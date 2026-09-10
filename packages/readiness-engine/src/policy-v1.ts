import { DecisionPolicySchema, type DecisionPolicy } from './policy-schema.js';

function freezeDecisionPolicy(policy: DecisionPolicy): DecisionPolicy {
  const record = policy as Record<string, unknown>;
  for (const nested of Object.values(record)) {
    if (typeof nested === 'object' && nested !== null) {
      Object.freeze(nested);
    }
  }

  return Object.freeze(policy);
}

const SCENEREADY_POLICY_V1_SOURCE = {
  policyVersion: 'SR-POLICY-v1',
  scoringVersion: 'SR-SCORE-v1',
  graphSchemaVersion: 'SR-GRAPH-v1',
  readiness: {
    readyFloor: 85,
    atRiskFloor: 60,
  },
  confidence: {
    certifiedFloor: 85,
    degradedFloor: 60,
  },
  evidenceFreshnessMinutes: {
    WEATHER: 15,
    TRAVEL: 15,
    SOLAR: 1440,
    CREW_CONFIRMATION: 720,
    EQUIPMENT_VERIFICATION: 1440,
    DOCUMENT: 10080,
    LOCATION_ACCESS: 1440,
  },
  recovery: {
    maxOptions: 3,
    maxIntroducedCriticalRisks: 0,
    maxIntroducedHighRisks: 1,
  },
  approval: {
    challengeTtlSeconds: 180,
    tokenTtlSeconds: 120,
  },
  replay: {
    fixtureVersion: 'BCN-DEMO-v1',
  },
} as const satisfies DecisionPolicy;

export const SCENEREADY_POLICY_V1: typeof SCENEREADY_POLICY_V1_SOURCE = freezeDecisionPolicy(
  DecisionPolicySchema.parse(SCENEREADY_POLICY_V1_SOURCE),
);
