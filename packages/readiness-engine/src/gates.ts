import {
  evaluateApprovedCapturePath,
  type CapturePathFact,
  type EquipmentFact,
} from './equipment-paths.js';
import { evaluateRightsCoverage, type RightsDocumentFact } from './rights.js';

export const HARD_GATE_IDS = [
  'LOCATION_ACCESS',
  'CRITICAL_TALENT',
  'RIGHTS',
  'CRITICAL_CAPTURE_KIT',
  'STUDIO_AVAILABILITY',
] as const;

export type HardGateId = (typeof HARD_GATE_IDS)[number];

export const GATE_STATES = ['PASSED', 'FAILED', 'UNRESOLVED'] as const;

export type GateState = (typeof GATE_STATES)[number];

export const PROOF_STATES = ['CONFIRMED', 'DENIED', 'MISSING', 'CONFLICTED', 'STALE'] as const;

export type ProofState = (typeof PROOF_STATES)[number];

export interface SubjectProof {
  readonly subjectId: string;
  readonly subjectType: 'LOCATION' | 'PERSON' | 'DOCUMENT' | 'EQUIPMENT' | 'EQUIPMENT_PATH';
  readonly aspect: 'ACCESS' | 'AVAILABILITY' | 'VALIDITY' | 'OPERATIONAL_STATE';
  readonly scope: string;
  readonly state: ProofState;
  readonly value?: string;
}

export interface HardGateFact {
  readonly id: HardGateId;
  readonly subjectType: string;
  readonly subjectIds: readonly string[];
}

export interface DomainFact {
  readonly domain:
    'PEOPLE' | 'LOCATION' | 'TIME_ENVIRONMENT' | 'EQUIPMENT' | 'DOCUMENTS_RIGHTS' | 'LOGISTICS';
  readonly state: GateState;
  readonly reasons: readonly string[];
}

export interface ReadinessEvaluationInput {
  readonly productionId: string;
  readonly productionDate: string;
  readonly intendedUsageScope: string;
  readonly intendedDeliverableId: string;
  readonly requiredPersonIds: readonly string[];
  readonly requiredLocationIds: readonly string[];
  readonly hardGates: readonly HardGateFact[];
  readonly documents: readonly RightsDocumentFact[];
  readonly capturePaths: readonly CapturePathFact[];
  readonly equipment: readonly EquipmentFact[];
  readonly proofs: readonly SubjectProof[];
  readonly domainFacts?: readonly DomainFact[];
}

export interface GateResult {
  readonly id: HardGateId;
  readonly state: GateState;
  readonly reasons: readonly string[];
  readonly subjectIds: readonly string[];
}

