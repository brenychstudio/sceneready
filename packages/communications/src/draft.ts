import type { AffectedAudience } from './audience.js';
import {
  inspectNotificationPayload,
  type BoundedNotificationPayload,
  type MessageIssueCode,
  type NotificationFacts,
} from './message-schema.js';

export const DRAFT_SET_ISSUE_CODES = [
  'DUPLICATE_PAYLOAD',
  'INCOMPLETE_OBLIGATION_SET',
  'OBLIGATION_MISMATCH',
  'UNKNOWN_RECIPIENT',
  'UNRELATED_RECIPIENT',
] as const;

export type DraftSetIssueCode = (typeof DRAFT_SET_ISSUE_CODES)[number];

export type DraftIssueCode = DraftSetIssueCode | MessageIssueCode;

export type DraftResult =
  | {
      readonly ok: true;
      readonly affectedRecipients: readonly string[];
      readonly notificationPayloads: readonly BoundedNotificationPayload[];
    }
  | { readonly ok: false; readonly issues: readonly DraftIssueCode[] };

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function sortedIssues(issues: ReadonlySet<DraftIssueCode>): readonly DraftIssueCode[] {
  return Object.freeze([...issues].sort(compareOrdinal));
}

function fail(issues: ReadonlySet<DraftIssueCode>): DraftResult {
  return Object.freeze({ ok: false, issues: sortedIssues(issues) });
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

function copyPayload(payload: BoundedNotificationPayload): BoundedNotificationPayload {
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

export function draftBoundCommunications(
  audience: AffectedAudience,
  proposedPayloads: readonly unknown[],
  crewPersonIds: readonly string[],
): DraftResult {
  if (!Array.isArray(proposedPayloads) || !Array.isArray(crewPersonIds)) {
    return fail(new Set<DraftIssueCode>(['MALFORMED_PAYLOAD']));
  }
  const expected = audience.obligations.map((obligation) => factKey(obligation));
  const consumed = new Set<number>();
  const matched = new Map<number, BoundedNotificationPayload>();
  const issues = new Set<DraftIssueCode>();
  const crew = new Set(crewPersonIds);
  const recipients = new Set(audience.affectedRecipients);

  for (const value of proposedPayloads) {
    const inspection = inspectNotificationPayload(value);
    for (const issue of inspection.issues) {
      issues.add(issue);
    }
    const payload = inspection.payload;
    if (payload === null) {
      continue;
    }
    if (!crew.has(payload.recipientPersonId)) {
      issues.add('UNKNOWN_RECIPIENT');
    }
    if (!recipients.has(payload.recipientPersonId)) {
      issues.add('UNRELATED_RECIPIENT');
      continue;
    }
    const key = factKey(payload);
    let matchIndex = -1;
    for (let index = 0; index < expected.length; index += 1) {
      const candidate = expected[index];
      if (candidate === key && !consumed.has(index)) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex === -1) {
      issues.add(expected.includes(key) ? 'DUPLICATE_PAYLOAD' : 'OBLIGATION_MISMATCH');
      continue;
    }
    consumed.add(matchIndex);
    matched.set(matchIndex, payload);
  }

  if (consumed.size !== expected.length) {
    issues.add('INCOMPLETE_OBLIGATION_SET');
  }
  if (issues.size > 0) {
    return fail(issues);
  }

  const notificationPayloads: BoundedNotificationPayload[] = [];
  for (let index = 0; index < expected.length; index += 1) {
    const payload = matched.get(index);
    if (payload === undefined) {
      return fail(new Set<DraftIssueCode>(['INCOMPLETE_OBLIGATION_SET']));
    }
    notificationPayloads.push(copyPayload(payload));
  }

  return Object.freeze({
    ok: true,
    affectedRecipients: Object.freeze([...audience.affectedRecipients]),
    notificationPayloads: Object.freeze(notificationPayloads),
  });
}
