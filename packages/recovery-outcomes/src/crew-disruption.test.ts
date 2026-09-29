import { describe, expect, it } from 'vitest';

import {
  CREW_DISRUPTION_ALGORITHM_VERSION,
  CREW_DISRUPTION_ISSUES,
  CREW_EVENT_KINDS,
  CREW_LEVELS,
  evaluateCrewDisruption,
  type CrewDisruptionAvailable,
  type CrewDisruptionResult,
} from './crew-disruption.js';
import { evaluateCrewDisruption as evaluateFromBarrel } from './index.js';

const DEPARTURE_PEOPLE = [
  'PERSON-DIGITAL-TECH',
  'PERSON-HMU',
  'PERSON-MODEL',
  'PERSON-MOTION-OPERATOR',
  'PERSON-PHOTO-ASSISTANT',
  'PERSON-PRODUCTION-ASSISTANT',
  'PERSON-PRODUCTION-LEAD',
  'PERSON-STYLIST',
];

function call(personId: string, deltaMinutes: number) {
  return { kind: 'PERSONAL_CALL_TIME_CHANGED' as const, personId, deltaMinutes };
}

function sharedActivity(affectedPersonIds: readonly string[], deltaMinutes = -25) {
  return {
    kind: 'SHARED_ACTIVITY_TIME_CHANGED' as const,
    activityId: 'ACT-GOTHIC-SETUP',
    deltaMinutes,
    affectedPersonIds,
  };
}

function sharedDeparture(affectedPersonIds: readonly string[], deltaMinutes = -20) {
  return {
    kind: 'SHARED_DEPARTURE_TIME_CHANGED' as const,
    activityId: 'ACT-DEPART-GOTHIC',
    deltaMinutes,
    affectedPersonIds,
  };
}

function optionAEvents() {
  return [
    sharedActivity([
      'PERSON-PRODUCTION-LEAD',
      'PERSON-PHOTO-ASSISTANT',
      'PERSON-DIGITAL-TECH',
      'PERSON-PRODUCTION-ASSISTANT',
    ]),
    sharedDeparture([...DEPARTURE_PEOPLE].reverse()),
    call('PERSON-MODEL', -25),
    call('PERSON-HMU', -25),
    call('PERSON-PHOTO-ASSISTANT', -25),
  ];
}

function available(result: CrewDisruptionResult): CrewDisruptionAvailable {
  expect(result.status).toBe('AVAILABLE');
  if (result.status !== 'AVAILABLE') {
    throw new Error('expected an available crew disruption result');
  }
  return result;
}

function issuesOf(events: unknown): readonly string[] {
  const result = evaluateCrewDisruption(events);
  expect(result.status).toBe('WITHHELD');
  if (result.status !== 'WITHHELD') {
    throw new Error('expected a withheld crew disruption result');
  }
  expect(result).not.toHaveProperty('level');
  expect(result.algorithmVersion).toBe(CREW_DISRUPTION_ALGORITHM_VERSION);
  return result.issues;
}

describe('evaluateCrewDisruption classification', () => {
  it('classifies an empty event list as NONE', () => {
    expect(available(evaluateCrewDisruption([]))).toEqual({
      status: 'AVAILABLE',
      algorithmVersion: 'SR-CREW-DISRUPTION-v1',
      level: 'NONE',
      affectedPersonIds: [],
      eventKinds: [],
    });
  });

  it('classifies one personal call as LOW and two as MEDIUM', () => {
    expect(available(evaluateCrewDisruption([call('PERSON-MODEL', -25)])).level).toBe('LOW');
    expect(
      available(evaluateCrewDisruption([call('PERSON-HMU', -25), call('PERSON-MODEL', 15)])).level,
    ).toBe('MEDIUM');
  });

  it('classifies a shared activity or departure move as HIGH', () => {
    expect(available(evaluateCrewDisruption([sharedActivity(['PERSON-MODEL'])])).level).toBe(
      'HIGH',
    );
    expect(available(evaluateCrewDisruption([sharedDeparture(['PERSON-STYLIST'])])).level).toBe(
      'HIGH',
    );
  });

  it('classifies location, order, reverification, and backup duty as CRITICAL', () => {
    expect(
      available(
        evaluateCrewDisruption([{ kind: 'LOCATION_CHANGED', affectedPersonIds: ['PERSON-MODEL'] }]),
      ).level,
    ).toBe('CRITICAL');
    expect(
      available(
        evaluateCrewDisruption([
          {
            kind: 'ACTIVITY_ORDER_CHANGED',
            activityIds: ['ACT-B', 'ACT-A'],
            affectedPersonIds: ['PERSON-Z', 'PERSON-A'],
          },
        ]),
      ),
    ).toMatchObject({
      level: 'CRITICAL',
      affectedPersonIds: ['PERSON-A', 'PERSON-Z'],
      eventKinds: ['ACTIVITY_ORDER_CHANGED'],
    });
    expect(
      available(
        evaluateCrewDisruption([
          { kind: 'REVERIFICATION_DUTY_ADDED', affectedPersonIds: ['PERSON-HMU'] },
        ]),
      ).level,
    ).toBe('CRITICAL');
    expect(
      available(
        evaluateCrewDisruption([
          { kind: 'BACKUP_OPERATOR_DUTY_ADDED', affectedPersonIds: ['PERSON-DIGITAL-TECH'] },
        ]),
      ).level,
    ).toBe('CRITICAL');
  });

  it('keeps the highest class', () => {
    const sharedAndCalls = available(
      evaluateCrewDisruption([
        call('PERSON-MODEL', -25),
        call('PERSON-HMU', -25),
        sharedActivity(['PERSON-MODEL']),
      ]),
    );
    const sharedAndLocation = available(
      evaluateCrewDisruption([
        sharedDeparture(['PERSON-MODEL']),
        { kind: 'LOCATION_CHANGED', affectedPersonIds: ['PERSON-STYLIST'] },
      ]),
    );

    expect(sharedAndCalls.level).toBe('HIGH');
    expect(sharedAndLocation.level).toBe('CRITICAL');
  });

  it('classifies the canonical shared-move case as HIGH and buffer-only or empty cases as NONE', () => {
    const optionA = available(evaluateCrewDisruption(optionAEvents()));
    const optionB = available(evaluateCrewDisruption([]));
    const optionC = available(evaluateCrewDisruption([]));

    expect(optionA.level).toBe('HIGH');
    expect(optionA.affectedPersonIds).toEqual(DEPARTURE_PEOPLE);
    expect(optionA.eventKinds).toEqual([
      'PERSONAL_CALL_TIME_CHANGED',
      'SHARED_ACTIVITY_TIME_CHANGED',
      'SHARED_DEPARTURE_TIME_CHANGED',
    ]);
    expect(optionB.level).toBe('NONE');
    expect(optionC.level).toBe('NONE');
  });
});

