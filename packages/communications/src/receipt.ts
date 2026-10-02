import type { TrackedNotification } from './acknowledgement.js';

export interface ExecutionReceipt {
  readonly status: 'COMPLETE' | 'PARTIALLY_COMPLETED';
  readonly requiresGraphRecompute: boolean;
  readonly deliveredCount: number;
  readonly requiredJobCount: number;
  readonly criticalConfirmedCount: number;
  readonly criticalRequiredCount: number;
}

function blocksCompletion(notification: TrackedNotification): boolean {
  return (
    notification.acknowledgementRequirement === 'REQUIRED_CRITICAL' ||
    notification.acknowledgementRequirement === 'REQUIRED'
  );
}

/**
 * COMPLETE is true only when every job is delivered, every blocking acknowledgement
 * is CONFIRMED, and nobody has reported CANNOT_COMPLY.
 * DELIVERED is not CONFIRMED.
 */
export function evaluateReceipt(notifications: readonly TrackedNotification[]): ExecutionReceipt {
  const deliveredCount = notifications.filter(
    (notification) => notification.deliveryStatus === 'DELIVERED',
  ).length;
  const blocking = notifications.filter(blocksCompletion);
  const critical = notifications.filter(
    (notification) => notification.acknowledgementRequirement === 'REQUIRED_CRITICAL',
  );
  const criticalConfirmedCount = critical.filter(
    (notification) => notification.acknowledgementStatus === 'CONFIRMED',
  ).length;
  const cannotComply = notifications.some(
    (notification) => notification.acknowledgementStatus === 'CANNOT_COMPLY',
  );
  const allDelivered = deliveredCount === notifications.length;
  const blockingConfirmed = blocking.every(
    (notification) => notification.acknowledgementStatus === 'CONFIRMED',
  );
  const complete = allDelivered && blockingConfirmed && !cannotComply;
  return Object.freeze({
    status: complete ? 'COMPLETE' : 'PARTIALLY_COMPLETED',
    requiresGraphRecompute: cannotComply,
    deliveredCount,
    requiredJobCount: notifications.length,
    criticalConfirmedCount,
    criticalRequiredCount: critical.length,
  });
}
