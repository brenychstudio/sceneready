import { describe, expect, it } from 'vitest';

import { DecisionPolicySchema, SCENEREADY_POLICY_V1 } from './index.js';

describe('decision policy v1', () => {
  it('validates the canonical policy identity', () => {
    const policy = DecisionPolicySchema.parse(SCENEREADY_POLICY_V1);

    expect(policy.policyVersion).toBe('SR-POLICY-v1');
    expect(policy.scoringVersion).toBe('SR-SCORE-v1');
    expect(policy.graphSchemaVersion).toBe('SR-GRAPH-v1');
  });

  it('centralizes readiness floors', () => {
    const policy = DecisionPolicySchema.parse(SCENEREADY_POLICY_V1);

    expect(policy.readiness.readyFloor).toBe(85);
    expect(policy.readiness.atRiskFloor).toBe(60);
  });

  it('centralizes confidence floors', () => {
    const policy = DecisionPolicySchema.parse(SCENEREADY_POLICY_V1);

    expect(policy.confidence.certifiedFloor).toBe(85);
    expect(policy.confidence.degradedFloor).toBe(60);
  });

  it('centralizes exact evidence freshness constants', () => {
    const policy = DecisionPolicySchema.parse(SCENEREADY_POLICY_V1);

    expect(policy.evidenceFreshnessMinutes).toEqual({
      WEATHER: 15,
      TRAVEL: 15,
      SOLAR: 1440,
      CREW_CONFIRMATION: 720,
      EQUIPMENT_VERIFICATION: 1440,
      DOCUMENT: 10080,
      LOCATION_ACCESS: 1440,
    });
  });

  it('centralizes recovery limits', () => {
    const policy = DecisionPolicySchema.parse(SCENEREADY_POLICY_V1);

    expect(policy.recovery.maxOptions).toBe(3);
    expect(policy.recovery.maxIntroducedCriticalRisks).toBe(0);
    expect(policy.recovery.maxIntroducedHighRisks).toBe(1);
  });

  it('centralizes approval TTLs', () => {
    const policy = DecisionPolicySchema.parse(SCENEREADY_POLICY_V1);

    expect(policy.approval.challengeTtlSeconds).toBe(180);
    expect(policy.approval.tokenTtlSeconds).toBe(120);
  });

  it('pins the canonical replay fixture version', () => {
    const policy = DecisionPolicySchema.parse(SCENEREADY_POLICY_V1);

    expect(policy.replay.fixtureVersion).toBe('BCN-DEMO-v1');
  });

  it('rejects a mutated v1 threshold while claiming SR-POLICY-v1', () => {
    const mutated: unknown = {
      ...SCENEREADY_POLICY_V1,
      readiness: {
        ...SCENEREADY_POLICY_V1.readiness,
        readyFloor: 84,
      },
    };

    expect(DecisionPolicySchema.safeParse(mutated).success).toBe(false);
  });

  it('rejects a policy-version mismatch', () => {
    const mismatched: unknown = {
      ...SCENEREADY_POLICY_V1,
      policyVersion: 'SR-POLICY-v2',
    };

    expect(DecisionPolicySchema.safeParse(mismatched).success).toBe(false);
  });

  it('rejects an unknown nested field', () => {
    const extraNested: unknown = {
      ...SCENEREADY_POLICY_V1,
      readiness: {
        ...SCENEREADY_POLICY_V1.readiness,
        extraFloor: 90,
      },
    };

    expect(DecisionPolicySchema.safeParse(extraNested).success).toBe(false);
  });

  it('rejects an unknown top-level field', () => {
    const extraTopLevel: unknown = {
      ...SCENEREADY_POLICY_V1,
      hiddenDefault: 1,
    };

    expect(DecisionPolicySchema.safeParse(extraTopLevel).success).toBe(false);
  });

  it('freezes the canonical policy at runtime', () => {
    expect(Object.isFrozen(SCENEREADY_POLICY_V1)).toBe(true);
    expect(Object.isFrozen(SCENEREADY_POLICY_V1.readiness)).toBe(true);
    expect(Object.isFrozen(SCENEREADY_POLICY_V1.confidence)).toBe(true);
    expect(Object.isFrozen(SCENEREADY_POLICY_V1.evidenceFreshnessMinutes)).toBe(true);
    expect(Object.isFrozen(SCENEREADY_POLICY_V1.recovery)).toBe(true);
    expect(Object.isFrozen(SCENEREADY_POLICY_V1.approval)).toBe(true);
    expect(Object.isFrozen(SCENEREADY_POLICY_V1.replay)).toBe(true);
  });

  it('rejects otherwise reasonable numeric drift under v1 identity', () => {
    const cases: readonly unknown[] = [
      {
        ...SCENEREADY_POLICY_V1,
        readiness: { ...SCENEREADY_POLICY_V1.readiness, atRiskFloor: 59 },
      },
      {
        ...SCENEREADY_POLICY_V1,
        confidence: { ...SCENEREADY_POLICY_V1.confidence, certifiedFloor: 84 },
      },
      {
        ...SCENEREADY_POLICY_V1,
        evidenceFreshnessMinutes: {
          ...SCENEREADY_POLICY_V1.evidenceFreshnessMinutes,
          WEATHER: 16,
        },
      },
      {
        ...SCENEREADY_POLICY_V1,
        evidenceFreshnessMinutes: {
          WEATHER: 15,
          TRAVEL: 15,
          SOLAR: 1440,
          CREW_CONFIRMATION: 720,
          EQUIPMENT_VERIFICATION: 1440,
          LOCATION_ACCESS: 1440,
        },
      },
      {
        ...SCENEREADY_POLICY_V1,
        evidenceFreshnessMinutes: {
          ...SCENEREADY_POLICY_V1.evidenceFreshnessMinutes,
          EXTRA: 1,
        },
      },
      {
        ...SCENEREADY_POLICY_V1,
        recovery: { ...SCENEREADY_POLICY_V1.recovery, maxOptions: 4 },
      },
      {
        ...SCENEREADY_POLICY_V1,
        recovery: { ...SCENEREADY_POLICY_V1.recovery, maxIntroducedCriticalRisks: -1 },
      },
      {
        ...SCENEREADY_POLICY_V1,
        approval: { ...SCENEREADY_POLICY_V1.approval, challengeTtlSeconds: 181 },
      },
      {
        ...SCENEREADY_POLICY_V1,
        replay: { fixtureVersion: 'BCN-DEMO-v2' },
      },
      {
        ...SCENEREADY_POLICY_V1,
        scoringVersion: 'SR-SCORE-v2',
      },
      {
        ...SCENEREADY_POLICY_V1,
        graphSchemaVersion: 'SR-GRAPH-v2',
      },
    ];

    for (const candidate of cases) {
      expect(DecisionPolicySchema.safeParse(candidate).success).toBe(false);
    }
  });
});
