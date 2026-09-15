import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveZonedProductionTime } from '@sceneready/domain';
import { fingerprintEvidenceContent } from '@sceneready/evidence';
import { validateProductionPack, type ProductionPack } from '@sceneready/production-pack';

import {
  calculateSolarEvidence,
  evaluateCreativeIntentEnvelope,
  SOLAR_ALGORITHM_VERSION,
  type CreativeIntentEnvelope,
} from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/barcelona-aer-ss27',
);

const PRODUCTION_DATE = '2026-09-17';
const PRODUCTION_TIME_ZONE = 'Europe/Madrid';
const PRODUCTION_ID = 'BCN-DEMO-01';

const GOTHIC_COORDINATES = Object.freeze({
  latitude: 41.38337,
  longitude: 2.17555,
});

const EIXAMPLE_COORDINATES = Object.freeze({
  latitude: 41.39529,
  longitude: 2.16189,
});

async function readJson(fileName: string): Promise<unknown> {
  const raw = await readFile(join(fixtureDir, fileName), 'utf8');
  return JSON.parse(raw) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadCanonicalBarcelonaPack(): Promise<unknown> {
  const [
    manifest,
    production,
    crew,
    locations,
    schedule,
    deliverables,
    equipment,
    rights,
    priorities,
  ] = await Promise.all([
    readJson('manifest.json'),
    readJson('production.json'),
    readJson('crew.json'),
    readJson('locations.json'),
    readJson('schedule.json'),
    readJson('deliverables.json'),
    readJson('equipment.json'),
    readJson('rights.json'),
    readJson('priorities.json'),
  ]);

  if (!isRecord(manifest) || !isRecord(equipment) || !isRecord(rights)) {
    throw new Error('canonical Barcelona fixture sections are malformed');
  }

  return {
    fixtureVersion: manifest.fixtureVersion,
    policyVersion: manifest.policyVersion,
    syntheticDataDeclaration: manifest.syntheticDataDeclaration,
    production,
    crew,
    locations,
    schedule,
    deliverables,
    equipment: equipment.assets,
    capturePaths: equipment.capturePaths,
    rights: rights.documents,
    priorities,
    hardGates: rights.hardGates,
    evidence: rights.evidence,
  };
}

async function loadCanonicalPack(): Promise<ProductionPack> {
  const validated = validateProductionPack(await loadCanonicalBarcelonaPack());
  expect(validated.ok).toBe(true);
  if (!validated.ok) {
    throw new Error('canonical Barcelona pack failed validation');
  }
  return validated.pack;
}

function instantAt(time: string): string {
  return resolveZonedProductionTime({
    date: PRODUCTION_DATE,
    time,
    timeZone: PRODUCTION_TIME_ZONE,
  }).instant;
}

function requireEnvelope(pack: ProductionPack, locationId: string): CreativeIntentEnvelope {
  const location = pack.locations.find((item) => item.id === locationId);
  if (location === undefined || location.solarCreativeIntent === undefined) {
    throw new Error(`missing solar creative intent for ${locationId}`);
  }
  return location.solarCreativeIntent;
}

function reverseKeys<T extends object>(value: T): T {
  const reversed: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) {
    reversed[key] = (value as Record<string, unknown>)[key];
  }
  return reversed as T;
}

