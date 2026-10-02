export const ACKNOWLEDGEMENT_REQUIREMENTS = [
  'REQUIRED_CRITICAL',
  'REQUIRED',
  'INFORMATIONAL',
] as const;

export type AcknowledgementRequirement = (typeof ACKNOWLEDGEMENT_REQUIREMENTS)[number];

export interface DurableOutboxJob {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly payloadIndex: number;
  readonly recipientPersonId: string;
  readonly acknowledgementRequirement: AcknowledgementRequirement;
  readonly payload: unknown;
  readonly deliveryStatus: 'PENDING';
}

export interface RevisionAppliedEvent {
  readonly ledgerEventId: string;
  readonly kind: 'REVISION_APPLIED';
  readonly executionId: string;
  readonly accountId: string;
  readonly productionId: string;
  readonly authorityNamespace: 'LIVE' | 'REPLAY';
  readonly proposalId: string;
  readonly proposalFingerprint: string;
  readonly tokenId: string;
  readonly previousProductionRevision: number;
  readonly productionRevision: number;
  readonly graphRevision: number;
  readonly appliedAt: string;
}

export type OutboxPlan =
  | { readonly ok: true; readonly jobs: readonly DurableOutboxJob[] }
  | {
      readonly ok: false;
      readonly reason: 'INVALID_EXECUTION_IDENTITY' | 'OUTBOX_PAYLOAD_INVALID';
    };

export function durableOutboxIdentity(
  executionId: string,
  payloadIndex: number,
  recipientPersonId: string,
): string {
  return JSON.stringify([executionId, payloadIndex, recipientPersonId]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirementFor(requiredAction: unknown): AcknowledgementRequirement | null {
  if (requiredAction === 'CONFIRM_UPDATED_CALL') {
    return 'REQUIRED_CRITICAL';
  }
  if (requiredAction === 'INFORMATION_ONLY') {
    return 'INFORMATIONAL';
  }
  return null;
}

function invalid(reason: 'INVALID_EXECUTION_IDENTITY' | 'OUTBOX_PAYLOAD_INVALID'): OutboxPlan {
  return Object.freeze({ ok: false, reason });
}

export function deriveDurableOutboxJobs(
  executionId: string,
  payloads: readonly unknown[],
): OutboxPlan {
  if (typeof executionId !== 'string' || executionId.length === 0) {
    return invalid('INVALID_EXECUTION_IDENTITY');
  }
  if (!Array.isArray(payloads)) {
    return invalid('OUTBOX_PAYLOAD_INVALID');
  }
  const jobs: DurableOutboxJob[] = [];
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    if (!isPlainRecord(payload)) {
      return invalid('OUTBOX_PAYLOAD_INVALID');
    }
    const recipientPersonId = payload.recipientPersonId;
    const requirement = requirementFor(payload.requiredAction);
    if (
      typeof recipientPersonId !== 'string' ||
      recipientPersonId.length === 0 ||
      requirement === null
    ) {
      return invalid('OUTBOX_PAYLOAD_INVALID');
    }
    let cloned: unknown;
    try {
      cloned = structuredClone(payload);
    } catch {
      return invalid('OUTBOX_PAYLOAD_INVALID');
    }
    const jobId = durableOutboxIdentity(executionId, index, recipientPersonId);
    jobs.push(
      Object.freeze({
        jobId,
        idempotencyKey: jobId,
        executionId,
        payloadIndex: index,
        recipientPersonId,
        acknowledgementRequirement: requirement,
        payload: cloned,
        deliveryStatus: 'PENDING',
      }),
    );
  }
  return Object.freeze({ ok: true, jobs: Object.freeze(jobs) });
}
