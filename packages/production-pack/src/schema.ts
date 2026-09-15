import {
  EvidenceTrustStateSchema,
  ProductionIdSchema,
  resolveZonedProductionTime,
} from '@sceneready/domain';
import { z } from 'zod';

const PackEntityIdSchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,63}$/);
const PolicyVersionSchema = z.string().regex(/^SR-POLICY-v\d+$/);
const FixtureVersionSchema = z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*-v\d+$/);
const ProductionTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ProductionTimeZoneSchema = z.literal('Europe/Madrid');

function isCanonicalProductionDate(date: string): boolean {
  try {
    resolveZonedProductionTime({
      date,
      time: '12:00',
      timeZone: 'Europe/Madrid',
    });
    return true;
  } catch {
    return false;
  }
}

const ProductionDateSchema = z.string().superRefine((date, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isCanonicalProductionDate(date)) {
    ctx.addIssue({
      code: 'custom',
      message: 'invalid production date',
    });
  }
});

const NullableProductionDateSchema = z.union([ProductionDateSchema, z.null()]);

const CoordinatesSchema = z.strictObject({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

const PersonSchema = z.strictObject({
  id: PackEntityIdSchema,
  role: z.string().min(1),
  name: z.string().min(1),
  critical: z.boolean(),
});

const AzimuthRangeSchema = z.strictObject({
  min: z.number().gte(0).lte(360),
  max: z.number().gte(0).lte(360),
});

const ElevationRangeSchema = z
  .strictObject({
    min: z.number().gte(-90).lte(90),
    max: z.number().gte(-90).lte(90),
  })
  .superRefine((range, ctx) => {
    if (range.min > range.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['min'],
        message: 'Elevation range min must be less than or equal to max.',
      });
    }
  });

const SolarCreativeIntentSchema = z.strictObject({
  envelopeId: PackEntityIdSchema,
  preferredLocalTimeStart: ProductionTimeSchema,
  preferredLocalTimeEnd: ProductionTimeSchema,
  acceptableLocalTimeStart: ProductionTimeSchema,
  acceptableLocalTimeEnd: ProductionTimeSchema,
  preferredAzimuthDegrees: AzimuthRangeSchema,
  acceptableAzimuthDegrees: AzimuthRangeSchema,
  preferredElevationDegrees: ElevationRangeSchema,
  acceptableElevationDegrees: ElevationRangeSchema,
  shadowIntent: z.string().min(1),
  importance: z.enum(['CRITICAL', 'HIGH', 'MEDIUM']),
});

const LocationSchema = z
  .strictObject({
    id: PackEntityIdSchema,
    name: z.string().min(1),
    kind: z.enum(['EXTERIOR', 'STUDIO']),
    coordinates: CoordinatesSchema,
    visualIntent: z.string().min(1),
    accessNotes: z.string().min(1),
    environmentNotes: z.string().min(1),
    logisticsNotes: z.string().min(1),
    solarCreativeIntent: SolarCreativeIntentSchema.optional(),
  })
  .superRefine((location, ctx) => {
    if (location.kind === 'STUDIO' && location.solarCreativeIntent !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['solarCreativeIntent'],
        message: 'STUDIO locations cannot declare a solar creative-intent envelope.',
      });
    }
    if (location.kind === 'EXTERIOR' && location.solarCreativeIntent === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['solarCreativeIntent'],
        message: 'EXTERIOR locations require a solar creative-intent envelope.',
      });
    }
  });

const ActivityConstraintSchema = z.enum([
  'FIXED',
  'CRITICAL_WINDOW',
  'TARGET',
  'FLEXIBLE',
  'DEPENDENT',
]);

const ActivitySchema = z
  .strictObject({
    id: PackEntityIdSchema,
    name: z.string().min(1).max(128),
    startLocal: ProductionTimeSchema,
    endLocal: ProductionTimeSchema,
    locationId: PackEntityIdSchema,
    assignedPersonIds: z.array(PackEntityIdSchema).min(1),
    dependsOn: z.array(PackEntityIdSchema),
    constraint: ActivityConstraintSchema,
    equipmentIds: z.array(PackEntityIdSchema),
    documentIds: z.array(PackEntityIdSchema),
  })
  .superRefine((activity, ctx) => {
    if (activity.constraint === 'DEPENDENT' && activity.dependsOn.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['dependsOn'],
        message: 'DEPENDENT activities require at least one dependency.',
      });
    }
  });

const DeliverableSchema = z.strictObject({
  id: PackEntityIdSchema,
  name: z.string().min(1).max(128),
  importance: z.enum(['CRITICAL', 'HIGH', 'MEDIUM']),
  requiredActivityIds: z.array(PackEntityIdSchema).min(1),
  requiredDocumentIds: z.array(PackEntityIdSchema),
  requiredPersonIds: z.array(PackEntityIdSchema),
  requiredLocationIds: z.array(PackEntityIdSchema),
  requiredEquipmentIds: z.array(PackEntityIdSchema),
  creativeIntentEnvelopeId: PackEntityIdSchema.optional(),
});

const EquipmentAssetSchema = z.strictObject({
  id: PackEntityIdSchema,
  name: z.string().min(1),
  category: z.enum(['BODY', 'LENS', 'MEDIA', 'POWER', 'LIGHTING', 'TETHERING', 'MOTION', 'OTHER']),
  operationalState: z.enum(['READY', 'DEGRADED', 'FAILED', 'UNKNOWN']),
});

const CapturePathSchema = z.strictObject({
  id: PackEntityIdSchema,
  primaryEquipmentIds: z.array(PackEntityIdSchema).min(1),
  backupEquipmentIds: z.array(PackEntityIdSchema).min(1),
});

