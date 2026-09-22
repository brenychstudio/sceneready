import type {
  InterventionPolicyDenialCode,
  InterventionPrimitive,
} from '@sceneready/intervention-engine';

import {
  freezeOperational,
  insideLocalDay,
  readActivity,
  replaceActivity,
  type ShadowActivityOverlay,
  type ShadowOperationalState,
} from './clone.js';

export type ShadowApplyDenialCode =
  | Extract<InterventionPolicyDenialCode, 'DAY_BOUNDARY_CROSSING' | 'DURATION_NOT_POSITIVE'>
  | 'MISSING_OPERATIONAL_FACT';

export type ShadowApplyResult =
  | { readonly ok: true; readonly state: ShadowOperationalState }
  | { readonly ok: false; readonly code: ShadowApplyDenialCode };

function applied(state: ShadowOperationalState): ShadowApplyResult {
  return { ok: true, state };
}

function denied(code: ShadowApplyDenialCode): ShadowApplyResult {
  return { ok: false, code };
}

function addId(values: readonly string[], id: string): readonly string[] {
  return [...values, id];
}

function shiftActivity(
  state: ShadowOperationalState,
  activityId: string,
  deltaMinutes: number,
): ShadowApplyResult {
  const activity = readActivity(state, activityId);
  if (activity === null) {
    return denied('MISSING_OPERATIONAL_FACT');
  }
  const startMinute = activity.startMinute + deltaMinutes;
  const endMinute = activity.endMinute + deltaMinutes;
  if (!insideLocalDay(startMinute) || !insideLocalDay(endMinute)) {
    return denied('DAY_BOUNDARY_CROSSING');
  }
  return applied(replaceActivity(state, { ...activity, startMinute, endMinute }));
}

function shortenActivity(
  state: ShadowOperationalState,
  activityId: string,
  minutes: number,
): ShadowApplyResult {
  const activity = readActivity(state, activityId);
  if (activity === null) {
    return denied('MISSING_OPERATIONAL_FACT');
  }
  const endMinute = activity.endMinute - minutes;
  if (endMinute <= activity.startMinute) {
    return denied('DURATION_NOT_POSITIVE');
  }
  return applied(replaceActivity(state, { ...activity, endMinute }));
}

function reorderActivities(
  state: ShadowOperationalState,
  activityIds: readonly string[],
): ShadowApplyResult {
  const known = new Set(state.activities.map((item) => item.activityId));
  for (const activityId of activityIds) {
    if (!known.has(activityId)) {
      return denied('MISSING_OPERATIONAL_FACT');
    }
  }
  const listed = new Map<string, number>();
  for (let index = 0; index < activityIds.length; index += 1) {
    const activityId = activityIds[index];
    if (activityId !== undefined) {
      listed.set(activityId, index);
    }
  }
  const rest = state.activities
    .map((item) => item.activityId)
    .filter((activityId) => !listed.has(activityId))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const orderOf = new Map<string, number>(listed);
  for (let index = 0; index < rest.length; index += 1) {
    const activityId = rest[index];
    if (activityId !== undefined) {
      orderOf.set(activityId, activityIds.length + index);
    }
  }
  const activities: ShadowActivityOverlay[] = state.activities.map((activity) => {
    const order = orderOf.get(activity.activityId);
    return order === undefined ? activity : { ...activity, order };
  });
  return applied(freezeOperational({ ...state, activities }));
}

function adjustCallTime(
  state: ShadowOperationalState,
  personId: string,
  deltaMinutes: number,
): ShadowApplyResult {
  const current = state.callTimes.find((item) => item.personId === personId);
  if (current === undefined) {
    return denied('MISSING_OPERATIONAL_FACT');
  }
  const callMinute = current.callMinute + deltaMinutes;
  if (!insideLocalDay(callMinute)) {
    return denied('DAY_BOUNDARY_CROSSING');
  }
  return applied(
    freezeOperational({
      ...state,
      callTimes: state.callTimes.map((item) =>
        item.personId === personId ? { ...item, callMinute } : item,
      ),
    }),
  );
}

export function applyIntervention(
  state: ShadowOperationalState,
  intervention: InterventionPrimitive,
): ShadowApplyResult {
  switch (intervention.kind) {
    case 'SHIFT_ACTIVITY':
      return shiftActivity(state, intervention.activityId, intervention.deltaMinutes);
    case 'ADJUST_DEPARTURE':
      return shiftActivity(state, intervention.transferActivityId, intervention.deltaMinutes);
    case 'SHORTEN_ACTIVITY':
      return shortenActivity(state, intervention.activityId, intervention.minutes);
    case 'REORDER_ACTIVITIES':
      return reorderActivities(state, intervention.activityIds);
    case 'ADD_BUFFER': {
      const activity = readActivity(state, intervention.beforeActivityId);
      if (activity === null) {
        return denied('MISSING_OPERATIONAL_FACT');
      }
      return applied(
        replaceActivity(state, {
          ...activity,
          bufferBeforeMinutes: activity.bufferBeforeMinutes + intervention.minutes,
        }),
      );
    }
    case 'INCREASE_TRANSFER_BUFFER': {
      const activity = readActivity(state, intervention.transferActivityId);
      if (activity === null) {
        return denied('MISSING_OPERATIONAL_FACT');
      }
      return applied(
        replaceActivity(state, {
          ...activity,
          transferBufferMinutes: activity.transferBufferMinutes + intervention.minutes,
        }),
      );
    }
    case 'SWITCH_TO_APPROVED_FALLBACK': {
      const activity = readActivity(state, intervention.activityId);
      if (activity === null) {
        return denied('MISSING_OPERATIONAL_FACT');
      }
      return applied(
        replaceActivity(state, { ...activity, locationId: intervention.fallbackLocationId }),
      );
    }
    case 'ADJUST_CALL_TIME':
      return adjustCallTime(state, intervention.personId, intervention.deltaMinutes);
    case 'ACTIVATE_BACKUP_KIT':
      // Records the approved path. Equipment operational facts stay unchanged.
      return applied(
        freezeOperational({
          ...state,
          activatedBackupPathIds: addId(state.activatedBackupPathIds, intervention.equipmentPathId),
        }),
      );
    case 'REQUIRE_REVERIFICATION':
      // Records the obligation. This does not mark equipment READY.
      return applied(
        freezeOperational({
          ...state,
          reverificationEquipmentIds: addId(
            state.reverificationEquipmentIds,
            intervention.equipmentId,
          ),
        }),
      );
    case 'REQUEST_MISSING_CONFIRMATION':
      // Records the request. Confirmation evidence is not created.
      return applied(
        freezeOperational({
          ...state,
          confirmationRequestScopes: addId(
            state.confirmationRequestScopes,
            intervention.evidenceScope,
          ),
        }),
      );
  }
}
