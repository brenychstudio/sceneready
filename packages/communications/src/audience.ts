import { parseIntervention, type InterventionPrimitive } from '@sceneready/intervention-engine';

import type { NotificationFacts } from './message-schema.js';
import {
  CALL_TIME_CHANGE,
  CALL_TIME_REASON,
  CONFIRM_UPDATED_CALL,
  INFORMATION_ONLY,
  LOAD_OUT_CHANGE,
  LOAD_OUT_REASON,
} from './message-schema.js';

export const COMMUNICATION_AUDIENCE_POLICY_VERSION = 'SR-COMMUNICATION-AUDIENCE-v1.0' as const;

/** Exact canonical role token. Display titles are not interpreted. */
export const CANONICAL_COORDINATION_ROLE = 'PRODUCTION_LEAD' as const;

export const AUDIENCE_ISSUE_CODES = [
  'AMBIGUOUS_ASSIGNMENT',
  'AMBIGUOUS_CALL_BASELINE',
  'AMBIGUOUS_CREW_ROLE',
  'AMBIGUOUS_DEPARTURE_BASELINE',
  'DUPLICATE_CALL_OBLIGATION',
  'DUPLICATE_DEPARTURE_OBLIGATION',
  'INVALID_ASSIGNMENT',
  'INVALID_CREW_MEMBER',
  'INVALID_CREW_ROLE',
  'INVALID_INTERVENTION',
  'INVALID_TIME_FACT',
  'MALFORMED_INPUT',
  'MISSING_CALL_BASELINE',
  'MISSING_DEPARTURE_BASELINE',
  'MISSING_PRODUCTION_LEAD',
  'MULTIPLE_PRODUCTION_LEADS',
  'TIME_OUT_OF_RANGE',
  'UNKNOWN_CALL_PERSON',
] as const;

export type AudienceIssueCode = (typeof AUDIENCE_ISSUE_CODES)[number];

export interface CommunicationCrewMember {
  readonly personId: string;
  readonly role: string;
}

export interface CallTimeFact {
  readonly personId: string;
  readonly callLocal: string;
}

export interface DepartureTimeFact {
  readonly transferActivityId: string;
  readonly departureLocal: string;
}

export interface AssignmentFact {
  readonly activityId: string;
  readonly assignedPersonIds: readonly string[];
}

export interface CommunicationAudienceInput {
  readonly interventions: readonly InterventionPrimitive[];
  readonly crew: readonly CommunicationCrewMember[];
  readonly callTimes: readonly CallTimeFact[];
  readonly departures: readonly DepartureTimeFact[];
  readonly activityAssignments?: readonly AssignmentFact[];
  readonly departureAssignments?: readonly AssignmentFact[];
}

export interface AffectedAudience {
  readonly policyVersion: typeof COMMUNICATION_AUDIENCE_POLICY_VERSION;
  readonly affectedRecipients: readonly string[];
  readonly obligations: readonly NotificationFacts[];
}

export type AudienceResult =
  | { readonly ok: true; readonly audience: AffectedAudience }
  | { readonly ok: false; readonly issues: readonly AudienceIssueCode[] };

interface CrewRecord {
  readonly personId: string;
  readonly role: string;
}

const ENTITY_ID = /^[A-Z0-9][A-Z0-9-]{2,63}$/;
const ROLE_TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;
const INPUT_KEYS = new Set<string>([
  'activityAssignments',
  'callTimes',
  'crew',
  'departureAssignments',
  'departures',
  'interventions',
]);

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function sortedIssues(issues: ReadonlySet<AudienceIssueCode>): readonly AudienceIssueCode[] {
  return Object.freeze([...issues].sort(compareOrdinal));
}

function fail(issues: ReadonlySet<AudienceIssueCode>): AudienceResult {
  return Object.freeze({ ok: false, issues: sortedIssues(issues) });
}

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

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function hasInputShape(value: object): value is CommunicationAudienceInput {
  if (!isPlainObject(value)) {
    return false;
  }
  if (Object.keys(value).some((key) => !INPUT_KEYS.has(key))) {
    return false;
  }
  if (
    !Array.isArray(value.interventions) ||
    !Array.isArray(value.crew) ||
    !Array.isArray(value.callTimes) ||
    !Array.isArray(value.departures)
  ) {
    return false;
  }
  if (Object.hasOwn(value, 'activityAssignments') && !Array.isArray(value.activityAssignments)) {
    return false;
  }
  if (Object.hasOwn(value, 'departureAssignments') && !Array.isArray(value.departureAssignments)) {
    return false;
  }
  return true;
}

