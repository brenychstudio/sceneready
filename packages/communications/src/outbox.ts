export const ACKNOWLEDGEMENT_REQUIREMENTS = [
  'REQUIRED_CRITICAL',
  'REQUIRED',
  'INFORMATIONAL',
] as const;

export type AcknowledgementRequirement = (typeof ACKNOWLEDGEMENT_REQUIREMENTS)[number];

export interface OutboxJob {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly payloadIndex: number;
  readonly recipientPersonId: string;
  readonly acknowledgementRequirement: AcknowledgementRequirement;
  readonly payload: unknown;
  readonly deliveryStatus: 'PENDING' | 'DELIVERED';
}

export type OutboxPlan =
  | { readonly ok: true; readonly jobs: readonly OutboxJob[] }
  | {
      readonly ok: false;
      readonly reason: 'INVALID_EXECUTION_IDENTITY' | 'OUTBOX_PAYLOAD_INVALID';
    };

export function outboxIdentity(
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

export function acknowledgementRequirementFor(
  requiredAction: unknown,
): AcknowledgementRequirement | null {
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

/**
 * Plans durable outbox jobs from exact approved payloads.
 * This does not send, and it does not mutate production state.
 */
export function deriveOutboxJobs(executionId: string, payloads: readonly unknown[]): OutboxPlan {
  if (typeof executionId !== 'string' || executionId.length === 0) {
    return invalid('INVALID_EXECUTION_IDENTITY');
  }
  if (!Array.isArray(payloads)) {
    return invalid('OUTBOX_PAYLOAD_INVALID');
  }
  const jobs: OutboxJob[] = [];
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    if (!isPlainRecord(payload)) {
      return invalid('OUTBOX_PAYLOAD_INVALID');
    }
    const recipientPersonId = payload.recipientPersonId;
    const acknowledgementRequirement = acknowledgementRequirementFor(payload.requiredAction);
    if (
      typeof recipientPersonId !== 'string' ||
      recipientPersonId.length === 0 ||
      acknowledgementRequirement === null
    ) {
      return invalid('OUTBOX_PAYLOAD_INVALID');
    }
    let cloned: unknown;
    try {
      cloned = structuredClone(payload);
    } catch {
      return invalid('OUTBOX_PAYLOAD_INVALID');
    }
    const jobId = outboxIdentity(executionId, index, recipientPersonId);
    jobs.push(
      Object.freeze({
        jobId,
        idempotencyKey: jobId,
        executionId,
        payloadIndex: index,
        recipientPersonId,
        acknowledgementRequirement,
        payload: cloned,
        deliveryStatus: 'PENDING',
      }),
    );
  }
  return Object.freeze({ ok: true, jobs: Object.freeze(jobs) });
}
