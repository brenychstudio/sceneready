import type { ProductionGraph } from './graph.js';

export const RISK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

const SEVERITY_RANK: Readonly<Record<RiskSeverity, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function isRiskSeverity(value: unknown): value is RiskSeverity {
  return typeof value === 'string' && (RISK_SEVERITIES as readonly string[]).includes(value);
}

export function compareRiskSeverity(left: RiskSeverity, right: RiskSeverity): number {
  return SEVERITY_RANK[left] - SEVERITY_RANK[right];
}

export function maxRiskSeverity(left: RiskSeverity, right: RiskSeverity): RiskSeverity {
  return compareRiskSeverity(left, right) >= 0 ? left : right;
}

export function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function uniqueSortedIds(ids: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(ids)].sort(compareOrdinal));
}

export function impactDedupeKey(incidentId: string, deliverableId: string): string {
  return `${incidentId}\u0000${deliverableId}`;
}

export interface RiskIncidentInput {
  readonly incidentId: string;
  readonly riskId: string;
  readonly subjectId: string;
  readonly severity: RiskSeverity;
  readonly sourceEvidenceIds: readonly string[];
  readonly reasons?: readonly string[];
}

export interface PropagatedRisk {
  readonly riskId: string;
  readonly incidentId: string;
  readonly subjectId: string;
  readonly severity: RiskSeverity;
  readonly sourceEvidenceIds: readonly string[];
  readonly reasons: readonly string[];
}

export interface RejectedRiskInput {
  readonly incidentId: string;
  readonly riskId: string;
  readonly subjectId: string;
  readonly reasons: readonly string[];
}

export interface CausalPath {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface CausalImpact {
  readonly incidentId: string;
  readonly deliverableId: string;
  readonly severity: RiskSeverity;
  readonly pathNodeIds: readonly string[];
  readonly pathEdgeIds: readonly string[];
  readonly dedupeKey: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly riskIds: readonly string[];
}

export interface RiskPropagationInput {
  readonly graph: ProductionGraph;
  readonly incidents: readonly RiskIncidentInput[];
}

export interface RiskPropagationResult {
  readonly risks: readonly PropagatedRisk[];
  readonly impacts: readonly CausalImpact[];
  readonly rejected: readonly RejectedRiskInput[];
}

export interface CausalTraceInput {
  readonly graph: ProductionGraph;
  readonly incident: RiskIncidentInput;
}

export interface CausalTraceResult {
  readonly risk: PropagatedRisk | null;
  readonly impacts: readonly CausalImpact[];
  readonly rejected: RejectedRiskInput | null;
}

export function serializeCausalPath(path: CausalPath): string {
  return `${path.nodeIds.join('\u0000')}\u0001${path.edgeIds.join('\u0000')}`;
}

export function compareCausalPaths(left: CausalPath, right: CausalPath): number {
  if (left.nodeIds.length !== right.nodeIds.length) {
    return left.nodeIds.length - right.nodeIds.length;
  }
  if (left.edgeIds.length !== right.edgeIds.length) {
    return left.edgeIds.length - right.edgeIds.length;
  }
  return compareOrdinal(serializeCausalPath(left), serializeCausalPath(right));
}

export function freezeRisk(risk: PropagatedRisk): PropagatedRisk {
  return Object.freeze({
    riskId: risk.riskId,
    incidentId: risk.incidentId,
    subjectId: risk.subjectId,
    severity: risk.severity,
    sourceEvidenceIds: uniqueSortedIds(risk.sourceEvidenceIds),
    reasons: uniqueSortedIds(risk.reasons),
  });
}

export function freezeRejected(rejected: RejectedRiskInput): RejectedRiskInput {
  return Object.freeze({
    incidentId: rejected.incidentId,
    riskId: rejected.riskId,
    subjectId: rejected.subjectId,
    reasons: uniqueSortedIds(rejected.reasons),
  });
}

export function freezeImpact(impact: CausalImpact): CausalImpact {
  return Object.freeze({
    incidentId: impact.incidentId,
    deliverableId: impact.deliverableId,
    severity: impact.severity,
    pathNodeIds: Object.freeze([...impact.pathNodeIds]),
    pathEdgeIds: Object.freeze([...impact.pathEdgeIds]),
    dedupeKey: impact.dedupeKey,
    sourceEvidenceIds: uniqueSortedIds(impact.sourceEvidenceIds),
    riskIds: uniqueSortedIds(impact.riskIds),
  });
}

export function comparePropagatedRisk(left: PropagatedRisk, right: PropagatedRisk): number {
  const incidentOrder = compareOrdinal(left.incidentId, right.incidentId);
  if (incidentOrder !== 0) {
    return incidentOrder;
  }
  const riskOrder = compareOrdinal(left.riskId, right.riskId);
  if (riskOrder !== 0) {
    return riskOrder;
  }
  return compareOrdinal(left.subjectId, right.subjectId);
}

export function compareCausalImpact(left: CausalImpact, right: CausalImpact): number {
  const incidentOrder = compareOrdinal(left.incidentId, right.incidentId);
  if (incidentOrder !== 0) {
    return incidentOrder;
  }
  return compareOrdinal(left.deliverableId, right.deliverableId);
}

export function compareRejectedInput(left: RejectedRiskInput, right: RejectedRiskInput): number {
  const incidentOrder = compareOrdinal(left.incidentId, right.incidentId);
  if (incidentOrder !== 0) {
    return incidentOrder;
  }
  const riskOrder = compareOrdinal(left.riskId, right.riskId);
  if (riskOrder !== 0) {
    return riskOrder;
  }
  return compareOrdinal(left.subjectId, right.subjectId);
}
