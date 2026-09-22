import { canInterveneOnActivity, type ProductionPhase } from '@sceneready/domain';
import type { ProductionGraph, ProductionGraphNode } from '@sceneready/production-graph';

import type { InterventionPrimitive } from './schema.js';

export const INTERVENTION_POLICY_VERSION = 'SR-POLICY-v1';

export const ACTIVITY_CONSTRAINTS = [
  'FIXED',
  'CRITICAL_WINDOW',
  'TARGET',
  'FLEXIBLE',
  'DEPENDENT',
] as const;

export type ActivityConstraint = (typeof ACTIVITY_CONSTRAINTS)[number];

export const LOCATION_CONFIRMATIONS = ['PASSED', 'FAILED', 'UNRESOLVED'] as const;

export type LocationConfirmation = (typeof LOCATION_CONFIRMATIONS)[number];

export interface ActivityPolicyFact {
  readonly activityId: string;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly locationId: string;
  readonly constraint: ActivityConstraint;
}

export interface ActivityStateFact {
  readonly activityId: string;
  readonly state: 'PENDING' | 'ACTIVE' | 'COMPLETED';
}

export interface LocationConstraintFact {
  readonly locationId: string;
  readonly access: LocationConfirmation;
  readonly rights: LocationConfirmation;
  readonly windowStartLocal: string;
  readonly windowEndLocal: string;
}

export interface ApprovedFallbackFact {
  readonly activityId: string;
  readonly fallbackLocationId: string;
}

export interface InterventionPolicyContext {
  readonly graph: ProductionGraph;
  readonly policyVersion: string;
  readonly productionPhase: ProductionPhase;
  readonly activities: readonly ActivityPolicyFact[];
  readonly activityStates: readonly ActivityStateFact[];
  readonly locationConstraints: readonly LocationConstraintFact[];
  readonly approvedFallbacks: readonly ApprovedFallbackFact[];
  readonly approvedBackupPathIds: readonly string[];
  readonly equipmentIds: readonly string[];
}

export const INTERVENTION_POLICY_DENIAL_CODES = [
  'POLICY_VERSION_MISMATCH',
  'ACTIVITY_IMMUTABLE_AFTER_COMPLETION',
  'PRODUCTION_COMPLETE_IMMUTABLE',
  'TARGET_NOT_FOUND',
  'TARGET_TYPE_MISMATCH',
  'FIXED_ACTIVITY_CONSTRAINT',
  'POLICY_CONTEXT_MISSING',
  'LOCATION_WINDOW_VIOLATION',
  'LOCATION_ACCESS_NOT_CONFIRMED',
  'RIGHTS_NOT_CONFIRMED',
  'DAY_BOUNDARY_CROSSING',
  'FALLBACK_NOT_APPROVED',
  'BACKUP_PATH_NOT_APPROVED',
  'EQUIPMENT_NOT_KNOWN',
  'DURATION_NOT_POSITIVE',
] as const;

export type InterventionPolicyDenialCode = (typeof INTERVENTION_POLICY_DENIAL_CODES)[number];

export type InterventionPolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: InterventionPolicyDenialCode };

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;

function allow(): InterventionPolicyDecision {
  return { allowed: true };
}

