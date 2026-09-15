import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activateProductionPack,
  fingerprintProductionPack,
  validateProductionPack,
} from './index.js';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/barcelona-aer-ss27',
);

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

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function withReversedObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withReversedObjectKeys);
  }
  if (isRecord(value)) {
    const reversed: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) {
      reversed[key] = withReversedObjectKeys(value[key]);
    }
    return reversed;
  }
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value;
}

function expectRejected(value: unknown): void {
  expect(typeof fingerprintProductionPack).toBe('function');
  expect(() => fingerprintProductionPack(value)).toThrow(
    /canonical|non-finite|non-JSON|undefined|bigint|symbol|function/i,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Production Pack fingerprint', () => {
  it('is a stable 64-character lowercase hex digest for the canonical fixture', async () => {
    const pack = await loadCanonicalBarcelonaPack();
    const digest = fingerprintProductionPack(pack);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).toBe(fingerprintProductionPack(cloneJson(pack)));
  });

  it('pins the canonical BCN-DEMO-v1 fingerprint', async () => {
    const pack = await loadCanonicalBarcelonaPack();
    expect(fingerprintProductionPack(pack)).toBe(
      '13a1183c848d5762764da1f646f2ffc97321f976bb8c3ff340425a99117263be',
    );
  });

  it('does not change when object keys are reordered', async () => {
    const pack = await loadCanonicalBarcelonaPack();
    const reordered = withReversedObjectKeys(pack);

    expect(fingerprintProductionPack(reordered)).toBe(fingerprintProductionPack(pack));
  });

  it('changes when array order changes', async () => {
    const pack = asRecord(await loadCanonicalBarcelonaPack(), 'pack');
    const schedule = pack.schedule;
    if (!Array.isArray(schedule) || schedule.length < 2) {
      throw new Error('canonical schedule must contain at least two activities');
    }

    const reordered = {
      ...pack,
      schedule: [...schedule].reverse(),
    };

    expect(fingerprintProductionPack(reordered)).not.toBe(fingerprintProductionPack(pack));
  });

  it('changes when a canonical name changes', async () => {
    const pack = asRecord(await loadCanonicalBarcelonaPack(), 'pack');
    const production = asRecord(pack.production, 'production');
    const mutated = {
      ...pack,
      production: {
        ...production,
        campaignName: `${String(production.campaignName)} altered`,
      },
    };

    expect(fingerprintProductionPack(mutated)).not.toBe(fingerprintProductionPack(pack));
  });

  it('rejects non-finite numbers', async () => {
    const pack = asRecord(await loadCanonicalBarcelonaPack(), 'pack');
    const production = asRecord(pack.production, 'production');

    expectRejected({
      ...pack,
      production: {
        ...production,
        latitude: Number.NaN,
      },
    });
    expectRejected({ n: Number.POSITIVE_INFINITY });
    expectRejected({ n: Number.NEGATIVE_INFINITY });
  });

  it('rejects undefined and other values JSON would silently drop', async () => {
    const pack = asRecord(await loadCanonicalBarcelonaPack(), 'pack');

    expectRejected({ ...pack, dropped: undefined });
    expectRejected({ ...pack, dropped: () => 'nope' });
    expectRejected({ ...pack, dropped: Symbol('nope') });
    expectRejected({ ...pack, dropped: 1n });
    expectRejected([undefined]);
  });

  it('does not mutate the input pack', async () => {
    const pack = await loadCanonicalBarcelonaPack();
    const before = JSON.stringify(pack);
    const nested = asRecord(pack, 'pack');
    const productionBefore = nested.production;

    fingerprintProductionPack(pack);

    expect(JSON.stringify(pack)).toBe(before);
    expect(nested.production).toBe(productionBefore);
  });
});

describe('Production Pack activation', () => {
  it('emits the exact canonical manifest fields', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const input = await loadCanonicalBarcelonaPack();
    const validated = validateProductionPack(input);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }

    const activatedAt = '2026-09-17T03:45:00Z';
    const digest = fingerprintProductionPack(validated.pack);
    const manifest = activateProductionPack(validated.pack, activatedAt);

    expect(Object.keys(manifest)).toEqual([
      'productionId',
      'fixtureVersion',
      'packFingerprint',
      'policyVersion',
      'graphSchemaVersion',
      'activatedAt',
    ]);
    expect(manifest).toEqual({
      productionId: 'BCN-DEMO-01',
      fixtureVersion: 'BCN-DEMO-v1',
      packFingerprint: digest,
      policyVersion: 'SR-POLICY-v1',
      graphSchemaVersion: 'SR-GRAPH-v1',
      activatedAt,
    });
    expect(nowSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(input)).toBe(JSON.stringify(await loadCanonicalBarcelonaPack()));
  });

  it('is byte-identical for the same pack and activatedAt', async () => {
    const input = await loadCanonicalBarcelonaPack();
    const validated = validateProductionPack(input);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }

    const activatedAt = '2026-09-17T03:45:00Z';
    const first = activateProductionPack(validated.pack, activatedAt);
    const second = activateProductionPack(validated.pack, activatedAt);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);
  });

  it('preserves an explicitly supplied activatedAt and does not derive schedule time', async () => {
    const input = await loadCanonicalBarcelonaPack();
    const validated = validateProductionPack(input);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }

    const callerSupplied = '1999-12-31T23:59:59Z';
    const nowSpy = vi.spyOn(Date, 'now');
    const manifest = activateProductionPack(validated.pack, callerSupplied);

    expect(manifest.activatedAt).toBe(callerSupplied);
    expect(manifest.activatedAt).not.toBe('2026-09-17T03:45:00Z');
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('does not export packOwnedActivationInstant or derive activatedAt', async () => {
    const api = await import('./index.js');
    expect('packOwnedActivationInstant' in api).toBe(false);

    const source = await readFile(new URL('./activate.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('packOwnedActivationInstant');
    expect(source).not.toContain('resolveZonedProductionTime');
    expect(source).not.toContain('schedule[0]');
    expect(source).toContain('export function activateProductionPack');
    expect(source).toContain('GRAPH_SCHEMA_VERSION');
    expect(source).toContain('ProductionActivationManifest');
  });
});
