import type { ProductionReadinessAssessment } from './evaluate.js';
import type { DeliverableImportance, ScoreSeverity } from './scoring.js';

export interface DeliverableOutcomeFact {
  readonly deliverableId: string;
  readonly importance: DeliverableImportance;
  readonly beforeProtected: boolean;
  readonly afterProtected: boolean;
}

export interface RiskTransition {
  readonly riskId: string;
  readonly subjectId: string;
  readonly beforeSeverity: ScoreSeverity;
  readonly afterSeverity: ScoreSeverity | null;
}

export interface OutcomeCostProfile {
  readonly costPerMinute: number;
  readonly currency: string;
}

export interface MonetaryImpact {
  readonly amount: number;
  readonly currency: string;
  readonly basis: 'EXPLICIT_DELAY_MINUTES_RATE';
}

export interface ReadinessComparison {
  readonly before: ProductionReadinessAssessment;
  readonly after: ProductionReadinessAssessment;
  readonly deliverableOutcomes: readonly DeliverableOutcomeFact[];
  readonly preservedCreativeEnvelopeIds: readonly string[];
  readonly beforePredictedStudioDelayMinutes: number;
  readonly afterPredictedStudioDelayMinutes: number;
  readonly affectedPersonIds: readonly string[];
  readonly riskTransitions: readonly RiskTransition[];
  readonly costProfile?: OutcomeCostProfile | null;
}

export interface OperationalOutcomeMetrics {
  readonly protectedCriticalDeliverables: number;
  readonly preservedCreativeEnvelopes: number;
  readonly predictedStudioDelayReductionMinutes: number;
  readonly crewMembersAffected: number;
  readonly riskReductions: readonly RiskTransition[];
  readonly monetaryImpact: MonetaryImpact | null;
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

function uniqueSorted(ids: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(ids)].sort(compareOrdinal));
}

function delayReduction(beforeMinutes: number, afterMinutes: number): number {
  const delta = beforeMinutes - afterMinutes;
  if (delta < 0) {
    return 0;
  }
  return delta;
}

function freezeTransition(item: RiskTransition): RiskTransition {
  return Object.freeze({
    riskId: item.riskId,
    subjectId: item.subjectId,
    beforeSeverity: item.beforeSeverity,
    afterSeverity: item.afterSeverity,
  });
}

function compareTransitions(left: RiskTransition, right: RiskTransition): number {
  const riskOrder = compareOrdinal(left.riskId, right.riskId);
  if (riskOrder !== 0) {
    return riskOrder;
  }
  return compareOrdinal(left.subjectId, right.subjectId);
}

export function calculateOutcomeMetrics(
  comparison: ReadinessComparison,
): OperationalOutcomeMetrics {
  const protectedIds = new Set<string>();
  for (const fact of comparison.deliverableOutcomes) {
    if (
      fact.importance === 'CRITICAL' &&
      fact.beforeProtected === false &&
      fact.afterProtected === true
    ) {
      protectedIds.add(fact.deliverableId);
    }
  }

  const reduction = delayReduction(
    comparison.beforePredictedStudioDelayMinutes,
    comparison.afterPredictedStudioDelayMinutes,
  );
  const costProfile = comparison.costProfile;
  const monetaryImpact =
    costProfile === undefined || costProfile === null
      ? null
      : Object.freeze({
          amount: reduction * costProfile.costPerMinute,
          currency: costProfile.currency,
          basis: 'EXPLICIT_DELAY_MINUTES_RATE' as const,
        });

  return Object.freeze({
    protectedCriticalDeliverables: protectedIds.size,
    preservedCreativeEnvelopes: uniqueSorted(comparison.preservedCreativeEnvelopeIds).length,
    predictedStudioDelayReductionMinutes: reduction,
    crewMembersAffected: uniqueSorted(comparison.affectedPersonIds).length,
    riskReductions: Object.freeze(
      [...comparison.riskTransitions].map(freezeTransition).sort(compareTransitions),
    ),
    monetaryImpact,
  });
}
