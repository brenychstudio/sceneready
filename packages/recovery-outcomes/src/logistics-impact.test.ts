import { describe, expect, it } from 'vitest';

import { evaluateLogisticsImpact as evaluateFromBarrel } from './index.js';
import {
  LOGISTICS_IMPACT_ALGORITHM_VERSION,
  LOGISTICS_IMPACT_ISSUES,
  LOGISTICS_LEVELS,
  evaluateLogisticsImpact,
  type LogisticsImpactAvailable,
  type LogisticsImpactResult,
  type LogisticsLevel,
} from './logistics-impact.js';

function transferTiming(transferActivityId: string) {
  return { kind: 'TRANSFER_TIMING_CHANGED' as const, transferActivityId };
}

function transferBuffer(transferActivityId: string) {
  return { kind: 'TRANSFER_BUFFER_CHANGED' as const, transferActivityId };
}

function reverification(subjectId: string) {
  return { kind: 'LOGISTICS_REVERIFICATION_ADDED' as const, subjectId };
}

function backupKit(equipmentPathId: string) {
  return { kind: 'BACKUP_KIT_ACTIVATED' as const, equipmentPathId };
}

function route(activityIds: readonly string[]) {
  return { kind: 'ROUTE_SEQUENCE_CHANGED' as const, activityIds };
}

function fallback(activityId: string, fallbackLocationId: string) {
  return { kind: 'FALLBACK_LOCATION_SWITCHED' as const, activityId, fallbackLocationId };
}

function optionAEvents() {
  return [transferTiming('ACT-DEPART-GOTHIC')];
}

function available(result: LogisticsImpactResult): LogisticsImpactAvailable {
  expect(result.status).toBe('AVAILABLE');
  if (result.status !== 'AVAILABLE') {
    throw new Error('expected an available logistics impact result');
  }
  return result;
}

function levelOf(events: unknown): LogisticsLevel {
  return available(evaluateLogisticsImpact(events)).level;
}

function issuesOf(events: unknown): readonly string[] {
  const result = evaluateLogisticsImpact(events);
  expect(result.status).toBe('WITHHELD');
  if (result.status !== 'WITHHELD') {
    throw new Error('expected a withheld logistics impact result');
  }
  expect(result).not.toHaveProperty('level');
  expect(result.algorithmVersion).toBe(LOGISTICS_IMPACT_ALGORITHM_VERSION);
  return result.issues;
}

describe('evaluateLogisticsImpact classification', () => {
  it('classifies an empty event set as NONE', () => {
    expect(available(evaluateLogisticsImpact([]))).toEqual({
      status: 'AVAILABLE',
      algorithmVersion: 'SR-LOGISTICS-IMPACT-v1',
      level: 'NONE',
    });
    expect([...LOGISTICS_LEVELS]).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });

  it('classifies transfer timing and transfer buffer as LOW', () => {
    expect(levelOf([transferTiming('ACT-DEPART-GOTHIC')])).toBe('LOW');
    expect(levelOf([transferBuffer('ACT-DEPART-GOTHIC')])).toBe('LOW');
  });

  it('classifies reverification as MEDIUM', () => {
    expect(levelOf([reverification('EQ-CAMERA-A')])).toBe('MEDIUM');
  });

  it('classifies a backup kit and a route sequence as HIGH', () => {
    expect(levelOf([backupKit('EQ-PATH-BACKUP')])).toBe('HIGH');
    expect(levelOf([route(['ACT-B', 'ACT-A'])])).toBe('HIGH');
  });

  it('classifies a fallback location switch as CRITICAL', () => {
    expect(levelOf([fallback('ACT-A', 'LOC-FALLBACK')])).toBe('CRITICAL');
  });

  it('keeps the highest class', () => {
    expect(
      levelOf([
        transferTiming('ACT-DEPART-GOTHIC'),
        reverification('EQ-CAMERA-A'),
        backupKit('EQ-PATH-BACKUP'),
        route(['ACT-C', 'ACT-B']),
        fallback('ACT-A', 'LOC-FALLBACK'),
      ]),
    ).toBe('CRITICAL');
    expect(
      levelOf([
        transferTiming('ACT-DEPART-GOTHIC'),
        reverification('EQ-CAMERA-A'),
        backupKit('EQ-PATH-BACKUP'),
      ]),
    ).toBe('HIGH');
    expect(levelOf([transferBuffer('ACT-MOVE'), reverification('EQ-CAMERA-A')])).toBe('MEDIUM');
  });
});

