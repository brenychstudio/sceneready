import type { InterventionPrimitive } from '@sceneready/intervention-engine';

import {
  classifyIntervention,
  SEND_CORRECTIVE_NOTIFICATION,
  type ClassifiedIntervention,
  type CorrectiveNotificationEffect,
  type ReversibilityDisclosure,
} from './reversibility.js';

export const COMPENSATION_DENIAL_REASONS = [
  'BOUND_PROPOSAL_MISMATCH',
  'COMMUNICATIONS_BINDING_REJECTED',
  'INVALID_APPLIED_INTERVENTION',
  'INVALID_APPLIED_PAYLOAD',
  'INVALID_APPLIED_PROPOSAL',
  'INVALID_AUDIENCE_BASELINE',
  'INVALID_CREW',
  'INVALID_PROPOSAL_ID',
  'INVALID_REVISION',
  'TIME_OUT_OF_RANGE',
] as const;

export type CompensationDenialReason = (typeof COMPENSATION_DENIAL_REASONS)[number];

export interface CompensationCrewMember {
  readonly personId: string;
  readonly role: string;
}

export interface CompensationCallTime {
  readonly personId: string;
  readonly callLocal: string;
}

export interface CompensationDeparture {
  readonly transferActivityId: string;
  readonly departureLocal: string;
}

export interface CompensationAudienceInput {
  readonly interventions: readonly InterventionPrimitive[];
  readonly crew: readonly CompensationCrewMember[];
  readonly callTimes: readonly CompensationCallTime[];
  readonly departures: readonly CompensationDeparture[];
}

export interface CompensationBindContext {
  readonly accountId: string;
  readonly productionId: string;
  readonly proposalId: string;
  readonly baseProductionRevision: number;
  readonly baseGraphRevision: number;
  readonly policyVersion: string;
  readonly predictedEffects: readonly unknown[];
}

export interface ExpectedCorrectivePayload {
  readonly recipientPersonId: string;
  readonly recipientRole: string;
  readonly changeType: 'CALL_TIME_UPDATED' | 'LOAD_OUT_UPDATED';
  readonly oldValue: string;
  readonly newValue: string;
  readonly reasonCode: 'ADJUST_CALL_TIME' | 'ADJUST_DEPARTURE';
  readonly requiredAction: 'CONFIRM_UPDATED_CALL' | 'INFORMATION_ONLY';
}

export interface CompensationPlan {
  readonly context: CompensationBindContext;
  readonly audience: CompensationAudienceInput;
  readonly inverses: readonly InterventionPrimitive[];
  readonly disclosures: readonly ReversibilityDisclosure[];
  readonly sideEffects: readonly CorrectiveNotificationEffect[];
  readonly expectedPayloads: readonly ExpectedCorrectivePayload[];
  readonly affectedRecipients: readonly string[];
}

export type CompensationPlanResult =
  | { readonly ok: true; readonly plan: CompensationPlan }
  | { readonly ok: false; readonly reason: CompensationDenialReason };

type Denied = { readonly ok: false; readonly reason: CompensationDenialReason };

interface AppliedPayload {
  readonly recipientPersonId: string;
  readonly recipientRole: string;
  readonly changeType: 'CALL_TIME_UPDATED' | 'LOAD_OUT_UPDATED';
  readonly oldValue: string;
  readonly newValue: string;
  readonly reasonCode: string;
  readonly requiredAction: 'CONFIRM_UPDATED_CALL' | 'INFORMATION_ONLY';
}

const CALL_TIME_CHANGE = 'CALL_TIME_UPDATED';
const LOAD_OUT_CHANGE = 'LOAD_OUT_UPDATED';
const CONFIRM_UPDATED_CALL = 'CONFIRM_UPDATED_CALL';
const INFORMATION_ONLY = 'INFORMATION_ONLY';
const CALL_TIME_REASON = 'ADJUST_CALL_TIME';
const LOAD_OUT_REASON = 'ADJUST_DEPARTURE';
const PRODUCTION_LEAD = 'PRODUCTION_LEAD';
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;
const PAYLOAD_KEYS = [
  'approvedText',
  'changeType',
  'newValue',
  'oldValue',
  'reasonCode',
  'recipientPersonId',
  'recipientRole',
  'requiredAction',
] as const;

