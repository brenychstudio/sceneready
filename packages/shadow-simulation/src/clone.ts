import type {
  ActivityConstraint,
  ActivityStateFact,
  InterventionPolicyContext,
} from '@sceneready/intervention-engine';
import type {
  DeliverableWeightFact,
  DomainFact,
  EvidenceConfidenceFact,
  ProductionEvaluationInput,
  ReadinessImpactFact,
  ReadinessRiskFact,
  SubjectProof,
} from '@sceneready/readiness-engine';

export interface ShadowCallTimeFact {
  readonly personId: string;
  readonly callLocal: string;
}

export interface ShadowActivityOverlay {
  readonly activityId: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly locationId: string;
  readonly constraint: ActivityConstraint;
  readonly state: ActivityStateFact['state'];
  readonly order: number;
  readonly bufferBeforeMinutes: number;
  readonly transferBufferMinutes: number;
}

export interface ShadowCallOverlay {
  readonly personId: string;
  readonly callMinute: number;
}

export interface ShadowOperationalState {
  readonly activities: readonly ShadowActivityOverlay[];
  readonly callTimes: readonly ShadowCallOverlay[];
  readonly activatedBackupPathIds: readonly string[];
  readonly reverificationEquipmentIds: readonly string[];
  readonly confirmationRequestScopes: readonly string[];
}

export const MINUTES_PER_DAY = 24 * 60;

export type ShadowCloneDenialCode = 'MISSING_OPERATIONAL_FACT' | 'CONFLICTING_OPERATIONAL_FACT';

export type ShadowCloneResult =
  | {
      readonly ok: true;
      readonly operational: ShadowOperationalState;
      readonly evaluation: ProductionEvaluationInput;
    }
  | { readonly ok: false; readonly code: ShadowCloneDenialCode };

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function parseLocalMinute(value: string): number | null {
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const hours = match[1];
  const minutes = match[2];
  if (hours === undefined || minutes === undefined) {
    return null;
  }
  return Number(hours) * 60 + Number(minutes);
}

export function formatLocalMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function insideLocalDay(minute: number): boolean {
  return minute >= 0 && minute < MINUTES_PER_DAY;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clonePlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clonePlain(item));
  }
  if (!isPlainObject(value)) {
    throw new Error('shadow clone rejected a non-plain object');
  }
  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const property = value[key];
    if (property !== undefined) {
      cloned[key] = clonePlain(property);
    }
  }
  return cloned;
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

function sortedStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareOrdinal));
}

function indexById<T>(items: readonly T[], idOf: (item: T) => string): Map<string, T> | null {
  const indexed = new Map<string, T>();
  for (const item of items) {
    const id = idOf(item);
    const existing = indexed.get(id);
    if (existing === undefined) {
      indexed.set(id, item);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(item)) {
      return null;
    }
  }
  return indexed;
}

function freezeActivity(activity: ShadowActivityOverlay): ShadowActivityOverlay {
  return Object.freeze({ ...activity });
}

export function freezeOperational(state: ShadowOperationalState): ShadowOperationalState {
  return Object.freeze({
    activities: Object.freeze(
      [...state.activities]
        .sort((left, right) => compareOrdinal(left.activityId, right.activityId))
        .map(freezeActivity),
    ),
    callTimes: Object.freeze(
      [...state.callTimes]
        .sort((left, right) => compareOrdinal(left.personId, right.personId))
        .map((item) => Object.freeze({ personId: item.personId, callMinute: item.callMinute })),
    ),
    activatedBackupPathIds: sortedStrings(state.activatedBackupPathIds),
    reverificationEquipmentIds: sortedStrings(state.reverificationEquipmentIds),
    confirmationRequestScopes: sortedStrings(state.confirmationRequestScopes),
  });
}

function compareRisks(left: ReadinessRiskFact, right: ReadinessRiskFact): number {
  const incident = compareOrdinal(left.incidentId, right.incidentId);
  if (incident !== 0) {
    return incident;
  }
  const risk = compareOrdinal(left.riskId, right.riskId);
  if (risk !== 0) {
    return risk;
  }
  return compareOrdinal(left.subjectId, right.subjectId);
}

