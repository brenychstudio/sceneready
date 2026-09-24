import {
  INTERVENTION_POLICY_VERSION,
  parseIntervention,
  validateInterventionPolicy,
  type InterventionPolicyContext,
  type InterventionPolicyDenialCode,
  type InterventionPrimitive,
} from '@sceneready/intervention-engine';
import { GRAPH_SCHEMA_VERSION, type ProductionGraph } from '@sceneready/production-graph';
import { fingerprintProductionPack } from '@sceneready/production-pack';
import {
  evaluateProductionReadiness,
  type ProductionEvaluationInput,
  type ProductionReadinessAssessment,
} from '@sceneready/readiness-engine';

import { applyIntervention } from './apply.js';
import {
  cloneShadowInputs,
  policyContextFromOperational,
  type ShadowCallTimeFact,
  type ShadowCloneDenialCode,
  type ShadowOperationalState,
} from './clone.js';
import {
  canonicalRecoveryProjection,
  projectShadowEvaluation,
  type ProjectionDenialCode,
  type RecoveryProjectionPolicy,
} from './projection.js';
import {
  compareProductionAssessments,
  type ShadowComparison,
  type ShadowRiskTransition,
} from './compare.js';

export const SHADOW_SIMULATION_SCHEMA_VERSION = 'SR-SHADOW-v1';

export const SHADOW_SIMULATION_DENIAL_CODES = [
  'INVALID_INTERVENTION',
  'DUPLICATE_INTERVENTION',
  'MISSING_OPERATIONAL_FACT',
  'CONFLICTING_OPERATIONAL_FACT',
  'PRODUCTION_IDENTITY_MISMATCH',
  'POLICY_EVALUATION_MISMATCH',
  'GRAPH_SCHEMA_MISMATCH',
] as const;

export type ShadowSimulationLocalDenialCode = (typeof SHADOW_SIMULATION_DENIAL_CODES)[number];

export type ShadowSimulationDenialCode =
  ShadowSimulationLocalDenialCode | InterventionPolicyDenialCode | ProjectionDenialCode;

export interface ShadowSimulationInput {
  readonly policyContext: InterventionPolicyContext;
  readonly evaluation: ProductionEvaluationInput;
  readonly interventions: readonly InterventionPrimitive[];
  readonly callTimes: readonly ShadowCallTimeFact[];
  readonly projection: RecoveryProjectionPolicy;
}

export interface ShadowGraphSnapshot {
  readonly schemaVersion: typeof SHADOW_SIMULATION_SCHEMA_VERSION;
  readonly productionId: string;
  readonly baseGraphRevision: number;
  readonly baseProductionRevision: number;
  readonly shadowGraphRevision: number;
  readonly productionRevision: number;
  readonly policyVersion: string;
  readonly liveGraphFingerprint: string;
  readonly graph: ProductionGraph;
  readonly operational: ShadowOperationalState;
  readonly fingerprint: string;
}

export interface ShadowSimulation {
  readonly schemaVersion: typeof SHADOW_SIMULATION_SCHEMA_VERSION;
  readonly simulationId: string;
  readonly baseGraphRevision: number;
  readonly baseProductionRevision: number;
  readonly shadowGraphRevision: number;
  readonly policyVersion: ProductionReadinessAssessment['policyVersion'];
  readonly scoringVersion: ProductionReadinessAssessment['scoringVersion'];
  readonly interventions: readonly InterventionPrimitive[];
  readonly liveAssessment: ProductionReadinessAssessment;
  readonly shadowAssessment: ProductionReadinessAssessment;
  readonly comparison: ShadowComparison;
  readonly introducedRisks: readonly ShadowRiskTransition[];
  readonly resolvedOrReducedRisks: readonly ShadowRiskTransition[];
  readonly preservedDeliverables: readonly string[];
  readonly shadowGraph: ShadowGraphSnapshot;
  readonly fingerprint: string;
}

export type ShadowSimulationFailure = {
  readonly ok: false;
  readonly code: ShadowSimulationDenialCode;
  readonly interventionIndex: number | null;
};

export type ShadowSimulationSuccess = {
  readonly ok: true;
  readonly simulation: ShadowSimulation;
};

export type ShadowSimulationResult = ShadowSimulationSuccess | ShadowSimulationFailure;

export type { ShadowCallTimeFact, ShadowOperationalState };

