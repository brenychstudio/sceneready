import { z } from 'zod';

import type { Brand } from './brand.js';

const PRODUCTION_TIME_ZONE = 'Europe/Madrid';
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const InstantSchema = z
  .string()
  .regex(INSTANT_PATTERN)
  .refine((value) => {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.toISOString() === value;
  })
  .transform((value) => value as Brand<string, 'Instant'>);

export type Instant = z.infer<typeof InstantSchema>;

export const ProductionTimeZoneSchema = z.literal(PRODUCTION_TIME_ZONE);

export type ProductionTimeZone = z.infer<typeof ProductionTimeZoneSchema>;

export const ZonedLocalTimeInputSchema = z.strictObject({
  local: z.string().regex(LOCAL_PATTERN),
  offset: z.string().regex(OFFSET_PATTERN),
  timeZone: ProductionTimeZoneSchema,
});

export type ZonedLocalTimeInput = z.infer<typeof ZonedLocalTimeInputSchema>;

export const ZonedProductionTimeSchema = z.strictObject({
  instant: InstantSchema,
  timeZone: ProductionTimeZoneSchema,
});

export type ZonedProductionTime = z.infer<typeof ZonedProductionTimeSchema>;

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function parseLocal(local: string): CalendarParts {
  const match = LOCAL_PATTERN.exec(local);
  if (match === null) {
    throw new Error('invalid local production time');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new Error('invalid local production time');
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    throw new Error('invalid local production time');
  }

  return { year, month, day, hour, minute, second };
}

function parseOffsetMinutes(offset: string): number {
  const match = OFFSET_PATTERN.exec(offset);
  if (match === null) {
    throw new Error('invalid production time offset');
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59) {
    throw new Error('invalid production time offset');
  }

  return sign * (hours * 60 + minutes);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function partsInZone(date: Date, timeZone: ProductionTimeZone): CalendarParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const named: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      named[part.type] = part.value;
    }
  }

  return {
    year: Number(named.year),
    month: Number(named.month),
    day: Number(named.day),
    hour: Number(named.hour),
    minute: Number(named.minute),
    second: Number(named.second),
  };
}

function sameLocal(left: CalendarParts, right: CalendarParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function offsetInZone(date: Date, timeZone: ProductionTimeZone): string {
  const local = partsInZone(date, timeZone);
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  const offsetMinutes = (localAsUtc - date.getTime()) / 60_000;
  if (!Number.isInteger(offsetMinutes)) {
    throw new Error('non-integral production time offset');
  }
  return formatOffset(offsetMinutes);
}

export function resolveZonedLocalTime(input: ZonedLocalTimeInput): ZonedProductionTime {
  const parsed = ZonedLocalTimeInputSchema.parse(input);
  const local = parseLocal(parsed.local);
  const offsetMinutes = parseOffsetMinutes(parsed.offset);
  const candidate = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
      offsetMinutes * 60_000,
  );
  const instant = InstantSchema.parse(candidate.toISOString());
  const projected = partsInZone(candidate, parsed.timeZone);
  const projectedOffset = offsetInZone(candidate, parsed.timeZone);

  if (!sameLocal(local, projected) || projectedOffset !== parsed.offset) {
    throw new Error('local production time is not valid in Europe/Madrid at the given offset');
  }

  return {
    instant,
    timeZone: parsed.timeZone,
  };
}

export interface Clock {
  now(): Instant;
}

export class SystemClock implements Clock {
  now(): Instant {
    return InstantSchema.parse(new Date().toISOString());
  }
}

export class ReplayClock implements Clock {
  #instant: Instant;

  constructor(initial: Instant) {
    this.#instant = InstantSchema.parse(initial);
  }

  now(): Instant {
    return this.#instant;
  }

  set(instant: Instant): void {
    this.#instant = InstantSchema.parse(instant);
  }
}
