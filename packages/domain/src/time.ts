import { Temporal } from '@js-temporal/polyfill';

const PRODUCTION_TIME_ZONE = 'Europe/Madrid';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export interface ZonedProductionTimeInput {
  readonly date: string;
  readonly time: string;
  readonly timeZone: string;
}

export interface ZonedProductionTime {
  readonly local: string;
  readonly timeZone: string;
  readonly instant: string;
}

function assertCanonicalDate(date: string): void {
  if (DATE_PATTERN.exec(date) === null) {
    throw new Error('invalid production date');
  }
}

function assertCanonicalTime(time: string): void {
  const match = TIME_PATTERN.exec(time);
  if (match === null) {
    throw new Error('invalid production time');
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error('invalid production time');
  }
}

function assertCanonicalTimeZone(timeZone: string): void {
  if (timeZone !== PRODUCTION_TIME_ZONE) {
    throw new Error('unsupported production time zone');
  }
}

export function resolveZonedProductionTime(input: ZonedProductionTimeInput): ZonedProductionTime {
  assertCanonicalDate(input.date);
  assertCanonicalTime(input.time);
  assertCanonicalTimeZone(input.timeZone);

  const plain = Temporal.PlainDateTime.from(`${input.date}T${input.time}:00`, {
    overflow: 'reject',
  });
  const zoned = plain.toZonedDateTime(input.timeZone, {
    disambiguation: 'reject',
  });

  return {
    local: plain.toString(),
    timeZone: input.timeZone,
    instant: zoned.toInstant().toString(),
  };
}