describe('evaluateCrewDisruption determinism', () => {
  it('sorts people and kinds, dedupes exact events, and repeats', () => {
    const duplicated = [
      call('PERSON-PHOTO-ASSISTANT', -25),
      call('PERSON-PHOTO-ASSISTANT', -25),
      sharedActivity(['PERSON-PHOTO-ASSISTANT', 'PERSON-PHOTO-ASSISTANT', 'PERSON-MODEL']),
    ];
    const forward = available(evaluateCrewDisruption(optionAEvents()));
    const reversed = available(evaluateCrewDisruption([...optionAEvents()].reverse()));
    const repeated = available(evaluateCrewDisruption(optionAEvents()));
    const deduped = available(evaluateCrewDisruption(duplicated));

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(forward));
    expect(deduped).toMatchObject({
      level: 'HIGH',
      affectedPersonIds: ['PERSON-MODEL', 'PERSON-PHOTO-ASSISTANT'],
      eventKinds: ['PERSONAL_CALL_TIME_CHANGED', 'SHARED_ACTIVITY_TIME_CHANGED'],
    });
    expect([...CREW_EVENT_KINDS].join()).toBe([...CREW_EVENT_KINDS].sort().join());
    expect([...CREW_LEVELS]).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });

  it('freezes the output and does not mutate a frozen input', () => {
    const events = optionAEvents();
    const before = JSON.stringify(events);
    for (const event of events) {
      Object.freeze(event);
      if ('affectedPersonIds' in event) {
        Object.freeze(event.affectedPersonIds);
      }
    }
    Object.freeze(events);

    const result = available(evaluateCrewDisruption(events));

    expect(JSON.stringify(events)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.affectedPersonIds)).toBe(true);
    expect(Object.isFrozen(result.eventKinds)).toBe(true);
    expect(evaluateFromBarrel).toBe(evaluateCrewDisruption);
  });
});

describe('evaluateCrewDisruption fail closed', () => {
  it('withholds a zero delta', () => {
    expect(issuesOf([call('PERSON-MODEL', 0)])).toEqual(['ZERO_DELTA']);
    expect(issuesOf([sharedDeparture(['PERSON-MODEL'], 0)])).toEqual(['ZERO_DELTA']);
  });

  it('withholds malformed events and conflicting identities', () => {
    expect(() => evaluateCrewDisruption(null)).not.toThrow();
    expect(issuesOf(null)).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([{ kind: 'NOT_A_KIND' }])).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([call('', -5)])).toEqual(['MALFORMED_PERSON_ID']);
    expect(issuesOf([{ kind: 'PERSONAL_CALL_TIME_CHANGED', personId: 'PERSON-A' }])).toEqual([
      'MISSING_DELTA',
    ]);
    expect(issuesOf([call('PERSON-A', 1.5)])).toEqual(['NON_INTEGER_DELTA']);
    expect(issuesOf([sharedActivity([])])).toEqual(['EMPTY_AFFECTED_PERSON_IDS']);
    expect(issuesOf([call('PERSON-A', -5), call('PERSON-A', -10)])).toEqual(['CONFLICTING_EVENT']);
    expect(
      issuesOf([
        { kind: 'LOCATION_CHANGED', affectedPersonIds: ['PERSON-A'] },
        { kind: 'LOCATION_CHANGED', affectedPersonIds: ['PERSON-B'] },
      ]),
    ).toEqual(['CONFLICTING_EVENT']);
  });

  it('collects every applicable issue code before returning', () => {
    const issues = issuesOf([
      null,
      { kind: 'UNKNOWN' },
      { kind: 'PERSONAL_CALL_TIME_CHANGED', personId: '', deltaMinutes: 1.5 },
      { kind: 'PERSONAL_CALL_TIME_CHANGED', personId: 'PERSON-A' },
      call('PERSON-B', 0),
      call('PERSON-B', -15),
      sharedActivity([], -10),
      sharedActivity(['PERSON-C'], -10),
      sharedActivity(['PERSON-D'], -20),
    ]);

    expect(issues).toEqual([...CREW_DISRUPTION_ISSUES]);
    const withheld = evaluateCrewDisruption([call('PERSON-A', 0)]);
    expect(Object.isFrozen(withheld)).toBe(true);
    if (withheld.status === 'WITHHELD') {
      expect(Object.isFrozen(withheld.issues)).toBe(true);
    }
  });
});
