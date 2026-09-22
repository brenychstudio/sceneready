/**
 * SR-02 bounded implementation interpretation of the canonical
 * "Explicit Production Phase State Machine + Phase-bound Action Validity"
 * requirement. These five phase names follow the BCN exterior-to-studio
 * sequence. They are not additional canonical design-authority phase names.
 */
export const PRODUCTION_PHASES = [
  'PREFLIGHT',
  'GOTHIC_ACTIVE',
  'EIXAMPLE_ACTIVE',
  'STUDIO_ACTIVE',
  'COMPLETE',
] as const;

export type ProductionPhase = (typeof PRODUCTION_PHASES)[number];

export const ACTIVITY_LIFECYCLE_STATES = ['PENDING', 'ACTIVE', 'COMPLETED'] as const;

export type ActivityLifecycleState = (typeof ACTIVITY_LIFECYCLE_STATES)[number];

export const LIFECYCLE_REASON_CODES = [
  'PHASE_SEQUENCE_MONOTONIC',
  'COMPLETE_IS_TERMINAL',
  'ACTIVITY_IMMUTABLE_AFTER_COMPLETION',
  'PRODUCTION_COMPLETE_IMMUTABLE',
] as const;

export type LifecycleReasonCode = (typeof LIFECYCLE_REASON_CODES)[number];

export type PhaseTransitionDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: LifecycleReasonCode };

export type ActivityInterventionKind = 'SHIFT_ACTIVITY';

export type ActivityInterventionDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: LifecycleReasonCode };

export function canTransitionProductionPhase(
  from: ProductionPhase,
  to: ProductionPhase,
): PhaseTransitionDecision {
  if (from === 'COMPLETE') {
    return { allowed: false, reason: 'COMPLETE_IS_TERMINAL' };
  }
  const fromIndex = PRODUCTION_PHASES.indexOf(from);
  const toIndex = PRODUCTION_PHASES.indexOf(to);
  if (fromIndex >= 0 && toIndex === fromIndex + 1) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'PHASE_SEQUENCE_MONOTONIC' };
}

export function canInterveneOnActivity(input: {
  readonly productionPhase: ProductionPhase;
  readonly activityState: ActivityLifecycleState;
  readonly interventionKind: ActivityInterventionKind;
}): ActivityInterventionDecision {
  if (input.activityState === 'COMPLETED') {
    return { allowed: false, reason: 'ACTIVITY_IMMUTABLE_AFTER_COMPLETION' };
  }
  if (input.productionPhase === 'COMPLETE') {
    return { allowed: false, reason: 'PRODUCTION_COMPLETE_IMMUTABLE' };
  }
  return { allowed: true };
}
