export const INTERVENTION_KINDS = [
  'SHIFT_ACTIVITY',
  'SHORTEN_ACTIVITY',
  'REORDER_ACTIVITIES',
  'ADD_BUFFER',
  'ADJUST_CALL_TIME',
  'ACTIVATE_BACKUP_KIT',
  'REQUIRE_REVERIFICATION',
  'SWITCH_TO_APPROVED_FALLBACK',
  'ADJUST_DEPARTURE',
  'INCREASE_TRANSFER_BUFFER',
  'REQUEST_MISSING_CONFIRMATION',
] as const;

export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const REVERSIBILITY_CLASSES = [
  'REVERSIBLE_BY_NEW_REVISION',
  'CORRECTIVE_ACTION_REQUIRED',
  'IRREVERSIBLE',
] as const;

export type ReversibilityClass = (typeof REVERSIBILITY_CLASSES)[number];

export interface InterventionDescriptor {
  readonly kind: InterventionKind;
  readonly reversibility: ReversibilityClass;
}

function descriptor(
  kind: InterventionKind,
  reversibility: ReversibilityClass,
): InterventionDescriptor {
  return Object.freeze({ kind, reversibility });
}

export const INTERVENTION_DESCRIPTORS: readonly InterventionDescriptor[] = Object.freeze([
  descriptor('SHIFT_ACTIVITY', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('SHORTEN_ACTIVITY', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('REORDER_ACTIVITIES', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('ADD_BUFFER', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('ADJUST_CALL_TIME', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('ACTIVATE_BACKUP_KIT', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('REQUIRE_REVERIFICATION', 'CORRECTIVE_ACTION_REQUIRED'),
  descriptor('SWITCH_TO_APPROVED_FALLBACK', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('ADJUST_DEPARTURE', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('INCREASE_TRANSFER_BUFFER', 'REVERSIBLE_BY_NEW_REVISION'),
  descriptor('REQUEST_MISSING_CONFIRMATION', 'CORRECTIVE_ACTION_REQUIRED'),
]);