function readCrew(crew: readonly unknown[], issues: Set<AudienceIssueCode>): readonly CrewRecord[] {
  const records: CrewRecord[] = [];
  const seen = new Set<string>();
  for (const member of crew) {
    if (
      typeof member !== 'object' ||
      member === null ||
      Array.isArray(member) ||
      !isPlainObject(member)
    ) {
      issues.add('INVALID_CREW_MEMBER');
      continue;
    }
    if (!exactKeys(member, ['personId', 'role'])) {
      issues.add('INVALID_CREW_MEMBER');
      continue;
    }
    const personId = readString(member.personId);
    const role = readString(member.role);
    if (personId === null || !ENTITY_ID.test(personId)) {
      issues.add('INVALID_CREW_MEMBER');
    }
    if (role === null || !ROLE_TOKEN.test(role)) {
      issues.add('INVALID_CREW_ROLE');
    }
    if (personId === null || role === null || !ENTITY_ID.test(personId) || !ROLE_TOKEN.test(role)) {
      continue;
    }
    if (seen.has(personId)) {
      issues.add('AMBIGUOUS_CREW_ROLE');
      continue;
    }
    seen.add(personId);
    records.push(Object.freeze({ personId, role }));
  }
  const leads = records.filter((member) => member.role === CANONICAL_COORDINATION_ROLE);
  if (leads.length > 1) {
    issues.add('MULTIPLE_PRODUCTION_LEADS');
  }
  return records;
}

function readCallTimes(
  callTimes: readonly unknown[],
  issues: Set<AudienceIssueCode>,
): ReadonlyMap<string, string> {
  const baselines = new Map<string, string>();
  for (const fact of callTimes) {
    if (typeof fact !== 'object' || fact === null || Array.isArray(fact) || !isPlainObject(fact)) {
      issues.add('INVALID_TIME_FACT');
      continue;
    }
    if (!exactKeys(fact, ['callLocal', 'personId'])) {
      issues.add('INVALID_TIME_FACT');
      continue;
    }
    const personId = readString(fact.personId);
    const callLocal = readString(fact.callLocal);
    if (
      personId === null ||
      callLocal === null ||
      !ENTITY_ID.test(personId) ||
      !LOCAL_TIME.test(callLocal)
    ) {
      issues.add('INVALID_TIME_FACT');
      continue;
    }
    if (baselines.has(personId)) {
      issues.add('AMBIGUOUS_CALL_BASELINE');
      continue;
    }
    baselines.set(personId, callLocal);
  }
  return baselines;
}

function readDepartures(
  departures: readonly unknown[],
  issues: Set<AudienceIssueCode>,
): ReadonlyMap<string, string> {
  const baselines = new Map<string, string>();
  for (const fact of departures) {
    if (typeof fact !== 'object' || fact === null || Array.isArray(fact) || !isPlainObject(fact)) {
      issues.add('INVALID_TIME_FACT');
      continue;
    }
    if (!exactKeys(fact, ['departureLocal', 'transferActivityId'])) {
      issues.add('INVALID_TIME_FACT');
      continue;
    }
    const transferActivityId = readString(fact.transferActivityId);
    const departureLocal = readString(fact.departureLocal);
    if (
      transferActivityId === null ||
      departureLocal === null ||
      !ENTITY_ID.test(transferActivityId) ||
      !LOCAL_TIME.test(departureLocal)
    ) {
      issues.add('INVALID_TIME_FACT');
      continue;
    }
    if (baselines.has(transferActivityId)) {
      issues.add('AMBIGUOUS_DEPARTURE_BASELINE');
      continue;
    }
    baselines.set(transferActivityId, departureLocal);
  }
  return baselines;
}

/**
 * Assignment lists are validated and then discarded. They never widen the
 * direct audience under SR-COMMUNICATION-AUDIENCE-v1.0.
 */
