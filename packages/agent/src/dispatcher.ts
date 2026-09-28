import { parseIntervention, type InterventionPrimitive } from '@sceneready/intervention-engine';

import {
  copyStructuredData,
  type AuthoritativeChanges,
  type AuthoritativeExecutionStatus,
  type AuthoritativeReadiness,
  type AuthoritativeRiskContext,
  type RecoveryCompositionInput,
} from './context.js';
import type {
  IntelligenceRequest,
  RecoveryCandidate,
  RecoveryComposer,
  SceneReadyStatePort,
} from './ports.js';

export const MAX_RECOVERY_OPTIONS = 3;

export const INVALID_INTELLIGENCE_REQUEST = 'INVALID_INTELLIGENCE_REQUEST';
export const INVALID_RECOVERY_COMPOSER_OUTPUT = 'INVALID_RECOVERY_COMPOSER_OUTPUT';
export const RECOVERY_COMPOSER_FAILED = 'RECOVERY_COMPOSER_FAILED';

export interface IntelligenceDispatcherDependencies {
  readonly state: SceneReadyStatePort;
  readonly composer: RecoveryComposer;
}

export interface FastReadinessResult {
  readonly ok: true;
  readonly path: 'FAST_OPERATIONAL';
  readonly requestKind: 'GET_READINESS';
  readonly data: AuthoritativeReadiness;
}

export interface FastChangesResult {
  readonly ok: true;
  readonly path: 'FAST_OPERATIONAL';
  readonly requestKind: 'GET_CHANGES';
  readonly data: AuthoritativeChanges;
}

export interface FastExecutionStatusResult {
  readonly ok: true;
  readonly path: 'FAST_OPERATIONAL';
  readonly requestKind: 'GET_EXECUTION_STATUS';
  readonly data: AuthoritativeExecutionStatus;
}

export interface ReasoningResult {
  readonly ok: true;
  readonly path: 'REASONING';
  readonly requestKind: 'EXPLAIN_RISK';
  readonly context: AuthoritativeRiskContext;
}

export interface RecoveryPlanningSuccess {
  readonly ok: true;
  readonly path: 'RECOVERY_PLANNING';
  readonly requestKind: 'PLAN_RECOVERY';
  readonly options: readonly RecoveryCandidate[];
}

export interface RecoveryPlanningFailure {
  readonly ok: false;
  readonly path: 'RECOVERY_PLANNING';
  readonly requestKind: 'PLAN_RECOVERY';
  readonly code: typeof INVALID_RECOVERY_COMPOSER_OUTPUT | typeof RECOVERY_COMPOSER_FAILED;
  readonly options: readonly RecoveryCandidate[];
}

export interface InvalidIntelligenceRequestResult {
  readonly ok: false;
  readonly code: typeof INVALID_INTELLIGENCE_REQUEST;
}

export type IntelligenceDispatchResult =
  | FastReadinessResult
  | FastChangesResult
  | FastExecutionStatusResult
  | ReasoningResult
  | RecoveryPlanningSuccess
  | RecoveryPlanningFailure
  | InvalidIntelligenceRequestResult;

export async function dispatchIntelligence(
  dependencies: IntelligenceDispatcherDependencies,
  request: IntelligenceRequest,
): Promise<IntelligenceDispatchResult> {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return invalidRequest();
  }
  const productionId = request.productionId;
  if (typeof productionId !== 'string' || productionId.length === 0) {
    return invalidRequest();
  }

  switch (request.kind) {
    case 'GET_READINESS':
      return fastReadiness(await dependencies.state.getReadiness(productionId));
    case 'GET_CHANGES':
      return fastChanges(await dependencies.state.getChanges(productionId));
    case 'GET_EXECUTION_STATUS':
      return fastExecutionStatus(await dependencies.state.getExecutionStatus(productionId));
    case 'EXPLAIN_RISK': {
      const riskId = request.riskId;
      if (typeof riskId !== 'string' || riskId.length === 0) {
        return invalidRequest();
      }
      return reasoningResult(await dependencies.state.getRiskContext(productionId, riskId));
    }
    case 'PLAN_RECOVERY': {
      const objective = request.objective;
      if (typeof objective !== 'string' || objective.length === 0) {
        return invalidRequest();
      }
      return planRecovery(dependencies, productionId, objective);
    }
    default:
      return assertNever(request);
  }
}

