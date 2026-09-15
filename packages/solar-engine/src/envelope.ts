export const CREATIVE_INTENT_BANDS = ['PREFERRED', 'ACCEPTABLE', 'OUTSIDE'] as const;

export type CreativeIntentBand = (typeof CREATIVE_INTENT_BANDS)[number];

export interface DegreeRange {
  readonly min: number;
  readonly max: number;
}

export interface CreativeIntentEnvelope {
  readonly envelopeId: string;
  readonly preferredLocalTimeStart: string;
  readonly preferredLocalTimeEnd: string;
  readonly acceptableLocalTimeStart: string;
  readonly acceptableLocalTimeEnd: string;
  readonly preferredAzimuthDegrees: DegreeRange;
  readonly acceptableAzimuthDegrees: DegreeRange;
  readonly preferredElevationDegrees: DegreeRange;
  readonly acceptableElevationDegrees: DegreeRange;
  readonly shadowIntent: string;
  readonly importance: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

export interface EvaluateCreativeIntentInput {
  readonly envelope: CreativeIntentEnvelope;
  readonly localTime: string;
  readonly sunAzimuthDegrees: number;
  readonly sunElevationDegrees: number;
}

export interface CreativeIntentEvaluation {
  readonly score: number;
  readonly band: CreativeIntentBand;
  readonly reasons: readonly string[];
  readonly envelopeId: string;
  readonly shadowIntent: string;
  readonly importance: CreativeIntentEnvelope['importance'];
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function assertFiniteNumber(value: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`canonical JSON rejected: invalid number at ${path}`);
  }
  return value;
}

function timeToMinutes(value: string, path: string): number {
  const match = LOCAL_TIME_PATTERN.exec(value);
  const hour = match?.[1];
  const minute = match?.[2];
  if (match === null || hour === undefined || minute === undefined) {
    throw new Error(`canonical JSON rejected: invalid local time at ${path}`);
  }
  return Number(hour) * 60 + Number(minute);
}

function inInclusiveWindow(minutes: number, start: number, end: number): boolean {
  return minutes >= start && minutes <= end;
}

function inDegreeRange(value: number, range: DegreeRange): boolean {
  if (range.min <= range.max) {
    return value >= range.min && value <= range.max;
  }
  return value >= range.min || value <= range.max;
}

function classifyTime(minutes: number, envelope: CreativeIntentEnvelope): CreativeIntentBand {
  if (
    inInclusiveWindow(
      minutes,
      timeToMinutes(envelope.preferredLocalTimeStart, 'preferredLocalTimeStart'),
      timeToMinutes(envelope.preferredLocalTimeEnd, 'preferredLocalTimeEnd'),
    )
  ) {
    return 'PREFERRED';
  }
  if (
    inInclusiveWindow(
      minutes,
      timeToMinutes(envelope.acceptableLocalTimeStart, 'acceptableLocalTimeStart'),
      timeToMinutes(envelope.acceptableLocalTimeEnd, 'acceptableLocalTimeEnd'),
    )
  ) {
    return 'ACCEPTABLE';
  }
  return 'OUTSIDE';
}

function classifyDegrees(
  value: number,
  preferred: DegreeRange,
  acceptable: DegreeRange,
): CreativeIntentBand {
  if (inDegreeRange(value, preferred)) {
    return 'PREFERRED';
  }
  if (inDegreeRange(value, acceptable)) {
    return 'ACCEPTABLE';
  }
  return 'OUTSIDE';
}

function dimensionScore(band: CreativeIntentBand, weight: number): number {
  if (band === 'PREFERRED') {
    return weight;
  }
  if (band === 'ACCEPTABLE') {
    return Math.round(weight * 0.6);
  }
  return 0;
}

function combineBand(
  timeBand: CreativeIntentBand,
  azimuthBand: CreativeIntentBand,
  elevationBand: CreativeIntentBand,
): CreativeIntentBand {
  if (timeBand === 'OUTSIDE' || azimuthBand === 'OUTSIDE' || elevationBand === 'OUTSIDE') {
    return 'OUTSIDE';
  }
  if (timeBand === 'PREFERRED' && azimuthBand === 'PREFERRED' && elevationBand === 'PREFERRED') {
    return 'PREFERRED';
  }
  return 'ACCEPTABLE';
}

export function evaluateCreativeIntentEnvelope(
  input: EvaluateCreativeIntentInput,
): CreativeIntentEvaluation {
  const envelope = input.envelope;
  const localMinutes = timeToMinutes(input.localTime, 'localTime');
  const azimuth = assertFiniteNumber(input.sunAzimuthDegrees, 'sunAzimuthDegrees');
  const elevation = assertFiniteNumber(input.sunElevationDegrees, 'sunElevationDegrees');

  const timeBand = classifyTime(localMinutes, envelope);
  const azimuthBand = classifyDegrees(
    azimuth,
    envelope.preferredAzimuthDegrees,
    envelope.acceptableAzimuthDegrees,
  );
  const elevationBand = classifyDegrees(
    elevation,
    envelope.preferredElevationDegrees,
    envelope.acceptableElevationDegrees,
  );

  return Object.freeze({
    score:
      dimensionScore(timeBand, 40) +
      dimensionScore(azimuthBand, 30) +
      dimensionScore(elevationBand, 30),
    band: combineBand(timeBand, azimuthBand, elevationBand),
    reasons: Object.freeze([
      `TIME_${timeBand}`,
      `AZIMUTH_${azimuthBand}`,
      `ELEVATION_${elevationBand}`,
    ]),
    envelopeId: envelope.envelopeId,
    shadowIntent: envelope.shadowIntent,
    importance: envelope.importance,
  });
}
