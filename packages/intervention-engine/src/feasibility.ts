import {
  collectConstraintReasons,
  type ActivityWindowConstraint,
  type FeasibilityActivityView,
} from './constraints.js';

export const FEASIBILITY_REASONS = [
  'INTRODUCES_FAILED_HARD_GATE',
  'INTRODUCES_TOO_MANY_CRITICAL_RISKS',
  'INTRODUCES_TOO_MANY_HIGH_RISKS',
  'FEASIBILITY_CONSTRAINT_TARGET_MISSING',
  'INVALID_FEASIBILITY_CONSTRAINT',
] as const;

export type SystemicFeasibilityReason = (typeof FEASIBILITY_REASONS)[number];

export type FeasibilitySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface FeasibilityRiskTransitionView {
  readonly riskId: string;
  readonly incidentId: string;
  readonly subjectId: string;
  readonly beforeSeverity: FeasibilitySeverity | null;
  readonly afterSeverity: FeasibilitySeverity | null;
}

export interface FeasibilitySimulationView {
  readonly comparison: {
    readonly failedGatesIntroduced: readonly string[];
  };
  readonly introducedRisks: readonly FeasibilityRiskTransitionView[];
  readonly shadowGraph: {
    readonly operational: {
      readonly activities: readonly FeasibilityActivityView[];
    };
  };
}

export interface RecoveryFeasibilityPolicy {
  readonly maxIntroducedCriticalRisks: number;
  readonly maxIntroducedHighRisks: number;
}

export interface FeasibilityResult {
  readonly viable: boolean;
  readonly reasons: readonly string[];
}

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isSeverity(value: unknown): value is FeasibilitySeverity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
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

function policyLimitsValid(policy: RecoveryFeasibilityPolicy): boolean {
  return (
    policy !== null &&
    typeof policy === 'object' &&
    isInteger(policy.maxIntroducedCriticalRisks) &&
    isInteger(policy.maxIntroducedHighRisks) &&
    policy.maxIntroducedCriticalRisks >= 0 &&
    policy.maxIntroducedHighRisks >= 0
  );
}

function riskEntryValid(risk: FeasibilityRiskTransitionView): boolean {
  return (
    risk !== null &&
    typeof risk === 'object' &&
    typeof risk.riskId === 'string' &&
    risk.riskId.length > 0 &&
    typeof risk.incidentId === 'string' &&
    typeof risk.subjectId === 'string' &&
    (risk.beforeSeverity === null || isSeverity(risk.beforeSeverity)) &&
    (risk.afterSeverity === null || isSeverity(risk.afterSeverity))
  );
}

export function evaluateInterventionFeasibility(
  simulation: FeasibilitySimulationView,
  constraints: readonly ActivityWindowConstraint[],
  policy: RecoveryFeasibilityPolicy,
): FeasibilityResult {
  const reasons = new Set<string>();
  if (!policyLimitsValid(policy)) {
    reasons.add('INVALID_FEASIBILITY_CONSTRAINT');
  }

  const gates = simulation.comparison?.failedGatesIntroduced;
  if (!Array.isArray(gates)) {
    reasons.add('INVALID_FEASIBILITY_CONSTRAINT');
  } else if (gates.length > 0) {
    reasons.add('INTRODUCES_FAILED_HARD_GATE');
  }

  const introduced = simulation.introducedRisks;
  let criticalCount = 0;
  let highCount = 0;
  if (!Array.isArray(introduced)) {
    reasons.add('INVALID_FEASIBILITY_CONSTRAINT');
  } else {
    for (const risk of introduced) {
      if (!riskEntryValid(risk)) {
        reasons.add('INVALID_FEASIBILITY_CONSTRAINT');
        continue;
      }
      if (risk.afterSeverity === 'CRITICAL') {
        criticalCount += 1;
      } else if (risk.afterSeverity === 'HIGH') {
        highCount += 1;
      }
    }
  }
  if (policyLimitsValid(policy) && criticalCount > policy.maxIntroducedCriticalRisks) {
    reasons.add('INTRODUCES_TOO_MANY_CRITICAL_RISKS');
  }
  if (policyLimitsValid(policy) && highCount > policy.maxIntroducedHighRisks) {
    reasons.add('INTRODUCES_TOO_MANY_HIGH_RISKS');
  }

  const activities = simulation.shadowGraph?.operational?.activities;
  if (!Array.isArray(activities)) {
    reasons.add('INVALID_FEASIBILITY_CONSTRAINT');
  } else {
    for (const reason of collectConstraintReasons(activities, constraints)) {
      reasons.add(reason);
    }
  }

  const sorted = [...reasons].sort(compareOrdinal);
  return deepFreeze({
    viable: sorted.length === 0,
    reasons: sorted,
  });
}
