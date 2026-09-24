import {
  allEvidenceBelowFloor,
  confidenceFloorIsValid,
  type EscalationReason,
  type RankingDecision,
  type RankingPolicyView,
} from './escalation.js';
import {
  metricIsMaximized,
  metricMagnitude,
  metricsAreValid,
  type RecoveryMetricId,
  type RecoveryOutcomeMetrics,
} from './metrics.js';
import { priorityProfileIsValid, type ProductionPriorityProfile } from './priority-profile.js';

export interface RecoveryRankingOption {
  readonly optionId: string;
  readonly feasibility: {
    readonly viable: boolean;
    readonly reasons: readonly string[];
  };
  readonly metrics: RecoveryOutcomeMetrics;
}

export interface RankedRecoveryOption {
  readonly optionId: string;
  readonly metrics: RecoveryOutcomeMetrics;
}

export interface RecoveryRankingResult {
  readonly decision: RankingDecision;
  readonly orderedOptions: readonly RankedRecoveryOption[];
  readonly recommendedOptionId: string | null;
  readonly escalationReason: EscalationReason | null;
}

type PairRelation = 'left' | 'right' | 'tie' | 'tradeoff';
type GroupResolution = 'unique' | 'tie' | 'tradeoff';

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function copyMetrics(metrics: RecoveryOutcomeMetrics): RecoveryOutcomeMetrics {
  return {
    readinessImprovement: metrics.readinessImprovement,
    creativePreservation: metrics.creativePreservation,
    scheduleStability: metrics.scheduleStability,
    logisticsImpact: metrics.logisticsImpact,
    crewDisruption: metrics.crewDisruption,
    evidenceConfidence: metrics.evidenceConfidence,
    newRiskIntroduced: metrics.newRiskIntroduced,
  };
}

function present(option: RecoveryRankingOption): RankedRecoveryOption {
  return { optionId: option.optionId, metrics: copyMetrics(option.metrics) };
}

function byOptionId(left: RecoveryRankingOption, right: RecoveryRankingOption): number {
  return compareOrdinal(left.optionId, right.optionId);
}

function escalate(
  reason: EscalationReason,
  ordered: readonly RankedRecoveryOption[] = [],
): RecoveryRankingResult {
  return deepFreeze({
    decision: 'ESCALATE',
    orderedOptions: ordered,
    recommendedOptionId: null,
    escalationReason: reason,
  });
}

function optionInputIsValid(options: readonly RecoveryRankingOption[]): boolean {
  if (!Array.isArray(options)) {
    return false;
  }
  const seen = new Set<string>();
  for (const option of options) {
    if (
      option === null ||
      typeof option !== 'object' ||
      typeof option.optionId !== 'string' ||
      option.optionId.length === 0 ||
      seen.has(option.optionId) ||
      option.feasibility === null ||
      typeof option.feasibility !== 'object' ||
      typeof option.feasibility.viable !== 'boolean' ||
      !Array.isArray(option.feasibility.reasons) ||
      !metricsAreValid(option.metrics)
    ) {
      return false;
    }
    seen.add(option.optionId);
  }
  return true;
}

function compareMetric(
  metricId: RecoveryMetricId,
  left: RecoveryOutcomeMetrics,
  right: RecoveryOutcomeMetrics,
): number {
  const leftValue = metricMagnitude(left, metricId);
  const rightValue = metricMagnitude(right, metricId);
  if (leftValue === rightValue) {
    return 0;
  }
  const leftIsBetter = metricIsMaximized(metricId)
    ? leftValue > rightValue
    : leftValue < rightValue;
  return leftIsBetter ? 1 : -1;
}

function relate(
  left: RecoveryRankingOption,
  right: RecoveryRankingOption,
  metricIds: readonly RecoveryMetricId[],
): PairRelation {
  let leftBetter = false;
  let rightBetter = false;
  for (const metricId of metricIds) {
    const comparison = compareMetric(metricId, left.metrics, right.metrics);
    if (comparison > 0) {
      leftBetter = true;
    } else if (comparison < 0) {
      rightBetter = true;
    }
  }
  if (leftBetter && rightBetter) {
    return 'tradeoff';
  }
  if (leftBetter) {
    return 'left';
  }
  if (rightBetter) {
    return 'right';
  }
  return 'tie';
}