function compareImpacts(left: ReadinessImpactFact, right: ReadinessImpactFact): number {
  const incident = compareOrdinal(left.incidentId, right.incidentId);
  if (incident !== 0) {
    return incident;
  }
  return compareOrdinal(left.deliverableId, right.deliverableId);
}

function compareProofs(left: SubjectProof, right: SubjectProof): number {
  const typeOrder = compareOrdinal(left.subjectType, right.subjectType);
  if (typeOrder !== 0) {
    return typeOrder;
  }
  const subjectOrder = compareOrdinal(left.subjectId, right.subjectId);
  if (subjectOrder !== 0) {
    return subjectOrder;
  }
  const aspectOrder = compareOrdinal(left.aspect, right.aspect);
  if (aspectOrder !== 0) {
    return aspectOrder;
  }
  return compareOrdinal(left.scope, right.scope);
}

function compareConfidence(left: EvidenceConfidenceFact, right: EvidenceConfidenceFact): number {
  const scopeOrder = compareOrdinal(left.scope, right.scope);
  if (scopeOrder !== 0) {
    return scopeOrder;
  }
  return compareOrdinal(left.evidenceId ?? '', right.evidenceId ?? '');
}

function compareDomains(left: DomainFact, right: DomainFact): number {
  return compareOrdinal(left.domain, right.domain);
}

function compareDeliverables(left: DeliverableWeightFact, right: DeliverableWeightFact): number {
  return compareOrdinal(left.deliverableId, right.deliverableId);
}

export function projectEvaluation(input: ProductionEvaluationInput): ProductionEvaluationInput {
  const cloned = clonePlain(input) as ProductionEvaluationInput;
  const projected = {
    productionId: cloned.productionId,
    productionDate: cloned.productionDate,
    intendedUsageScope: cloned.intendedUsageScope,
    intendedDeliverableId: cloned.intendedDeliverableId,
    requiredPersonIds: sortedStrings(cloned.requiredPersonIds),
    requiredLocationIds: sortedStrings(cloned.requiredLocationIds),
    hardGates: Object.freeze(
      [...cloned.hardGates]
        .map((gate) =>
          Object.freeze({
            id: gate.id,
            subjectType: gate.subjectType,
            subjectIds: sortedStrings(gate.subjectIds),
          }),
        )
        .sort((left, right) => compareOrdinal(left.id, right.id)),
    ),
    documents: Object.freeze(
      [...cloned.documents].sort((left, right) => compareOrdinal(left.id, right.id)),
    ),
    capturePaths: Object.freeze(
      [...cloned.capturePaths].sort((left, right) => compareOrdinal(left.id, right.id)),
    ),
    equipment: Object.freeze(
      [...cloned.equipment].sort((left, right) => compareOrdinal(left.id, right.id)),
    ),
    proofs: Object.freeze([...cloned.proofs].sort(compareProofs)),
    policy: cloned.policy,
    risks: Object.freeze([...cloned.risks].sort(compareRisks)),
    impacts: Object.freeze([...cloned.impacts].sort(compareImpacts)),
    deliverables: Object.freeze([...cloned.deliverables].sort(compareDeliverables)),
    confidenceFacts: Object.freeze([...cloned.confidenceFacts].sort(compareConfidence)),
    requiredEvidenceScopes: sortedStrings(cloned.requiredEvidenceScopes),
  };
  if (cloned.domainFacts === undefined) {
    return deepFreeze(projected);
  }
  return deepFreeze({
    ...projected,
    domainFacts: Object.freeze([...cloned.domainFacts].sort(compareDomains)),
  });
}

