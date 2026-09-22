import type {
  CertificationState,
  HardGateId,
  OperationalStatus,
  ProductionReadinessAssessment,
  ReadinessImpactFact,
  ScoreSeverity,
} from '@sceneready/readiness-engine';
import { SCORE_SEVERITIES } from '@sceneready/readiness-engine';

export interface ShadowRiskTransition {
  readonly riskId: string;
  readonly incidentId: string;
  readonly subjectId: string;
  readonly beforeSeverity: ScoreSeverity | null;
  readonly afterSeverity: ScoreSeverity | null;
}

export interface ShadowComparison {
  readonly readinessDelta: number;
  readonly confidenceDelta: number;
  readonly statusBefore: OperationalStatus;
  readonly statusAfter: OperationalStatus;
  readonly certificationBefore: CertificationState;
  readonly certificationAfter: CertificationState;
  readonly failedGatesIntroduced: readonly HardGateId[];
  readonly failedGatesResolved: readonly HardGateId[];
  readonly unresolvedGatesIntroduced: readonly HardGateId[];
  readonly unresolvedGatesResolved: readonly HardGateId[];
  readonly riskTransitions: readonly ShadowRiskTransition[];
  readonly introducedRisks: readonly ShadowRiskTransition[];
  readonly resolvedOrReducedRisks: readonly ShadowRiskTransition[];
  readonly preservedDeliverables: readonly string[];
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

function severityRank(severity: ScoreSeverity): number {
  return SCORE_SEVERITIES.indexOf(severity);
}

function riskKey(incidentId: string, riskId: string, subjectId: string): string {
  return `${incidentId}\u0000${riskId}\u0000${subjectId}`;
}

interface RiskIdentity {
  readonly incidentId: string;
  readonly riskId: string;
  readonly subjectId: string;
  readonly severity: ScoreSeverity;
}

function indexRisks(assessment: ProductionReadinessAssessment): Map<string, RiskIdentity> {
  const indexed = new Map<string, RiskIdentity>();
  for (const risk of assessment.risks) {
    const key = riskKey(risk.incidentId, risk.riskId, risk.subjectId);
    const existing = indexed.get(key);
    if (existing === undefined || severityRank(risk.severity) > severityRank(existing.severity)) {
      indexed.set(key, {
        incidentId: risk.incidentId,
        riskId: risk.riskId,
        subjectId: risk.subjectId,
        severity: risk.severity,
      });
    }
  }
  return indexed;
}

function compareTransitions(left: ShadowRiskTransition, right: ShadowRiskTransition): number {
  const riskOrder = compareOrdinal(left.riskId, right.riskId);
  if (riskOrder !== 0) {
    return riskOrder;
  }
  const incidentOrder = compareOrdinal(left.incidentId, right.incidentId);
  if (incidentOrder !== 0) {
    return incidentOrder;
  }
  return compareOrdinal(left.subjectId, right.subjectId);
}

function freezeTransition(transition: ShadowRiskTransition): ShadowRiskTransition {
  return Object.freeze({ ...transition });
}

function idDifference(
  before: readonly string[],
  after: readonly string[],
): { readonly introduced: readonly string[]; readonly resolved: readonly string[] } {
  const beforeIds = new Set(before);
  const afterIds = new Set(after);
  return {
    introduced: Object.freeze(
      [...afterIds].filter((id) => !beforeIds.has(id)).sort(compareOrdinal),
    ),
    resolved: Object.freeze([...beforeIds].filter((id) => !afterIds.has(id)).sort(compareOrdinal)),
  };
}

function maxImpactSeverity(impacts: readonly ReadinessImpactFact[]): Map<string, ScoreSeverity> {
  const indexed = new Map<string, ScoreSeverity>();
  for (const impact of impacts) {
    const existing = indexed.get(impact.deliverableId);
    if (existing === undefined || severityRank(impact.severity) > severityRank(existing)) {
      indexed.set(impact.deliverableId, impact.severity);
    }
  }
  return indexed;
}

function preservedDeliverables(
  before: ProductionReadinessAssessment,
  after: ProductionReadinessAssessment,
): readonly string[] {
  const beforeImpacts = maxImpactSeverity(before.impacts);
  const afterImpacts = maxImpactSeverity(after.impacts);
  const cleared: string[] = [];
  for (const deliverableId of beforeImpacts.keys()) {
    if (!afterImpacts.has(deliverableId)) {
      cleared.push(deliverableId);
    }
  }
  return Object.freeze(cleared.sort(compareOrdinal));
}

export function compareProductionAssessments(
  before: ProductionReadinessAssessment,
  after: ProductionReadinessAssessment,
): ShadowComparison {
  const beforeRisks = indexRisks(before);
  const afterRisks = indexRisks(after);
  const keys = new Set<string>([...beforeRisks.keys(), ...afterRisks.keys()]);
  const transitions: ShadowRiskTransition[] = [];
  for (const key of keys) {
    const earlier = beforeRisks.get(key);
    const later = afterRisks.get(key);
    const beforeSeverity = earlier?.severity ?? null;
    const afterSeverity = later?.severity ?? null;
    if (beforeSeverity === afterSeverity) {
      continue;
    }
    const identity = later ?? earlier;
    if (identity === undefined) {
      continue;
    }
    transitions.push(
      freezeTransition({
        riskId: identity.riskId,
        incidentId: identity.incidentId,
        subjectId: identity.subjectId,
        beforeSeverity,
        afterSeverity,
      }),
    );
  }
  const riskTransitions = Object.freeze(transitions.sort(compareTransitions));
  const introducedRisks = Object.freeze(
    riskTransitions.filter((item) => {
      if (item.afterSeverity === null) {
        return false;
      }
      if (item.beforeSeverity === null) {
        return true;
      }
      return severityRank(item.afterSeverity) > severityRank(item.beforeSeverity);
    }),
  );
  const resolvedOrReducedRisks = Object.freeze(
    riskTransitions.filter((item) => {
      if (item.beforeSeverity === null) {
        return false;
      }
      if (item.afterSeverity === null) {
        return true;
      }
      return severityRank(item.afterSeverity) < severityRank(item.beforeSeverity);
    }),
  );
  const failed = idDifference(before.failedGateIds, after.failedGateIds);
  const unresolved = idDifference(before.unresolvedGateIds, after.unresolvedGateIds);

  return Object.freeze({
    readinessDelta: after.readinessScore - before.readinessScore,
    confidenceDelta: after.confidenceScore - before.confidenceScore,
    statusBefore: before.status,
    statusAfter: after.status,
    certificationBefore: before.certification,
    certificationAfter: after.certification,
    failedGatesIntroduced: failed.introduced as readonly HardGateId[],
    failedGatesResolved: failed.resolved as readonly HardGateId[],
    unresolvedGatesIntroduced: unresolved.introduced as readonly HardGateId[],
    unresolvedGatesResolved: unresolved.resolved as readonly HardGateId[],
    riskTransitions,
    introducedRisks,
    resolvedOrReducedRisks,
    preservedDeliverables: preservedDeliverables(before, after),
  });
}
