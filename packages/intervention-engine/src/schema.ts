import { z } from 'zod';

const EntityIdSchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,63}$/);

export const ActivityIdSchema = EntityIdSchema;
export const PersonIdSchema = EntityIdSchema;
export const EquipmentIdSchema = EntityIdSchema;
export const EquipmentPathIdSchema = EntityIdSchema;
export const LocationIdSchema = EntityIdSchema;

export const EvidenceScopeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,31}:[A-Z0-9][A-Z0-9-]{2,63}:[A-Z][A-Z0-9_]{0,31}$/);

const ShiftActivitySchema = z.strictObject({
  kind: z.literal('SHIFT_ACTIVITY'),
  activityId: ActivityIdSchema,
  deltaMinutes: z.int().min(-120).max(120),
});

const ShortenActivitySchema = z.strictObject({
  kind: z.literal('SHORTEN_ACTIVITY'),
  activityId: ActivityIdSchema,
  minutes: z.int().min(5).max(60),
});

const ReorderActivitiesSchema = z.strictObject({
  kind: z.literal('REORDER_ACTIVITIES'),
  activityIds: z
    .array(ActivityIdSchema)
    .min(2)
    .max(5)
    .superRefine((activityIds, ctx) => {
      if (new Set(activityIds).size !== activityIds.length) {
        ctx.addIssue({ code: 'custom', message: 'duplicate activity id' });
      }
    })
    .readonly(),
});

const AddBufferSchema = z.strictObject({
  kind: z.literal('ADD_BUFFER'),
  beforeActivityId: ActivityIdSchema,
  minutes: z.int().min(5).max(45),
});

const AdjustCallTimeSchema = z.strictObject({
  kind: z.literal('ADJUST_CALL_TIME'),
  personId: PersonIdSchema,
  deltaMinutes: z.int().min(-90).max(90),
});

const ActivateBackupKitSchema = z.strictObject({
  kind: z.literal('ACTIVATE_BACKUP_KIT'),
  equipmentPathId: EquipmentPathIdSchema,
});

const RequireReverificationSchema = z.strictObject({
  kind: z.literal('REQUIRE_REVERIFICATION'),
  equipmentId: EquipmentIdSchema,
});

const SwitchToApprovedFallbackSchema = z.strictObject({
  kind: z.literal('SWITCH_TO_APPROVED_FALLBACK'),
  activityId: ActivityIdSchema,
  fallbackLocationId: LocationIdSchema,
});

const AdjustDepartureSchema = z.strictObject({
  kind: z.literal('ADJUST_DEPARTURE'),
  transferActivityId: ActivityIdSchema,
  deltaMinutes: z.int().min(-90).max(90),
});

const IncreaseTransferBufferSchema = z.strictObject({
  kind: z.literal('INCREASE_TRANSFER_BUFFER'),
  transferActivityId: ActivityIdSchema,
  minutes: z.int().min(5).max(45),
});

const RequestMissingConfirmationSchema = z.strictObject({
  kind: z.literal('REQUEST_MISSING_CONFIRMATION'),
  evidenceScope: EvidenceScopeSchema,
});

export const InterventionPrimitiveSchema = z.discriminatedUnion('kind', [
  ShiftActivitySchema,
  ShortenActivitySchema,
  ReorderActivitiesSchema,
  AddBufferSchema,
  AdjustCallTimeSchema,
  ActivateBackupKitSchema,
  RequireReverificationSchema,
  SwitchToApprovedFallbackSchema,
  AdjustDepartureSchema,
  IncreaseTransferBufferSchema,
  RequestMissingConfirmationSchema,
]);

export type InterventionPrimitive = z.infer<typeof InterventionPrimitiveSchema>;

export const INVALID_INTERVENTION = 'INVALID_INTERVENTION';

export type ParseInterventionResult =
  | { readonly ok: true; readonly intervention: InterventionPrimitive }
  | { readonly ok: false; readonly code: typeof INVALID_INTERVENTION };

function freezeIntervention(intervention: InterventionPrimitive): InterventionPrimitive {
  if (intervention.kind === 'REORDER_ACTIVITIES') {
    return Object.freeze({
      kind: intervention.kind,
      activityIds: Object.freeze([...intervention.activityIds]),
    });
  }
  return Object.freeze({ ...intervention });
}

export function parseIntervention(value: unknown): ParseInterventionResult {
  const parsed = InterventionPrimitiveSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, code: INVALID_INTERVENTION };
  }
  return { ok: true, intervention: freezeIntervention(parsed.data) };
}