function deny(reason: CompensationDenialReason): Denied {
  return Object.freeze({ ok: false, reason });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Acceptance clock for a communications result. The certified sentence still
 * comes from the communications binder; this only rejects a different fact.
 */
function shiftLocalTime(local: string, deltaMinutes: number): string | null {
  const match = LOCAL_TIME.exec(local);
  if (match === null || !Number.isInteger(deltaMinutes)) {
    return null;
  }
  const hours = match[1];
  const minutes = match[2];
  if (hours === undefined || minutes === undefined) {
    return null;
  }
  const total = Number(hours) * 60 + Number(minutes) + deltaMinutes;
  if (total < 0 || total >= MINUTES_PER_DAY) {
    return null;
  }
  const nextHours = Math.floor(total / 60);
  const nextMinutes = total % 60;
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`;
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

function readPayload(value: unknown): AppliedPayload | null {
  if (!isPlainRecord(value) || !exactKeys(value, PAYLOAD_KEYS)) {
    return null;
  }
  const recipientPersonId = value.recipientPersonId;
  const recipientRole = value.recipientRole;
  const changeType = value.changeType;
  const oldValue = value.oldValue;
  const newValue = value.newValue;
  const reasonCode = value.reasonCode;
  const requiredAction = value.requiredAction;
  const approvedText = value.approvedText;
  if (
    typeof recipientPersonId !== 'string' ||
    typeof recipientRole !== 'string' ||
    typeof oldValue !== 'string' ||
    typeof newValue !== 'string' ||
    typeof reasonCode !== 'string' ||
    typeof approvedText !== 'string' ||
    (changeType !== CALL_TIME_CHANGE && changeType !== LOAD_OUT_CHANGE) ||
    (requiredAction !== CONFIRM_UPDATED_CALL && requiredAction !== INFORMATION_ONLY)
  ) {
    return null;
  }
  return Object.freeze({
    recipientPersonId,
    recipientRole,
    changeType,
    oldValue,
    newValue,
    reasonCode,
    requiredAction,
  });
}

function readPayloads(
  values: readonly unknown[],
): { readonly ok: true; readonly payloads: readonly AppliedPayload[] } | Denied {
  if (!Array.isArray(values)) {
    return deny('INVALID_APPLIED_PAYLOAD');
  }
  const payloads: AppliedPayload[] = [];
  for (const value of values) {
    const payload = readPayload(value);
    if (payload === null) {
      return deny('INVALID_APPLIED_PAYLOAD');
    }
    payloads.push(payload);
  }
  return { ok: true, payloads };
}

function readCrew(
  values: readonly CompensationCrewMember[],
): { readonly ok: true; readonly crew: readonly CompensationCrewMember[] } | Denied {
  if (!Array.isArray(values)) {
    return deny('INVALID_CREW');
  }
  const crew: CompensationCrewMember[] = [];
  const seen = new Set<string>();
  for (const member of values) {
    if (
      !isPlainRecord(member) ||
      !exactKeys(member, ['personId', 'role']) ||
      typeof member.personId !== 'string' ||
      member.personId.length === 0 ||
      typeof member.role !== 'string' ||
      member.role.length === 0
    ) {
      return deny('INVALID_CREW');
    }
    if (seen.has(member.personId)) {
      return deny('INVALID_CREW');
    }
    seen.add(member.personId);
    crew.push(Object.freeze({ personId: member.personId, role: member.role }));
  }
  return { ok: true, crew };
}

function readNamedBaselines(
  values: readonly CompensationCallTime[],
  idKey: 'personId',
  valueKey: 'callLocal',
): { readonly ok: true; readonly baselines: ReadonlyMap<string, string> } | Denied {
  if (!Array.isArray(values)) {
    return deny('INVALID_AUDIENCE_BASELINE');
  }
  const baselines = new Map<string, string>();
  for (const fact of values) {
    if (!isPlainRecord(fact) || !exactKeys(fact, [idKey, valueKey])) {
      return deny('INVALID_AUDIENCE_BASELINE');
    }
    const id = fact[idKey];
    const local = fact[valueKey];
    if (typeof id !== 'string' || id.length === 0 || typeof local !== 'string') {
      return deny('INVALID_AUDIENCE_BASELINE');
    }
    if (baselines.has(id)) {
      return deny('INVALID_AUDIENCE_BASELINE');
    }
    baselines.set(id, local);
  }
  return { ok: true, baselines };
}

function readDepartureBaselines(
  values: readonly CompensationDeparture[],
): { readonly ok: true; readonly baselines: ReadonlyMap<string, string> } | Denied {
  if (!Array.isArray(values)) {
    return deny('INVALID_AUDIENCE_BASELINE');
  }
  const baselines = new Map<string, string>();
  for (const fact of values) {
    if (!isPlainRecord(fact) || !exactKeys(fact, ['departureLocal', 'transferActivityId'])) {
      return deny('INVALID_AUDIENCE_BASELINE');
    }
    if (
      typeof fact.transferActivityId !== 'string' ||
      fact.transferActivityId.length === 0 ||
      typeof fact.departureLocal !== 'string'
    ) {
      return deny('INVALID_AUDIENCE_BASELINE');
    }
    if (baselines.has(fact.transferActivityId)) {
      return deny('INVALID_AUDIENCE_BASELINE');
    }
    baselines.set(fact.transferActivityId, fact.departureLocal);
  }
  return { ok: true, baselines };
}

function productionLead(crew: readonly CompensationCrewMember[]): CompensationCrewMember | Denied {
  const leads = crew.filter((member) => member.role === PRODUCTION_LEAD);
  if (leads.length !== 1) {
    return deny('INVALID_CREW');
  }
  const lead = leads[0];
  if (lead === undefined) {
    return deny('INVALID_CREW');
  }
  return lead;
}

function unusedPayloads(
  payloads: readonly AppliedPayload[],
  used: ReadonlySet<AppliedPayload>,
): Denied | null {
  for (const payload of payloads) {
    if (!used.has(payload)) {
      return deny('INVALID_APPLIED_PAYLOAD');
    }
  }
  return null;
}

export interface CompensationSource {
  readonly accountId: string;
  readonly productionId: string;
  readonly policyVersion: string;
  readonly proposalId: string;
  readonly currentProductionRevision: number;
  readonly currentGraphRevision: number;
  readonly interventions: readonly unknown[];
  readonly notificationPayloads: readonly unknown[];
  readonly crew: readonly CompensationCrewMember[];
  readonly callTimes: readonly CompensationCallTime[];
  readonly departures: readonly CompensationDeparture[];
}

export function planCompensation(source: CompensationSource): CompensationPlanResult {
  if (!Array.isArray(source.interventions)) {
    return deny('INVALID_APPLIED_INTERVENTION');
  }
  const classified: ClassifiedIntervention[] = [];
  for (let index = 0; index < source.interventions.length; index += 1) {
    const item = classifyIntervention(source.interventions[index], index);
    if (item === null) {
      return deny('INVALID_APPLIED_INTERVENTION');
    }
    classified.push(item);
  }
  const payloadResult = readPayloads(source.notificationPayloads);
  if (!payloadResult.ok) {
    return payloadResult;
  }
  const crewResult = readCrew(source.crew);
  if (!crewResult.ok) {
    return crewResult;
  }
  const callResult = readNamedBaselines(source.callTimes, 'personId', 'callLocal');
  if (!callResult.ok) {
    return callResult;
  }
  const departureResult = readDepartureBaselines(source.departures);
  if (!departureResult.ok) {
    return departureResult;
  }

  const inverses: InterventionPrimitive[] = [];
  const disclosures: ReversibilityDisclosure[] = [];
  const keyedPayloads: Array<{
    readonly sortKey: string;
    readonly payload: ExpectedCorrectivePayload;
  }> = [];
  const postApplyCalls: CompensationCallTime[] = [];
  const postApplyDepartures: CompensationDeparture[] = [];
  const used = new Set<AppliedPayload>();

  for (const item of classified) {
    disclosures.push(item.disclosure);
    if (item.inverse === null) {
      continue;
    }
    inverses.push(item.inverse);
    if (item.original.kind === 'ADJUST_CALL_TIME' && item.inverse.kind === 'ADJUST_CALL_TIME') {
      const built = callPayload(
        item.original,
        item.inverse,
        payloadResult.payloads,
        callResult.baselines,
        crewResult.crew,
        used,
      );
      if (!built.ok) {
        return built;
      }
      keyedPayloads.push({ sortKey: built.baseline.personId, payload: built.payload });
      postApplyCalls.push(built.baseline);
    }
    if (item.original.kind === 'ADJUST_DEPARTURE' && item.inverse.kind === 'ADJUST_DEPARTURE') {
      const built = departurePayload(
        item.original,
        item.inverse,
        payloadResult.payloads,
        departureResult.baselines,
        crewResult.crew,
        used,
      );
      if (!built.ok) {
        return built;
      }
      keyedPayloads.push({ sortKey: built.baseline.transferActivityId, payload: built.payload });
      postApplyDepartures.push(built.baseline);
    }
  }

  const unused = unusedPayloads(payloadResult.payloads, used);
  if (unused !== null) {
    return unused;
  }

  const expectedPayloads = keyedPayloads
    .sort((left, right) => {
      if (left.payload.changeType !== right.payload.changeType) {
        return left.payload.changeType === LOAD_OUT_CHANGE ? -1 : 1;
      }
      return compareOrdinal(left.sortKey, right.sortKey);
    })
    .map((item) => item.payload);
  postApplyCalls.sort((left, right) => compareOrdinal(left.personId, right.personId));
  postApplyDepartures.sort((left, right) =>
    compareOrdinal(left.transferActivityId, right.transferActivityId),
  );

  const sideEffects = expectedPayloads
    .filter((payload) => payload.oldValue !== payload.newValue)
    .map((payload) =>
      Object.freeze({
        kind: SEND_CORRECTIVE_NOTIFICATION,
        recipientPersonId: payload.recipientPersonId,
        changeType: payload.changeType,
        previouslyCommunicatedValue: payload.oldValue,
        correctiveValue: payload.newValue,
      }),
    );
  const affectedRecipients: string[] = [];
  const seenRecipients = new Set<string>();
  for (const payload of expectedPayloads) {
    if (seenRecipients.has(payload.recipientPersonId)) {
      continue;
    }
    seenRecipients.add(payload.recipientPersonId);
    affectedRecipients.push(payload.recipientPersonId);
  }

  const predictedEffects = Object.freeze([...disclosures, ...sideEffects]);
  return Object.freeze({
    ok: true,
    plan: Object.freeze({
      inverses: Object.freeze(inverses),
      disclosures: Object.freeze(disclosures),
      sideEffects: Object.freeze(sideEffects),
      expectedPayloads: Object.freeze(expectedPayloads),
      affectedRecipients: Object.freeze(affectedRecipients),
      audience: Object.freeze({
        interventions: Object.freeze(inverses),
        crew: Object.freeze(crewResult.crew),
        callTimes: Object.freeze(postApplyCalls),
        departures: Object.freeze(postApplyDepartures),
      }),
      context: Object.freeze({
        accountId: source.accountId,
        productionId: source.productionId,
        proposalId: source.proposalId,
        baseProductionRevision: source.currentProductionRevision,
        baseGraphRevision: source.currentGraphRevision,
        policyVersion: source.policyVersion,
        predictedEffects,
      }),
    }),
  });
}

function callPayload(
  original: Extract<InterventionPrimitive, { kind: 'ADJUST_CALL_TIME' }>,
  inverse: Extract<InterventionPrimitive, { kind: 'ADJUST_CALL_TIME' }>,
  payloads: readonly AppliedPayload[],
  baselines: ReadonlyMap<string, string>,
  crew: readonly CompensationCrewMember[],
  used: Set<AppliedPayload>,
):
  | {
      readonly ok: true;
      readonly payload: ExpectedCorrectivePayload;
      readonly baseline: CompensationCallTime;
    }
  | Denied {
  const baseline = baselines.get(original.personId);
  const member = crew.find((item) => item.personId === original.personId);
  const matches = payloads.filter(
    (payload) =>
      !used.has(payload) &&
      payload.recipientPersonId === original.personId &&
      payload.changeType === CALL_TIME_CHANGE &&
      payload.reasonCode === CALL_TIME_REASON &&
      payload.requiredAction === CONFIRM_UPDATED_CALL,
  );
  const applied = matches.length === 1 ? matches[0] : undefined;
  if (baseline === undefined || member === undefined || applied === undefined) {
    return deny('INVALID_AUDIENCE_BASELINE');
  }
  if (applied.oldValue !== baseline || applied.recipientRole !== member.role) {
    return deny('INVALID_AUDIENCE_BASELINE');
  }
  if (shiftLocalTime(applied.oldValue, original.deltaMinutes) !== applied.newValue) {
    return deny('INVALID_AUDIENCE_BASELINE');
  }
  const correctiveValue = shiftLocalTime(applied.newValue, inverse.deltaMinutes);
  if (correctiveValue === null) {
    return deny('TIME_OUT_OF_RANGE');
  }
  used.add(applied);
  return {
    ok: true,
    baseline: Object.freeze({ personId: original.personId, callLocal: applied.newValue }),
    payload: Object.freeze({
      recipientPersonId: member.personId,
      recipientRole: member.role,
      changeType: CALL_TIME_CHANGE,
      oldValue: applied.newValue,
      newValue: correctiveValue,
      reasonCode: CALL_TIME_REASON,
      requiredAction: CONFIRM_UPDATED_CALL,
    }),
  };
}

function departurePayload(
  original: Extract<InterventionPrimitive, { kind: 'ADJUST_DEPARTURE' }>,
  inverse: Extract<InterventionPrimitive, { kind: 'ADJUST_DEPARTURE' }>,
  payloads: readonly AppliedPayload[],
  baselines: ReadonlyMap<string, string>,
  crew: readonly CompensationCrewMember[],
  used: Set<AppliedPayload>,
):
  | {
      readonly ok: true;
      readonly payload: ExpectedCorrectivePayload;
      readonly baseline: CompensationDeparture;
    }
  | Denied {
  const lead = productionLead(crew);
  if (!('personId' in lead)) {
    return lead;
  }
  const baseline = baselines.get(original.transferActivityId);
  const matches = payloads.filter(
    (payload) =>
      !used.has(payload) &&
      payload.changeType === LOAD_OUT_CHANGE &&
      payload.reasonCode === LOAD_OUT_REASON &&
      payload.requiredAction === INFORMATION_ONLY &&
      payload.oldValue === baseline &&
      payload.recipientPersonId === lead.personId &&
      payload.recipientRole === lead.role,
  );
  const applied = matches.length === 1 ? matches[0] : undefined;
  if (baseline === undefined || applied === undefined) {
    return deny('INVALID_AUDIENCE_BASELINE');
  }
  if (shiftLocalTime(applied.oldValue, original.deltaMinutes) !== applied.newValue) {
    return deny('INVALID_AUDIENCE_BASELINE');
  }
  const correctiveValue = shiftLocalTime(applied.newValue, inverse.deltaMinutes);
  if (correctiveValue === null) {
    return deny('TIME_OUT_OF_RANGE');
  }
  used.add(applied);
  return {
    ok: true,
    baseline: Object.freeze({
      transferActivityId: original.transferActivityId,
      departureLocal: applied.newValue,
    }),
    payload: Object.freeze({
      recipientPersonId: lead.personId,
      recipientRole: lead.role,
      changeType: LOAD_OUT_CHANGE,
      oldValue: applied.newValue,
      newValue: correctiveValue,
      reasonCode: LOAD_OUT_REASON,
      requiredAction: INFORMATION_ONLY,
    }),
  };
}
