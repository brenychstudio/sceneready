import {
  compareCausalImpact,
  compareCausalPaths,
  freezeImpact,
  maxRiskSeverity,
  uniqueSortedIds,
  type CausalImpact,
  type CausalPath,
} from './risk.js';

function pathOf(impact: CausalImpact): CausalPath {
  return {
    nodeIds: impact.pathNodeIds,
    edgeIds: impact.pathEdgeIds,
  };
}

function mergeImpactGroup(impacts: readonly CausalImpact[]): CausalImpact {
  const first = impacts[0];
  if (first === undefined) {
    throw new Error('canonical JSON rejected: empty causal impact group');
  }

  let severity = first.severity;
  let path = pathOf(first);
  const evidenceIds: string[] = [...first.sourceEvidenceIds];
  const riskIds: string[] = [...first.riskIds];

  for (const impact of impacts.slice(1)) {
    severity = maxRiskSeverity(severity, impact.severity);
    const candidate = pathOf(impact);
    if (compareCausalPaths(candidate, path) < 0) {
      path = candidate;
    }
    evidenceIds.push(...impact.sourceEvidenceIds);
    riskIds.push(...impact.riskIds);
  }

  return freezeImpact({
    incidentId: first.incidentId,
    deliverableId: first.deliverableId,
    severity,
    pathNodeIds: path.nodeIds,
    pathEdgeIds: path.edgeIds,
    dedupeKey: first.dedupeKey,
    sourceEvidenceIds: uniqueSortedIds(evidenceIds),
    riskIds: uniqueSortedIds(riskIds),
  });
}

export function deduplicateImpacts(candidates: readonly CausalImpact[]): readonly CausalImpact[] {
  const groups = new Map<string, CausalImpact[]>();
  for (const impact of candidates) {
    const existing = groups.get(impact.dedupeKey);
    if (existing === undefined) {
      groups.set(impact.dedupeKey, [impact]);
    } else {
      existing.push(impact);
    }
  }

  const merged: CausalImpact[] = [];
  for (const group of groups.values()) {
    merged.push(mergeImpactGroup(group));
  }
  return Object.freeze(merged.sort(compareCausalImpact));
}
