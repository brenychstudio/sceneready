export const ACKNOWLEDGEMENT_STATES = [
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'CANNOT_COMPLY',
  'EXPIRED',
] as const;

export type AcknowledgementState = (typeof ACKNOWLEDGEMENT_STATES)[number];

export interface TrackedNotification {
  readonly idempotencyKey: string;
  readonly acknowledgementRequirement: 'REQUIRED_CRITICAL' | 'REQUIRED' | 'INFORMATIONAL';
  readonly deliveryStatus: 'PENDING' | 'DELIVERED';
  readonly acknowledgementStatus: AcknowledgementState;
}

export type AcknowledgementUpdate =
  | {
      readonly ok: true;
      readonly notifications: readonly TrackedNotification[];
      readonly requiresGraphRecompute: boolean;
    }
  | { readonly ok: false; readonly reason: 'UNKNOWN_NOTIFICATION' | 'INVALID_ACKNOWLEDGEMENT' };

function isState(value: string): value is AcknowledgementState {
  return ACKNOWLEDGEMENT_STATES.some((state) => state === value);
}

export function applyAcknowledgement(
  notifications: readonly TrackedNotification[],
  idempotencyKey: string,
  status: AcknowledgementState,
): AcknowledgementUpdate {
  if (!isState(status)) {
    return Object.freeze({ ok: false, reason: 'INVALID_ACKNOWLEDGEMENT' });
  }
  const index = notifications.findIndex(
    (notification) => notification.idempotencyKey === idempotencyKey,
  );
  const current = index >= 0 ? notifications[index] : undefined;
  if (current === undefined) {
    return Object.freeze({ ok: false, reason: 'UNKNOWN_NOTIFICATION' });
  }
  const next = Object.freeze(
    notifications.map((notification, itemIndex) =>
      itemIndex === index
        ? Object.freeze({ ...notification, acknowledgementStatus: status })
        : notification,
    ),
  );
  return Object.freeze({
    ok: true,
    notifications: next,
    requiresGraphRecompute: status === 'CANNOT_COMPLY',
  });
}
