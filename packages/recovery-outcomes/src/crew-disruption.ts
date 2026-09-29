export const CREW_DISRUPTION_ALGORITHM_VERSION = 'SR-CREW-DISRUPTION-v1' as const;

export const CREW_EVENT_KINDS = [
  'ACTIVITY_ORDER_CHANGED',
  'BACKUP_OPERATOR_DUTY_ADDED',
  'LOCATION_CHANGED',
  'PERSONAL_CALL_TIME_CHANGED',
  'REVERIFICATION_DUTY_ADDED',
  'SHARED_ACTIVITY_TIME_CHANGED',
  'SHARED_DEPARTURE_TIME_CHANGED',
] as const;

export type CrewEventKind = (typeof CREW_EVENT_KINDS)[number];

export const CREW_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type CrewLevel = (typeof CREW_LEVELS)[number];

export const CREW_DISRUPTION_ISSUES = [
  'CONFLICTING_EVENT',
  'EMPTY_AFFECTED_PERSON_IDS',
  'MALFORMED_EVENT',
  'MALFORMED_PERSON_ID',
  'MISSING_DELTA',
  'NON_INTEGER_DELTA',
  'ZERO_DELTA',
] as const;

export type CrewDisruptionIssue = (typeof CREW_DISRUPTION_ISSUES)[number];

export interface PersonalCallTimeChanged {
  readonly kind: 'PERSONAL_CALL_TIME_CHANGED';
  readonly personId: string;
  readonly deltaMinutes: number;
}

export interface SharedActivityTimeChanged {
  readonly kind: 'SHARED_ACTIVITY_TIME_CHANGED';
  readonly activityId: string;
  readonly deltaMinutes: number;
  readonly affectedPersonIds: readonly string[];
}

export interface SharedDepartureTimeChanged {
  readonly kind: 'SHARED_DEPARTURE_TIME_CHANGED';
  readonly activityId: string;
  readonly deltaMinutes: number;
  readonly affectedPersonIds: readonly string[];
}

export interface LocationChanged {
  readonly kind: 'LOCATION_CHANGED';
  readonly affectedPersonIds: readonly string[];
}

export interface ActivityOrderChanged {
  readonly kind: 'ACTIVITY_ORDER_CHANGED';
  readonly activityIds: readonly string[];
  readonly affectedPersonIds: readonly string[];
}

export interface ReverificationDutyAdded {
  readonly kind: 'REVERIFICATION_DUTY_ADDED';
  readonly affectedPersonIds: readonly string[];
}

export interface BackupOperatorDutyAdded {
  readonly kind: 'BACKUP_OPERATOR_DUTY_ADDED';
  readonly affectedPersonIds: readonly string[];
}

export type CrewDisruptionEvent =
  | PersonalCallTimeChanged
  | SharedActivityTimeChanged
  | SharedDepartureTimeChanged
  | LocationChanged
  | ActivityOrderChanged
  | ReverificationDutyAdded
  | BackupOperatorDutyAdded;

export interface CrewDisruptionAvailable {
  readonly status: 'AVAILABLE';
  readonly algorithmVersion: typeof CREW_DISRUPTION_ALGORITHM_VERSION;
  readonly level: CrewLevel;
  readonly affectedPersonIds: readonly string[];
  readonly eventKinds: readonly CrewEventKind[];
}

export interface CrewDisruptionWithheld {
  readonly status: 'WITHHELD';
  readonly algorithmVersion: typeof CREW_DISRUPTION_ALGORITHM_VERSION;
  readonly issues: readonly CrewDisruptionIssue[];
}

export type CrewDisruptionResult = CrewDisruptionAvailable | CrewDisruptionWithheld;

interface EventIdentity {
  readonly key: string;
  readonly signature: string;
}

interface AcceptedEvent {
  readonly kind: CrewEventKind;
  readonly personIds: readonly string[];
  readonly callerId: string | null;
  readonly key: string;
}

const CRITICAL_KINDS: ReadonlySet<CrewEventKind> = new Set([
  'ACTIVITY_ORDER_CHANGED',
  'BACKUP_OPERATOR_DUTY_ADDED',
  'LOCATION_CHANGED',
  'REVERIFICATION_DUTY_ADDED',
]);