describe('calculateSolarEvidence', () => {
  it('returns finite Barcelona solar geometry with algorithmVersion SR-SOLAR-v1', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const randomSpy = vi.spyOn(Math, 'random');
    const result = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('07:30'),
    });

    expect(result.algorithmVersion).toBe('SR-SOLAR-v1');
    expect(SOLAR_ALGORITHM_VERSION).toBe('SR-SOLAR-v1');
    expect(Number.isFinite(result.sunAzimuthDegrees)).toBe(true);
    expect(Number.isFinite(result.sunElevationDegrees)).toBe(true);
    expect(result.sunAzimuthDegrees).toBeGreaterThanOrEqual(0);
    expect(result.sunAzimuthDegrees).toBeLessThan(360);
    expect(result.sunElevationDegrees).toBeGreaterThanOrEqual(-90);
    expect(result.sunElevationDegrees).toBeLessThanOrEqual(90);
    expect(result.evidence.kind).toBe('SOLAR');
    expect(result.evidence.productionId).toBe(PRODUCTION_ID);
    expect(result.evidence.evidenceId).toBe('EVD-SOLAR-GOTHIC');
    expect(result.evidence.algorithmVersion).toBe('SR-SOLAR-v1');
    expect(result.evidence.authorityClass).toBe('SYSTEM_DERIVED');
    expect(result.evidence.payload).toEqual(
      expect.objectContaining({
        sunAzimuthDegrees: result.sunAzimuthDegrees,
        sunElevationDegrees: result.sunElevationDegrees,
      }),
    );
    expect(nowSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('repeats identical solar input as byte-equivalent operational values and fingerprint', () => {
    const input = {
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('07:30'),
    };
    const first = calculateSolarEvidence(input);
    const second = calculateSolarEvidence({
      instant: input.instant,
      evidenceId: input.evidenceId,
      productionId: input.productionId,
      coordinates: {
        longitude: input.coordinates.longitude,
        latitude: input.coordinates.latitude,
      },
    });

    expect(second.sunAzimuthDegrees).toBe(first.sunAzimuthDegrees);
    expect(second.sunElevationDegrees).toBe(first.sunElevationDegrees);
    expect(second.algorithmVersion).toBe(first.algorithmVersion);
    expect(second.evidence.contentFingerprint).toBe(first.evidence.contentFingerprint);
    expect(JSON.stringify(second.evidence.payload)).toBe(JSON.stringify(first.evidence.payload));
    expect(second.evidence.contentFingerprint).toBe(
      fingerprintEvidenceContent({
        algorithmVersion: second.evidence.algorithmVersion,
        adapterVersion: second.evidence.adapterVersion,
        authorityClass: second.evidence.authorityClass,
        kind: second.evidence.kind,
        mode: second.evidence.mode,
        observedAt: second.evidence.observedAt,
        payload: second.evidence.payload,
        receivedAt: second.evidence.receivedAt,
        sourceType: second.evidence.sourceType,
        trustState: second.evidence.trustState,
      }),
    );
  });

  it('fails closed on invalid latitude, longitude, or instant', () => {
    const valid = {
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('07:30'),
    };

    expect(() =>
      calculateSolarEvidence({
        ...valid,
        coordinates: { latitude: 91, longitude: 2.17555 },
      }),
    ).toThrow(/canonical JSON rejected/i);
    expect(() =>
      calculateSolarEvidence({
        ...valid,
        coordinates: { latitude: 41.38337, longitude: 181 },
      }),
    ).toThrow(/canonical JSON rejected/i);
    expect(() =>
      calculateSolarEvidence({
        ...valid,
        instant: 'not-an-instant',
      }),
    ).toThrow(/canonical JSON rejected/i);
  });
});

