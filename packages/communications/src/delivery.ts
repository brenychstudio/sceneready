import type { OutboxJob } from './outbox.js';
import {
  applyAcknowledgement,
  type AcknowledgementState,
  type AcknowledgementUpdate,
  type TrackedNotification,
} from './acknowledgement.js';
import { evaluateReceipt, type ExecutionReceipt } from './receipt.js';

export interface SandboxDeliveryAdapter {
  deliver(notification: TrackedNotification): Promise<void>;
}

export type DeliveryOutcome = 'DELIVERED' | 'ALREADY_DELIVERED' | 'UNKNOWN_JOB';

/**
 * Synthetic sandbox only. The adapter is injected.
 * This module does not look up contacts or send email, SMS, or device messages.
 */
export class SandboxNotificationTracker {
  private notifications: readonly TrackedNotification[];
  private readonly tails = new Map<string, Promise<void>>();

  constructor(jobs: readonly OutboxJob[]) {
    this.notifications = Object.freeze(
      jobs.map((job) =>
        Object.freeze({
          idempotencyKey: job.idempotencyKey,
          acknowledgementRequirement: job.acknowledgementRequirement,
          deliveryStatus: job.deliveryStatus,
          acknowledgementStatus: 'PENDING' as const,
        }),
      ),
    );
  }

  snapshot(): readonly TrackedNotification[] {
    return this.notifications;
  }

  receipt(): ExecutionReceipt {
    return evaluateReceipt(this.notifications);
  }

  acknowledge(idempotencyKey: string, status: AcknowledgementState): AcknowledgementUpdate {
    const update = applyAcknowledgement(this.notifications, idempotencyKey, status);
    if (update.ok) {
      this.notifications = update.notifications;
    }
    return update;
  }

  async deliver(adapter: SandboxDeliveryAdapter, idempotencyKey: string): Promise<DeliveryOutcome> {
    return this.exclusive(idempotencyKey, async () => {
      const current = this.notifications.find(
        (notification) => notification.idempotencyKey === idempotencyKey,
      );
      if (current === undefined) {
        return 'UNKNOWN_JOB';
      }
      if (current.deliveryStatus === 'DELIVERED') {
        return 'ALREADY_DELIVERED';
      }
      await adapter.deliver(current);
      this.notifications = Object.freeze(
        this.notifications.map((notification) =>
          notification.idempotencyKey === idempotencyKey
            ? Object.freeze({ ...notification, deliveryStatus: 'DELIVERED' as const })
            : notification,
        ),
      );
      return 'DELIVERED';
    });
  }

  private async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}
