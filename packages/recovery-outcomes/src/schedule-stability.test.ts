import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { evaluateScheduleStability as evaluateFromBarrel } from './index.js';
import {
  BOUND_SOURCE_INTERVENTION_CONTRACT,
  SCHEDULE_BOUND_MAXIMA,
  SCHEDULE_STABILITY_ALGORITHM_VERSION,
  SCHEDULE_STABILITY_ISSUES,
  evaluateScheduleStability,
  type ScheduleStabilityAvailable,
  type ScheduleStabilityResult,
} from './schedule-stability.js';

function activityTime(subjectId: string, deltaMinutes: number) {
  return { kind: 'ACTIVITY_TIME_CHANGED' as const, subjectId, deltaMinutes };
}

function personalCall(subjectId: string, deltaMinutes: number) {
  return { kind: 'PERSONAL_CALL_TIME_CHANGED' as const, subjectId, deltaMinutes };
}

function departure(subjectId: string, deltaMinutes: number) {
  return { kind: 'DEPARTURE_TIME_CHANGED' as const, subjectId, deltaMinutes };
}

function shortened(subjectId: string, minutes: number) {
  return { kind: 'ACTIVITY_SHORTENED' as const, subjectId, minutes };
}

function buffer(subjectId: string, minutes: number) {
  return { kind: 'BUFFER_ADDED' as const, subjectId, minutes };
}

function transferBuffer(subjectId: string, minutes: number) {
  return { kind: 'TRANSFER_BUFFER_INCREASED' as const, subjectId, minutes };
}

function reorder(subjectIds: readonly string[]) {
  return { kind: 'ACTIVITY_ORDER_CHANGED' as const, subjectIds };
}

function optionAEvents() {
  return [
    activityTime('ACT-GOTHIC-SETUP', -25),
    departure('ACT-DEPART-GOTHIC', -20),
    personalCall('PERSON-MODEL', -25),
    personalCall('PERSON-HMU', -25),
    personalCall('PERSON-PHOTO-ASSISTANT', -25),
  ];
}

function optionBEvents() {
  return [buffer('ACT-EIXAMPLE-SETUP', 10)];
}

function available(result: ScheduleStabilityResult): ScheduleStabilityAvailable {
  expect(result.status).toBe('AVAILABLE');
  if (result.status !== 'AVAILABLE') {
    throw new Error('expected an available schedule stability result');
  }
  return result;
}

function stabilityOf(events: unknown): number {
  return available(evaluateScheduleStability(events)).scheduleStability;
}

function issuesOf(events: unknown): readonly string[] {
  const result = evaluateScheduleStability(events);
  expect(result.status).toBe('WITHHELD');
  if (result.status !== 'WITHHELD') {
    throw new Error('expected a withheld schedule stability result');
  }
  expect(result).not.toHaveProperty('scheduleStability');
  expect(result.algorithmVersion).toBe(SCHEDULE_STABILITY_ALGORITHM_VERSION);
  expect(result.boundSource).toBe(BOUND_SOURCE_INTERVENTION_CONTRACT);
  return result.issues;
}

describe('evaluateScheduleStability canonical vectors', () => {
  it('scores an empty event set as 100', () => {
    expect(available(evaluateScheduleStability([]))).toEqual({
      status: 'AVAILABLE',
      algorithmVersion: 'SR-SCHEDULE-STABILITY-v1',
      boundSource: 'v1',
      scheduleStability: 100,
    });
  });

  it('scores canonical option A as 72 from the worst disturbance 25/90', () => {
    expect(stabilityOf(optionAEvents())).toBe(72);
  });

  it('scores canonical option B as 78 from a 10 minute buffer against 45', () => {
    expect(stabilityOf(optionBEvents())).toBe(78);
  });

  it('scores canonical option C as 100 from an empty event set', () => {
    expect(stabilityOf([])).toBe(100);
  });

  it('binds the accepted intervention maxima and does not invent a second table', () => {
    expect(SCHEDULE_BOUND_MAXIMA).toEqual({
      ACTIVITY_TIME_CHANGED: 120,
      PERSONAL_CALL_TIME_CHANGED: 90,
      DEPARTURE_TIME_CHANGED: 90,
      ACTIVITY_SHORTENED: 60,
      BUFFER_ADDED: 45,
      TRANSFER_BUFFER_INCREASED: 45,
    });
    expect(BOUND_SOURCE_INTERVENTION_CONTRACT).toBe('v1');
    expect(SCHEDULE_STABILITY_ALGORITHM_VERSION).toBe('SR-SCHEDULE-STABILITY-v1');
  });
});