function readAssignments(
  assignments: readonly unknown[] | undefined,
  crewIds: ReadonlySet<string>,
  issues: Set<AudienceIssueCode>,
): void {
  if (assignments === undefined) {
    return;
  }
  const seenActivities = new Set<string>();
  for (const assignment of assignments) {
    if (
      typeof assignment !== 'object' ||
      assignment === null ||
      Array.isArray(assignment) ||
      !isPlainObject(assignment) ||
      !exactKeys(assignment, ['activityId', 'assignedPersonIds'])
    ) {
      issues.add('INVALID_ASSIGNMENT');
      continue;
    }
    const activityId = readString(assignment.activityId);
    const assigned = assignment.assignedPersonIds;
    if (activityId === null || !ENTITY_ID.test(activityId) || !Array.isArray(assigned)) {
      issues.add('INVALID_ASSIGNMENT');
      continue;
    }
    if (seenActivities.has(activityId)) {
      issues.add('AMBIGUOUS_ASSIGNMENT');
      continue;
    }
    seenActivities.add(activityId);
    const seenPeople = new Set<string>();
    for (const personId of assigned) {
      if (typeof personId !== 'string' || !ENTITY_ID.test(personId) || !crewIds.has(personId)) {
        issues.add('INVALID_ASSIGNMENT');
        continue;
      }
      if (seenPeople.has(personId)) {
        issues.add('AMBIGUOUS_ASSIGNMENT');
        continue;
      }
      seenPeople.add(personId);
    }
  }
}

function freezeFacts(facts: NotificationFacts): NotificationFacts {
  return Object.freeze({
    recipientPersonId: facts.recipientPersonId,
    recipientRole: facts.recipientRole,
    changeType: facts.changeType,
    oldValue: facts.oldValue,
    newValue: facts.newValue,
    reasonCode: facts.reasonCode,
    requiredAction: facts.requiredAction,
  });
}

function coordinationOwner(crew: readonly CrewRecord[]): CrewRecord | null {
  const leads = crew.filter((member) => member.role === CANONICAL_COORDINATION_ROLE);
  if (leads.length !== 1) {
    return null;
  }
  return leads[0] ?? null;
}

