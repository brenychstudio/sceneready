import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { RankingPolicyView } from './escalation.js';
import type { RecoveryOutcomeMetrics } from './metrics.js';
import type { ProductionPriorityProfile } from './priority-profile.js';
import { rankRecoveryOptions, type RecoveryRankingOption } from './rank.js';

const CREATIVE_FIRST: ProductionPriorityProfile = {
  profileId: 'CREATIVE-FIRST',
  tiers: [
    { metricIds: ['CREATIVE_PRESERVATION'] },
    { metricIds: ['READINESS_IMPROVEMENT'] },
    { metricIds: ['SCHEDULE_STABILITY'] },
    { metricIds: ['EVIDENCE_CONFIDENCE'] },
    { metricIds: ['LOGISTICS_IMPACT'] },
    { metricIds: ['CREW_DISRUPTION'] },
    { metricIds: ['NEW_RISK_INTRODUCED'] },
  ],
};

const POLICY: RankingPolicyView = { confidence: { degradedFloor: 60 } };

function metrics(overrides: Partial<RecoveryOutcomeMetrics> = {}): RecoveryOutcomeMetrics {
  return {
    readinessImprovement: 0,
    creativePreservation: 50,
    scheduleStability: 50,
    logisticsImpact: 'LOW',
    crewDisruption: 'LOW',
    evidenceConfidence: 90,
    newRiskIntroduced: 'LOW',
    ...overrides,
  };
}

function option(
  optionId: string,
  overrides: Partial<RecoveryOutcomeMetrics> = {},
  viable = true,
): RecoveryRankingOption {
  return {
    optionId,
    feasibility: { viable, reasons: viable ? [] : ['INFEASIBLE'] },
    metrics: metrics(overrides),
  };
}

const OPTION_A = option('OPTION-A', {
  readinessImprovement: 15,
  creativePreservation: 95,
  scheduleStability: 80,
  logisticsImpact: 'LOW',
  crewDisruption: 'MEDIUM',
  evidenceConfidence: 90,
  newRiskIntroduced: 'LOW',
});

const OPTION_B = option('OPTION-B', {
  readinessImprovement: 40,
  creativePreservation: 80,
  scheduleStability: 90,
  logisticsImpact: 'NONE',
  crewDisruption: 'LOW',
  evidenceConfidence: 96,
  newRiskIntroduced: 'NONE',
});

const OPTION_C = option('OPTION-C', {
  readinessImprovement: 50,
  creativePreservation: 60,
  scheduleStability: 95,
  logisticsImpact: 'NONE',
  crewDisruption: 'NONE',
  evidenceConfidence: 99,
  newRiskIntroduced: 'NONE',
});