describe('evaluateScheduleStability formula', () => {
  it('scores each accepted maximum disturbance as 0', () => {
    expect(stabilityOf([activityTime('ACT-A', 120)])).toBe(0);
    expect(stabilityOf([activityTime('ACT-A', -120)])).toBe(0);
    expect(stabilityOf([personalCall('PERSON-A', 90)])).toBe(0);
    expect(stabilityOf([personalCall('PERSON-A', -90)])).toBe(0);
    expect(stabilityOf([departure('ACT-MOVE', 90)])).toBe(0);
    expect(stabilityOf([departure('ACT-MOVE', -90)])).toBe(0);
    expect(stabilityOf([shortened('ACT-A', 60)])).toBe(0);
    expect(stabilityOf([buffer('ACT-A', 45)])).toBe(0);
    expect(stabilityOf([transferBuffer('ACT-MOVE', 45)])).toBe(0);
    expect(stabilityOf([reorder(['ACT-B', 'ACT-A'])])).toBe(0);
  });

  it('uses the worst disturbance rather than the sum', () => {
    const bufferAlone = stabilityOf([buffer('ACT-A', 10)]);
    const combined = stabilityOf([
      buffer('ACT-A', 10),
      activityTime('ACT-B', 24),
      personalCall('PERSON-A', -10),
    ]);

    expect(bufferAlone).toBe(78);
    expect(combined).toBe(78);
    expect(stabilityOf(optionAEvents())).toBe(72);
  });

  it('rounds a half and a sub-half away from truncation toward zero', () => {
    expect(stabilityOf([activityTime('ACT-A', 117)])).toBe(3);
    expect(stabilityOf([activityTime('ACT-A', 119)])).toBe(1);
  });

  it('accepts a positive in-bound minute below the intervention schema minimum', () => {
    expect(stabilityOf([buffer('ACT-A', 1)])).toBe(98);
  });

  it('dedupes an exact duplicate and still scores the single disturbance', () => {
    expect(stabilityOf([...optionAEvents(), ...optionAEvents()])).toBe(72);
    expect(stabilityOf([buffer('ACT-A', 10), buffer('ACT-A', 10)])).toBe(78);
    expect(stabilityOf([reorder(['ACT-B', 'ACT-A']), reorder(['ACT-B', 'ACT-A'])])).toBe(0);
  });
});

describe('evaluateScheduleStability determinism', () => {
  it('is invariant to input order and repeats', () => {
    const forward = evaluateScheduleStability(optionAEvents());
    const reversed = evaluateScheduleStability([...optionAEvents()].reverse());
    const repeated = evaluateScheduleStability(optionAEvents());

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(forward));
    expect(stabilityOf([...optionBEvents()].reverse())).toBe(78);
  });

  it('does not read option identity', () => {
    const tagged = optionAEvents().map((event) => ({ ...event, optionId: 'OPTION-A' }));
    expect(stabilityOf(tagged)).toBe(stabilityOf(optionAEvents()));
  });

  it('freezes the output and does not mutate the input', () => {
    const events = optionAEvents();
    const before = JSON.stringify(events);
    for (const event of events) {
      Object.freeze(event);
    }
    Object.freeze(events);

    const result = available(evaluateScheduleStability(events));

    expect(JSON.stringify(events)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(evaluateFromBarrel).toBe(evaluateScheduleStability);
  });
});

