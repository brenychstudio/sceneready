import {
  INTERVENTION_DESCRIPTORS,
  parseIntervention,
  type InterventionPrimitive,
  type ReversibilityClass,
} from '@sceneready/intervention-engine';

export const REVERSIBILITY_DISCLOSURE_KIND = 'REVERSIBILITY_DISCLOSURE' as const;

export const SEND_CORRECTIVE_NOTIFICATION = 'SEND_CORRECTIVE_NOTIFICATION' as const;

const MECHANICAL_INVERSE_KINDS = new Set<InterventionPrimitive['kind']>([
  'SHIFT_ACTIVITY',
  'ADJUST_CALL_TIME',
  'ADJUST_DEPARTURE',
]);

export interface ReversibilityDisclosure {
  readonly kind: typeof REVERSIBILITY_DISCLOSURE_KIND;
  readonly interventionIndex: number;
  readonly interventionKind: InterventionPrimitive['kind'];
  readonly subjectId: string;
  readonly reversibility: ReversibilityClass;
  readonly mechanicalInverse: boolean;
}

export interface CorrectiveNotificationEffect {
  readonly kind: typeof SEND_CORRECTIVE_NOTIFICATION;
  readonly recipientPersonId: string;
  readonly changeType: 'CALL_TIME_UPDATED' | 'LOAD_OUT_UPDATED';
  readonly previouslyCommunicatedValue: string;
  readonly correctiveValue: string;
}

export interface ClassifiedIntervention {
  readonly original: InterventionPrimitive;
  readonly disclosure: ReversibilityDisclosure;
  readonly inverse: InterventionPrimitive | null;
}

function subjectOf(intervention: InterventionPrimitive): string {
  switch (intervention.kind) {
    case 'SHIFT_ACTIVITY':
    case 'SHORTEN_ACTIVITY':
    case 'SWITCH_TO_APPROVED_FALLBACK':
      return intervention.activityId;
    case 'ADJUST_CALL_TIME':
      return intervention.personId;
    case 'ADJUST_DEPARTURE':
    case 'INCREASE_TRANSFER_BUFFER':
      return intervention.transferActivityId;
    case 'ADD_BUFFER':
      return intervention.beforeActivityId;
    case 'ACTIVATE_BACKUP_KIT':
      return intervention.equipmentPathId;
    case 'REQUIRE_REVERIFICATION':
      return intervention.equipmentId;
    case 'REORDER_ACTIVITIES':
      return intervention.activityIds.join(',');
    case 'REQUEST_MISSING_CONFIRMATION':
      return intervention.evidenceScope;
    default: {
      const unexpected: never = intervention;
      return unexpected;
    }
  }
}

function negatedCandidate(intervention: InterventionPrimitive): unknown {
  if (intervention.kind === 'SHIFT_ACTIVITY') {
    return {
      kind: 'SHIFT_ACTIVITY',
      activityId: intervention.activityId,
      deltaMinutes: -intervention.deltaMinutes,
    };
  }
  if (intervention.kind === 'ADJUST_CALL_TIME') {
    return {
      kind: 'ADJUST_CALL_TIME',
      personId: intervention.personId,
      deltaMinutes: -intervention.deltaMinutes,
    };
  }
  if (intervention.kind === 'ADJUST_DEPARTURE') {
    return {
      kind: 'ADJUST_DEPARTURE',
      transferActivityId: intervention.transferActivityId,
      deltaMinutes: -intervention.deltaMinutes,
    };
  }
  return null;
}

/**
 * Negate only the delta kinds the intervention schema accepts in both directions.
 * A failed re-parse does not relabel the descriptor class and does not invent another kind.
 */
function mechanicalInverse(intervention: InterventionPrimitive): InterventionPrimitive | null {
  if (!MECHANICAL_INVERSE_KINDS.has(intervention.kind)) {
    return null;
  }
  const candidate = negatedCandidate(intervention);
  if (candidate === null) {
    return null;
  }
  const parsed = parseIntervention(candidate);
  return parsed.ok ? parsed.intervention : null;
}

export function classifyIntervention(
  value: unknown,
  interventionIndex: number,
): ClassifiedIntervention | null {
  const parsed = parseIntervention(value);
  if (!parsed.ok) {
    return null;
  }
  const descriptor = INTERVENTION_DESCRIPTORS.find(
    (item) => item.kind === parsed.intervention.kind,
  );
  if (descriptor === undefined) {
    return null;
  }
  const inverse = mechanicalInverse(parsed.intervention);
  return Object.freeze({
    original: parsed.intervention,
    inverse,
    disclosure: Object.freeze({
      kind: REVERSIBILITY_DISCLOSURE_KIND,
      interventionIndex,
      interventionKind: parsed.intervention.kind,
      subjectId: subjectOf(parsed.intervention),
      reversibility: descriptor.reversibility,
      mechanicalInverse: inverse !== null,
    }),
  });
}
