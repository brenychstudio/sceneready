export const LOGISTICS_IMPACT_ALGORITHM_VERSION = 'SR-LOGISTICS-IMPACT-v1' as const;

const ENTITY_ID = /^[A-Z0-9][A-Z0-9-]{2,63}$/;

export const LOGISTICS_EVENT_KINDS = [
  'BACKUP_KIT_ACTIVATED',
  'FALLBACK_LOCATION_SWITCHED',
  'LOGISTICS_REVERIFICATION_ADDED',
  'ROUTE_SEQUENCE_CHANGED',
  'TRANSFER_BUFFER_CHANGED',
  'TRANSFER_TIMING_CHANGED',
] as const;

export type LogisticsEventKind = (typeof LOGISTICS_EVENT_KINDS)[number];

export const LOGISTICS_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type LogisticsLevel = (typeof LOGISTICS_LEVELS)[number];

export const LOGISTICS_IMPACT_ISSUES = [
  'CONFLICTING_EVENT',
  'MALFORMED_EVENT',
  'MALFORMED_FALLBACK',
  'MALFORMED_ROUTE',
  'MALFORMED_SUBJECT_ID',
] as const;

export type LogisticsImpactIssue = (typeof LOGISTICS_IMPACT_ISSUES)[number];

export interface TransferTimingChanged {
  readonly kind: 'TRANSFER_TIMING_CHANGED';
  readonly transferActivityId: string;
}

export interface TransferBufferChanged {
  readonly kind: 'TRANSFER_BUFFER_CHANGED';
  readonly transferActivityId: string;
}

export interface LogisticsReverificationAdded {
  readonly kind: 'LOGISTICS_REVERIFICATION_ADDED';
  readonly subjectId: string;
}

export interface BackupKitActivated {
  readonly kind: 'BACKUP_KIT_ACTIVATED';
  readonly equipmentPathId: string;
}

export interface RouteSequenceChanged {
  readonly kind: 'ROUTE_SEQUENCE_CHANGED';
  readonly activityIds: readonly string[];
}

export interface FallbackLocationSwitched {
  readonly kind: 'FALLBACK_LOCATION_SWITCHED';
  readonly activityId: string;
  readonly fallbackLocationId: string;
}

export type LogisticsImpactEvent =
  | TransferTimingChanged
  | TransferBufferChanged
  | LogisticsReverificationAdded
  | BackupKitActivated
  | RouteSequenceChanged
  | FallbackLocationSwitched;

export interface LogisticsImpactAvailable {
  readonly status: 'AVAILABLE';
  readonly algorithmVersion: typeof LOGISTICS_IMPACT_ALGORITHM_VERSION;
  readonly level: LogisticsLevel;
}

export interface LogisticsImpactWithheld {
  readonly status: 'WITHHELD';
  readonly algorithmVersion: typeof LOGISTICS_IMPACT_ALGORITHM_VERSION;
  readonly issues: readonly LogisticsImpactIssue[];
}

export type LogisticsImpactResult = LogisticsImpactAvailable | LogisticsImpactWithheld;

interface EventIdentity {
  readonly key: string;
  readonly signature: string;
}

interface AcceptedEvent {
  readonly key: string;
  readonly kind: LogisticsEventKind;
}

interface ParsedEvent {
  readonly identity: EventIdentity | null;
  readonly accepted: AcceptedEvent | null;
}

const LEVEL_RANK: Readonly<Record<LogisticsLevel, number>> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

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