export function deriveAffectedAudience(input: CommunicationAudienceInput): AudienceResult {
  if (typeof input !== 'object' || input === null || !hasInputShape(input)) {
    return fail(new Set<AudienceIssueCode>(['MALFORMED_INPUT']));
  }
  const issues = new Set<AudienceIssueCode>();
  const crew = readCrew(input.crew, issues);
  const crewIds = new Set(crew.map((member) => member.personId));
  const crewById = new Map(crew.map((member) => [member.personId, member]));
  const callTimes = readCallTimes(input.callTimes, issues);
  const departures = readDepartures(input.departures, issues);
  readAssignments(
    Object.hasOwn(input, 'activityAssignments') ? input.activityAssignments : undefined,
    crewIds,
    issues,
  );
  readAssignments(
    Object.hasOwn(input, 'departureAssignments') ? input.departureAssignments : undefined,
    crewIds,
    issues,
  );

  const parsed: InterventionPrimitive[] = [];
  for (const value of input.interventions) {
    const result = parseIntervention(value);
    if (!result.ok) {
      issues.add('INVALID_INTERVENTION');
      continue;
    }
    parsed.push(result.intervention);
  }

  const callObligations: NotificationFacts[] = [];
  const departureObligations: Array<{
    readonly activityId: string;
    readonly facts: NotificationFacts;
  }> = [];
  const seenCalls = new Set<string>();
  const seenDepartures = new Set<string>();
  const lead = coordinationOwner(crew);
  let departureCount = 0;

  for (const intervention of parsed) {
    switch (intervention.kind) {
      case 'ADJUST_CALL_TIME': {
        const member = crewById.get(intervention.personId);
        if (member === undefined) {
          issues.add('UNKNOWN_CALL_PERSON');
          break;
        }
        const oldValue = callTimes.get(intervention.personId);
        if (oldValue === undefined) {
          issues.add('MISSING_CALL_BASELINE');
          break;
        }
        if (seenCalls.has(intervention.personId)) {
          issues.add('DUPLICATE_CALL_OBLIGATION');
          break;
        }
        const newValue = shiftLocalTime(oldValue, intervention.deltaMinutes);
        if (newValue === null) {
          issues.add(LOCAL_TIME.test(oldValue) ? 'TIME_OUT_OF_RANGE' : 'INVALID_TIME_FACT');
          break;
        }
        seenCalls.add(intervention.personId);
        callObligations.push(
          freezeFacts({
            recipientPersonId: member.personId,
            recipientRole: member.role,
            changeType: CALL_TIME_CHANGE,
            oldValue,
            newValue,
            reasonCode: CALL_TIME_REASON,
            requiredAction: CONFIRM_UPDATED_CALL,
          }),
        );
        break;
      }
      case 'ADJUST_DEPARTURE': {
        departureCount += 1;
        if (lead === null) {
          if (crew.filter((member) => member.role === CANONICAL_COORDINATION_ROLE).length > 1) {
            issues.add('MULTIPLE_PRODUCTION_LEADS');
          } else {
            issues.add('MISSING_PRODUCTION_LEAD');
          }
          break;
        }
        const oldValue = departures.get(intervention.transferActivityId);
        if (oldValue === undefined) {
          issues.add('MISSING_DEPARTURE_BASELINE');
          break;
        }
        if (seenDepartures.has(intervention.transferActivityId)) {
          issues.add('DUPLICATE_DEPARTURE_OBLIGATION');
          break;
        }
        const newValue = shiftLocalTime(oldValue, intervention.deltaMinutes);
        if (newValue === null) {
          issues.add('TIME_OUT_OF_RANGE');
          break;
        }
        const facts = freezeFacts({
          recipientPersonId: lead.personId,
          recipientRole: lead.role,
          changeType: LOAD_OUT_CHANGE,
          oldValue,
          newValue,
          reasonCode: LOAD_OUT_REASON,
          requiredAction: INFORMATION_ONLY,
        });
        if (departureObligations.some((item) => factKey(item.facts) === factKey(facts))) {
          issues.add('DUPLICATE_DEPARTURE_OBLIGATION');
          break;
        }
        seenDepartures.add(intervention.transferActivityId);
        departureObligations.push(
          Object.freeze({ activityId: intervention.transferActivityId, facts }),
        );
        break;
      }
      case 'SHIFT_ACTIVITY':
      case 'ADD_BUFFER':
      case 'SHORTEN_ACTIVITY':
      case 'REORDER_ACTIVITIES':
      case 'ACTIVATE_BACKUP_KIT':
      case 'REQUIRE_REVERIFICATION':
      case 'SWITCH_TO_APPROVED_FALLBACK':
      case 'INCREASE_TRANSFER_BUFFER':
      case 'REQUEST_MISSING_CONFIRMATION':
        break;
      default: {
        const unexpected: never = intervention;
        void unexpected;
        issues.add('INVALID_INTERVENTION');
      }
    }
  }

  if (departureCount > 0 && lead === null && !issues.has('MULTIPLE_PRODUCTION_LEADS')) {
    issues.add('MISSING_PRODUCTION_LEAD');
  }

  if (issues.size > 0) {
    return fail(issues);
  }

  departureObligations.sort((left, right) => compareOrdinal(left.activityId, right.activityId));
  callObligations.sort((left, right) =>
    compareOrdinal(left.recipientPersonId, right.recipientPersonId),
  );

  const obligations = [...departureObligations.map((item) => item.facts), ...callObligations];
  const affectedRecipients: string[] = [];
  const seenRecipients = new Set<string>();
  for (const obligation of obligations) {
    if (seenRecipients.has(obligation.recipientPersonId)) {
      continue;
    }
    seenRecipients.add(obligation.recipientPersonId);
    affectedRecipients.push(obligation.recipientPersonId);
  }

  return Object.freeze({
    ok: true,
    audience: Object.freeze({
      policyVersion: COMMUNICATION_AUDIENCE_POLICY_VERSION,
      affectedRecipients: Object.freeze(affectedRecipients),
      obligations: Object.freeze(obligations),
    }),
  });
}

function factKey(facts: NotificationFacts): string {
  return [
    facts.recipientPersonId,
    facts.recipientRole,
    facts.changeType,
    facts.oldValue,
    facts.newValue,
    facts.reasonCode,
    facts.requiredAction,
  ].join('\u001f');
}
