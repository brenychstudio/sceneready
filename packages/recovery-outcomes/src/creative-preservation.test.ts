import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CREATIVE_PRESERVATION_ALGORITHM_VERSION,
  CREATIVE_PRESERVATION_ISSUES,
  evaluateCreativePreservation,
  type CreativePreservationAvailable,
  type CreativePreservationResult,
} from './creative-preservation.js';
import { evaluateCreativePreservation as evaluateFromBarrel } from './index.js';

const GOTHIC = 'ENVELOPE-GOTHIC-LOOK';
const EIXAMPLE = 'ENVELOPE-EIXAMPLE-LOOK';

function look(
  activityId: string,
  envelopeId: string,
  envelopeImportance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  startScore: number,
  endScore: number,
) {
  return { activityId, envelopeId, envelopeImportance, startScore, endScore };
}

function risk(riskId: string, subjectId: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') {
  return { riskId, subjectId, severity };
}

const CANONICAL_LOOKS = [
  look('ACT-GOTHIC-LOOK-01', GOTHIC, 'CRITICAL', 92, 88),
  look('ACT-GOTHIC-LOOK-02', GOTHIC, 'CRITICAL', 76, 81),
  look('ACT-GOTHIC-LOOK-03', GOTHIC, 'CRITICAL', 60, 77),
  look('ACT-EIXAMPLE-LOOK-04', EIXAMPLE, 'HIGH', 100, 100),
  look('ACT-EIXAMPLE-LOOK-05', EIXAMPLE, 'HIGH', 93, 88),
];

const LIVE_RISKS = [
  risk('RISK-GOTHIC-LOOK-03', 'ACT-GOTHIC-LOOK-03', 'CRITICAL'),
  risk('RISK-EIXAMPLE-LOOK-05', 'ACT-EIXAMPLE-LOOK-05', 'HIGH'),
];

const OPTION_A_RISKS = [risk('RISK-EIXAMPLE-LOOK-05', 'ACT-EIXAMPLE-LOOK-05', 'HIGH')];

function available(result: CreativePreservationResult): CreativePreservationAvailable {
  expect(result.status).toBe('AVAILABLE');
  if (result.status !== 'AVAILABLE') {
    throw new Error('expected an available creative preservation result');
  }
  return result;
}

function issuesOf(input: unknown): readonly string[] {
  const result = evaluateCreativePreservation(input);
  expect(result.status).toBe('WITHHELD');
  if (result.status !== 'WITHHELD') {
    throw new Error('expected a withheld creative preservation result');
  }
  expect(result).not.toHaveProperty('creativePreservation');
  expect(result).not.toHaveProperty('staticEnvelopeQuality');
  expect(result.algorithmVersion).toBe(CREATIVE_PRESERVATION_ALGORITHM_VERSION);
  return result.issues;
}

