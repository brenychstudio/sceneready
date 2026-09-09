import { describe, expect, it } from 'vitest';

import { ReplayClock, SystemClock } from './index.js';

describe('ReplayClock', () => {
  it('returns the initial instant until an explicit advance', () => {
    const clock = new ReplayClock('2026-09-17T04:00:00Z');

    expect(clock.now().toString()).toBe('2026-09-17T04:00:00Z');
    expect(clock.now().toString()).toBe('2026-09-17T04:00:00Z');

    clock.advance({ minutes: 35 });

    expect(clock.now().toString()).toBe('2026-09-17T04:35:00Z');
  });
});

describe('SystemClock', () => {
  it('returns a valid Temporal instant', () => {
    const now = new SystemClock().now();
    expect(now.toString().endsWith('Z')).toBe(true);
    expect(typeof now.epochNanoseconds).toBe('bigint');
  });
});