const RightsDocumentSchema = z.strictObject({
  id: PackEntityIdSchema,
  name: z.string().min(1),
  kind: z.enum([
    'MODEL_RELEASE',
    'LOCATION_RELEASE',
    'LOCATION_ACCESS',
    'PERMIT',
    'STUDIO_BOOKING',
    'USAGE_RIGHTS',
  ]),
  validFromDate: NullableProductionDateSchema,
  validThroughDate: NullableProductionDateSchema,
  personIds: z.array(PackEntityIdSchema),
  locationIds: z.array(PackEntityIdSchema),
  coversDeliverableIds: z.array(PackEntityIdSchema),
  usageScopes: z.array(z.string().min(1)),
});

const PriorityObjectiveSchema = z.enum([
  'EXTERIOR_CREATIVE_INTENT',
  'DAYLIGHT',
  'STUDIO_COMPLETION',
  'DELAY_MINIMIZATION',
  'CREW_CONVENIENCE',
  'COST',
]);

const PriorityProfileSchema = z.strictObject({
  profile: z.literal('CREATIVE_FIRST'),
  rankedObjectives: z
    .array(PriorityObjectiveSchema)
    .length(6)
    .refine(
      (objectives) => new Set(objectives).size === objectives.length,
      'Priority objectives must each appear exactly once.',
    ),
});

export const HARD_GATE_SUBJECT_TYPES = {
  LOCATION_ACCESS: 'LOCATION',
  CRITICAL_TALENT: 'PERSON',
  RIGHTS: 'DOCUMENT',
  CRITICAL_CAPTURE_KIT: 'EQUIPMENT_PATH',
  STUDIO_AVAILABILITY: 'LOCATION',
} as const;

const HardGateIdSchema = z.enum([
  'LOCATION_ACCESS',
  'CRITICAL_TALENT',
  'RIGHTS',
  'CRITICAL_CAPTURE_KIT',
  'STUDIO_AVAILABILITY',
]);

const HardGateSubjectTypeSchema = z.enum(['LOCATION', 'PERSON', 'DOCUMENT', 'EQUIPMENT_PATH']);

const HardGateSchema = z
  .strictObject({
    id: HardGateIdSchema,
    subjectType: HardGateSubjectTypeSchema,
    subjectIds: z.array(PackEntityIdSchema).min(1),
  })
  .superRefine((gate, ctx) => {
    if (gate.subjectType !== HARD_GATE_SUBJECT_TYPES[gate.id]) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectType'],
        message: `Hard gate '${gate.id}' requires subjectType '${HARD_GATE_SUBJECT_TYPES[gate.id]}'.`,
      });
    }
  });

const EvidenceKindSchema = z.enum([
  'WEATHER',
  'TRAVEL',
  'SOLAR',
  'CREW_CONFIRMATION',
  'EQUIPMENT_VERIFICATION',
  'DOCUMENT',
  'LOCATION_ACCESS',
]);

const EvidenceSubjectTypeSchema = z.enum([
  'PERSON',
  'LOCATION',
  'ACTIVITY',
  'EQUIPMENT',
  'EQUIPMENT_PATH',
  'DOCUMENT',
]);

const EvidenceReferenceSchema = z.strictObject({
  id: PackEntityIdSchema,
  kind: EvidenceKindSchema,
  trustState: EvidenceTrustStateSchema,
  subjectType: EvidenceSubjectTypeSchema,
  subjectId: PackEntityIdSchema,
});

const ProductionIdentitySchema = z.strictObject({
  id: ProductionIdSchema,
  campaignName: z.string().min(1),
  date: ProductionDateSchema,
  timeZone: ProductionTimeZoneSchema,
});

export const ProductionPackSchema = z
  .strictObject({
    fixtureVersion: FixtureVersionSchema,
    policyVersion: PolicyVersionSchema,
    syntheticDataDeclaration: z.literal(true),
    production: ProductionIdentitySchema,
    crew: z.array(PersonSchema).min(1),
    locations: z.array(LocationSchema).min(1),
    schedule: z.array(ActivitySchema).min(1),
    deliverables: z.array(DeliverableSchema).min(1),
    equipment: z.array(EquipmentAssetSchema).min(1),
    capturePaths: z.array(CapturePathSchema).min(1),
    rights: z.array(RightsDocumentSchema).min(1),
    priorities: PriorityProfileSchema,
    hardGates: z.array(HardGateSchema).min(1),
    evidence: z.array(EvidenceReferenceSchema).min(1),
  })
  .superRefine((pack, ctx) => {
    const envelopes = new Map<string, string>();
    for (const [index, location] of pack.locations.entries()) {
      const envelope = location.solarCreativeIntent;
      if (envelope === undefined) {
        continue;
      }
      if (envelopes.has(envelope.envelopeId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['locations', index, 'solarCreativeIntent', 'envelopeId'],
          message: `Duplicate creative intent envelope id '${envelope.envelopeId}'.`,
        });
        continue;
      }
      envelopes.set(envelope.envelopeId, location.id);
    }

    for (const [index, deliverable] of pack.deliverables.entries()) {
      const envelopeId = deliverable.creativeIntentEnvelopeId;
      if (envelopeId === undefined) {
        continue;
      }
      const locationId = envelopes.get(envelopeId);
      if (locationId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['deliverables', index, 'creativeIntentEnvelopeId'],
          message: `Unknown creative intent envelope '${envelopeId}'.`,
        });
        continue;
      }
      if (!deliverable.requiredLocationIds.includes(locationId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['deliverables', index, 'creativeIntentEnvelopeId'],
          message: `Creative intent envelope '${envelopeId}' is not bound to a required location.`,
        });
      }
    }
  });

export type ProductionPack = z.infer<typeof ProductionPackSchema>;
