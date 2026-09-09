import { describe, expect, it } from 'vitest';

import {
  InstantSchema,
  ProductionTimeZoneSchema,
  ReplayClock,
  SystemClock,
  ZonedLocalTimeInputSchema,
  resolveZonedLocalTime,
} from './index.js';

describe('InstantSchema', () => {
  it('accepts a canonical UTC instant', () => {
    expect(InstantSchema.parse('2026-09-09T12:00:00.000Z')).toBe('2026-09-09T12:00:00.000Z');
  });

  it('rejects a non-canonical offset instant', () => {
    expect(InstantSchema.safeParse('2026-09-09T14:00:00+02:00').success).toBe(false);
  });

  it('rejects incomplete and free-form timestamps', () => {
    expect(InstantSchema.safeParse('2026-09-09').success).toBe(false);
    expect(InstantSchema.safeParse('2026-09-09 12:00').success).toBe(false);
    expect(InstantSchema.safeParse('2026-09-09T12:00:00').success).toBe(false);
    expect(InstantSchema.safeParse('not-a-time').success).toBe(false);
  });
});

describe('ProductionTimeZoneSchema', () => {
  it('accepts the canonical competition zone', () => {
    expect(ProductionTimeZoneSchema.parse('Europe/Madrid')).toBe('Europe/Madrid');
  });

  it('rejects other zones', () => {
    expect(ProductionTimeZoneSchema.safeParse('Europe/Paris').success).toBe(false);
    expect(ProductionTimeZoneSchema.safeParse('UTC').success).toBe(false);
    expect(ProductionTimeZoneSchema.safeParse('europe/madrid').success).toBe(false);
  });
});

describe('resolveZonedLocalTime', () => {
  it('resolves a normal Barcelona summer local time with the correct offset', () => {
    const resolved = resolveZonedLocalTime({
      local: '2026-09-09T12:00:00',
      offset: '+02:00',
      timeZone: 'Europe/Madrid',
    });

    expect(resolved).toEqual({
      instant: '2026-09-09T10:00:00.000Z',
      timeZone: 'Europe/Madrid',
    });
  });

  it('rejects a syntactically valid but wrong Madrid offset', () => {
    expect(() =>
      resolveZonedLocalTime({
        local: '2026-09-09T12:00:00',
        offset: '+01:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
  });

  it('rejects the nonexistent spring-forward local time', () => {
    expect(() =>
      resolveZonedLocalTime({
        local: '2026-03-29T02:30:00',
        offset: '+01:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedLocalTime({
        local: '2026-03-29T02:30:00',
        offset: '+02:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
  });

  it('resolves both explicit fall-back instants as distinct values', () => {
    const plus02 = resolveZonedLocalTime({
      local: '2026-10-25T02:30:00',
      offset: '+02:00',
      timeZone: 'Europe/Madrid',
    });
    const plus01 = resolveZonedLocalTime({
      local: '2026-10-25T02:30:00',
      offset: '+01:00',
      timeZone: 'Europe/Madrid',
    });

    expect(plus02.instant).toBe('2026-10-25T00:30:00.000Z');
    expect(plus01.instant).toBe('2026-10-25T01:30:00.000Z');
    expect(plus02.instant).not.toBe(plus01.instant);
  });

  it('rejects a local scheduled timestamp without an offset', () => {
    expect(
      ZonedLocalTimeInputSchema.safeParse({
        local: '2026-10-25T02:30:00',
        timeZone: 'Europe/Madrid',
      }).success,
    ).toBe(false);
  });

  it('rejects impossible calendar values and malformed offsets', () => {
    expect(() =>
      resolveZonedLocalTime({
        local: '2026-13-01T12:00:00',
        offset: '+02:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedLocalTime({
        local: '2026-02-29T12:00:00',
        offset: '+01:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedLocalTime({
        local: '2026-09-09T24:00:00',
        offset: '+02:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(() =>
      resolveZonedLocalTime({
        local: '2026-09-09T12:60:00',
        offset: '+02:00',
        timeZone: 'Europe/Madrid',
      }),
    ).toThrow();
    expect(
      ZonedLocalTimeInputSchema.safeParse({
        local: '2026-09-09T12:00:00',
        offset: '+0200',
        timeZone: 'Europe/Madrid',
      }).success,
    ).toBe(false);
  });
});

describe('ReplayClock', () => {
  it('returns the controlled instant without advancing', () => {
    const initial = InstantSchema.parse('2026-09-09T12:00:00.000Z');
    const second = InstantSchema.parse('2026-10-25T00:30:00.000Z');
    const clock = new ReplayClock(initial);

    expect(clock.now()).toBe(initial);
    expect(clock.now()).toBe(initial);

    clock.set(second);

    expect(clock.now()).toBe(second);
  });
});

describe('SystemClock', () => {
  it('returns a canonical UTC instant', () => {
    const now = new SystemClock().now();
    expect(InstantSchema.parse(now)).toBe(now);
  });
});
