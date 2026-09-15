import type { HardGateId } from './gates.js';
import type { DecisionPolicy } from './policy-schema.js';
import type { ReadinessRiskFact } from './scoring.js';

export const OPERATIONAL_STATUSES = ['READY', 'AT_RISK', 'BLOCKED'] as const;

export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

export const CERTIFICATION_STATES = ['CERTIFIED', 'DEGRADED', 'INSUFFICIENT'] as const;

export type CertificationState = (typeof CERTIFICATION_STATES)[number];

function hasBlockingSeverity(risks: readonly ReadinessRiskFact[]): boolean {
  return risks.some((risk) => risk.severity === 'HIGH' || risk.severity === 'CRITICAL');
}

export function operationalStatus(input: {
  readonly failedGateIds: readonly HardGateId[];
  readonly unresolvedGateIds: readonly HardGateId[];
  readonly readinessScore: number;
  readonly risks: readonly ReadinessRiskFact[];
  readonly unresolvedRequiredEvidenceScopes: readonly string[];
  readonly policy: DecisionPolicy;
}): OperationalStatus {
  if (input.failedGateIds.length > 0) {
    return 'BLOCKED';
  }
  if (
    input.unresolvedGateIds.length === 0 &&
    input.readinessScore >= input.policy.readiness.readyFloor &&
    !hasBlockingSeverity(input.risks) &&
    input.unresolvedRequiredEvidenceScopes.length === 0
  ) {
    return 'READY';
  }
  return 'AT_RISK';
}

export function certificationState(input: {
  readonly confidenceScore: number;
  readonly unresolvedRequiredEvidenceScopes: readonly string[];
  readonly policy: DecisionPolicy;
}): CertificationState {
  if (input.confidenceScore < input.policy.confidence.degradedFloor) {
    return 'INSUFFICIENT';
  }
  if (input.unresolvedRequiredEvidenceScopes.length > 0) {
    return 'DEGRADED';
  }
  if (input.confidenceScore >= input.policy.confidence.certifiedFloor) {
    return 'CERTIFIED';
  }
  return 'DEGRADED';
}
