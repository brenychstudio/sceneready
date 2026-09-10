import { ProductionIdSchema } from '@sceneready/domain';
import { z } from 'zod';

const PackEntityIdSchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,63}$/);
const PolicyVersionSchema = z.string().regex(/^SR-POLICY-v\d+$/);
const FixtureVersionSchema = z.string().regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*-v\d+$/);
const ProductionDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ProductionTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ProductionTimeZoneSchema = z.literal('Europe/Madrid');

const CoordinatesSchema = z.strictObject({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

const PersonSchema = z.strictObject({
  id: PackEntityIdSchema,
  role: z.string().min(1),
  name: z.string().min(1),
});

const LocationSchema = z.strictObject({
  id: PackEntityIdSchema,
  name: z.string().min(1),
  coordinates: CoordinatesSchema,
});

const ActivityConstraintSchema = z.enum([
  'FIXED',
  'CRITICAL_WINDOW',
  'TARGET',
  'FLEXIBLE',
  'DEPENDENT',
]);

const ActivitySchema = z.strictObject({
  id: PackEntityIdSchema,
  startLocal: ProductionTimeSchema,
  endLocal: ProductionTimeSchema,
  locationId: PackEntityIdSchema,
  assignedPersonIds: z.array(PackEntityIdSchema).min(1),
  dependsOn: z.array(PackEntityIdSchema),
  constraint: ActivityConstraintSchema,
  equipmentIds: z.array(PackEntityIdSchema),
  documentIds: z.array(PackEntityIdSchema),
});

const DeliverableSchema = z.strictObject({
  id: PackEntityIdSchema,
  importance: z.enum(['CRITICAL', 'HIGH', 'MEDIUM']),
  requiredActivityIds: z.array(PackEntityIdSchema).min(1),
  requiredDocumentIds: z.array(PackEntityIdSchema),
});

const EquipmentAssetSchema = z.strictObject({
  id: PackEntityIdSchema,
  name: z.string().min(1),
});

const CapturePathSchema = z.strictObject({
  id: PackEntityIdSchema,
  primaryEquipmentIds: z.array(PackEntityIdSchema).min(1),
  backupEquipmentIds: z.array(PackEntityIdSchema).min(1),
});

const RightsDocumentSchema = z.strictObject({
  id: PackEntityIdSchema,
  coversDeliverableIds: z.array(PackEntityIdSchema),
  locationIds: z.array(PackEntityIdSchema),
});

const PriorityProfileSchema = z.strictObject({
  profile: z.literal('CREATIVE_FIRST'),
  rankedObjectives: z
    .array(
      z.enum([
        'PRESERVE_EXTERIOR_INTENT',
        'PRESERVE_STUDIO',
        'MINIMIZE_DELAY',
        'CREW_CONVENIENCE',
        'MINIMIZE_COST',
      ]),
    )
    .min(1),
});

const HardGateIdSchema = z.enum([
  'LOCATION_ACCESS',
  'CRITICAL_TALENT',
  'RIGHTS',
  'CRITICAL_CAPTURE_KIT',
  'STUDIO_AVAILABILITY',
]);

const HardGateSchema = z.strictObject({
  id: HardGateIdSchema,
  evidenceIds: z.array(PackEntityIdSchema),
});

const EvidenceReferenceSchema = z.strictObject({
  id: PackEntityIdSchema,
  documentIds: z.array(PackEntityIdSchema),
});

const ProductionIdentitySchema = z.strictObject({
  id: ProductionIdSchema,
  campaignName: z.string().min(1),
  date: ProductionDateSchema,
  timeZone: ProductionTimeZoneSchema,
});

export const ProductionPackSchema = z.strictObject({
  fixtureVersion: FixtureVersionSchema,
  policyVersion: PolicyVersionSchema,
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
});

export type ProductionPack = z.infer<typeof ProductionPackSchema>;
