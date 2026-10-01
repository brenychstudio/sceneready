export const CALL_TIME_CHANGE = 'CALL_TIME_UPDATED' as const;
export const LOAD_OUT_CHANGE = 'LOAD_OUT_UPDATED' as const;
export const CONFIRM_UPDATED_CALL = 'CONFIRM_UPDATED_CALL' as const;
export const INFORMATION_ONLY = 'INFORMATION_ONLY' as const;
export const CALL_TIME_REASON = 'ADJUST_CALL_TIME' as const;
export const LOAD_OUT_REASON = 'ADJUST_DEPARTURE' as const;

export const MESSAGE_ISSUE_CODES = [
  'MALFORMED_PAYLOAD',
  'MESSAGE_PAYLOAD_CONTRADICTION',
  'MISSING_TEXT',
] as const;

export type MessageIssueCode = (typeof MESSAGE_ISSUE_CODES)[number];

export interface NotificationFacts {
  readonly recipientPersonId: string;
  readonly recipientRole: string;
  readonly changeType: typeof CALL_TIME_CHANGE | typeof LOAD_OUT_CHANGE;
  readonly oldValue: string;
  readonly newValue: string;
  readonly reasonCode: string;
  readonly requiredAction: typeof CONFIRM_UPDATED_CALL | typeof INFORMATION_ONLY;
}

export interface BoundedNotificationPayload extends NotificationFacts {
  readonly approvedText: string;
}

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

type PayloadKey = (typeof PAYLOAD_KEYS)[number];

const PAYLOAD_KEY_SET = new Set<string>(PAYLOAD_KEYS);

export interface PayloadInspection {
  readonly payload: BoundedNotificationPayload | null;
  readonly issues: readonly MessageIssueCode[];
}

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

function freezeIssues(issues: ReadonlySet<MessageIssueCode>): readonly MessageIssueCode[] {
  return Object.freeze([...issues].sort(compareOrdinal));
}

/**
 * Approved wording is this template only. Arbitrary prose is not certified.
 */
export function renderApprovedText(facts: NotificationFacts): string {
  const change = facts.changeType === CALL_TIME_CHANGE ? 'call time updated' : 'load-out updated';
  return [
    `${facts.recipientPersonId} role ${facts.recipientRole}:`,
    `${change} from ${facts.oldValue} to ${facts.newValue}.`,
    `Reason ${facts.reasonCode}.`,
    `Required action ${facts.requiredAction}.`,
  ].join(' ');
}

export function notificationFactsConsistent(facts: NotificationFacts): boolean {
  if (facts.changeType === CALL_TIME_CHANGE) {
    return facts.requiredAction === CONFIRM_UPDATED_CALL && facts.reasonCode === CALL_TIME_REASON;
  }
  return facts.requiredAction === INFORMATION_ONLY && facts.reasonCode === LOAD_OUT_REASON;
}

function readString(record: Record<string, unknown>, key: PayloadKey): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function freezePayload(payload: BoundedNotificationPayload): BoundedNotificationPayload {
  return Object.freeze({
    recipientPersonId: payload.recipientPersonId,
    recipientRole: payload.recipientRole,
    changeType: payload.changeType,
    oldValue: payload.oldValue,
    newValue: payload.newValue,
    reasonCode: payload.reasonCode,
    requiredAction: payload.requiredAction,
    approvedText: payload.approvedText,
  });
}

export function inspectNotificationPayload(value: unknown): PayloadInspection {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObject(value)
  ) {
    return { payload: null, issues: Object.freeze(['MALFORMED_PAYLOAD']) };
  }
  const keys = Object.keys(value);
  if (keys.length !== PAYLOAD_KEYS.length || keys.some((key) => !PAYLOAD_KEY_SET.has(key))) {
    return { payload: null, issues: Object.freeze(['MALFORMED_PAYLOAD']) };
  }
  const recipientPersonId = readString(value, 'recipientPersonId');
  const recipientRole = readString(value, 'recipientRole');
  const changeType = readString(value, 'changeType');
  const oldValue = readString(value, 'oldValue');
  const newValue = readString(value, 'newValue');
  const reasonCode = readString(value, 'reasonCode');
  const requiredAction = readString(value, 'requiredAction');
  const approvedText = readString(value, 'approvedText');
  if (
    recipientPersonId === null ||
    recipientRole === null ||
    changeType === null ||
    oldValue === null ||
    newValue === null ||
    reasonCode === null ||
    requiredAction === null ||
    approvedText === null
  ) {
    return { payload: null, issues: Object.freeze(['MALFORMED_PAYLOAD']) };
  }
  if (changeType !== CALL_TIME_CHANGE && changeType !== LOAD_OUT_CHANGE) {
    return { payload: null, issues: Object.freeze(['MALFORMED_PAYLOAD']) };
  }
  if (requiredAction !== CONFIRM_UPDATED_CALL && requiredAction !== INFORMATION_ONLY) {
    return { payload: null, issues: Object.freeze(['MALFORMED_PAYLOAD']) };
  }
  const payload = freezePayload({
    recipientPersonId,
    recipientRole,
    changeType,
    oldValue,
    newValue,
    reasonCode,
    requiredAction,
    approvedText,
  });
  const issues = new Set<MessageIssueCode>();
  if (approvedText.trim() === '') {
    issues.add('MISSING_TEXT');
  } else if (
    !notificationFactsConsistent(payload) ||
    approvedText !== renderApprovedText(payload)
  ) {
    issues.add('MESSAGE_PAYLOAD_CONTRADICTION');
  }
  return { payload, issues: freezeIssues(issues) };
}
