import { Temporal } from '@js-temporal/polyfill';

export interface Clock {
  now(): Temporal.Instant;
}

export class SystemClock implements Clock {
  now(): Temporal.Instant {
    return Temporal.Now.instant();
  }
}

export class ReplayClock implements Clock {
  private current: Temporal.Instant;

  constructor(initialInstant: string) {
    this.current = Temporal.Instant.from(initialInstant);
  }

  now(): Temporal.Instant {
    return this.current;
  }

  advance(duration: Temporal.DurationLike): void {
    this.current = this.current.add(duration);
  }
}