describe('rankRecoveryOptions', () => {
  it('recommends the creative-first option without scoring the other gains', () => {
    const result = rankRecoveryOptions([OPTION_C, OPTION_A, OPTION_B], CREATIVE_FIRST, POLICY);
    expect(result.decision).toBe('RECOMMEND');
    expect(result.recommendedOptionId).toBe('OPTION-A');
    expect(result.escalationReason).toBeNull();
    expect(result.orderedOptions[0]?.optionId).toBe('OPTION-A');
    expect(result.orderedOptions[0]?.metrics.creativePreservation).toBe(95);
    expect(result.orderedOptions[0]?.metrics.readinessImprovement).toBe(15);
    expect(result.orderedOptions[0]?.metrics.crewDisruption).toBe('MEDIUM');
    expect(result.orderedOptions.map((item) => item.optionId)).toEqual([
      'OPTION-A',
      'OPTION-B',
      'OPTION-C',
    ]);
  });

  it('removes an infeasible option before ranking even when its metrics are better', () => {
    const superior = option(
      'OPTION-Z',
      {
        readinessImprovement: 100,
        creativePreservation: 100,
        scheduleStability: 100,
        logisticsImpact: 'NONE',
        crewDisruption: 'NONE',
        evidenceConfidence: 100,
        newRiskIntroduced: 'NONE',
      },
      false,
    );
    const result = rankRecoveryOptions([superior, OPTION_A], CREATIVE_FIRST, POLICY);
    expect(result.recommendedOptionId).toBe('OPTION-A');
    expect(result.orderedOptions.map((item) => item.optionId)).toEqual(['OPTION-A']);
  });

  it('escalates when every option is infeasible', () => {
    const result = rankRecoveryOptions(
      [option('OPTION-A', {}, false), option('OPTION-B', {}, false)],
      CREATIVE_FIRST,
      POLICY,
    );
    expect(result).toMatchObject({
      decision: 'ESCALATE',
      recommendedOptionId: null,
      escalationReason: 'NO_VIABLE_PLAN',
      orderedOptions: [],
    });
  });

  it('presents a trade-off when co-equal metrics point at different options', () => {
    const profile: ProductionPriorityProfile = {
      profileId: 'CREATIVE-THEN-SPLIT',
      tiers: [
        { metricIds: ['CREATIVE_PRESERVATION'] },
        { metricIds: ['READINESS_IMPROVEMENT', 'CREW_DISRUPTION'] },
        { metricIds: ['SCHEDULE_STABILITY'] },
        { metricIds: ['EVIDENCE_CONFIDENCE'] },
        { metricIds: ['LOGISTICS_IMPACT'] },
        { metricIds: ['NEW_RISK_INTRODUCED'] },
      ],
    };
    const ready = option('OPTION-READY', {
      creativePreservation: 90,
      readinessImprovement: 40,
      crewDisruption: 'HIGH',
    });
    const calm = option('OPTION-CALM', {
      creativePreservation: 90,
      readinessImprovement: 5,
      crewDisruption: 'NONE',
    });
    const result = rankRecoveryOptions([ready, calm], profile, POLICY);
    expect(result.decision).toBe('PRESENT_TRADE_OFF');
    expect(result.recommendedOptionId).toBeNull();
    expect(result.escalationReason).toBe('PRIORITY_CONFLICT');
    expect(result.orderedOptions.map((item) => item.optionId).sort()).toEqual([
      'OPTION-CALM',
      'OPTION-READY',
    ]);
  });

  it('does not turn an exact metric tie into a recommendation', () => {
    const shared = { creativePreservation: 90, readinessImprovement: 10 };
    const result = rankRecoveryOptions(
      [option('OPTION-B', shared), option('OPTION-A', shared)],
      CREATIVE_FIRST,
      POLICY,
    );
    expect(result.decision).not.toBe('RECOMMEND');
    expect(result.recommendedOptionId).toBeNull();
    expect(result.orderedOptions.map((item) => item.optionId)).toEqual(['OPTION-A', 'OPTION-B']);
  });

  it('keeps the same result when the input order is reversed', () => {
    const forward = rankRecoveryOptions([OPTION_A, OPTION_B, OPTION_C], CREATIVE_FIRST, POLICY);
    const reversed = rankRecoveryOptions([OPTION_C, OPTION_B, OPTION_A], CREATIVE_FIRST, POLICY);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it('orders an exact tie by option id without recommending either', () => {
    const shared = { creativePreservation: 70 };
    const result = rankRecoveryOptions(
      [option('OPTION-B', shared), option('OPTION-A', shared)],
      CREATIVE_FIRST,
      POLICY,
    );
    expect(result.recommendedOptionId).toBeNull();
    expect(result.orderedOptions.map((item) => item.optionId)).toEqual(['OPTION-A', 'OPTION-B']);
  });

  it('escalates when every viable candidate is below the confidence floor', () => {
    const result = rankRecoveryOptions(
      [
        option('OPTION-A', { evidenceConfidence: 59, creativePreservation: 99 }),
        option('OPTION-B', { evidenceConfidence: 10, creativePreservation: 10 }),
      ],
      CREATIVE_FIRST,
      POLICY,
    );
    expect(result).toMatchObject({
      decision: 'ESCALATE',
      recommendedOptionId: null,
      escalationReason: 'INSUFFICIENT_EVIDENCE',
    });
  });

  it('does not change another option when one candidate is below the confidence floor', () => {
    const strong = option('OPTION-A', { evidenceConfidence: 90, creativePreservation: 95 });
    const weak = option('OPTION-B', { evidenceConfidence: 10, creativePreservation: 99 });
    const before = JSON.stringify([strong, weak]);
    const result = rankRecoveryOptions([weak, strong], CREATIVE_FIRST, POLICY);
    expect(JSON.stringify([strong, weak])).toBe(before);
    expect(result.decision).toBe('RECOMMEND');
    expect(result.recommendedOptionId).toBe('OPTION-B');
    expect(result.orderedOptions[1]?.metrics).toEqual(strong.metrics);
  });

  it('maximizes readiness, creative preservation, schedule stability, and evidence confidence', () => {
    const cases = [
      { metric: 'readinessImprovement' as const, low: 1, high: 20 },
      { metric: 'creativePreservation' as const, low: 40, high: 90 },
      { metric: 'scheduleStability' as const, low: 20, high: 80 },
      { metric: 'evidenceConfidence' as const, low: 70, high: 95 },
    ];
    for (const sample of cases) {
      const profile: ProductionPriorityProfile = {
        profileId: sample.metric,
        tiers: [
          {
            metricIds: [
              sample.metric === 'readinessImprovement'
                ? 'READINESS_IMPROVEMENT'
                : sample.metric === 'creativePreservation'
                  ? 'CREATIVE_PRESERVATION'
                  : sample.metric === 'scheduleStability'
                    ? 'SCHEDULE_STABILITY'
                    : 'EVIDENCE_CONFIDENCE',
            ],
          },
          ...CREATIVE_FIRST.tiers.filter(
            (tier) =>
              tier.metricIds[0] !==
              (sample.metric === 'readinessImprovement'
                ? 'READINESS_IMPROVEMENT'
                : sample.metric === 'creativePreservation'
                  ? 'CREATIVE_PRESERVATION'
                  : sample.metric === 'scheduleStability'
                    ? 'SCHEDULE_STABILITY'
                    : 'EVIDENCE_CONFIDENCE'),
          ),
        ],
      };
      const result = rankRecoveryOptions(
        [
          option('OPTION-LOW', { [sample.metric]: sample.low }),
          option('OPTION-HIGH', { [sample.metric]: sample.high }),
        ],
        profile,
        POLICY,
      );
      expect(result.recommendedOptionId).toBe('OPTION-HIGH');
    }
  });

  it('minimizes logistics impact, crew disruption, and new risk', () => {
    const cases = [
      { field: 'logisticsImpact' as const, metricId: 'LOGISTICS_IMPACT' as const },
      { field: 'crewDisruption' as const, metricId: 'CREW_DISRUPTION' as const },
      { field: 'newRiskIntroduced' as const, metricId: 'NEW_RISK_INTRODUCED' as const },
    ];
    for (const sample of cases) {
      const profile: ProductionPriorityProfile = {
        profileId: sample.metricId,
        tiers: [
          { metricIds: [sample.metricId] },
          ...CREATIVE_FIRST.tiers.filter((tier) => tier.metricIds[0] !== sample.metricId),
        ],
      };
      const result = rankRecoveryOptions(
        [
          option('OPTION-WORSE', { [sample.field]: 'CRITICAL' }),
          option('OPTION-BETTER', { [sample.field]: 'NONE' }),
        ],
        profile,
        POLICY,
      );
      expect(result.recommendedOptionId).toBe('OPTION-BETTER');
    }
  });

  it('fails closed for a duplicate option id, invalid metrics, and an invalid profile', () => {
    expect(
      rankRecoveryOptions([option('OPTION-A'), option('OPTION-A')], CREATIVE_FIRST, POLICY),
    ).toMatchObject({
      decision: 'ESCALATE',
      recommendedOptionId: null,
      escalationReason: 'PRIORITY_CONFLICT',
    });
    expect(
      rankRecoveryOptions(
        [option('OPTION-A', { readinessImprovement: 101 })],
        CREATIVE_FIRST,
        POLICY,
      ),
    ).toMatchObject({ decision: 'ESCALATE', escalationReason: 'PRIORITY_CONFLICT' });
    expect(
      rankRecoveryOptions(
        [option('OPTION-A', { creativePreservation: -1 })],
        CREATIVE_FIRST,
        POLICY,
      ),
    ).toMatchObject({ decision: 'ESCALATE', escalationReason: 'PRIORITY_CONFLICT' });
    expect(
      rankRecoveryOptions(
        [option('OPTION-A')],
        {
          profileId: 'DUPLICATE',
          tiers: [
            { metricIds: ['CREATIVE_PRESERVATION', 'CREATIVE_PRESERVATION'] },
            { metricIds: ['READINESS_IMPROVEMENT'] },
            { metricIds: ['SCHEDULE_STABILITY'] },
            { metricIds: ['EVIDENCE_CONFIDENCE'] },
            { metricIds: ['LOGISTICS_IMPACT'] },
            { metricIds: ['CREW_DISRUPTION'] },
            { metricIds: ['NEW_RISK_INTRODUCED'] },
          ],
        },
        POLICY,
      ),
    ).toMatchObject({ decision: 'ESCALATE', escalationReason: 'PRIORITY_CONFLICT' });
    expect(
      rankRecoveryOptions(
        [option('OPTION-A')],
        {
          profileId: 'MISSING',
          tiers: CREATIVE_FIRST.tiers.slice(0, 6),
        },
        POLICY,
      ),
    ).toMatchObject({ decision: 'ESCALATE', escalationReason: 'PRIORITY_CONFLICT' });
    expect(
      rankRecoveryOptions(
        [option('OPTION-A')],
        {
          profileId: 'EMPTY-TIER',
          tiers: [{ metricIds: [] }, ...CREATIVE_FIRST.tiers],
        },
        POLICY,
      ),
    ).toMatchObject({ decision: 'ESCALATE', escalationReason: 'PRIORITY_CONFLICT' });
  });

  it('does not mutate the supplied options, profile, or policy', () => {
    const options = [OPTION_B, OPTION_A];
    const before = JSON.stringify({ options, profile: CREATIVE_FIRST, policy: POLICY });
    rankRecoveryOptions(options, CREATIVE_FIRST, POLICY);
    expect(JSON.stringify({ options, profile: CREATIVE_FIRST, policy: POLICY })).toBe(before);
  });
});

describe('recovery ranking boundary', () => {
  it('does not import engines or hidden authority and does not weight a total score', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    const forbidden = [
      /@sceneready\/shadow-simulation/,
      /@sceneready\/intervention-engine/,
      /@sceneready\/readiness-engine/,
      /@sceneready\/agent/,
      /Date\.now/,
      /Math\.random/,
      /randomUUID/,
      /\bfetch\s*\(/,
      /bedrock/i,
      /strands/i,
      /approvalToken/,
      /sendNotification/,
      /\bexecute\s*\(/,
      /OPTION-A/,
      /BCN-DEMO/,
      /weightedScore/,
      /readinessImprovement\s*\+/,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
  });
});
