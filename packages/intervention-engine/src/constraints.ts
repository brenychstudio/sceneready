export const ACTIVITY_WINDOW_CONSTRAINT_KIND = 'ACTIVITY_WITHIN_WINDOW' as const;

export const MINUTES_PER_DAY = 24 * 60;

export const CONSTRAINT_CONFIGURATION_REASON = 'INVALID_FEASIBILITY_CONSTRAINT' as const;

export const CONSTRAINT_TARGET_MISSING_REASON = 'FEASIBILITY_CONSTRAINT_TARGET_MISSING' as const;

export interface FeasibilityActivityView {
  readonly activityId: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly locationId: string;
  readonly bufferBeforeMinutes: number;
  readonly transferBufferMinutes: number;
}

export interface ActivityWindowConstraint {
  readonly kind: typeof ACTIVITY_WINDOW_CONSTRAINT_KIND;
  readonly constraintId: string;
  readonly activityId: string;
  readonly locationId: string;
  readonly windowStartMinute: number;
  readonly windowEndMinute: number;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validMinuteSpan(start: number, end: number): boolean {
  return start >= 0 && end <= MINUTES_PER_DAY && start < end;
}

export function isActivityWindowConstraint(value: object): value is ActivityWindowConstraint {
  if (!('kind' in value) || value.kind !== ACTIVITY_WINDOW_CONSTRAINT_KIND) {
    return false;
  }
  const constraint = value as ActivityWindowConstraint;
  return (
    isLabel(constraint.constraintId) &&
    isLabel(constraint.activityId) &&
    isLabel(constraint.locationId) &&
    isInteger(constraint.windowStartMinute) &&
    isInteger(constraint.windowEndMinute) &&
    validMinuteSpan(constraint.windowStartMinute, constraint.windowEndMinute)
  );
}

export function windowViolationReason(constraintId: string): string {
  return `${constraintId}_VIOLATION`;
}

function activityFieldsValid(activity: FeasibilityActivityView): boolean {
  return (
    isLabel(activity.activityId) &&
    isLabel(activity.locationId) &&
    isInteger(activity.startMinute) &&
    isInteger(activity.endMinute) &&
    isInteger(activity.bufferBeforeMinutes) &&
    isInteger(activity.transferBufferMinutes) &&
    activity.bufferBeforeMinutes >= 0 &&
    activity.transferBufferMinutes >= 0 &&
    validMinuteSpan(activity.startMinute, activity.endMinute)
  );
}

function indexActivities(
  activities: readonly FeasibilityActivityView[],
): Map<string, FeasibilityActivityView> | null {
  const indexed = new Map<string, FeasibilityActivityView>();
  for (const activity of activities) {
    if (!isLabel(activity.activityId) || indexed.has(activity.activityId)) {
      return null;
    }
    indexed.set(activity.activityId, activity);
  }
  return indexed;
}

export function collectConstraintReasons(
  activities: readonly FeasibilityActivityView[],
  constraints: readonly ActivityWindowConstraint[],
): readonly string[] {
  const reasons = new Set<string>();
  if (!Array.isArray(constraints) || !Array.isArray(activities)) {
    return [CONSTRAINT_CONFIGURATION_REASON];
  }
  const activitiesById = indexActivities(activities);
  if (activitiesById === null) {
    reasons.add(CONSTRAINT_CONFIGURATION_REASON);
  }

  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  const accepted: ActivityWindowConstraint[] = [];
  for (const constraint of constraints) {
    if (
      constraint === null ||
      typeof constraint !== 'object' ||
      !isActivityWindowConstraint(constraint)
    ) {
      reasons.add(CONSTRAINT_CONFIGURATION_REASON);
      continue;
    }
    if (seenIds.has(constraint.constraintId)) {
      duplicateIds.add(constraint.constraintId);
      continue;
    }
    seenIds.add(constraint.constraintId);
    accepted.push(constraint);
  }
  if (duplicateIds.size > 0) {
    reasons.add(CONSTRAINT_CONFIGURATION_REASON);
  }
  if (activitiesById === null) {
    return [...reasons];
  }

  for (const constraint of accepted) {
    if (duplicateIds.has(constraint.constraintId)) {
      continue;
    }
    const activity = activitiesById.get(constraint.activityId);
    if (activity === undefined) {
      reasons.add(CONSTRAINT_TARGET_MISSING_REASON);
      continue;
    }
    if (!activityFieldsValid(activity)) {
      reasons.add(CONSTRAINT_CONFIGURATION_REASON);
      continue;
    }
    if (activity.locationId !== constraint.locationId) {
      continue;
    }
    const occupiedStart = activity.startMinute - activity.bufferBeforeMinutes;
    const occupiedEnd = activity.endMinute + activity.transferBufferMinutes;
    if (occupiedStart < constraint.windowStartMinute || occupiedEnd > constraint.windowEndMinute) {
      reasons.add(windowViolationReason(constraint.constraintId));
    }
  }
  return [...reasons];
}