function deny(code: InterventionPolicyDenialCode): InterventionPolicyDecision {
  return { allowed: false, code };
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function parseMinute(value: string): number | null {
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function indexById<T>(items: readonly T[], idOf: (item: T) => string): Map<string, T> | null {
  const indexed = new Map<string, T>();
  for (const item of items) {
    const id = idOf(item);
    const existing = indexed.get(id);
    if (existing === undefined) {
      indexed.set(id, item);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(item)) {
      return null;
    }
  }
  return indexed;
}

interface PolicyIndexes {
  readonly nodes: ReadonlyMap<string, ProductionGraphNode>;
  readonly activities: ReadonlyMap<string, ActivityPolicyFact>;
  readonly states: ReadonlyMap<string, ActivityStateFact>;
  readonly locations: ReadonlyMap<string, LocationConstraintFact>;
  readonly approvedFallbacks: ReadonlySet<string>;
  readonly approvedBackupPathIds: ReadonlySet<string>;
  readonly equipmentIds: ReadonlySet<string>;
}

function fallbackKey(activityId: string, fallbackLocationId: string): string {
  return `${activityId}\u0000${fallbackLocationId}`;
}

function buildIndexes(context: InterventionPolicyContext): PolicyIndexes | null {
  const activities = indexById(context.activities, (item) => item.activityId);
  const states = indexById(context.activityStates, (item) => item.activityId);
  const locations = indexById(context.locationConstraints, (item) => item.locationId);
  if (activities === null || states === null || locations === null) {
    return null;
  }
  const nodes = new Map<string, ProductionGraphNode>();
  for (const node of context.graph.nodes) {
    nodes.set(node.id, node);
  }
  return {
    nodes,
    activities,
    states,
    locations,
    approvedFallbacks: new Set(
      context.approvedFallbacks.map((item) =>
        fallbackKey(item.activityId, item.fallbackLocationId),
      ),
    ),
    approvedBackupPathIds: new Set(context.approvedBackupPathIds),
    equipmentIds: new Set(context.equipmentIds),
  };
}

function requireMutableActivity(
  activityId: string,
  context: InterventionPolicyContext,
  indexes: PolicyIndexes,
):
  | { readonly ok: true; readonly fact: ActivityPolicyFact }
  | { readonly ok: false; readonly decision: InterventionPolicyDecision } {
  const node = indexes.nodes.get(activityId);
  if (node === undefined) {
    return { ok: false, decision: deny('TARGET_NOT_FOUND') };
  }
  if (node.type !== 'ACTIVITY') {
    return { ok: false, decision: deny('TARGET_TYPE_MISMATCH') };
  }
  const state = indexes.states.get(activityId);
  const fact = indexes.activities.get(activityId);
  if (state === undefined || fact === undefined) {
    return { ok: false, decision: deny('POLICY_CONTEXT_MISSING') };
  }
  const lifecycle = canInterveneOnActivity({
    productionPhase: context.productionPhase,
    activityState: state.state,
    interventionKind: 'SHIFT_ACTIVITY',
  });
  if (!lifecycle.allowed) {
    if (
      lifecycle.reason === 'ACTIVITY_IMMUTABLE_AFTER_COMPLETION' ||
      lifecycle.reason === 'PRODUCTION_COMPLETE_IMMUTABLE'
    ) {
      return { ok: false, decision: deny(lifecycle.reason) };
    }
    return { ok: false, decision: deny('POLICY_CONTEXT_MISSING') };
  }
  if (fact.constraint === 'FIXED') {
    return { ok: false, decision: deny('FIXED_ACTIVITY_CONSTRAINT') };
  }
  return { ok: true, fact };
}

function activityInterval(
  fact: ActivityPolicyFact,
): { readonly start: number; readonly end: number } | null {
  const start = parseMinute(fact.startLocal);
  const end = parseMinute(fact.endLocal);
  if (start === null || end === null || end <= start) {
    return null;
  }
  return { start, end };
}

function moveInterval(
  start: number,
  end: number,
  deltaMinutes: number,
): { readonly start: number; readonly end: number } | 'DAY' {
  const nextStart = start + deltaMinutes;
  const nextEnd = end + deltaMinutes;
  if (nextStart < 0 || nextEnd < 0 || nextStart >= MINUTES_PER_DAY || nextEnd >= MINUTES_PER_DAY) {
    return 'DAY';
  }
  return { start: nextStart, end: nextEnd };
}

function requireConfirmedWindow(
  locationId: string,
  start: number,
  end: number,
  indexes: PolicyIndexes,
): InterventionPolicyDecision {
  const node = indexes.nodes.get(locationId);
  if (node === undefined) {
    return deny('TARGET_NOT_FOUND');
  }
  if (node.type !== 'LOCATION') {
    return deny('TARGET_TYPE_MISMATCH');
  }
  const constraint = indexes.locations.get(locationId);
  if (constraint === undefined) {
    return deny('POLICY_CONTEXT_MISSING');
  }
  if (constraint.access !== 'PASSED') {
    return deny('LOCATION_ACCESS_NOT_CONFIRMED');
  }
  if (constraint.rights !== 'PASSED') {
    return deny('RIGHTS_NOT_CONFIRMED');
  }
  const windowStart = parseMinute(constraint.windowStartLocal);
  const windowEnd = parseMinute(constraint.windowEndLocal);
  if (windowStart === null || windowEnd === null || windowEnd < windowStart) {
    return deny('POLICY_CONTEXT_MISSING');
  }
  if (start < windowStart || end > windowEnd) {
    return deny('LOCATION_WINDOW_VIOLATION');
  }
  return allow();
}

function validateMovedActivity(
  activityId: string,
  deltaMinutes: number,
  context: InterventionPolicyContext,
  indexes: PolicyIndexes,
): InterventionPolicyDecision {
  const activity = requireMutableActivity(activityId, context, indexes);
  if (!activity.ok) {
    return activity.decision;
  }
  const interval = activityInterval(activity.fact);
  if (interval === null) {
    return deny('POLICY_CONTEXT_MISSING');
  }
  const moved = moveInterval(interval.start, interval.end, deltaMinutes);
  if (moved === 'DAY') {
    return deny('DAY_BOUNDARY_CROSSING');
  }
  return requireConfirmedWindow(activity.fact.locationId, moved.start, moved.end, indexes);
}

function requireResource(
  resourceId: string,
  indexes: PolicyIndexes,
): InterventionPolicyDecision | null {
  const node = indexes.nodes.get(resourceId);
  if (node === undefined) {
    return deny('TARGET_NOT_FOUND');
  }
  if (node.type !== 'RESOURCE') {
    return deny('TARGET_TYPE_MISMATCH');
  }
  return null;
}

function requireOpenProduction(
  context: InterventionPolicyContext,
): InterventionPolicyDecision | null {
  if (context.productionPhase === 'COMPLETE') {
    return deny('PRODUCTION_COMPLETE_IMMUTABLE');
  }
  return null;
}

function validateFallbackLocation(
  locationId: string,
  indexes: PolicyIndexes,
): InterventionPolicyDecision {
  const node = indexes.nodes.get(locationId);
  if (node === undefined) {
    return deny('TARGET_NOT_FOUND');
  }
  if (node.type !== 'LOCATION') {
    return deny('TARGET_TYPE_MISMATCH');
  }
  const constraint = indexes.locations.get(locationId);
  if (constraint === undefined) {
    return deny('POLICY_CONTEXT_MISSING');
  }
  if (constraint.access !== 'PASSED') {
    return deny('LOCATION_ACCESS_NOT_CONFIRMED');
  }
  if (constraint.rights !== 'PASSED') {
    return deny('RIGHTS_NOT_CONFIRMED');
  }
  return allow();
}

export function validateInterventionPolicy(
  intervention: InterventionPrimitive,
  context: InterventionPolicyContext,
): InterventionPolicyDecision {
  if (context.policyVersion !== INTERVENTION_POLICY_VERSION) {
    return deny('POLICY_VERSION_MISMATCH');
  }
  const indexes = buildIndexes(context);
  if (indexes === null) {
    return deny('POLICY_CONTEXT_MISSING');
  }

  switch (intervention.kind) {
    case 'SHIFT_ACTIVITY':
      return validateMovedActivity(
        intervention.activityId,
        intervention.deltaMinutes,
        context,
        indexes,
      );
    case 'ADJUST_DEPARTURE':
      return validateMovedActivity(
        intervention.transferActivityId,
        intervention.deltaMinutes,
        context,
        indexes,
      );
    case 'SHORTEN_ACTIVITY': {
      const activity = requireMutableActivity(intervention.activityId, context, indexes);
      if (!activity.ok) {
        return activity.decision;
      }
      const interval = activityInterval(activity.fact);
      if (interval === null) {
        return deny('POLICY_CONTEXT_MISSING');
      }
      if (interval.end - interval.start - intervention.minutes <= 0) {
        return deny('DURATION_NOT_POSITIVE');
      }
      return allow();
    }
    case 'REORDER_ACTIVITIES': {
      const activityIds = [...intervention.activityIds].sort(compareOrdinal);
      for (const activityId of activityIds) {
        const activity = requireMutableActivity(activityId, context, indexes);
        if (!activity.ok) {
          return activity.decision;
        }
      }
      return allow();
    }
    case 'ADD_BUFFER': {
      const activity = requireMutableActivity(intervention.beforeActivityId, context, indexes);
      return activity.ok ? allow() : activity.decision;
    }
    case 'INCREASE_TRANSFER_BUFFER': {
      const activity = requireMutableActivity(intervention.transferActivityId, context, indexes);
      return activity.ok ? allow() : activity.decision;
    }
    case 'SWITCH_TO_APPROVED_FALLBACK': {
      const activity = requireMutableActivity(intervention.activityId, context, indexes);
      if (!activity.ok) {
        return activity.decision;
      }
      if (
        !indexes.approvedFallbacks.has(
          fallbackKey(intervention.activityId, intervention.fallbackLocationId),
        )
      ) {
        return deny('FALLBACK_NOT_APPROVED');
      }
      return validateFallbackLocation(intervention.fallbackLocationId, indexes);
    }
    case 'ACTIVATE_BACKUP_KIT': {
      const closed = requireOpenProduction(context);
      if (closed !== null) {
        return closed;
      }
      const resource = requireResource(intervention.equipmentPathId, indexes);
      if (resource !== null) {
        return resource;
      }
      if (!indexes.approvedBackupPathIds.has(intervention.equipmentPathId)) {
        return deny('BACKUP_PATH_NOT_APPROVED');
      }
      return allow();
    }
    case 'REQUIRE_REVERIFICATION': {
      const closed = requireOpenProduction(context);
      if (closed !== null) {
        return closed;
      }
      const resource = requireResource(intervention.equipmentId, indexes);
      if (resource !== null) {
        return resource;
      }
      if (!indexes.equipmentIds.has(intervention.equipmentId)) {
        return deny('EQUIPMENT_NOT_KNOWN');
      }
      return allow();
    }
    case 'ADJUST_CALL_TIME': {
      const closed = requireOpenProduction(context);
      if (closed !== null) {
        return closed;
      }
      const node = indexes.nodes.get(intervention.personId);
      if (node === undefined) {
        return deny('TARGET_NOT_FOUND');
      }
      if (node.type !== 'PERSON') {
        return deny('TARGET_TYPE_MISMATCH');
      }
      return allow();
    }
    case 'REQUEST_MISSING_CONFIRMATION': {
      const closed = requireOpenProduction(context);
      return closed ?? allow();
    }
  }
}