function fail(
  code: ShadowSimulationDenialCode,
  interventionIndex: number | null,
): ShadowSimulationFailure {
  return Object.freeze({ ok: false, code, interventionIndex });
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

function parseInterventions(
  interventions: readonly InterventionPrimitive[],
):
  | { readonly ok: true; readonly interventions: readonly InterventionPrimitive[] }
  | { readonly ok: false; readonly index: number } {
  const parsed: InterventionPrimitive[] = [];
  for (let index = 0; index < interventions.length; index += 1) {
    const result = parseIntervention(interventions[index]);
    if (!result.ok) {
      return { ok: false, index };
    }
    parsed.push(result.intervention);
  }
  return { ok: true, interventions: Object.freeze(parsed) };
}

function duplicateIndex(interventions: readonly InterventionPrimitive[]): number | null {
  const seen = new Set<string>();
  for (let index = 0; index < interventions.length; index += 1) {
    const intervention = interventions[index];
    if (intervention === undefined) {
      return index;
    }
    const identity = fingerprintProductionPack(intervention);
    if (seen.has(identity)) {
      return index;
    }
    seen.add(identity);
  }
  return null;
}

function denialFromClone(code: ShadowCloneDenialCode): ShadowSimulationFailure {
  return fail(code, null);
}

export function simulateShadowProduction(input: ShadowSimulationInput): ShadowSimulationResult {
  const graph = input.policyContext.graph;
  if (graph.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    return fail('GRAPH_SCHEMA_MISMATCH', null);
  }
  if (input.policyContext.policyVersion !== INTERVENTION_POLICY_VERSION) {
    return fail('POLICY_VERSION_MISMATCH', null);
  }
  if (input.evaluation.policy.policyVersion !== input.policyContext.policyVersion) {
    return fail('POLICY_EVALUATION_MISMATCH', null);
  }
  if (input.evaluation.productionId !== graph.productionId) {
    return fail('PRODUCTION_IDENTITY_MISMATCH', null);
  }

  const parsed = parseInterventions(input.interventions);
  if (!parsed.ok) {
    return fail('INVALID_INTERVENTION', parsed.index);
  }
  const duplicate = duplicateIndex(parsed.interventions);
  if (duplicate !== null) {
    return fail('DUPLICATE_INTERVENTION', duplicate);
  }

  const cloned = cloneShadowInputs(input.policyContext, input.evaluation, input.callTimes);
  if (!cloned.ok) {
    return denialFromClone(cloned.code);
  }

  const liveOperational = cloned.operational;
  let operational = liveOperational;
  for (let index = 0; index < parsed.interventions.length; index += 1) {
    const intervention = parsed.interventions[index];
    if (intervention === undefined) {
      return fail('INVALID_INTERVENTION', index);
    }
    const decision = validateInterventionPolicy(
      intervention,
      policyContextFromOperational(input.policyContext, operational),
    );
    if (!decision.allowed) {
      return fail(decision.code, index);
    }
    const applied = applyIntervention(operational, intervention);
    if (!applied.ok) {
      return fail(applied.code, index);
    }
    operational = applied.state;
  }

  const projected = projectShadowEvaluation(
    cloned.evaluation,
    liveOperational,
    operational,
    input.projection,
  );
  if (!projected.ok) {
    return fail(projected.code, null);
  }
  const liveEvaluation = cloned.evaluation;
  const shadowEvaluation = projected.evaluation;
  const liveAssessment = evaluateProductionReadiness(liveEvaluation);
  const shadowAssessment = evaluateProductionReadiness(shadowEvaluation);
  const comparison = compareProductionAssessments(liveAssessment, shadowAssessment);
  const baseGraphRevision = graph.graphRevision;
  const baseProductionRevision = graph.productionRevision;
  const shadowGraphRevision = baseGraphRevision + 1;

  const fingerprint = fingerprintProductionPack({
    schemaVersion: SHADOW_SIMULATION_SCHEMA_VERSION,
    productionId: graph.productionId,
    baseProductionRevision,
    baseGraphRevision,
    shadowGraphRevision,
    policyVersion: input.policyContext.policyVersion,
    scoringVersion: liveAssessment.scoringVersion,
    productionPhase: input.policyContext.productionPhase,
    liveGraphFingerprint: graph.fingerprint,
    interventions: parsed.interventions,
    operational,
    projection: canonicalRecoveryProjection(input.projection),
    evaluation: shadowEvaluation,
  });
  const simulationId = fingerprintProductionPack({
    schemaVersion: SHADOW_SIMULATION_SCHEMA_VERSION,
    kind: 'SIMULATION_ID',
    fingerprint,
  });

  const shadowGraph: ShadowGraphSnapshot = {
    schemaVersion: SHADOW_SIMULATION_SCHEMA_VERSION,
    productionId: graph.productionId,
    baseGraphRevision,
    baseProductionRevision,
    shadowGraphRevision,
    productionRevision: graph.productionRevision,
    policyVersion: input.policyContext.policyVersion,
    liveGraphFingerprint: graph.fingerprint,
    graph,
    operational,
    fingerprint,
  };

  const simulation: ShadowSimulation = {
    schemaVersion: SHADOW_SIMULATION_SCHEMA_VERSION,
    simulationId,
    baseGraphRevision,
    baseProductionRevision,
    shadowGraphRevision,
    policyVersion: liveAssessment.policyVersion,
    scoringVersion: liveAssessment.scoringVersion,
    interventions: parsed.interventions,
    liveAssessment,
    shadowAssessment,
    comparison,
    introducedRisks: comparison.introducedRisks,
    resolvedOrReducedRisks: comparison.resolvedOrReducedRisks,
    preservedDeliverables: comparison.preservedDeliverables,
    shadowGraph,
    fingerprint,
  };

  return deepFreeze({ ok: true as const, simulation });
}
