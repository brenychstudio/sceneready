export const IMPACT_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export interface RecoveryOutcomeMetrics {
  readonly readinessImprovement: number;
  readonly creativePreservation: number;
  readonly scheduleStability: number;
  readonly logisticsImpact: ImpactLevel;
  readonly crewDisruption: ImpactLevel;
  readonly evidenceConfidence: number;
  readonly newRiskIntroduced: ImpactLevel;
}

export const IMPACT_RANK: Readonly<Record<ImpactLevel, number>> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const HIGHER_IS_BETTER = [
  'CREATIVE_PRESERVATION',
  'READINESS_IMPROVEMENT',
  'SCHEDULE_STABILITY',
  'EVIDENCE_CONFIDENCE',
] as const;

const LOWER_IS_BETTER = ['LOGISTICS_IMPACT', 'CREW_DISRUPTION', 'NEW_RISK_INTRODUCED'] as const;

export const RECOVERY_METRIC_IDS = [...HIGHER_IS_BETTER, ...LOWER_IS_BETTER] as const;

export type RecoveryMetricId = (typeof RECOVERY_METRIC_IDS)[number];

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return isInteger(value) && value >= minimum && value <= maximum;
}

function isImpact(value: unknown): value is ImpactLevel {
  return typeof value === 'string' && (IMPACT_LEVELS as readonly string[]).includes(value);
}

export function metricsAreValid(metrics: RecoveryOutcomeMetrics): boolean {
  return (
    metrics !== null &&
    typeof metrics === 'object' &&
    inRange(metrics.readinessImprovement, -100, 100) &&
    inRange(metrics.creativePreservation, 0, 100) &&
    inRange(metrics.scheduleStability, 0, 100) &&
    inRange(metrics.evidenceConfidence, 0, 100) &&
    isImpact(metrics.logisticsImpact) &&
    isImpact(metrics.crewDisruption) &&
    isImpact(metrics.newRiskIntroduced)
  );
}

export function metricIsMaximized(metricId: RecoveryMetricId): boolean {
  return (HIGHER_IS_BETTER as readonly string[]).includes(metricId);
}

export function metricMagnitude(
  metrics: RecoveryOutcomeMetrics,
  metricId: RecoveryMetricId,
): number {
  switch (metricId) {
    case 'CREATIVE_PRESERVATION':
      return metrics.creativePreservation;
    case 'READINESS_IMPROVEMENT':
      return metrics.readinessImprovement;
    case 'SCHEDULE_STABILITY':
      return metrics.scheduleStability;
    case 'EVIDENCE_CONFIDENCE':
      return metrics.evidenceConfidence;
    case 'LOGISTICS_IMPACT':
      return IMPACT_RANK[metrics.logisticsImpact];
    case 'CREW_DISRUPTION':
      return IMPACT_RANK[metrics.crewDisruption];
    case 'NEW_RISK_INTRODUCED':
      return IMPACT_RANK[metrics.newRiskIntroduced];
  }
}
