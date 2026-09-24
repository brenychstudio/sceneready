import type { RecoveryOutcomeMetrics } from './metrics.js';

export const RANKING_DECISIONS = ['RECOMMEND', 'PRESENT_TRADE_OFF', 'ESCALATE'] as const;

export type RankingDecision = (typeof RANKING_DECISIONS)[number];

export const ESCALATION_REASONS = [
  'NO_VIABLE_PLAN',
  'INSUFFICIENT_EVIDENCE',
  'PRIORITY_CONFLICT',
] as const;

export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export interface RankingPolicyView {
  readonly confidence: {
    readonly degradedFloor: number;
  };
}

export function confidenceFloorIsValid(policy: RankingPolicyView): boolean {
  const floor = policy?.confidence?.degradedFloor;
  return typeof floor === 'number' && Number.isInteger(floor) && floor >= 0 && floor <= 100;
}

export function allEvidenceBelowFloor(
  metrics: readonly Pick<RecoveryOutcomeMetrics, 'evidenceConfidence'>[],
  floor: number,
): boolean {
  return metrics.length > 0 && metrics.every((candidate) => candidate.evidenceConfidence < floor);
}