const HIGH_KINDS: ReadonlySet<CrewEventKind> = new Set([
  'SHARED_ACTIVITY_TIME_CHANGED',
  'SHARED_DEPARTURE_TIME_CHANGED',
]);

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCrewKind(value: unknown): value is CrewEventKind {
  return typeof value === 'string' && (CREW_EVENT_KINDS as readonly string[]).includes(value);
}

function uniqueSorted(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort(compareOrdinal);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== null && typeof nested === 'object') {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

function readDelta(value: unknown, issues: Set<CrewDisruptionIssue>): number | undefined {
  if (value === undefined || value === null) {
    issues.add('MISSING_DELTA');
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.add('NON_INTEGER_DELTA');
    return undefined;
  }
  if (value === 0) {
    issues.add('ZERO_DELTA');
  }
  return value;
}

function readPersonIds(value: unknown, issues: Set<CrewDisruptionIssue>): readonly string[] | null {
  if (!Array.isArray(value)) {
    issues.add('MALFORMED_EVENT');
    return null;
  }
  if (value.length === 0) {
    issues.add('EMPTY_AFFECTED_PERSON_IDS');
    return null;
  }
  const ids: string[] = [];
  let malformed = false;
  for (const entry of value) {
    if (!nonEmptyString(entry)) {
      issues.add('MALFORMED_PERSON_ID');
      malformed = true;
      continue;
    }
    ids.push(entry);
  }
  if (malformed) {
    return null;
  }
  return uniqueSorted(ids);
}

function readActivityId(value: unknown, issues: Set<CrewDisruptionIssue>): string | null {
  if (!nonEmptyString(value)) {
    issues.add('MALFORMED_EVENT');
    return null;
  }
  return value;
}

function readActivityIds(
  value: unknown,
  issues: Set<CrewDisruptionIssue>,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    issues.add('MALFORMED_EVENT');
    return null;
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (!nonEmptyString(entry)) {
      issues.add('MALFORMED_EVENT');
      return null;
    }
    ids.push(entry);
  }
  return uniqueSorted(ids);
}

function parseEvent(
  entry: unknown,
  issues: Set<CrewDisruptionIssue>,
): { readonly identity: EventIdentity | null; readonly accepted: AcceptedEvent | null } {
  if (!isRecord(entry) || !isCrewKind(entry.kind)) {
    issues.add('MALFORMED_EVENT');
    return { identity: null, accepted: null };
  }

  switch (entry.kind) {
    case 'PERSONAL_CALL_TIME_CHANGED': {
      const personId = entry.personId;
      const personOk = nonEmptyString(personId);
      if (!personOk) {
        issues.add('MALFORMED_PERSON_ID');
      }
      const delta = readDelta(entry.deltaMinutes, issues);
      if (!personOk || delta === undefined) {
        return { identity: null, accepted: null };
      }
      const key = JSON.stringify([entry.kind, personId]);
      const identity = { key, signature: JSON.stringify([delta]) };
      if (delta === 0) {
        return { identity, accepted: null };
      }
      return {
        identity,
        accepted: { kind: entry.kind, personIds: [personId], callerId: personId, key },
      };
    }
    case 'SHARED_ACTIVITY_TIME_CHANGED':
    case 'SHARED_DEPARTURE_TIME_CHANGED': {
      const activityId = readActivityId(entry.activityId, issues);
      const delta = readDelta(entry.deltaMinutes, issues);
      const personIds = readPersonIds(entry.affectedPersonIds, issues);
      if (activityId === null || delta === undefined || personIds === null) {
        return { identity: null, accepted: null };
      }
      const key = JSON.stringify([entry.kind, activityId]);
      const identity = { key, signature: JSON.stringify([delta, personIds]) };
      if (delta === 0) {
        return { identity, accepted: null };
      }
      return { identity, accepted: { kind: entry.kind, personIds, callerId: null, key } };
    }
    case 'LOCATION_CHANGED':
    case 'REVERIFICATION_DUTY_ADDED':
    case 'BACKUP_OPERATOR_DUTY_ADDED': {
      const personIds = readPersonIds(entry.affectedPersonIds, issues);
      if (personIds === null) {
        return { identity: null, accepted: null };
      }
      const key = JSON.stringify([entry.kind]);
      return {
        identity: { key, signature: JSON.stringify([personIds]) },
        accepted: { kind: entry.kind, personIds, callerId: null, key },
      };
    }
    case 'ACTIVITY_ORDER_CHANGED': {
      const activityIds = readActivityIds(entry.activityIds, issues);
      const personIds = readPersonIds(entry.affectedPersonIds, issues);
      if (activityIds === null || personIds === null) {
        return { identity: null, accepted: null };
      }
      const key = JSON.stringify([entry.kind, activityIds]);
      return {
        identity: { key, signature: JSON.stringify([personIds]) },
        accepted: { kind: entry.kind, personIds, callerId: null, key },
      };
    }
    default: {
      const unexpected: never = entry.kind;
      void unexpected;
      issues.add('MALFORMED_EVENT');
      return { identity: null, accepted: null };
    }
  }
}

