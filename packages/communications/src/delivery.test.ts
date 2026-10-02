import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SandboxNotificationTracker,
  deriveAffectedAudience,
  deriveOutboxJobs,
  evaluateReceipt,
  renderApprovedText,
  type CommunicationAudienceInput,
  type OutboxJob,
  type TrackedNotification,
} from './index.js';

const OPTION_A: CommunicationAudienceInput = {
  interventions: [
    { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: -25 },
    { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 },
    { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-HMU', deltaMinutes: -25 },
    { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-PHOTO-ASSISTANT', deltaMinutes: -25 },
    { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
  ],
  crew: [
    { personId: 'PERSON-PRODUCTION-LEAD', role: 'PRODUCTION_LEAD' },
    { personId: 'PERSON-MODEL', role: 'MODEL' },
    { personId: 'PERSON-HMU', role: 'HMU' },
    { personId: 'PERSON-PHOTO-ASSISTANT', role: 'PHOTO_ASSISTANT' },
  ],
  callTimes: [
    { personId: 'PERSON-MODEL', callLocal: '06:30' },
    { personId: 'PERSON-HMU', callLocal: '06:30' },
    { personId: 'PERSON-PHOTO-ASSISTANT', callLocal: '06:30' },
  ],
  departures: [{ transferActivityId: 'ACT-DEPART-GOTHIC', departureLocal: '06:40' }],
};

function optionAJobs(): readonly OutboxJob[] {
  const audience = deriveAffectedAudience(OPTION_A);
  expect(audience.ok).toBe(true);
  if (!audience.ok) {
    throw new Error(audience.issues.join(','));
  }
  const payloads = audience.audience.obligations.map((obligation) => ({
    recipientPersonId: obligation.recipientPersonId,
    recipientRole: obligation.recipientRole,
    changeType: obligation.changeType,
    oldValue: obligation.oldValue,
    newValue: obligation.newValue,
    reasonCode: obligation.reasonCode,
    requiredAction: obligation.requiredAction,
    approvedText: renderApprovedText(obligation),
  }));
  const planned = deriveOutboxJobs('EXEC-R15', payloads);
  expect(planned.ok).toBe(true);
  if (!planned.ok) {
    throw new Error(planned.reason);
  }
  return planned.jobs;
}

function track(
  jobs: readonly OutboxJob[],
  mutate: (notification: TrackedNotification, index: number) => TrackedNotification = (
    notification,
  ) => notification,
): TrackedNotification[] {
  return jobs.map((job, index) =>
    mutate(
      {
        idempotencyKey: job.idempotencyKey,
        acknowledgementRequirement: job.acknowledgementRequirement,
        deliveryStatus: 'PENDING',
        acknowledgementStatus: 'PENDING',
      },
      index,
    ),
  );
}

describe('sandbox delivery and truthful receipts', () => {
  it('delivers once and treats a retry as already delivered', async () => {
    const jobs = optionAJobs();
    const tracker = new SandboxNotificationTracker(jobs);
    const calls: string[] = [];
    const adapter = {
      deliver(notification: TrackedNotification) {
        calls.push(notification.idempotencyKey);
        return Promise.resolve();
      },
    };
    const key = jobs[0]?.idempotencyKey;
    if (key === undefined) {
      throw new Error('missing job');
    }
    const [first, second] = await Promise.all([
      tracker.deliver(adapter, key),
      tracker.deliver(adapter, key),
    ]);
    expect([first, second].sort()).toEqual(['ALREADY_DELIVERED', 'DELIVERED']);
    expect(calls).toEqual([key]);
    const delivered = tracker
      .snapshot()
      .find((notification) => notification.idempotencyKey === key);
    expect(delivered?.deliveryStatus).toBe('DELIVERED');
    expect(delivered?.acknowledgementStatus).toBe('PENDING');
    expect(delivered?.deliveryStatus).not.toBe(delivered?.acknowledgementStatus);
    expect(tracker.receipt().status).not.toBe('COMPLETE');
  });

  it('keeps the canonical option A acknowledgement split', () => {
    const jobs = optionAJobs();
    expect(jobs).toHaveLength(4);
    expect(
      jobs.filter((job) => job.acknowledgementRequirement === 'REQUIRED_CRITICAL'),
    ).toHaveLength(3);
    expect(jobs.filter((job) => job.acknowledgementRequirement === 'INFORMATIONAL')).toHaveLength(
      1,
    );
  });

  it('refuses COMPLETE until required delivery and critical acknowledgements finish', () => {
    const jobs = optionAJobs();
    expect(evaluateReceipt(track(jobs)).status).not.toBe('COMPLETE');
    expect(evaluateReceipt(track(jobs)).status).toBe('PARTIALLY_COMPLETED');

    const threeDelivered = evaluateReceipt(
      track(jobs, (notification, index) =>
        index < 3 ? { ...notification, deliveryStatus: 'DELIVERED' } : notification,
      ),
    );
    expect(threeDelivered.status).toBe('PARTIALLY_COMPLETED');
    expect(threeDelivered.deliveredCount).toBe(3);

    const pendingAck = evaluateReceipt(
      track(jobs, (notification, index) => ({
        ...notification,
        deliveryStatus: 'DELIVERED',
        acknowledgementStatus: index === 1 ? 'PENDING' : 'CONFIRMED',
      })),
    );
    expect(pendingAck.criticalRequiredCount).toBe(3);
    expect(pendingAck.criticalConfirmedCount).toBe(2);
    expect(pendingAck.status).not.toBe('COMPLETE');

    const complete = evaluateReceipt(
      track(jobs, (notification) => ({
        ...notification,
        deliveryStatus: 'DELIVERED',
        acknowledgementStatus:
          notification.acknowledgementRequirement === 'REQUIRED_CRITICAL' ? 'CONFIRMED' : 'PENDING',
      })),
    );
    expect(complete.criticalConfirmedCount).toBe(3);
    expect(complete.status).toBe('COMPLETE');
    expect(complete.requiresGraphRecompute).toBe(false);
  });

  it('treats CANNOT_COMPLY as incomplete and requiring graph recompute', () => {
    const jobs = optionAJobs();
    const tracker = new SandboxNotificationTracker(jobs);
    for (const job of jobs) {
      tracker.acknowledge(job.idempotencyKey, 'CONFIRMED');
    }
    const blocked = tracker.acknowledge(jobs[1]?.idempotencyKey ?? '', 'CANNOT_COMPLY');
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) {
      throw new Error(blocked.reason);
    }
    expect(blocked.requiresGraphRecompute).toBe(true);
    const receipt = evaluateReceipt(
      jobs.map((job, index) => ({
        idempotencyKey: job.idempotencyKey,
        acknowledgementRequirement: job.acknowledgementRequirement,
        deliveryStatus: 'DELIVERED' as const,
        acknowledgementStatus: index === 1 ? ('CANNOT_COMPLY' as const) : ('CONFIRMED' as const),
      })),
    );
    expect(receipt.status).not.toBe('COMPLETE');
    expect(receipt.requiresGraphRecompute).toBe(true);
    expect(tracker.receipt().requiresGraphRecompute).toBe(true);
    expect(tracker.receipt().status).not.toBe('COMPLETE');
  });

  it('does not send through a real channel or mutate the supplied jobs', async () => {
    const jobs = optionAJobs();
    const before = structuredClone(jobs);
    const tracker = new SandboxNotificationTracker(jobs);
    await tracker.deliver(
      {
        deliver() {
          return Promise.resolve();
        },
      },
      jobs[0]?.idempotencyKey ?? '',
    );
    expect(jobs).toEqual(before);
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/twilio|nodemailer|smtp|whatsapp|bedrock|@aws-sdk|\bfetch\s*\(/i);
    expect(source).not.toContain('@sceneready/authority');
  });
});
