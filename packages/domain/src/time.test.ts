import { describe, expect, it } from 'vitest';

import { resolveZonedProductionTime } from './index.js';

describe('resolveZonedProductionTime', () => {
  it('resolves Barcelona wall time to an authoritative instant', () => {
    const value = resolveZonedProductionTime({
      date: '2026-09-17',
      time: '07:20',
      timeZone: 'Europe/Madrid',
    });

    expect(value.local).toBe('2026-09-17T07:20:00');
    expect(value.timeZone).toBe('Europe/Madrid');
    expect(value.instant.endsWith('Z')).toBe(true);
    expect(value.instant).toBe('2026-09-17T05:20:00Z');
  });

  it('rejects the nonexistent spring-forward local time', () => {
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-03-29',
        time: '02:30',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
  });

  it('rejects the ambiguous fall-back local time', () => {
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-10-25',
        time: '02:30',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
  });

  it('rejects invalid calendar values and malformed inputs', () => {
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-13-01',
        time: '07:20',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-02-29',
        time: '07:20',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-09-17',
        time: '24:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-09-17',
        time: '12:60',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-09-17',
        time: '07:20:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-09-17',
        time: '07:20+02:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
  });

  it('rejects non-Madrid production time zones', () => {
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-09-17',
        time: '07:20',
        timeZone: 'Europe/Paris',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-09-17',
        time: '07:20',
        timeZone: 'UTC',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedProductionTime({
        date: '2026-09-17',
        time: '07:20',
        timeZone: 'europe/madrid',
      }),
    ).toThrow();
  });
});