function classify(events: readonly AcceptedEvent[]): CrewLevel {
  let critical = false;
  let high = false;
  const callers = new Set<string>();
  for (const event of events) {
    if (CRITICAL_KINDS.has(event.kind)) {
      critical = true;
    }
    if (HIGH_KINDS.has(event.kind)) {
      high = true;
    }
    if (event.callerId !== null) {
      callers.add(event.callerId);
    }
  }
  if (critical) {
    return 'CRITICAL';
  }
  if (high) {
    return 'HIGH';
  }
  if (callers.size >= 2) {
    return 'MEDIUM';
  }
  if (callers.size === 1) {
    return 'LOW';
  }
  return 'NONE';
}

function sortedIssues(issues: ReadonlySet<CrewDisruptionIssue>): readonly CrewDisruptionIssue[] {
  return [...issues].sort(compareOrdinal);
}

export function evaluateCrewDisruption(events: unknown): CrewDisruptionResult {
  const issues = new Set<CrewDisruptionIssue>();
  if (!Array.isArray(events)) {
    issues.add('MALFORMED_EVENT');
    const withheld: CrewDisruptionWithheld = {
      status: 'WITHHELD',
      algorithmVersion: CREW_DISRUPTION_ALGORITHM_VERSION,
      issues: sortedIssues(issues),
    };
    return deepFreeze(withheld);
  }

  const identities: EventIdentity[] = [];
  const accepted: AcceptedEvent[] = [];
  for (const entry of events) {
    const parsed = parseEvent(entry, issues);
    if (parsed.identity !== null) {
      identities.push(parsed.identity);
    }
    if (parsed.accepted !== null) {
      accepted.push(parsed.accepted);
    }
  }

  const seen = new Map<string, string>();
  for (const identity of identities) {
    const previous = seen.get(identity.key);
    if (previous === undefined) {
      seen.set(identity.key, identity.signature);
    } else if (previous !== identity.signature) {
      issues.add('CONFLICTING_EVENT');
    }
  }

  if (issues.size > 0) {
    const withheld: CrewDisruptionWithheld = {
      status: 'WITHHELD',
      algorithmVersion: CREW_DISRUPTION_ALGORITHM_VERSION,
      issues: sortedIssues(issues),
    };
    return deepFreeze(withheld);
  }

  const unique: AcceptedEvent[] = [];
  const acceptedKeys = new Set<string>();
  for (const event of accepted) {
    if (acceptedKeys.has(event.key)) {
      continue;
    }
    acceptedKeys.add(event.key);
    unique.push(event);
  }

  const people = new Set<string>();
  const kinds = new Set<CrewEventKind>();
  for (const event of unique) {
    kinds.add(event.kind);
    for (const personId of event.personIds) {
      people.add(personId);
    }
  }

  const result: CrewDisruptionAvailable = {
    status: 'AVAILABLE',
    algorithmVersion: CREW_DISRUPTION_ALGORITHM_VERSION,
    level: classify(unique),
    affectedPersonIds: [...people].sort(compareOrdinal),
    eventKinds: [...kinds].sort(compareOrdinal),
  };
  return deepFreeze(result);
}
