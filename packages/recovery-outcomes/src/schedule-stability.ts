export const SCHEDULE_STABILITY_ALGORITHM_VERSION = 'SR-SCHEDULE-STABILITY-v1' as const;

export const BOUND_SOURCE_INTERVENTION_CONTRACT = 'v1' as const;

// EntityId pattern and primitive maxima from the accepted intervention contract.
// Changing either binding requires a new schedule algorithm version.
const ENTITY_ID = /^[A-Z0-9][A-Z0-9-]{2,63}$/;

export const SCHEDULE_EVENT_KINDS = [
  'ACTIVITY_ORDER_CHANGED',
  'ACTIVITY_SHORTENED',
  'ACTIVITY_TIME_CHANGED',
  'BUFFER_ADDED',
  'DEPARTURE_TIME_CHANGED',
  'PERSONAL_CALL_TIME_CHANGED',
  'TRANSFER_BUFFER_INCREASED',
] as const;

export type ScheduleEventKind = (typeof SCHEDULE_EVENT_KINDS)[number];

export const SCHEDULE_BOUND_MAXIMA = Object.freeze({
  ACTIVITY_TIME_CHANGED: 120,
  PERSONAL_CALL_TIME_CHANGED: 90,
  DEPARTURE_TIME_CHANGED: 90,
  ACTIVITY_SHORTENED: 60,
  BUFFER_ADDED: 45,
  TRANSFER_BUFFER_INCREASED: 45,
});

export const SCHEDULE_STABILITY_ISSUES = [
  'CONFLICTING_EVENT',
  'MALFORMED_EVENT',
  'MALFORMED_SUBJECT_ID',
  'NON_INTEGER_CHANGE',
  'OUT_OF_BOUND',
  'REORDER_TOO_SHORT',
  'ZERO_CHANGE',
] as const;

export type ScheduleStabilityIssue = (typeof SCHEDULE_STABILITY_ISSUES)[number];

export interface ActivityTimeChanged {
  readonly kind: 'ACTIVITY_TIME_CHANGED';
  readonly subjectId: string;
  readonly deltaMinutes: number;
}

export interface SchedulePersonalCallChanged {
  readonly kind: 'PERSONAL_CALL_TIME_CHANGED';
  readonly subjectId: string;
  readonly deltaMinutes: number;
}

export interface DepartureTimeChanged {
  readonly kind: 'DEPARTURE_TIME_CHANGED';
  readonly subjectId: string;
  readonly deltaMinutes: number;
}

export interface ActivityShortened {
  readonly kind: 'ACTIVITY_SHORTENED';
  readonly subjectId: string;
  readonly minutes: number;
}

export interface BufferAdded {
  readonly kind: 'BUFFER_ADDED';
  readonly subjectId: string;
  readonly minutes: number;
}

export interface TransferBufferIncreased {
  readonly kind: 'TRANSFER_BUFFER_INCREASED';
  readonly subjectId: string;
  readonly minutes: number;
}

export interface ScheduleOrderChanged {
  readonly kind: 'ACTIVITY_ORDER_CHANGED';
  readonly subjectIds: readonly string[];
}

export type ScheduleChangeEvent =
  | ActivityTimeChanged
  | SchedulePersonalCallChanged
  | DepartureTimeChanged
  | ActivityShortened
  | BufferAdded
  | TransferBufferIncreased
  | ScheduleOrderChanged;

export interface ScheduleStabilityAvailable {
  readonly status: 'AVAILABLE';
  readonly algorithmVersion: typeof SCHEDULE_STABILITY_ALGORITHM_VERSION;
  readonly boundSource: typeof BOUND_SOURCE_INTERVENTION_CONTRACT;
  readonly scheduleStability: number;
}

export interface ScheduleStabilityWithheld {
  readonly status: 'WITHHELD';
  readonly algorithmVersion: typeof SCHEDULE_STABILITY_ALGORITHM_VERSION;
  readonly boundSource: typeof BOUND_SOURCE_INTERVENTION_CONTRACT;
  readonly issues: readonly ScheduleStabilityIssue[];
}