function isLogisticsKind(value: unknown): value is LogisticsEventKind {
  return typeof value === 'string' && (LOGISTICS_EVENT_KINDS as readonly string[]).includes(value);
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

function sortedIssues(issues: ReadonlySet<LogisticsImpactIssue>): readonly LogisticsImpactIssue[] {
  return [...issues].sort(compareOrdinal);
}

function withhold(issues: ReadonlySet<LogisticsImpactIssue>): LogisticsImpactWithheld {
  return deepFreeze({
    status: 'WITHHELD',
    algorithmVersion: LOGISTICS_IMPACT_ALGORITHM_VERSION,
    issues: sortedIssues(issues),
  });
}

function available(level: LogisticsLevel): LogisticsImpactAvailable {
  return deepFreeze({
    status: 'AVAILABLE',
    algorithmVersion: LOGISTICS_IMPACT_ALGORITHM_VERSION,
    level,
  });
}

function levelFor(kind: LogisticsEventKind): LogisticsLevel {
  switch (kind) {
    case 'TRANSFER_TIMING_CHANGED':
    case 'TRANSFER_BUFFER_CHANGED':
      return 'LOW';
    case 'LOGISTICS_REVERIFICATION_ADDED':
      return 'MEDIUM';
    case 'BACKUP_KIT_ACTIVATED':
    case 'ROUTE_SEQUENCE_CHANGED':
      return 'HIGH';
    case 'FALLBACK_LOCATION_SWITCHED':
      return 'CRITICAL';
    default: {
      const unexpected: never = kind;
      void unexpected;
      return 'NONE';
    }
  }
}

function subjectIdentity(
  kind: LogisticsEventKind,
  subjectId: unknown,
  issues: Set<LogisticsImpactIssue>,
): ParsedEvent {
  if (!isSubjectId(subjectId)) {
    issues.add('MALFORMED_SUBJECT_ID');
    return { identity: null, accepted: null };
  }
  const key = JSON.stringify([kind, subjectId]);
  return {
    identity: { key, signature: key },
    accepted: { key, kind },
  };
}

function parseRoute(value: unknown, issues: Set<LogisticsImpactIssue>): ParsedEvent {
  if (!Array.isArray(value)) {
    issues.add('MALFORMED_ROUTE');
    return { identity: null, accepted: null };
  }
  if (value.length < 2) {
    issues.add('MALFORMED_ROUTE');
  }
  const ids: string[] = [];
  let malformedId = false;
  for (const activityId of value) {
    if (!isSubjectId(activityId)) {
      issues.add('MALFORMED_SUBJECT_ID');
      issues.add('MALFORMED_ROUTE');
      malformedId = true;
      continue;
    }
    ids.push(activityId);
  }
  if (malformedId || value.length < 2) {
    return { identity: null, accepted: null };
  }
  if (new Set(ids).size !== ids.length) {
    issues.add('MALFORMED_ROUTE');
    return { identity: null, accepted: null };
  }
  const key = JSON.stringify(['ROUTE_SEQUENCE_CHANGED', ids]);
  return {
    identity: { key, signature: key },
    accepted: { key, kind: 'ROUTE_SEQUENCE_CHANGED' },
  };
}

function parseFallback(
  entry: Record<string, unknown>,
  issues: Set<LogisticsImpactIssue>,
): ParsedEvent {
  const activityOk = isSubjectId(entry.activityId);
  const locationOk = isSubjectId(entry.fallbackLocationId);
  if (!activityOk || !locationOk) {
    issues.add('MALFORMED_FALLBACK');
    issues.add('MALFORMED_SUBJECT_ID');
    return { identity: null, accepted: null };
  }
  const key = JSON.stringify(['FALLBACK_LOCATION_SWITCHED', entry.activityId]);
  return {
    identity: { key, signature: JSON.stringify([entry.fallbackLocationId]) },
    accepted: { key, kind: 'FALLBACK_LOCATION_SWITCHED' },
  };
}

function parseEvent(entry: unknown, issues: Set<LogisticsImpactIssue>): ParsedEvent {
  if (!isRecord(entry) || !isLogisticsKind(entry.kind)) {
    issues.add('MALFORMED_EVENT');
    return { identity: null, accepted: null };
  }

  switch (entry.kind) {
    case 'TRANSFER_TIMING_CHANGED':
    case 'TRANSFER_BUFFER_CHANGED':
      return subjectIdentity(entry.kind, entry.transferActivityId, issues);
    case 'LOGISTICS_REVERIFICATION_ADDED':
      return subjectIdentity(entry.kind, entry.subjectId, issues);
    case 'BACKUP_KIT_ACTIVATED':
      return subjectIdentity(entry.kind, entry.equipmentPathId, issues);
    case 'ROUTE_SEQUENCE_CHANGED':
      return parseRoute(entry.activityIds, issues);
    case 'FALLBACK_LOCATION_SWITCHED':
      return parseFallback(entry, issues);
    default: {
      const unexpected: never = entry.kind;
      void unexpected;
      issues.add('MALFORMED_EVENT');
      return { identity: null, accepted: null };
    }
  }
}

function highestLevel(events: readonly AcceptedEvent[]): LogisticsLevel {
  let best: LogisticsLevel = 'NONE';
  for (const event of events) {
    const level = levelFor(event.kind);
    if (LEVEL_RANK[level] > LEVEL_RANK[best]) {
      best = level;
    }
  }
  return best;
}

export function evaluateLogisticsImpact(events: unknown): LogisticsImpactResult {
  const issues = new Set<LogisticsImpactIssue>();
  if (!Array.isArray(events)) {
    issues.add('MALFORMED_EVENT');
    return withhold(issues);
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
    return withhold(issues);
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

  return available(highestLevel(unique));
}