describe('evaluateScheduleStability fail closed', () => {
  it('withholds a zero-minute declared change', () => {
    expect(issuesOf([activityTime('ACT-A', 0)])).toEqual(['ZERO_CHANGE']);
    expect(issuesOf([personalCall('PERSON-A', 0)])).toEqual(['ZERO_CHANGE']);
    expect(issuesOf([departure('ACT-MOVE', 0)])).toEqual(['ZERO_CHANGE']);
    expect(issuesOf([shortened('ACT-A', 0)])).toEqual(['ZERO_CHANGE']);
    expect(issuesOf([buffer('ACT-A', 0)])).toEqual(['ZERO_CHANGE']);
    expect(issuesOf([transferBuffer('ACT-MOVE', 0)])).toEqual(['ZERO_CHANGE']);
  });

  it('withholds a numeric change past the accepted primitive maximum', () => {
    expect(issuesOf([activityTime('ACT-A', 121)])).toEqual(['OUT_OF_BOUND']);
    expect(issuesOf([activityTime('ACT-A', -121)])).toEqual(['OUT_OF_BOUND']);
    expect(issuesOf([personalCall('PERSON-A', 91)])).toEqual(['OUT_OF_BOUND']);
    expect(issuesOf([departure('ACT-MOVE', -91)])).toEqual(['OUT_OF_BOUND']);
    expect(issuesOf([shortened('ACT-A', 61)])).toEqual(['OUT_OF_BOUND']);
    expect(issuesOf([buffer('ACT-A', 46)])).toEqual(['OUT_OF_BOUND']);
    expect(issuesOf([buffer('ACT-A', -1)])).toEqual(['OUT_OF_BOUND']);
    expect(issuesOf([transferBuffer('ACT-MOVE', 46)])).toEqual(['OUT_OF_BOUND']);
  });

  it('withholds an empty or malformed subject id', () => {
    expect(issuesOf([activityTime('', -25)])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(issuesOf([activityTime('ab', -25)])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(issuesOf([personalCall('person-model', -25)])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(issuesOf([buffer('  ACT-A', 10)])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(
      issuesOf([{ kind: 'DEPARTURE_TIME_CHANGED', subjectId: null, deltaMinutes: -20 }]),
    ).toEqual(['MALFORMED_SUBJECT_ID']);
  });

  it('withholds a reorder with fewer than two valid subject ids', () => {
    expect(issuesOf([reorder(['ACT-A'])])).toEqual(['REORDER_TOO_SHORT']);
    expect(issuesOf([reorder([])])).toEqual(['REORDER_TOO_SHORT']);
    expect(issuesOf([{ kind: 'ACTIVITY_ORDER_CHANGED', subjectIds: 'ACT-A' }])).toEqual([
      'MALFORMED_EVENT',
    ]);
  });

  it('withholds non-integers, conflicts, and malformed events without throwing', () => {
    expect(() => evaluateScheduleStability(null)).not.toThrow();
    expect(issuesOf(null)).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([{ kind: 'NOT_A_KIND' }])).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([activityTime('ACT-A', 1.5)])).toEqual(['NON_INTEGER_CHANGE']);
    expect(issuesOf([{ kind: 'BUFFER_ADDED', subjectId: 'ACT-A' }])).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([activityTime('ACT-A', -25), activityTime('ACT-A', -30)])).toEqual([
      'CONFLICTING_EVENT',
    ]);
    expect(issuesOf([reorder(['ACT-A', 'ACT-A'])])).toEqual(['MALFORMED_EVENT']);
  });

  it('collects every applicable issue code and freezes the withheld result', () => {
    const issues = issuesOf([
      null,
      { kind: 'UNKNOWN' },
      { kind: 'ACTIVITY_TIME_CHANGED', subjectId: '', deltaMinutes: 1.5 },
      { kind: 'ACTIVITY_TIME_CHANGED', subjectId: 'ACT-A' },
      activityTime('ACT-B', 0),
      activityTime('ACT-B', -15),
      buffer('ACT-C', 46),
      reorder(['ACT-D']),
    ]);

    expect(issues).toEqual([...SCHEDULE_STABILITY_ISSUES]);
    const withheld = evaluateScheduleStability([activityTime('ACT-A', 0)]);
    expect(Object.isFrozen(withheld)).toBe(true);
    if (withheld.status === 'WITHHELD') {
      expect(Object.isFrozen(withheld.issues)).toBe(true);
    }
  });
});

describe('schedule stability source boundary', () => {
  it('does not hardcode canonical scores or reach outside the pure package', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    const forbidden = [
      /\b72\b/,
      /\b78\b/,
      /OPTION-[ABC]/,
      /ACT-GOTHIC/,
      /ACT-EIXAMPLE/,
      /ACT-DEPART/,
      /PERSON-MODEL/,
      /Math\.round/,
      /Math\.random/,
      /Date\.now/,
      /randomUUID/,
      /\bfetch\s*\(/,
      /process\.env/,
      /node:fs/,
      /bedrock/i,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
  });
});