export function policyContextFromOperational(
  context: InterventionPolicyContext,
  operational: ShadowOperationalState,
): InterventionPolicyContext {
  const activities = Object.freeze(
    [...operational.activities]
      .sort((left, right) => compareOrdinal(left.activityId, right.activityId))
      .map((activity) =>
        Object.freeze({
          activityId: activity.activityId,
          startLocal: formatLocalMinute(activity.startMinute),
          endLocal: formatLocalMinute(activity.endMinute),
          locationId: activity.locationId,
          constraint: activity.constraint,
        }),
      ),
  );
  const activityStates = Object.freeze(
    [...operational.activities]
      .sort((left, right) => compareOrdinal(left.activityId, right.activityId))
      .map((activity) =>
        Object.freeze({
          activityId: activity.activityId,
          state: activity.state,
        }),
      ),
  );
  return {
    graph: context.graph,
    policyVersion: context.policyVersion,
    productionPhase: context.productionPhase,
    activities,
    activityStates,
    locationConstraints: context.locationConstraints,
    approvedFallbacks: context.approvedFallbacks,
    approvedBackupPathIds: context.approvedBackupPathIds,
    equipmentIds: context.equipmentIds,
    requestableEvidenceScopes: context.requestableEvidenceScopes,
  };
}

function deny(code: ShadowCloneDenialCode): ShadowCloneResult {
  return { ok: false, code };
}

export function cloneShadowInputs(
  context: InterventionPolicyContext,
  evaluation: ProductionEvaluationInput,
  callTimes: readonly ShadowCallTimeFact[],
): ShadowCloneResult {
  const activities = indexById(context.activities, (item) => item.activityId);
  const states = indexById(context.activityStates, (item) => item.activityId);
  const calls = indexById(callTimes, (item) => item.personId);
  if (activities === null || states === null || calls === null) {
    return deny('CONFLICTING_OPERATIONAL_FACT');
  }
  if (activities.size !== states.size) {
    return deny('MISSING_OPERATIONAL_FACT');
  }

  const overlays: ShadowActivityOverlay[] = [];
  const activityFacts = [...activities.values()].sort((left, right) =>
    compareOrdinal(left.activityId, right.activityId),
  );
  for (const [index, fact] of activityFacts.entries()) {
    const state = states.get(fact.activityId);
    if (state === undefined) {
      return deny('MISSING_OPERATIONAL_FACT');
    }
    const startMinute = parseLocalMinute(fact.startLocal);
    const endMinute = parseLocalMinute(fact.endLocal);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      return deny('MISSING_OPERATIONAL_FACT');
    }
    overlays.push(
      freezeActivity({
        activityId: fact.activityId,
        startMinute,
        endMinute,
        locationId: fact.locationId,
        constraint: fact.constraint,
        state: state.state,
        order: index,
        bufferBeforeMinutes: 0,
        transferBufferMinutes: 0,
      }),
    );
  }

  const callOverlays: ShadowCallOverlay[] = [];
  for (const fact of calls.values()) {
    const callMinute = parseLocalMinute(fact.callLocal);
    if (callMinute === null) {
      return deny('MISSING_OPERATIONAL_FACT');
    }
    callOverlays.push(Object.freeze({ personId: fact.personId, callMinute }));
  }

  let projected: ProductionEvaluationInput;
  try {
    projected = projectEvaluation(evaluation);
  } catch {
    return deny('CONFLICTING_OPERATIONAL_FACT');
  }

  return {
    ok: true,
    operational: freezeOperational({
      activities: overlays,
      callTimes: callOverlays,
      activatedBackupPathIds: [],
      reverificationEquipmentIds: [],
      confirmationRequestScopes: [],
    }),
    evaluation: projected,
  };
}

export function readActivity(
  state: ShadowOperationalState,
  activityId: string,
): ShadowActivityOverlay | null {
  return state.activities.find((item) => item.activityId === activityId) ?? null;
}

export function replaceActivity(
  state: ShadowOperationalState,
  activity: ShadowActivityOverlay,
): ShadowOperationalState {
  return freezeOperational({
    ...state,
    activities: state.activities.map((item) =>
      item.activityId === activity.activityId ? activity : item,
    ),
  });
}
