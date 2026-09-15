import { PRODUCTION_DOMAINS, type DomainHealth, type ProductionDomainId } from './domain-health.js';
import type { GateState } from './gates.js';

export const SCORING_VERSION = 'SR-SCORE-v1';

export const SCORE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type ScoreSeverity = (typeof SCORE_SEVERITIES)[number];

export const DELIVERABLE_IMPORTANCES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type DeliverableImportance = (typeof DELIVERABLE_IMPORTANCES)[number];

export const SR_SCORE_V1 = Object.freeze({
  scoringVersion: SCORING_VERSION,
  domainPenalty: Object.freeze({
    PASSED: 0,
    UNRESOLVED: 10,
    FAILED: 22,
  }),
  severityWeight: Object.freeze({
    LOW: 1,
    MEDIUM: 2,
    HIGH: 4,
    CRITICAL: 6,
  }),
  importanceWeight: Object.freeze({
    LOW: 1,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  }),
});

export interface ReadinessRiskFact {
  readonly riskId: string;
  readonly incidentId: string;
  readonly subjectId: string;
  readonly severity: ScoreSeverity;
  readonly sourceEvidenceIds: readonly string[];
  readonly reasons?: readonly string[];
}

export interface ReadinessImpactFact {
  readonly incidentId: string;
  readonly deliverableId: string;
  readonly severity: ScoreSeverity;
  readonly sourceEvidenceIds: readonly string[];
  readonly riskIds: readonly string[];
}

export interface DeliverableWeightFact {
  readonly deliverableId: string;
  readonly importance: DeliverableImportance;
}

export interface DomainScore {
  readonly domain: ProductionDomainId;
  readonly state: GateState;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface ReadinessScoreResult {
  readonly readinessScore: number;
  readonly domainScores: readonly DomainScore[];
  readonly impacts: readonly ReadinessImpactFact[];
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function uniqueSortedIds(ids: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(ids)].sort(compareOrdinal));
}

export function clampScore(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function isScoreSeverity(value: string): value is ScoreSeverity {
  return (SCORE_SEVERITIES as readonly string[]).includes(value);
}

function isDeliverableImportance(value: string): value is DeliverableImportance {
  return (DELIVERABLE_IMPORTANCES as readonly string[]).includes(value);
}

function severityRank(severity: ScoreSeverity): number {
  return SR_SCORE_V1.severityWeight[severity];
}

function maxSeverity(left: ScoreSeverity, right: ScoreSeverity): ScoreSeverity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function impactKey(impact: ReadinessImpactFact): string {
  return `${impact.incidentId}\u0000${impact.deliverableId}`;
}

function lookupImportance(
  deliverableId: string,
  deliverables: readonly DeliverableWeightFact[],
): DeliverableImportance {
  const found = deliverables.find((item) => item.deliverableId === deliverableId);
  if (found !== undefined && isDeliverableImportance(found.importance)) {
    return found.importance;
  }
  return 'CRITICAL';
}

function impactPenalty(severity: ScoreSeverity, importance: DeliverableImportance): number {
  return SR_SCORE_V1.severityWeight[severity] * SR_SCORE_V1.importanceWeight[importance];
}

export function deduplicateImpacts(
  impacts: readonly ReadinessImpactFact[],
): readonly ReadinessImpactFact[] {
  const groups = new Map<string, ReadinessImpactFact[]>();
  for (const item of impacts) {
    if (!isScoreSeverity(item.severity)) {
      continue;
    }
    const key = impactKey(item);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [item]);
    } else {
      existing.push(item);
    }
  }

  const merged: ReadinessImpactFact[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    let severity = first.severity;
    const evidenceIds: string[] = [...first.sourceEvidenceIds];
    const riskIds: string[] = [...first.riskIds];
    for (const item of group.slice(1)) {
      severity = maxSeverity(severity, item.severity);
      evidenceIds.push(...item.sourceEvidenceIds);
      riskIds.push(...item.riskIds);
    }
    merged.push(
      Object.freeze({
        incidentId: first.incidentId,
        deliverableId: first.deliverableId,
        severity,
        sourceEvidenceIds: uniqueSortedIds(evidenceIds),
        riskIds: uniqueSortedIds(riskIds),
      }),
    );
  }

  return Object.freeze(
    merged.sort((left, right) => {
      const incidentOrder = compareOrdinal(left.incidentId, right.incidentId);
      if (incidentOrder !== 0) {
        return incidentOrder;
      }
      return compareOrdinal(left.deliverableId, right.deliverableId);
    }),
  );
}

export function scoreReadiness(input: {
  readonly domains: readonly DomainHealth[];
  readonly impacts: readonly ReadinessImpactFact[];
  readonly deliverables: readonly DeliverableWeightFact[];
}): ReadinessScoreResult {
  const byDomain = new Map(input.domains.map((item) => [item.domain, item]));
  const domainScores = Object.freeze(
    PRODUCTION_DOMAINS.map((domain) => {
      const health = byDomain.get(domain);
      const state = health?.state ?? 'UNRESOLVED';
      const penalty = SR_SCORE_V1.domainPenalty[state];
      return Object.freeze({
        domain,
        state,
        score: clampScore(100 - penalty),
        reasons: Object.freeze([...(health?.reasons ?? [])]),
      });
    }),
  );

  const impacts = deduplicateImpacts(input.impacts);
  let penalty = 0;
  for (const item of domainScores) {
    penalty += SR_SCORE_V1.domainPenalty[item.state];
  }
  for (const item of impacts) {
    penalty += impactPenalty(
      item.severity,
      lookupImportance(item.deliverableId, input.deliverables),
    );
  }

  return Object.freeze({
    readinessScore: clampScore(100 - penalty),
    domainScores,
    impacts,
  });
}
