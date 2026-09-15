import {
  certificationState,
  operationalStatus,
  type CertificationState,
  type OperationalStatus,
} from './certification.js';
import {
  scoreConfidence,
  type EvidenceConfidenceFact,
  type EvidenceReference,
} from './confidence.js';
import {
  evaluateCriticalGates,
  type GateResult,
  type HardGateId,
  type ReadinessEvaluationInput,
} from './gates.js';
import type { DecisionPolicy } from './policy-schema.js';
import {
  SCORING_VERSION,
  scoreReadiness,
  type DeliverableWeightFact,
  type DomainScore,
  type ReadinessImpactFact,
  type ReadinessRiskFact,
} from './scoring.js';

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

export interface ProductionEvaluationInput extends ReadinessEvaluationInput {
  readonly policy: DecisionPolicy;
  readonly risks: readonly ReadinessRiskFact[];
  readonly impacts: readonly ReadinessImpactFact[];
  readonly deliverables: readonly DeliverableWeightFact[];
  readonly confidenceFacts: readonly EvidenceConfidenceFact[];
  readonly requiredEvidenceScopes: readonly string[];
}

export interface ProductionReadinessAssessment {
  readonly scoringVersion: typeof SCORING_VERSION;
  readonly policyVersion: DecisionPolicy['policyVersion'];
  readonly readinessScore: number;
  readonly confidenceScore: number;
  readonly status: OperationalStatus;
  readonly certification: CertificationState;
  readonly domainScores: readonly DomainScore[];
  readonly gates: readonly GateResult[];
  readonly failedGateIds: readonly HardGateId[];
  readonly unresolvedGateIds: readonly HardGateId[];
  readonly risks: readonly ReadinessRiskFact[];
  readonly impacts: readonly ReadinessImpactFact[];
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly unresolvedRequiredEvidenceScopes: readonly string[];
}

function freezeRisk(risk: ReadinessRiskFact): ReadinessRiskFact {
  return Object.freeze({
    riskId: risk.riskId,
    incidentId: risk.incidentId,
    subjectId: risk.subjectId,
    severity: risk.severity,
    sourceEvidenceIds: uniqueSortedIds(risk.sourceEvidenceIds),
    reasons: uniqueSortedIds(risk.reasons ?? []),
  });
}

function compareRisks(left: ReadinessRiskFact, right: ReadinessRiskFact): number {
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

export function evaluateProductionReadiness(
  input: ProductionEvaluationInput,
): ProductionReadinessAssessment {
  const gates = evaluateCriticalGates(input);
  const scored = scoreReadiness({
    domainFacts: input.domainFacts ?? [],
    impacts: input.impacts,
    deliverables: input.deliverables,
  });
  const confidence = scoreConfidence({
    requiredEvidenceScopes: input.requiredEvidenceScopes,
    confidenceFacts: input.confidenceFacts,
  });
  const risks = Object.freeze([...input.risks.map(freezeRisk)].sort(compareRisks));
  const status = operationalStatus({
    failedGateIds: gates.failedGateIds,
    unresolvedGateIds: gates.unresolvedGateIds,
    readinessScore: scored.readinessScore,
    risks,
    unresolvedRequiredEvidenceScopes: confidence.unresolvedRequiredEvidenceScopes,
    policy: input.policy,
  });
  const certification = certificationState({
    confidenceScore: confidence.confidenceScore,
    unresolvedRequiredEvidenceScopes: confidence.unresolvedRequiredEvidenceScopes,
    policy: input.policy,
  });

  return Object.freeze({
    scoringVersion: SCORING_VERSION,
    policyVersion: input.policy.policyVersion,
    readinessScore: scored.readinessScore,
    confidenceScore: confidence.confidenceScore,
    status,
    certification,
    domainScores: scored.domainScores,
    gates: gates.gates,
    failedGateIds: gates.failedGateIds,
    unresolvedGateIds: gates.unresolvedGateIds,
    risks,
    impacts: scored.impacts,
    evidenceReferences: confidence.evidenceReferences,
    unresolvedRequiredEvidenceScopes: confidence.unresolvedRequiredEvidenceScopes,
  });
}