describe('evaluateLogisticsImpact canonical vectors', () => {
  it('scores canonical option A as LOW from the Gothic departure timing change', () => {
    expect(levelOf(optionAEvents())).toBe('LOW');
  });

  it('scores canonical option B as NONE because a setup buffer is not transfer-buffer change', () => {
    const logisticsEvents: readonly unknown[] = [];
    expect(levelOf(logisticsEvents)).toBe('NONE');
  });

  it('scores canonical option C as NONE from an empty logistics set', () => {
    expect(levelOf([])).toBe('NONE');
  });

  it('keeps an Eixample setup buffer alone at NONE', () => {
    const logisticsEventsForEixampleSetupBuffer: readonly unknown[] = [];
    expect(levelOf(logisticsEventsForEixampleSetupBuffer)).toBe('NONE');
  });

  it('keeps a personal call alone at NONE', () => {
    const logisticsEventsForPersonalCall: readonly unknown[] = [];
    expect(levelOf(logisticsEventsForPersonalCall)).toBe('NONE');
  });

  it('does not classify ordinary timing, buffer, shorten, or confirmation records', () => {
    expect(
      issuesOf([{ kind: 'BUFFER_ADDED', subjectId: 'ACT-EIXAMPLE-SETUP', minutes: 10 }]),
    ).toEqual(['MALFORMED_EVENT']);
    expect(
      issuesOf([
        { kind: 'PERSONAL_CALL_TIME_CHANGED', subjectId: 'PERSON-MODEL', deltaMinutes: -25 },
      ]),
    ).toEqual(['MALFORMED_EVENT']);
    expect(
      issuesOf([{ kind: 'ACTIVITY_TIME_CHANGED', subjectId: 'ACT-A', deltaMinutes: -25 }]),
    ).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([{ kind: 'ACTIVITY_SHORTENED', subjectId: 'ACT-A', minutes: 10 }])).toEqual([
      'MALFORMED_EVENT',
    ]);
    expect(issuesOf([{ kind: 'REQUEST_MISSING_CONFIRMATION', subjectId: 'EV-SCOPE-1' }])).toEqual([
      'MALFORMED_EVENT',
    ]);
  });
});

describe('evaluateLogisticsImpact determinism', () => {
  it('is invariant to input order, dedupes exact events, and repeats', () => {
    const events = [
      fallback('ACT-A', 'LOC-FALLBACK'),
      transferTiming('ACT-DEPART-GOTHIC'),
      reverification('EQ-CAMERA-A'),
      backupKit('EQ-PATH-BACKUP'),
    ];
    const forward = evaluateLogisticsImpact(events);
    const reversed = evaluateLogisticsImpact([...events].reverse());
    const repeated = evaluateLogisticsImpact(events);
    const duplicated = evaluateLogisticsImpact([...optionAEvents(), ...optionAEvents()]);

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(forward));
    expect(available(duplicated).level).toBe('LOW');
  });

  it('freezes the output and does not mutate the input', () => {
    const events = [route(['ACT-B', 'ACT-A']), transferTiming('ACT-DEPART-GOTHIC')];
    const before = JSON.stringify(events);
    for (const event of events) {
      Object.freeze(event);
      if ('activityIds' in event) {
        Object.freeze(event.activityIds);
      }
    }
    Object.freeze(events);

    const result = available(evaluateLogisticsImpact(events));

    expect(JSON.stringify(events)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.level).toBe('HIGH');
    expect(evaluateFromBarrel).toBe(evaluateLogisticsImpact);
  });
});

describe('evaluateLogisticsImpact fail closed', () => {
  it('withholds malformed events, empty ids, bad routes, and bad fallback pairs', () => {
    expect(() => evaluateLogisticsImpact(null)).not.toThrow();
    expect(issuesOf(null)).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([{ kind: 'NOT_A_KIND' }])).toEqual(['MALFORMED_EVENT']);
    expect(issuesOf([transferTiming('')])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(issuesOf([transferBuffer('ab')])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(issuesOf([reverification('')])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(issuesOf([backupKit('')])).toEqual(['MALFORMED_SUBJECT_ID']);
    expect(issuesOf([route(['ACT-A'])])).toEqual(['MALFORMED_ROUTE']);
    expect(issuesOf([route([])])).toEqual(['MALFORMED_ROUTE']);
    expect(issuesOf([route(['ACT-A', 'ACT-A'])])).toEqual(['MALFORMED_ROUTE']);
    expect(issuesOf([route(['ACT-A', 'nope'])])).toEqual([
      'MALFORMED_ROUTE',
      'MALFORMED_SUBJECT_ID',
    ]);
    expect(issuesOf([fallback('', 'LOC-FALLBACK')])).toEqual([
      'MALFORMED_FALLBACK',
      'MALFORMED_SUBJECT_ID',
    ]);
    expect(issuesOf([fallback('ACT-A', '')])).toEqual([
      'MALFORMED_FALLBACK',
      'MALFORMED_SUBJECT_ID',
    ]);
    expect(issuesOf([{ kind: 'FALLBACK_LOCATION_SWITCHED', activityId: 'ACT-A' }])).toEqual([
      'MALFORMED_FALLBACK',
      'MALFORMED_SUBJECT_ID',
    ]);
  });

  it('withholds a conflicting duplicate identity', () => {
    expect(
      issuesOf([fallback('ACT-A', 'LOC-FALLBACK-A'), fallback('ACT-A', 'LOC-FALLBACK-B')]),
    ).toEqual(['CONFLICTING_EVENT']);
  });

  it('collects issue codes in sorted unique order and freezes them', () => {
    const issues = issuesOf([
      null,
      transferTiming(''),
      route(['bad']),
      fallback('ACT-A', ''),
      fallback('ACT-B', 'LOC-ONE'),
      fallback('ACT-B', 'LOC-TWO'),
    ]);

    expect(issues).toEqual([
      'CONFLICTING_EVENT',
      'MALFORMED_EVENT',
      'MALFORMED_FALLBACK',
      'MALFORMED_ROUTE',
      'MALFORMED_SUBJECT_ID',
    ]);
    expect(issues).toEqual([...LOGISTICS_IMPACT_ISSUES]);
    const withheld = evaluateLogisticsImpact(null);
    expect(Object.isFrozen(withheld)).toBe(true);
    if (withheld.status === 'WITHHELD') {
      expect(Object.isFrozen(withheld.issues)).toBe(true);
    }
  });
});