describe('evaluateCreativePreservation canonical vectors', () => {
  it('derives live, buffer-only, and empty preservation as 59 with static quality 82', () => {
    const live = available(
      evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: LIVE_RISKS }),
    );
    const bufferOnly = available(
      evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: LIVE_RISKS }),
    );
    const emptyOption = available(
      evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: LIVE_RISKS }),
    );

    expect(live.creativePreservation).toBe(59);
    expect(bufferOnly.creativePreservation).toBe(59);
    expect(emptyOption.creativePreservation).toBe(59);
    expect(live.staticEnvelopeQuality).toBe(82);
    expect(live.finalQuotient).toEqual({ numerator: 176, denominator: 3 });
    expect(live.staticQuotient).toEqual({ numerator: 412, denominator: 5 });
    expect(live.algorithmVersion).toBe('SR-CREATIVE-PRESERVATION-v1');
    expect(live.boundSourceScoringVersion).toBe('SR-SCORE-v1');
    expect(live.envelopes).toEqual([
      {
        envelopeId: EIXAMPLE,
        envelopeImportance: 'HIGH',
        envelopeScore: { numerator: 194, denominator: 3 },
      },
      {
        envelopeId: GOTHIC,
        envelopeImportance: 'CRITICAL',
        envelopeScore: { numerator: 164, denominator: 3 },
      },
    ]);
    expect(JSON.stringify(bufferOnly)).toBe(JSON.stringify(live));
    expect(JSON.stringify(emptyOption)).toBe(JSON.stringify(live));
  });

  it('derives the direct-risk removal case as 71 without changing static quality', () => {
    const preserved = available(
      evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: OPTION_A_RISKS }),
    );

    expect(preserved.creativePreservation).toBe(71);
    expect(preserved.staticEnvelopeQuality).toBe(82);
    expect(preserved.finalQuotient).toEqual({ numerator: 212, denominator: 3 });
    expect(preserved.staticQuotient).toEqual({ numerator: 412, denominator: 5 });
    expect(preserved.envelopes).toEqual([
      {
        envelopeId: EIXAMPLE,
        envelopeImportance: 'HIGH',
        envelopeScore: { numerator: 194, denominator: 3 },
      },
      {
        envelopeId: GOTHIC,
        envelopeImportance: 'CRITICAL',
        envelopeScore: { numerator: 224, denominator: 3 },
      },
    ]);
  });

  it('uses the look floor and keeps survival fractions unsimplified', () => {
    const live = available(
      evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: LIVE_RISKS }),
    );
    const byActivity = new Map(live.looks.map((item) => [item.activityId, item]));

    expect(byActivity.get('ACT-GOTHIC-LOOK-01')).toMatchObject({
      lookFloor: 88,
      directRiskSeverity: null,
      survivalNumerator: 1,
      survivalDenominator: 1,
      operationalLookValue: { numerator: 88, denominator: 1 },
    });
    expect(byActivity.get('ACT-GOTHIC-LOOK-02')).toMatchObject({
      lookFloor: 76,
      directRiskSeverity: null,
      operationalLookValue: { numerator: 76, denominator: 1 },
    });
    expect(byActivity.get('ACT-GOTHIC-LOOK-03')).toMatchObject({
      lookFloor: 60,
      directRiskSeverity: 'CRITICAL',
      survivalNumerator: 0,
      survivalDenominator: 6,
      operationalLookValue: { numerator: 0, denominator: 1 },
    });
    expect(byActivity.get('ACT-EIXAMPLE-LOOK-04')).toMatchObject({
      lookFloor: 100,
      directRiskSeverity: null,
      operationalLookValue: { numerator: 100, denominator: 1 },
    });
    expect(byActivity.get('ACT-EIXAMPLE-LOOK-05')).toMatchObject({
      lookFloor: 88,
      directRiskSeverity: 'HIGH',
      survivalNumerator: 2,
      survivalDenominator: 6,
      operationalLookValue: { numerator: 88, denominator: 3 },
    });
  });

  it('zeroes only the direct critical look', () => {
    const live = available(
      evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: LIVE_RISKS }),
    );
    const cleared = available(
      evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: OPTION_A_RISKS }),
    );
    const liveGothic = live.looks.find((item) => item.activityId === 'ACT-GOTHIC-LOOK-03');
    const clearedGothic = cleared.looks.find((item) => item.activityId === 'ACT-GOTHIC-LOOK-03');
    const untouched = cleared.looks.find((item) => item.activityId === 'ACT-GOTHIC-LOOK-01');

    expect(liveGothic?.operationalLookValue).toEqual({ numerator: 0, denominator: 1 });
    expect(clearedGothic).toMatchObject({
      directRiskSeverity: null,
      survivalNumerator: 1,
      survivalDenominator: 1,
      operationalLookValue: { numerator: 60, denominator: 1 },
    });
    expect(untouched?.operationalLookValue).toEqual({ numerator: 88, denominator: 1 });
  });
});

