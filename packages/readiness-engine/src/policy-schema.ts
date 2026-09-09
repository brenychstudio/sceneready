import { z } from 'zod';

const ReadinessPolicySchema = z.strictObject({
  readyFloor: z.literal(85),
  atRiskFloor: z.literal(60),
});

const ConfidencePolicySchema = z.strictObject({
  certifiedFloor: z.literal(85),
  degradedFloor: z.literal(60),
});

const EvidenceFreshnessMinutesSchema = z.strictObject({
  WEATHER: z.literal(15),
  TRAVEL: z.literal(15),
  SOLAR: z.literal(1440),
  CREW_CONFIRMATION: z.literal(720),
  EQUIPMENT_VERIFICATION: z.literal(1440),
  DOCUMENT: z.literal(10080),
  LOCATION_ACCESS: z.literal(1440),
});

const RecoveryPolicySchema = z.strictObject({
  maxOptions: z.literal(3),
  maxIntroducedCriticalRisks: z.literal(0),
  maxIntroducedHighRisks: z.literal(1),
});

const ApprovalPolicySchema = z.strictObject({
  challengeTtlSeconds: z.literal(180),
  tokenTtlSeconds: z.literal(120),
});

const ReplayPolicySchema = z.strictObject({
  fixtureVersion: z.literal('BCN-DEMO-v1'),
});

export const DecisionPolicySchema = z.strictObject({
  policyVersion: z.literal('SR-POLICY-v1'),
  scoringVersion: z.literal('SR-SCORE-v1'),
  graphSchemaVersion: z.literal('SR-GRAPH-v1'),
  readiness: ReadinessPolicySchema,
  confidence: ConfidencePolicySchema,
  evidenceFreshnessMinutes: EvidenceFreshnessMinutesSchema,
  recovery: RecoveryPolicySchema,
  approval: ApprovalPolicySchema,
  replay: ReplayPolicySchema,
});

export type DecisionPolicy = z.infer<typeof DecisionPolicySchema>;
