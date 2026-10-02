import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SandboxNotificationTracker,
  deriveAffectedAudience,
  deriveOutboxJobs,
  type CommunicationAudienceInput,
  type OutboxJob,
  renderApprovedText,
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

function keyAt(jobs: readonly OutboxJob[], index: number): string {
  const key = jobs[index]?.idempotencyKey;
  if (key === undefined) {
    throw new Error(`missing outbox job ${index}`);
  }
  return key;
}

describe('canonical delivery failure and recovery', () => {
  it('stays partial at three of four and completes only after delivery and critical acknowledgements', async () => {
    const jobs = optionAJobs();
    expect(jobs).toHaveLength(4);
    const critical = jobs.filter((job) => job.acknowledgementRequirement === 'REQUIRED_CRITICAL');
    const informational = jobs.filter((job) => job.acknowledgementRequirement === 'INFORMATIONAL');
    expect(critical).toHaveLength(3);
    expect(informational).toHaveLength(1);
    const calls: string[] = [];
    const tracker = new SandboxNotificationTracker(jobs);
    const adapter = {
      deliver(notification: { readonly idempotencyKey: string }) {
        calls.push(notification.idempotencyKey);
        return Promise.resolve();
      },
    };
    await tracker.deliver(adapter, keyAt(jobs, 0));
    await tracker.deliver(adapter, keyAt(jobs, 1));
    await tracker.deliver(adapter, keyAt(jobs, 2));
    const fault = tracker.receipt();
    expect(fault.deliveredCount).toBe(3);
    expect(fault.status).toBe('PARTIALLY_COMPLETED');
    expect(fault.status).not.toBe('COMPLETE');

    const firstKey = keyAt(jobs, 0);
    const retry = await tracker.deliver(adapter, firstKey);
    expect(retry).toBe('ALREADY_DELIVERED');
    expect(calls.filter((key) => key === firstKey)).toEqual([firstKey]);
    const delivered = tracker.snapshot().find((item) => item.idempotencyKey === firstKey);
    expect(delivered?.deliveryStatus).toBe('DELIVERED');
    expect(delivered?.acknowledgementStatus).toBe('PENDING');

    await tracker.deliver(adapter, keyAt(jobs, 3));
    const recovered = tracker.receipt();
    expect(recovered.deliveredCount).toBe(4);
    expect(recovered.status).not.toBe('COMPLETE');

    for (const job of critical) {
      expect(tracker.acknowledge(job.idempotencyKey, 'CONFIRMED').ok).toBe(true);
    }
    const complete = tracker.receipt();
    expect(complete.criticalConfirmedCount).toBe(3);
    expect(complete.criticalRequiredCount).toBe(3);
    expect(complete.status).toBe('COMPLETE');
    expect(complete.requiresGraphRecompute).toBe(false);
  });

  it('treats critical CANNOT_COMPLY as incomplete recompute without a production write', async () => {
    const jobs = optionAJobs();
    const tracker = new SandboxNotificationTracker(jobs);
    for (const job of jobs) {
      await tracker.deliver(
        {
          deliver() {
            return Promise.resolve();
          },
        },
        job.idempotencyKey,
      );
    }
    const critical = jobs.find((job) => job.acknowledgementRequirement === 'REQUIRED_CRITICAL');
    if (critical === undefined) {
      throw new Error('missing critical job');
    }
    const update = tracker.acknowledge(critical.idempotencyKey, 'CANNOT_COMPLY');
    expect(update.ok).toBe(true);
    if (!update.ok) {
      throw new Error(update.reason);
    }
    expect(update.requiresGraphRecompute).toBe(true);
    const receipt = tracker.receipt();
    expect(receipt.status).not.toBe('COMPLETE');
    expect(receipt.requiresGraphRecompute).toBe(true);
    expect(receipt.status).toBe('PARTIALLY_COMPLETED');
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    expect(source).not.toContain('@sceneready/authority');
    expect(source).not.toContain('applyApprovedProductionRevision');
    expect(source).not.toContain('applyConditionalRevision');
    expect(source).not.toMatch(/twilio|nodemailer|smtp|whatsapp|bedrock|@aws-sdk|\bfetch\s*\(/i);
  });
});