describe('evaluateCreativePreservation direct risk rules', () => {
  it('ignores an unrelated studio subject and an indirect schedule successor', () => {
    const live = evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: LIVE_RISKS });
    const widened = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: [
        ...LIVE_RISKS,
        risk('RISK-STUDIO-LOAD-IN', 'ACT-STUDIO-LOAD-IN', 'MEDIUM'),
        risk('RISK-SCHEDULE-SUCCESSOR', 'ACT-EIXAMPLE-SETUP', 'CRITICAL'),
      ],
    });

    expect(JSON.stringify(widened)).toBe(JSON.stringify(live));
  });

  it('uses the worst direct severity once', () => {
    const criticalOnly = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: LIVE_RISKS,
    });
    const worstOfMany = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: [
        risk('RISK-GOTHIC-LOW', 'ACT-GOTHIC-LOOK-03', 'LOW'),
        risk('RISK-GOTHIC-LOOK-03', 'ACT-GOTHIC-LOOK-03', 'CRITICAL'),
        risk('RISK-EIXAMPLE-LOOK-05', 'ACT-EIXAMPLE-LOOK-05', 'HIGH'),
        risk('RISK-EIXAMPLE-MEDIUM', 'ACT-EIXAMPLE-LOOK-05', 'MEDIUM'),
      ],
    });
    const lowOnly = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: [
        risk('RISK-GOTHIC-LOW', 'ACT-GOTHIC-LOOK-03', 'LOW'),
        risk('RISK-EIXAMPLE-LOOK-05', 'ACT-EIXAMPLE-LOOK-05', 'HIGH'),
      ],
    });

    expect(JSON.stringify(worstOfMany)).toBe(JSON.stringify(criticalOnly));
    expect(JSON.stringify(lowOnly)).not.toBe(JSON.stringify(criticalOnly));
  });

  it('does not let a duplicate risk multiply the penalty', () => {
    const once = evaluateCreativePreservation({ looks: CANONICAL_LOOKS, risks: LIVE_RISKS });
    const duplicated = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: [LIVE_RISKS[0], LIVE_RISKS[0], LIVE_RISKS[1], { ...LIVE_RISKS[1] }],
    });
    const sameSeverityDifferentId = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: [...LIVE_RISKS, risk('RISK-GOTHIC-LOOK-03-COPY', 'ACT-GOTHIC-LOOK-03', 'CRITICAL')],
    });

    expect(JSON.stringify(duplicated)).toBe(JSON.stringify(once));
    expect(JSON.stringify(sameSeverityDifferentId)).toBe(JSON.stringify(once));
  });

  it('keeps a medium survival fraction at 4/6', () => {
    const result = available(
      evaluateCreativePreservation({
        looks: [look('LOOK-M', 'ENVELOPE-M', 'LOW', 60, 90)],
        risks: [risk('RISK-M', 'LOOK-M', 'MEDIUM')],
      }),
    );

    expect(result.looks[0]).toMatchObject({
      lookFloor: 60,
      directRiskSeverity: 'MEDIUM',
      survivalNumerator: 4,
      survivalDenominator: 6,
    });
  });

  it('rounds one half away from zero to 1', () => {
    const result = available(
      evaluateCreativePreservation({
        looks: [
          look('LOOK-0', 'ENVELOPE-LOW', 'LOW', 0, 5),
          look('LOOK-1', 'ENVELOPE-LOW', 'LOW', 4, 1),
        ],
        risks: [],
      }),
    );

    expect(result.finalQuotient).toEqual({ numerator: 1, denominator: 2 });
    expect(result.creativePreservation).toBe(1);
    expect(result.staticEnvelopeQuality).toBe(1);
  });
});

describe('evaluateCreativePreservation determinism', () => {
  it('is input-order invariant and repeats byte-equivalent output', () => {
    const forward = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: LIVE_RISKS,
    });
    const reversed = evaluateCreativePreservation({
      looks: [...CANONICAL_LOOKS].reverse(),
      risks: [...LIVE_RISKS].reverse(),
    });
    const repeated = evaluateCreativePreservation({
      looks: CANONICAL_LOOKS,
      risks: LIVE_RISKS,
    });

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(forward));
  });

  it('freezes the output and does not mutate a frozen input', () => {
    const input = {
      looks: CANONICAL_LOOKS.map((item) => ({ ...item })),
      risks: LIVE_RISKS.map((item) => ({ ...item })),
      ignored: true,
    };
    const before = JSON.stringify(input);
    Object.freeze(input.looks);
    Object.freeze(input.risks);
    for (const item of input.looks) {
      Object.freeze(item);
    }
    for (const item of input.risks) {
      Object.freeze(item);
    }
    Object.freeze(input);

    const result = available(evaluateCreativePreservation(input));

    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.looks)).toBe(true);
    expect(Object.isFrozen(result.looks[0])).toBe(true);
    expect(Object.isFrozen(result.looks[0]?.operationalLookValue)).toBe(true);
    expect(Object.isFrozen(result.envelopes)).toBe(true);
    expect(Object.isFrozen(result.finalQuotient)).toBe(true);
    expect(Object.isFrozen(result.staticQuotient)).toBe(true);
    expect(evaluateFromBarrel).toBe(evaluateCreativePreservation);
  });
});