describe('evaluateCreativeIntentEnvelope', () => {
  it('scores preferred Gothic geometry above a clearly late outside case', async () => {
    const pack = await loadCanonicalPack();
    const gothic = requireEnvelope(pack, 'LOC-GOTHIC');
    const preferredSolar = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC-PREFERRED',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('07:30'),
    });
    const lateSolar = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC-LATE',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('16:00'),
    });

    const preferred = evaluateCreativeIntentEnvelope({
      envelope: gothic,
      localTime: '07:30',
      sunAzimuthDegrees: preferredSolar.sunAzimuthDegrees,
      sunElevationDegrees: preferredSolar.sunElevationDegrees,
    });
    const late = evaluateCreativeIntentEnvelope({
      envelope: gothic,
      localTime: '16:00',
      sunAzimuthDegrees: lateSolar.sunAzimuthDegrees,
      sunElevationDegrees: lateSolar.sunElevationDegrees,
    });

    expect(preferred.band).toBe('PREFERRED');
    expect(late.band).toBe('OUTSIDE');
    expect(preferred.score).toBeGreaterThan(late.score);
    expect(preferred.score).toBeGreaterThanOrEqual(0);
    expect(preferred.score).toBeLessThanOrEqual(100);
    expect(late.score).toBeGreaterThanOrEqual(0);
    expect(late.score).toBeLessThanOrEqual(100);
    expect(preferred.reasons).toEqual(expect.arrayContaining(['TIME_PREFERRED']));
    expect(late.reasons).toEqual(expect.arrayContaining(['TIME_OUTSIDE']));
  });

  it('evaluates Eixample with its own envelope, not Gothic', async () => {
    const pack = await loadCanonicalPack();
    const gothic = requireEnvelope(pack, 'LOC-GOTHIC');
    const eixample = requireEnvelope(pack, 'LOC-EIXAMPLE');
    const solar = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-EIXAMPLE',
      coordinates: EIXAMPLE_COORDINATES,
      instant: instantAt('09:20'),
    });

    const gothicEval = evaluateCreativeIntentEnvelope({
      envelope: gothic,
      localTime: '09:20',
      sunAzimuthDegrees: solar.sunAzimuthDegrees,
      sunElevationDegrees: solar.sunElevationDegrees,
    });
    const eixampleEval = evaluateCreativeIntentEnvelope({
      envelope: eixample,
      localTime: '09:20',
      sunAzimuthDegrees: solar.sunAzimuthDegrees,
      sunElevationDegrees: solar.sunElevationDegrees,
    });

    expect(eixample.envelopeId).not.toBe(gothic.envelopeId);
    expect(eixample.shadowIntent).not.toBe(gothic.shadowIntent);
    expect(eixampleEval.band).toBe('PREFERRED');
    expect(eixampleEval.band).not.toBe(gothicEval.band);
    expect(eixampleEval.reasons).not.toEqual(gothicEval.reasons);
  });

  it('keeps PREFERRED, ACCEPTABLE, and OUTSIDE boundaries deterministic', async () => {
    const pack = await loadCanonicalPack();
    const gothic = requireEnvelope(pack, 'LOC-GOTHIC');
    const preferredSolar = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC-PREFERRED',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('07:30'),
    });
    const acceptableSolar = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC-ACCEPTABLE',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('08:20'),
    });
    const outsideSolar = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC-OUTSIDE',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('16:00'),
    });

    const preferred = evaluateCreativeIntentEnvelope({
      envelope: gothic,
      localTime: '07:30',
      sunAzimuthDegrees: preferredSolar.sunAzimuthDegrees,
      sunElevationDegrees: preferredSolar.sunElevationDegrees,
    });
    const acceptable = evaluateCreativeIntentEnvelope({
      envelope: gothic,
      localTime: '08:20',
      sunAzimuthDegrees: acceptableSolar.sunAzimuthDegrees,
      sunElevationDegrees: acceptableSolar.sunElevationDegrees,
    });
    const outside = evaluateCreativeIntentEnvelope({
      envelope: gothic,
      localTime: '16:00',
      sunAzimuthDegrees: outsideSolar.sunAzimuthDegrees,
      sunElevationDegrees: outsideSolar.sunElevationDegrees,
    });
    const preferredAgain = evaluateCreativeIntentEnvelope({
      envelope: gothic,
      localTime: '07:30',
      sunAzimuthDegrees: preferredSolar.sunAzimuthDegrees,
      sunElevationDegrees: preferredSolar.sunElevationDegrees,
    });

    expect(preferred.band).toBe('PREFERRED');
    expect(acceptable.band).toBe('ACCEPTABLE');
    expect(outside.band).toBe('OUTSIDE');
    expect(preferredAgain).toEqual(preferred);
    expect(preferred.reasons.some((reason) => reason.includes('GOOD_LIGHT'))).toBe(false);
    expect(outside.reasons.some((reason) => reason.includes('BAD_LIGHT'))).toBe(false);
  });

  it('does not assign a solar creative-intent envelope to studio', async () => {
    const pack = await loadCanonicalPack();
    const studio = pack.locations.find((item) => item.id === 'LOC-STUDIO-NORTH');
    const studioDeliverables = pack.deliverables.filter((item) =>
      item.requiredLocationIds.every((locationId) => locationId === 'LOC-STUDIO-NORTH'),
    );

    expect(studio?.kind).toBe('STUDIO');
    expect(studio?.solarCreativeIntent).toBeUndefined();
    expect(studioDeliverables.map((item) => item.id).sort()).toEqual([
      'DELIVERABLE-D5',
      'DELIVERABLE-D6',
    ]);
    expect(studioDeliverables.every((item) => item.creativeIntentEnvelopeId === undefined)).toBe(
      true,
    );
  });

  it('does not change evaluation when unrelated object keys are reordered', async () => {
    const pack = await loadCanonicalPack();
    const gothic = requireEnvelope(pack, 'LOC-GOTHIC');
    const solar = calculateSolarEvidence({
      productionId: PRODUCTION_ID,
      evidenceId: 'EVD-SOLAR-GOTHIC',
      coordinates: GOTHIC_COORDINATES,
      instant: instantAt('07:30'),
    });
    const input = {
      envelope: gothic,
      localTime: '07:30',
      sunAzimuthDegrees: solar.sunAzimuthDegrees,
      sunElevationDegrees: solar.sunElevationDegrees,
    };

    const forward = evaluateCreativeIntentEnvelope(input);
    const reversed = evaluateCreativeIntentEnvelope({
      sunElevationDegrees: input.sunElevationDegrees,
      sunAzimuthDegrees: input.sunAzimuthDegrees,
      localTime: input.localTime,
      envelope: reverseKeys(input.envelope),
    });

    expect(reversed).toEqual(forward);
  });
});

describe('solar-engine source authority', () => {
  it('does not use Date.now, Math.random, or UUID operational authority', async () => {
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const sources = await Promise.all(
      ['solar.ts', 'envelope.ts', 'evidence.ts', 'index.ts'].map((fileName) =>
        readFile(join(sourceDir, fileName), 'utf8'),
      ),
    );
    const joined = sources.join('\n');

    expect(joined).not.toMatch(/Date\.now\s*\(/);
    expect(joined).not.toMatch(/Math\.random\s*\(/);
    expect(joined).not.toMatch(/randomUUID/);
    expect(joined).not.toMatch(/uuid/i);
    expect(joined).not.toMatch(/bedrock/i);
    expect(joined).not.toMatch(/living atlas/i);
  });
});
