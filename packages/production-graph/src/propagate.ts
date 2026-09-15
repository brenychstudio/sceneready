import { deduplicateImpacts } from './deduplicate.js';
import type { ProductionGraphEdge } from './edge.js';
import type { ProductionGraph } from './graph.js';
import { indexProductionGraph, type ProductionGraphIndexes } from './indexes.js';
import {
  compareOrdinal,
  comparePropagatedRisk,
  compareRejectedInput,
  freezeImpact,
  freezeRejected,
  freezeRisk,
  impactDedupeKey,
  isRiskSeverity,
  type CausalImpact,
  type CausalPath,
  type CausalTraceInput,
  type CausalTraceResult,
  type PropagatedRisk,
  type RejectedRiskInput,
  type RiskIncidentInput,
  type RiskPropagationInput,
  type RiskPropagationResult,
} from './risk.js';
import { causalEdgeId, concatCausalPaths, compareCausalPaths, trivialCausalPath } from './trace.js';

interface CausalHop {
  readonly to: string;
  readonly edge: ProductionGraphEdge;
}

function causalSuccessor(
  edge: ProductionGraphEdge,
): { readonly from: string; readonly to: string } | null {
  switch (edge.type) {
    case 'AFFECTS':
    case 'DEGRADES':
    case 'SCHEDULED_BEFORE':
    case 'BLOCKS':
      return { from: edge.from, to: edge.to };
    case 'REQUIRES':
      return { from: edge.to, to: edge.from };
    case 'FALLBACK_FOR':
      return null;
  }
}

function compareCausalHops(left: CausalHop, right: CausalHop): number {
  const byTo = compareOrdinal(left.to, right.to);
  if (byTo !== 0) {
    return byTo;
  }
  return compareOrdinal(causalEdgeId(left.edge), causalEdgeId(right.edge));
}

function buildCausalAdjacency(graph: ProductionGraph): ReadonlyMap<string, readonly CausalHop[]> {
  const hops = new Map<string, CausalHop[]>();
  for (const node of graph.nodes) {
    hops.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const successor = causalSuccessor(edge);
    if (successor === null) {
      continue;
    }
    hops.get(successor.from)?.push({ to: successor.to, edge });
  }

  const frozen = new Map<string, readonly CausalHop[]>();
  for (const [nodeId, list] of hops) {
    frozen.set(nodeId, Object.freeze([...list].sort(compareCausalHops)));
  }
  return frozen;
}

function bestPathsFrom(
  startId: string,
  adjacency: ReadonlyMap<string, readonly CausalHop[]>,
): ReadonlyMap<string, CausalPath> {
  const best = new Map<string, CausalPath>();
  best.set(startId, trivialCausalPath(startId));
  const queue = [startId];
  let next = 0;

  while (next < queue.length) {
    const current = queue[next];
    next += 1;
    if (current === undefined) {
      continue;
    }
    const path = best.get(current);
    if (path === undefined) {
      continue;
    }
    const onPath = new Set(path.nodeIds);
    for (const hop of adjacency.get(current) ?? []) {
      if (onPath.has(hop.to)) {
        continue;
      }
      const candidate: CausalPath = {
        nodeIds: Object.freeze([...path.nodeIds, hop.to]),
        edgeIds: Object.freeze([...path.edgeIds, causalEdgeId(hop.edge)]),
      };
      const existing = best.get(hop.to);
      if (existing === undefined || compareCausalPaths(candidate, existing) < 0) {
        best.set(hop.to, candidate);
        queue.push(hop.to);
      }
    }
  }

  return best;
}

function selectEvidencePrefix(
  risk: PropagatedRisk,
  adjacency: ReadonlyMap<string, readonly CausalHop[]>,
  indexes: ProductionGraphIndexes,
): CausalPath {
  let best: CausalPath | undefined;
  for (const evidenceId of risk.sourceEvidenceIds) {
    if (!indexes.nodesById.has(evidenceId)) {
      continue;
    }
    const toSubject = bestPathsFrom(evidenceId, adjacency).get(risk.subjectId);
    if (toSubject === undefined) {
      continue;
    }
    if (best === undefined || compareCausalPaths(toSubject, best) < 0) {
      best = toSubject;
    }
  }
  return best ?? trivialCausalPath(risk.subjectId);
}

function classifyIncident(
  graph: ProductionGraph,
  incident: RiskIncidentInput,
):
  | { readonly ok: true; readonly risk: PropagatedRisk }
  | { readonly ok: false; readonly rejected: RejectedRiskInput } {
  const reasons: string[] = [];
  if (!isRiskSeverity(incident.severity)) {
    reasons.push('INVALID_SEVERITY');
  }
  if (!graph.nodes.some((node) => node.id === incident.subjectId)) {
    reasons.push('UNKNOWN_SUBJECT');
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      rejected: freezeRejected({
        incidentId: incident.incidentId,
        riskId: incident.riskId,
        subjectId: incident.subjectId,
        reasons,
      }),
    };
  }
  return {
    ok: true,
    risk: freezeRisk({
      riskId: incident.riskId,
      incidentId: incident.incidentId,
      subjectId: incident.subjectId,
      severity: incident.severity,
      sourceEvidenceIds: incident.sourceEvidenceIds,
      reasons: incident.reasons ?? [],
    }),
  };
}

function collectCandidateImpacts(
  indexes: ProductionGraphIndexes,
  adjacency: ReadonlyMap<string, readonly CausalHop[]>,
  risk: PropagatedRisk,
): readonly CausalImpact[] {
  const prefix = selectEvidencePrefix(risk, adjacency, indexes);
  const fromSubject = bestPathsFrom(risk.subjectId, adjacency);
  const impacts: CausalImpact[] = [];

  for (const [nodeId, suffix] of fromSubject) {
    const node = indexes.nodesById.get(nodeId);
    if (node?.type !== 'DELIVERABLE') {
      continue;
    }
    const path = concatCausalPaths(prefix, suffix);
    impacts.push(
      freezeImpact({
        incidentId: risk.incidentId,
        deliverableId: nodeId,
        severity: risk.severity,
        pathNodeIds: path.nodeIds,
        pathEdgeIds: path.edgeIds,
        dedupeKey: impactDedupeKey(risk.incidentId, nodeId),
        sourceEvidenceIds: risk.sourceEvidenceIds,
        riskIds: [risk.riskId],
      }),
    );
  }

  return impacts;
}

export function propagateRisk(input: RiskPropagationInput): RiskPropagationResult {
  const indexes = indexProductionGraph(input.graph);
  const adjacency = buildCausalAdjacency(input.graph);
  const risks: PropagatedRisk[] = [];
  const rejected: RejectedRiskInput[] = [];
  const candidates: CausalImpact[] = [];

  for (const incident of input.incidents) {
    const classified = classifyIncident(input.graph, incident);
    if (!classified.ok) {
      rejected.push(classified.rejected);
      continue;
    }
    risks.push(classified.risk);
    candidates.push(...collectCandidateImpacts(indexes, adjacency, classified.risk));
  }

  return Object.freeze({
    risks: Object.freeze([...risks].sort(comparePropagatedRisk)),
    impacts: deduplicateImpacts(candidates),
    rejected: Object.freeze([...rejected].sort(compareRejectedInput)),
  });
}

export function traceCausalImpact(input: CausalTraceInput): CausalTraceResult {
  const result = propagateRisk({
    graph: input.graph,
    incidents: [input.incident],
  });
  return Object.freeze({
    risk: result.risks[0] ?? null,
    impacts: result.impacts,
    rejected: result.rejected[0] ?? null,
  });
}