describe('evaluateCreativePreservation fail closed', () => {
  const validLook = look('LOOK-A', 'ENVELOPE-A', 'LOW', 10, 20);

  it('withholds an empty look set', () => {
    expect(issuesOf({ looks: [], risks: [] })).toEqual(['EMPTY_LOOK_SET']);
  });

  it('withholds malformed input without throwing', () => {
    expect(() => evaluateCreativePreservation(null)).not.toThrow();
    expect(issuesOf(null)).toEqual(['MALFORMED_INPUT']);
    expect(issuesOf([])).toEqual(['MALFORMED_INPUT']);
    expect(issuesOf({ looks: 'no', risks: [] })).toEqual(['MALFORMED_INPUT']);
    expect(issuesOf({ looks: [], risks: 'no' })).toEqual(['EMPTY_LOOK_SET', 'MALFORMED_INPUT']);
  });

  it('withholds a missing score', () => {
    expect(issuesOf({ looks: [{ ...validLook, startScore: undefined }], risks: [] })).toEqual([
      'MISSING_SCORE',
    ]);
    expect(issuesOf({ looks: [{ ...validLook, endScore: null }], risks: [] })).toEqual([
      'MISSING_SCORE',
    ]);
  });

  it('withholds a non-integer score and an out-of-range score separately', () => {
    expect(issuesOf({ looks: [{ ...validLook, startScore: 10.5 }], risks: [] })).toEqual([
      'NON_INTEGER_SCORE',
    ]);
    expect(issuesOf({ looks: [{ ...validLook, startScore: Number.NaN }], risks: [] })).toEqual([
      'NON_INTEGER_SCORE',
    ]);
    expect(issuesOf({ looks: [{ ...validLook, endScore: 101 }], risks: [] })).toEqual([
      'SCORE_OUT_OF_RANGE',
    ]);
    expect(issuesOf({ looks: [{ ...validLook, endScore: 150.5 }], risks: [] })).toEqual([
      'NON_INTEGER_SCORE',
      'SCORE_OUT_OF_RANGE',
    ]);
  });

  it('withholds invalid importance, duplicate activities, and envelope conflicts', () => {
    expect(
      issuesOf({
        looks: [{ ...validLook, envelopeImportance: 'NONE' }],
        risks: [],
      }),
    ).toEqual(['INVALID_IMPORTANCE']);
    expect(
      issuesOf({
        looks: [validLook, { ...validLook }],
        risks: [],
      }),
    ).toEqual(['DUPLICATE_ACTIVITY_ID']);
    expect(
      issuesOf({
        looks: [validLook, { ...validLook, envelopeId: 'ENVELOPE-B' }],
        risks: [],
      }),
    ).toEqual(['CONFLICTING_ENVELOPE_ID', 'DUPLICATE_ACTIVITY_ID']);
    expect(
      issuesOf({
        looks: [validLook, look('LOOK-B', 'ENVELOPE-A', 'HIGH', 10, 10)],
        risks: [],
      }),
    ).toEqual(['CONFLICTING_ENVELOPE_IMPORTANCE']);
  });

  it('withholds malformed and conflicting risks', () => {
    expect(
      issuesOf({
        looks: [validLook],
        risks: [{ riskId: 'RISK-1', subjectId: 'LOOK-A', severity: 'NONE' }],
      }),
    ).toEqual(['INVALID_RISK_SEVERITY']);
    expect(
      issuesOf({
        looks: [validLook],
        risks: [{ riskId: '', subjectId: 'LOOK-A', severity: 'LOW' }],
      }),
    ).toEqual(['MALFORMED_RISK_ID']);
    expect(
      issuesOf({
        looks: [validLook],
        risks: [{ riskId: 'RISK-1', subjectId: '', severity: 'LOW' }],
      }),
    ).toEqual(['MALFORMED_RISK_SUBJECT_ID']);
    expect(
      issuesOf({
        looks: [validLook],
        risks: [
          { riskId: 'RISK-1', subjectId: 'LOOK-A', severity: 'LOW' },
          { riskId: 'RISK-1', subjectId: 'LOOK-A', severity: 'HIGH' },
        ],
      }),
    ).toEqual(['CONFLICTING_RISK']);
    expect(issuesOf({ looks: [{ ...validLook, activityId: '' }], risks: [] })).toEqual([
      'MALFORMED_ACTIVITY_ID',
    ]);
    expect(issuesOf({ looks: [{ ...validLook, envelopeId: 4 }], risks: [] })).toEqual([
      'MALFORMED_ENVELOPE_ID',
    ]);
  });

  it('collects every applicable issue code before returning', () => {
    const issues = issuesOf({
      looks: [
        null,
        {
          activityId: '',
          envelopeId: '',
          envelopeImportance: 'NONE',
          startScore: null,
          endScore: 1.5,
        },
        look('LOOK-A', 'ENVELOPE-1', 'LOW', 101, -1),
        look('LOOK-A', 'ENVELOPE-2', 'HIGH', 10, 10),
        look('LOOK-B', 'ENVELOPE-1', 'CRITICAL', 150.5, 10),
      ],
      risks: [
        null,
        { riskId: '', subjectId: '', severity: 'NONE' },
        { riskId: 'RISK-1', subjectId: 'LOOK-A', severity: 'LOW' },
        { riskId: 'RISK-1', subjectId: 'LOOK-B', severity: 'HIGH' },
        { riskId: 'RISK-2', subjectId: 4, severity: 'LOW' },
      ],
    });
    const empty = issuesOf({ looks: [], risks: [] });
    const seen = [...new Set([...issues, ...empty])].sort();

    expect(issues).toEqual([
      'CONFLICTING_ENVELOPE_ID',
      'CONFLICTING_ENVELOPE_IMPORTANCE',
      'CONFLICTING_RISK',
      'DUPLICATE_ACTIVITY_ID',
      'INVALID_IMPORTANCE',
      'INVALID_RISK_SEVERITY',
      'MALFORMED_ACTIVITY_ID',
      'MALFORMED_ENVELOPE_ID',
      'MALFORMED_INPUT',
      'MALFORMED_RISK_ID',
      'MALFORMED_RISK_SUBJECT_ID',
      'MISSING_SCORE',
      'NON_INTEGER_SCORE',
      'SCORE_OUT_OF_RANGE',
    ]);
    expect(seen).toEqual([...CREATIVE_PRESERVATION_ISSUES]);
    expect(Object.isFrozen(evaluateCreativePreservation({ looks: [], risks: [] }))).toBe(true);
  });
});

describe('recovery outcome source boundary', () => {
  it('stays free of engines, clocks, randomness, network, authority, and canonical literals', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    const forbidden = [
      /bedrock/i,
      /\bfetch\s*\(/,
      /Date\.now/,
      /Math\.random/,
      /Math\.round/,
      /randomUUID/,
      /approvalToken/,
      /\bapprove\b/i,
      /executeProduction/,
      /sendNotification/,
      /mutateProduction/,
      /node:fs/,
      /node:http/,
      /process\.env/,
      /@sceneready\/(?:agent|domain|evidence|intervention-engine|production-graph|readiness-engine|recovery-ranking|shadow-simulation|solar-engine)/,
      /\b59\b/,
      /\b71\b/,
      /\b82\b/,
      /OPTION-[ABC]/,
      /ACT-GOTHIC/,
      /ACT-EIXAMPLE/,
      /ACT-STUDIO/,
      /ENVELOPE-GOTHIC/,
      /ENVELOPE-EIXAMPLE/,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
  });
});
