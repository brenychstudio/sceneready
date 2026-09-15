import { Temporal } from '@js-temporal/polyfill';
import type { EvidenceEnvelope } from '@sceneready/evidence';
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';

import {
  createSolarEvidenceEnvelope,
  SOLAR_ALGORITHM_VERSION,
  SOLAR_LIBRARY_LICENSE,
  SOLAR_LIBRARY_NAME,
  SOLAR_LIBRARY_VERSION,
  type SolarEvidencePayload,
} from './evidence.js';

export interface SolarCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface CalculateSolarEvidenceInput {
  readonly productionId: string;
  readonly evidenceId: string;
  readonly coordinates: SolarCoordinates;
  readonly instant: string;
}

export interface SolarEvidenceResult {
  readonly algorithmVersion: typeof SOLAR_ALGORITHM_VERSION;
  readonly libraryName: typeof SOLAR_LIBRARY_NAME;
  readonly libraryVersion: typeof SOLAR_LIBRARY_VERSION;
  readonly libraryLicense: typeof SOLAR_LIBRARY_LICENSE;
  readonly sunAzimuthDegrees: number;
  readonly sunElevationDegrees: number;
  readonly evidence: EvidenceEnvelope<SolarEvidencePayload>;
}

const GEOMETRY_SCALE = 1_000_000;

function assertFiniteNumber(value: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`canonical JSON rejected: invalid number at ${path}`);
  }
  return value;
}

function assertLatitude(value: number): number {
  const latitude = assertFiniteNumber(value, 'coordinates.latitude');
  if (latitude < -90 || latitude > 90) {
    throw new Error('canonical JSON rejected: invalid latitude');
  }
  return latitude;
}

function assertLongitude(value: number): number {
  const longitude = assertFiniteNumber(value, 'coordinates.longitude');
  if (longitude < -180 || longitude > 180) {
    throw new Error('canonical JSON rejected: invalid longitude');
  }
  return longitude;
}

function assertInstant(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('canonical JSON rejected: invalid instant');
  }
  try {
    return Temporal.Instant.from(value).toString();
  } catch {
    throw new Error('canonical JSON rejected: invalid instant');
  }
}

function assertNonEmptyId(value: string, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`canonical JSON rejected: invalid string at ${path}`);
  }
  return value;
}

function normalizeDegrees(value: number): number {
  return Math.round(value * GEOMETRY_SCALE) / GEOMETRY_SCALE;
}

function normalizeAzimuth(value: number): number {
  const normalized = ((normalizeDegrees(value) % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

export function calculateSolarEvidence(input: CalculateSolarEvidenceInput): SolarEvidenceResult {
  const productionId = assertNonEmptyId(input.productionId, 'productionId');
  const evidenceId = assertNonEmptyId(input.evidenceId, 'evidenceId');
  const latitude = assertLatitude(input.coordinates.latitude);
  const longitude = assertLongitude(input.coordinates.longitude);
  const instant = assertInstant(input.instant);
  const utcDate = new Date(Temporal.Instant.from(instant).epochMilliseconds);
  const observer = new Observer(latitude, longitude, 0);
  const equator = Equator(Body.Sun, utcDate, observer, true, true);
  const horizon = Horizon(utcDate, observer, equator.ra, equator.dec, 'normal');
  const sunAzimuthDegrees = normalizeAzimuth(horizon.azimuth);
  const sunElevationDegrees = normalizeDegrees(horizon.altitude);

  if (!Number.isFinite(sunAzimuthDegrees) || !Number.isFinite(sunElevationDegrees)) {
    throw new Error('canonical JSON rejected: non-finite solar geometry');
  }

  const evidence = createSolarEvidenceEnvelope({
    productionId,
    evidenceId,
    instant,
    latitude,
    longitude,
    sunAzimuthDegrees,
    sunElevationDegrees,
  });

  return Object.freeze({
    algorithmVersion: SOLAR_ALGORITHM_VERSION,
    libraryName: SOLAR_LIBRARY_NAME,
    libraryVersion: SOLAR_LIBRARY_VERSION,
    libraryLicense: SOLAR_LIBRARY_LICENSE,
    sunAzimuthDegrees,
    sunElevationDegrees,
    evidence,
  });
}