async function planRecovery(
  dependencies: IntelligenceDispatcherDependencies,
  productionId: string,
  objective: string,
): Promise<RecoveryPlanningSuccess | RecoveryPlanningFailure> {
  const composerInput: RecoveryCompositionInput = deepFreeze(
    copyStructuredData({
      productionId,
      objective,
      recoveryContext: await dependencies.state.getRecoveryContext(productionId),
    }),
  );

  let composed: unknown;
  try {
    composed = await dependencies.composer.compose(composerInput);
  } catch {
    return recoveryFailure(RECOVERY_COMPOSER_FAILED);
  }

  if (!Array.isArray(composed)) {
    return recoveryFailure(INVALID_RECOVERY_COMPOSER_OUTPUT);
  }

  const accepted = canonicalizeCandidates(composed);
  if (accepted === null) {
    return recoveryFailure(INVALID_RECOVERY_COMPOSER_OUTPUT);
  }

  return recoverySuccess(accepted.slice(0, MAX_RECOVERY_OPTIONS));
}

function canonicalizeCandidates(candidates: readonly unknown[]): RecoveryCandidate[] | null {
  const accepted: RecoveryCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const canonical = canonicalCandidate(candidate);
    if (canonical === null || seen.has(canonical.optionId)) {
      return null;
    }
    seen.add(canonical.optionId);
    accepted.push(canonical);
  }
  return accepted;
}

function canonicalCandidate(value: unknown): RecoveryCandidate | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.optionId !== 'string' || record.optionId.length === 0) {
    return null;
  }
  if (!Array.isArray(record.interventions)) {
    return null;
  }
  const interventions: InterventionPrimitive[] = [];
  for (const intervention of record.interventions) {
    const parsed = parseIntervention(intervention);
    if (!parsed.ok) {
      return null;
    }
    interventions.push(parsed.intervention);
  }
  return {
    optionId: record.optionId,
    interventions,
  };
}

function fastReadiness(data: AuthoritativeReadiness): FastReadinessResult {
  return Object.freeze({
    ok: true,
    path: 'FAST_OPERATIONAL',
    requestKind: 'GET_READINESS',
    data,
  });
}

function fastChanges(data: AuthoritativeChanges): FastChangesResult {
  return Object.freeze({
    ok: true,
    path: 'FAST_OPERATIONAL',
    requestKind: 'GET_CHANGES',
    data,
  });
}

function fastExecutionStatus(data: AuthoritativeExecutionStatus): FastExecutionStatusResult {
  return Object.freeze({
    ok: true,
    path: 'FAST_OPERATIONAL',
    requestKind: 'GET_EXECUTION_STATUS',
    data,
  });
}

function reasoningResult(context: AuthoritativeRiskContext): ReasoningResult {
  return Object.freeze({
    ok: true,
    path: 'REASONING',
    requestKind: 'EXPLAIN_RISK',
    context,
  });
}

function recoverySuccess(options: readonly RecoveryCandidate[]): RecoveryPlanningSuccess {
  return Object.freeze({
    ok: true,
    path: 'RECOVERY_PLANNING',
    requestKind: 'PLAN_RECOVERY',
    options: Object.freeze(options.map(freezeCandidate)),
  });
}

function recoveryFailure(
  code: typeof INVALID_RECOVERY_COMPOSER_OUTPUT | typeof RECOVERY_COMPOSER_FAILED,
): RecoveryPlanningFailure {
  return Object.freeze({
    ok: false,
    path: 'RECOVERY_PLANNING',
    requestKind: 'PLAN_RECOVERY',
    code,
    options: Object.freeze([]),
  });
}

function freezeCandidate(candidate: RecoveryCandidate): RecoveryCandidate {
  return Object.freeze({
    optionId: candidate.optionId,
    interventions: Object.freeze([...candidate.interventions]),
  });
}

function invalidRequest(): InvalidIntelligenceRequestResult {
  return Object.freeze({
    ok: false,
    code: INVALID_INTELLIGENCE_REQUEST,
  });
}

function assertNever(value: never): InvalidIntelligenceRequestResult {
  void value;
  return invalidRequest();
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