export type ScheduleStabilityResult = ScheduleStabilityAvailable | ScheduleStabilityWithheld;

interface EventIdentity {
  readonly key: string;
  readonly signature: string;
}

interface AcceptedDisturbance {
  readonly key: string;
  readonly absolute: number;
  readonly bound: number;
}

interface ParsedEvent {
  readonly identity: EventIdentity | null;
  readonly accepted: AcceptedDisturbance | null;
}

const SIGNED_KINDS: ReadonlySet<ScheduleEventKind> = new Set([
  'ACTIVITY_TIME_CHANGED',
  'PERSONAL_CALL_TIME_CHANGED',
  'DEPARTURE_TIME_CHANGED',
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

function isScheduleKind(value: unknown): value is ScheduleEventKind {
  return typeof value === 'string' && (SCHEDULE_EVENT_KINDS as readonly string[]).includes(value);
}

function isSubjectId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID.test(value);
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

function roundHalfAwayFromZero(numerator: number, denominator: number): number {
  const scaled = 2 * numerator + denominator;
  const divisor = 2 * denominator;
  return (scaled - (scaled % divisor)) / divisor;
}

function sortedIssues(
  issues: ReadonlySet<ScheduleStabilityIssue>,
): readonly ScheduleStabilityIssue[] {
  return [...issues].sort(compareOrdinal);
}

function withhold(issues: ReadonlySet<ScheduleStabilityIssue>): ScheduleStabilityWithheld {
  return deepFreeze({
    status: 'WITHHELD',
    algorithmVersion: SCHEDULE_STABILITY_ALGORITHM_VERSION,
    boundSource: BOUND_SOURCE_INTERVENTION_CONTRACT,
    issues: sortedIssues(issues),
  });
}

function available(scheduleStability: number): ScheduleStabilityAvailable {
  return deepFreeze({
    status: 'AVAILABLE',
    algorithmVersion: SCHEDULE_STABILITY_ALGORITHM_VERSION,
    boundSource: BOUND_SOURCE_INTERVENTION_CONTRACT,
    scheduleStability,
  });
}

function readChange(
  value: unknown,
  maximum: number,
  signed: boolean,
  issues: Set<ScheduleStabilityIssue>,
): { readonly absolute: number | null; readonly signature: string | null } {
  if (value === undefined || value === null) {
    issues.add('MALFORMED_EVENT');
    return { absolute: null, signature: null };
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.add('NON_INTEGER_CHANGE');
    return { absolute: null, signature: null };
  }
  const signature = JSON.stringify([value]);
  if (value === 0) {
    issues.add('ZERO_CHANGE');
    return { absolute: null, signature };
  }
  if (!signed && value < 0) {
    issues.add('OUT_OF_BOUND');
    return { absolute: null, signature };
  }
  const absolute = value < 0 ? -value : value;
  if (absolute > maximum) {
    issues.add('OUT_OF_BOUND');
    return { absolute: null, signature };
  }
  return { absolute, signature };
}

function parseNumeric(
  entry: Record<string, unknown>,
  kind: ScheduleEventKind,
  field: 'deltaMinutes' | 'minutes',
  maximum: number,
  issues: Set<ScheduleStabilityIssue>,
): ParsedEvent {
  const subjectOk = isSubjectId(entry.subjectId);
  if (!subjectOk) {
    issues.add('MALFORMED_SUBJECT_ID');
  }
  const change = readChange(entry[field], maximum, SIGNED_KINDS.has(kind), issues);
  if (!subjectOk || change.signature === null) {
    return { identity: null, accepted: null };
  }
  const key = JSON.stringify([kind, entry.subjectId]);
  const identity = { key, signature: change.signature };
  if (change.absolute === null) {
    return { identity, accepted: null };
  }
  return { identity, accepted: { key, absolute: change.absolute, bound: maximum } };
}

function parseReorder(
  entry: Record<string, unknown>,
  issues: Set<ScheduleStabilityIssue>,
): ParsedEvent {
  const subjectIds = entry.subjectIds;
  if (!Array.isArray(subjectIds)) {
    issues.add('MALFORMED_EVENT');
    return { identity: null, accepted: null };
  }
  if (subjectIds.length < 2) {
    issues.add('REORDER_TOO_SHORT');
  }
  const ids: string[] = [];
  let malformedId = false;
  for (const subjectId of subjectIds) {
    if (!isSubjectId(subjectId)) {
      issues.add('MALFORMED_SUBJECT_ID');
      malformedId = true;
      continue;
    }
    ids.push(subjectId);
  }
  if (malformedId || subjectIds.length < 2) {
    return { identity: null, accepted: null };
  }
  if (new Set(ids).size !== ids.length) {
    issues.add('MALFORMED_EVENT');
    return { identity: null, accepted: null };
  }
  const key = JSON.stringify(['ACTIVITY_ORDER_CHANGED', ids]);
  return {
    identity: { key, signature: JSON.stringify(ids) },
    accepted: { key, absolute: 1, bound: 1 },
  };
}

function parseEvent(entry: unknown, issues: Set<ScheduleStabilityIssue>): ParsedEvent {
  if (!isRecord(entry) || !isScheduleKind(entry.kind)) {
    issues.add('MALFORMED_EVENT');
    return { identity: null, accepted: null };
  }

  switch (entry.kind) {
    case 'ACTIVITY_TIME_CHANGED':
      return parseNumeric(
        entry,
        entry.kind,
        'deltaMinutes',
        SCHEDULE_BOUND_MAXIMA.ACTIVITY_TIME_CHANGED,
        issues,
      );
    case 'PERSONAL_CALL_TIME_CHANGED':
      return parseNumeric(
        entry,
        entry.kind,
        'deltaMinutes',
        SCHEDULE_BOUND_MAXIMA.PERSONAL_CALL_TIME_CHANGED,
        issues,
      );
    case 'DEPARTURE_TIME_CHANGED':
      return parseNumeric(
        entry,
        entry.kind,
        'deltaMinutes',
        SCHEDULE_BOUND_MAXIMA.DEPARTURE_TIME_CHANGED,
        issues,
      );
    case 'ACTIVITY_SHORTENED':
      return parseNumeric(
        entry,
        entry.kind,
        'minutes',
        SCHEDULE_BOUND_MAXIMA.ACTIVITY_SHORTENED,
        issues,
      );
    case 'BUFFER_ADDED':
      return parseNumeric(entry, entry.kind, 'minutes', SCHEDULE_BOUND_MAXIMA.BUFFER_ADDED, issues);
    case 'TRANSFER_BUFFER_INCREASED':
      return parseNumeric(
        entry,
        entry.kind,
        'minutes',
        SCHEDULE_BOUND_MAXIMA.TRANSFER_BUFFER_INCREASED,
        issues,
      );
    case 'ACTIVITY_ORDER_CHANGED':
      return parseReorder(entry, issues);
    default: {
      const unexpected: never = entry.kind;
      void unexpected;
      issues.add('MALFORMED_EVENT');
      return { identity: null, accepted: null };
    }
  }
}

function worstStability(events: readonly AcceptedDisturbance[]): number {
  let worstAbsolute = 0;
  let worstBound = 1;
  for (const event of events) {
    if (event.absolute * worstBound > worstAbsolute * event.bound) {
      worstAbsolute = event.absolute;
      worstBound = event.bound;
    }
  }
  return roundHalfAwayFromZero(100 * (worstBound - worstAbsolute), worstBound);
}

export function evaluateScheduleStability(events: unknown): ScheduleStabilityResult {
  const issues = new Set<ScheduleStabilityIssue>();
  if (!Array.isArray(events)) {
    issues.add('MALFORMED_EVENT');
    return withhold(issues);
  }

  const identities: EventIdentity[] = [];
  const accepted: AcceptedDisturbance[] = [];
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
    return withhold(issues);
  }

  const unique: AcceptedDisturbance[] = [];
  const acceptedKeys = new Set<string>();
  for (const event of accepted) {
    if (acceptedKeys.has(event.key)) {
      continue;
    }
    acceptedKeys.add(event.key);
    unique.push(event);
  }

  if (unique.length === 0) {
    return available(100);
  }
  return available(worstStability(unique));
}