function paretoFront(
  candidates: readonly RecoveryRankingOption[],
  metricIds: readonly RecoveryMetricId[],
): RecoveryRankingOption[] {
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) => other !== candidate && relate(other, candidate, metricIds) === 'left',
      ),
  );
}

function frontIsExactTie(
  front: readonly RecoveryRankingOption[],
  metricIds: readonly RecoveryMetricId[],
): boolean {
  for (let index = 0; index < front.length; index += 1) {
    for (let other = index + 1; other < front.length; other += 1) {
      const left = front[index];
      const right = front[other];
      if (left === undefined || right === undefined || relate(left, right, metricIds) !== 'tie') {
        return false;
      }
    }
  }
  return true;
}

function orderGroup(
  candidates: readonly RecoveryRankingOption[],
  tiers: ProductionPriorityProfile['tiers'],
  tierIndex: number,
): { readonly ordered: RecoveryRankingOption[]; readonly resolution: GroupResolution } {
  if (candidates.length <= 1) {
    return { ordered: [...candidates], resolution: 'unique' };
  }
  const tier = tiers[tierIndex];
  if (tier === undefined) {
    return {
      ordered: [...candidates].sort(byOptionId),
      resolution: 'tie',
    };
  }
  const front = paretoFront(candidates, tier.metricIds);
  const dominated = candidates.filter((candidate) => !front.includes(candidate));
  if (frontIsExactTie(front, tier.metricIds)) {
    if (front.length === candidates.length) {
      return orderGroup(candidates, tiers, tierIndex + 1);
    }
    const leaders = orderGroup(front, tiers, tierIndex + 1);
    const rest = orderGroup(dominated, tiers, tierIndex);
    return {
      ordered: [...leaders.ordered, ...rest.ordered],
      resolution: leaders.resolution,
    };
  }
  const rest = orderGroup(dominated, tiers, tierIndex);
  return {
    ordered: [...[...front].sort(byOptionId), ...rest.ordered],
    resolution: 'tradeoff',
  };
}

function decide(
  ordered: readonly RecoveryRankingOption[],
  resolution: GroupResolution,
): RecoveryRankingResult {
  const presented = ordered.map(present);
  if (resolution === 'unique' && ordered.length > 0) {
    return deepFreeze({
      decision: 'RECOMMEND' as RankingDecision,
      orderedOptions: presented,
      recommendedOptionId: ordered[0]?.optionId ?? null,
      escalationReason: null,
    });
  }
  return deepFreeze({
    decision: 'PRESENT_TRADE_OFF',
    orderedOptions: presented,
    recommendedOptionId: null,
    escalationReason: 'PRIORITY_CONFLICT',
  });
}

export function rankRecoveryOptions(
  options: readonly RecoveryRankingOption[],
  profile: ProductionPriorityProfile,
  policy: RankingPolicyView,
): RecoveryRankingResult {
  if (
    !optionInputIsValid(options) ||
    !priorityProfileIsValid(profile) ||
    !confidenceFloorIsValid(policy)
  ) {
    return escalate('PRIORITY_CONFLICT');
  }
  const viable = options.filter((option) => option.feasibility.viable);
  if (viable.length === 0) {
    return escalate('NO_VIABLE_PLAN');
  }
  if (
    allEvidenceBelowFloor(
      viable.map((option) => option.metrics),
      policy.confidence.degradedFloor,
    )
  ) {
    return escalate('INSUFFICIENT_EVIDENCE', [...viable].sort(byOptionId).map(present));
  }
  const ranked = orderGroup(viable, profile.tiers, 0);
  return decide(ranked.ordered, ranked.resolution);
}