export interface CriticalGatesResult {
  readonly gates: readonly GateResult[];
  readonly failedGateIds: readonly HardGateId[];
  readonly unresolvedGateIds: readonly HardGateId[];
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

function expectedScope(subjectType: string, subjectId: string, aspect: string): string {
  return `${subjectType}:${subjectId}:${aspect}`;
}

function matchingProofs(
  proofs: readonly SubjectProof[],
  subjectId: string,
  subjectType: string,
  aspect: SubjectProof['aspect'],
): SubjectProof[] {
  const scope = expectedScope(subjectType, subjectId, aspect);
  return proofs.filter(
    (item) =>
      item.subjectId === subjectId &&
      item.subjectType === subjectType &&
      item.aspect === aspect &&
      item.scope === scope,
  );
}

function proofState(proofs: readonly SubjectProof[]): GateState {
  if (proofs.length === 0) {
    return 'UNRESOLVED';
  }
  if (
    proofs.some(
      (item) => item.state === 'CONFLICTED' || item.state === 'MISSING' || item.state === 'STALE',
    )
  ) {
    return 'UNRESOLVED';
  }
  if (proofs.some((item) => item.state === 'DENIED')) {
    return 'FAILED';
  }
  if (proofs.some((item) => item.state === 'CONFIRMED')) {
    return 'PASSED';
  }
  return 'UNRESOLVED';
}

function combineStates(states: readonly GateState[]): GateState {
  if (states.some((state) => state === 'FAILED')) {
    return 'FAILED';
  }
  if (states.some((state) => state === 'UNRESOLVED')) {
    return 'UNRESOLVED';
  }
  return 'PASSED';
}

function reasonForProofState(state: GateState, prefix: string): string {
  if (state === 'PASSED') {
    return `${prefix}_CONFIRMED`;
  }
  if (state === 'FAILED') {
    return `${prefix}_DENIED`;
  }
  return `${prefix}_UNRESOLVED`;
}

function evaluateSubjects(
  input: ReadinessEvaluationInput,
  gate: HardGateFact,
  aspect: SubjectProof['aspect'],
  reasonPrefix: string,
): GateResult {
  const states: GateState[] = [];
  const reasons: string[] = [];
  for (const subjectId of [...gate.subjectIds].sort(compareOrdinal)) {
    const state = proofState(matchingProofs(input.proofs, subjectId, gate.subjectType, aspect));
    states.push(state);
    reasons.push(`${reasonPrefix}_${subjectId}_${state}`);
  }
  return Object.freeze({
    id: gate.id,
    state: combineStates(states),
    reasons: Object.freeze(reasons.sort(compareOrdinal)),
    subjectIds: Object.freeze([...gate.subjectIds].sort(compareOrdinal)),
  });
}

function evaluateRightsGate(input: ReadinessEvaluationInput, gate: HardGateFact): GateResult {
  const reasons: string[] = [];
  const states: GateState[] = [];
  if (!Array.isArray(input.requiredPersonIds) || !Array.isArray(input.requiredLocationIds)) {
    return Object.freeze({
      id: gate.id,
      state: 'UNRESOLVED',
      reasons: Object.freeze(['RIGHTS_SCOPE_CONTEXT_MISSING']),
      subjectIds: Object.freeze([...gate.subjectIds].sort(compareOrdinal)),
    });
  }
  for (const subjectId of [...gate.subjectIds].sort(compareOrdinal)) {
    const document = input.documents.find((item) => item.id === subjectId);
    if (document === undefined) {
      states.push('UNRESOLVED');
      reasons.push(`RIGHTS_${subjectId}_DOCUMENT_MISSING`);
      continue;
    }
    const coverage = evaluateRightsCoverage({
      document,
      intendedUsageScope: input.intendedUsageScope,
      intendedDeliverableId: input.intendedDeliverableId,
      productionDate: input.productionDate,
      requiredPersonIds: input.requiredPersonIds,
      requiredLocationIds: input.requiredLocationIds,
    });
    if (!coverage.covered) {
      states.push('FAILED');
      reasons.push(...coverage.reasons.map((reason) => `RIGHTS_${subjectId}_${reason}`));
      continue;
    }
    const state = proofState(matchingProofs(input.proofs, subjectId, 'DOCUMENT', 'VALIDITY'));
    states.push(state);
    reasons.push(reasonForProofState(state, `RIGHTS_${subjectId}`));
  }
  return Object.freeze({
    id: gate.id,
    state: combineStates(states),
    reasons: Object.freeze(reasons.sort(compareOrdinal)),
    subjectIds: Object.freeze([...gate.subjectIds].sort(compareOrdinal)),
  });
}

function evaluateCaptureKit(input: ReadinessEvaluationInput, gate: HardGateFact): GateResult {
  const reasons: string[] = [];
  const states: GateState[] = [];
  for (const subjectId of [...gate.subjectIds].sort(compareOrdinal)) {
    const matched = matchingProofs(input.proofs, subjectId, 'EQUIPMENT_PATH', 'OPERATIONAL_STATE');
    if (matched.length > 0) {
      const proof = proofState(matched);
      if (proof === 'UNRESOLVED' || proof === 'FAILED') {
        states.push(proof);
        reasons.push(`CAPTURE_${subjectId}_${proof}`);
        continue;
      }
    }
    const path = input.capturePaths.find((item) => item.id === subjectId);
    if (path === undefined) {
      states.push('UNRESOLVED');
      reasons.push(`CAPTURE_${subjectId}_PATH_MISSING`);
      continue;
    }
    const readiness = evaluateApprovedCapturePath(path, input.equipment);
    if (readiness === 'READY') {
      states.push('PASSED');
      reasons.push(`CAPTURE_${subjectId}_PATH_READY`);
      continue;
    }
    if (readiness === 'FAILED') {
      states.push('FAILED');
      reasons.push(`CAPTURE_${subjectId}_NO_COMPLETE_PATH`);
      continue;
    }
    states.push('UNRESOLVED');
    reasons.push(`CAPTURE_${subjectId}_UNRESOLVED`);
  }
  return Object.freeze({
    id: gate.id,
    state: combineStates(states),
    reasons: Object.freeze(reasons.sort(compareOrdinal)),
    subjectIds: Object.freeze([...gate.subjectIds].sort(compareOrdinal)),
  });
}

function gateFact(input: ReadinessEvaluationInput, id: HardGateId): HardGateFact {
  const found = input.hardGates.find((gate) => gate.id === id);
  if (found !== undefined) {
    return found;
  }
  return { id, subjectType: 'LOCATION', subjectIds: [] };
}

function evaluateOne(input: ReadinessEvaluationInput, id: HardGateId): GateResult {
  const gate = gateFact(input, id);
  switch (id) {
    case 'LOCATION_ACCESS':
      return evaluateSubjects(input, gate, 'ACCESS', 'ACCESS');
    case 'CRITICAL_TALENT':
      return evaluateSubjects(input, gate, 'AVAILABILITY', 'TALENT');
    case 'RIGHTS':
      return evaluateRightsGate(input, gate);
    case 'CRITICAL_CAPTURE_KIT':
      return evaluateCaptureKit(input, gate);
    case 'STUDIO_AVAILABILITY':
      return evaluateSubjects(input, gate, 'AVAILABILITY', 'STUDIO');
  }
}

export function evaluateCriticalGates(input: ReadinessEvaluationInput): CriticalGatesResult {
  const gates = Object.freeze(HARD_GATE_IDS.map((id) => evaluateOne(input, id)));
  return Object.freeze({
    gates,
    failedGateIds: Object.freeze(
      gates.filter((gate) => gate.state === 'FAILED').map((gate) => gate.id),
    ),
    unresolvedGateIds: Object.freeze(
      gates.filter((gate) => gate.state === 'UNRESOLVED').map((gate) => gate.id),
    ),
  });
}
