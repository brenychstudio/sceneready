import { describe, expect, it } from 'vitest';

import { validateProductionPack } from '@sceneready/production-pack';

import { loadCanonicalBarcelonaPack } from './load-fixture.js';

const CANONICAL_ACTIVITY_IDS = [
  'ACT-DEPART-GOTHIC',
  'ACT-GOTHIC-SETUP',
  'ACT-GOTHIC-LOOK-03',
  'ACT-EIXAMPLE-SETUP',
  'ACT-EIXAMPLE-LOOK-05',
  'ACT-STUDIO-LOAD-IN',
] as const;

const CANONICAL_ACTIVITY_NAMES = [
  'Production lead preflight',
  'Core crew call / gear load',
  'Model + HMU preparation',
  'Departure to Gothic',
  'Gothic setup',
  'Look 01',
  'Look 02',
  'Look 03',
  'Gothic wrap / load-out',
  'Transfer -> Eixample',
  'Eixample setup',
  'Look 04',
  'Look 05 + motion',
  'Eixample wrap',
  'Transfer -> Studio',
  'Studio load-in / digital station',
  'Studio session begins',
  'Backups / wrap',
] as const;

const CANONICAL_DELIVERABLES = [
  {
    id: 'DELIVERABLE-D1',
    name: 'Hero Exterior Stills - Gothic Looks 01-02',
    importance: 'CRITICAL',
  },
  {
    id: 'DELIVERABLE-D2',
    name: 'Gothic Motion Cut - Look 03',
    importance: 'HIGH',
  },
  {
    id: 'DELIVERABLE-D3',
    name: 'Eixample Editorial Stills - Looks 04-05',
    importance: 'HIGH',
  },
  {
    id: 'DELIVERABLE-D4',
    name: 'Eixample Motion Inserts - Look 05',
    importance: 'MEDIUM',
  },
  {
    id: 'DELIVERABLE-D5',
    name: 'Studio Campaign Stills - Looks 06-08',
    importance: 'CRITICAL',
  },
  {
    id: 'DELIVERABLE-D6',
    name: 'Studio Motion Master',
    importance: 'HIGH',
  },
  {
    id: 'DELIVERABLE-D7',
    name: 'Commercial Usage Package',
    importance: 'CRITICAL',
  },
] as const;

describe('BCN-DEMO-v1 fixture', () => {
  it('contains the canonical team, locations, gates, and deliverables', async () => {
    const input = await loadCanonicalBarcelonaPack();
    const result = validateProductionPack(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.crew).toHaveLength(8);
    expect(result.pack.locations.map((item) => item.id)).toEqual([
      'LOC-GOTHIC',
      'LOC-EIXAMPLE',
      'LOC-STUDIO-NORTH',
    ]);
    expect(result.pack.deliverables).toHaveLength(7);
    expect(result.pack.hardGates).toHaveLength(5);
    expect(JSON.stringify(result.pack)).not.toMatch(/@gmail|@outlook|\+34/);
  });

  it('validates with zero production-pack issues', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.issues).toEqual([]);
  });

  it('pins canonical identity, locations, and geography', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.fixtureVersion).toBe('BCN-DEMO-v1');
    expect(result.pack.production.id).toBe('BCN-DEMO-01');
    expect(result.pack.production.campaignName).toBe('AER / SS27');
    expect(result.pack.production.date).toBe('2026-09-17');
    expect(result.pack.production.timeZone).toBe('Europe/Madrid');
    expect(result.pack.syntheticDataDeclaration).toBe(true);
    expect(result.pack.locations.map((item) => item.name)).toEqual([
      'Gothic Quarter',
      'Eixample',
      'Studio North — synthetic',
    ]);
    expect(result.pack.locations[0]?.coordinates).toEqual({
      latitude: 41.38337,
      longitude: 2.17555,
    });
    expect(result.pack.locations[1]?.coordinates).toEqual({
      latitude: 41.39529,
      longitude: 2.16189,
    });
    expect(result.pack.locations[2]?.coordinates).toEqual({
      latitude: 41.4034,
      longitude: 2.1986,
    });
  });

  it('freezes canonical crew, activity, deliverable, and document identities', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const crewIds = result.pack.crew.map((person) => person.id);
    expect(crewIds).toEqual([
      'PERSON-PRODUCTION-LEAD',
      'PERSON-MODEL',
      'PERSON-STYLIST',
      'PERSON-HMU',
      'PERSON-PHOTO-ASSISTANT',
      'PERSON-DIGITAL-TECH',
      'PERSON-MOTION-OPERATOR',
      'PERSON-PRODUCTION-ASSISTANT',
    ]);
    expect(result.pack.crew.find((person) => person.id === 'PERSON-MODEL')?.critical).toBe(true);
    const activityIds = result.pack.schedule.map((activity) => activity.id);
    for (const activityId of CANONICAL_ACTIVITY_IDS) {
      expect(activityIds).toContain(activityId);
    }
    expect(result.pack.deliverables.map((item) => item.id)).toEqual(
      CANONICAL_DELIVERABLES.map((item) => item.id),
    );
    expect(result.pack.rights.some((item) => item.id === 'DOCUMENT-MODEL-RELEASE')).toBe(true);
  });

  it('pins exact D1-D7 names and priorities on the validated pack', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.pack.deliverables.map((item) => ({
        id: item.id,
        name: item.name,
        importance: item.importance,
      })),
    ).toEqual([...CANONICAL_DELIVERABLES]);
  });

  it('retains canonical activity names on the validated pack', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.schedule.map((item) => item.name)).toEqual([...CANONICAL_ACTIVITY_NAMES]);
  });

  it('keeps DOCUMENT-MODEL-RELEASE missing at R0 and required by D7', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const modelRelease = result.pack.rights.find((item) => item.id === 'DOCUMENT-MODEL-RELEASE');
    expect(modelRelease?.kind).toBe('MODEL_RELEASE');
    const missingEvidence = result.pack.evidence.filter(
      (item) => item.subjectId === 'DOCUMENT-MODEL-RELEASE',
    );
    expect(missingEvidence).toEqual([
      expect.objectContaining({
        kind: 'DOCUMENT',
        trustState: 'MISSING',
        subjectType: 'DOCUMENT',
        subjectId: 'DOCUMENT-MODEL-RELEASE',
      }),
    ]);
    const commercialPackage = result.pack.deliverables.find((item) => item.id === 'DELIVERABLE-D7');
    expect(commercialPackage?.requiredDocumentIds).toContain('DOCUMENT-MODEL-RELEASE');
  });

  it('declares five subject-bound hard gates and primary plus backup capture', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.hardGates.map((gate) => gate.id)).toEqual([
      'LOCATION_ACCESS',
      'CRITICAL_TALENT',
      'RIGHTS',
      'CRITICAL_CAPTURE_KIT',
      'STUDIO_AVAILABILITY',
    ]);
    expect(result.pack.capturePaths.length).toBeGreaterThan(0);
    expect(result.pack.capturePaths.some((path) => path.primaryEquipmentIds.length > 0)).toBe(true);
    expect(result.pack.capturePaths.some((path) => path.backupEquipmentIds.length > 0)).toBe(true);
  });

  it('uses the canonical creative-first priority order', async () => {
    const result = validateProductionPack(await loadCanonicalBarcelonaPack());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.pack.priorities).toEqual({
      profile: 'CREATIVE_FIRST',
      rankedObjectives: [
        'EXTERIOR_CREATIVE_INTENT',
        'DAYLIGHT',
        'STUDIO_COMPLETION',
        'DELAY_MINIMIZATION',
        'CREW_CONVENIENCE',
        'COST',
      ],
    });
  });

  it('contains no real email, phone, or contact data', async () => {
    const serialized = JSON.stringify(await loadCanonicalBarcelonaPack());
    expect(serialized).not.toMatch(/@gmail|@outlook|\+34/i);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(serialized).not.toMatch(/\+\d{8,}/);
  });

  it('loads equivalent data on repeated assembly', async () => {
    const first = await loadCanonicalBarcelonaPack();
    const second = await loadCanonicalBarcelonaPack();
    expect(first).toEqual(second);
    const firstResult = validateProductionPack(first);
    const secondResult = validateProductionPack(second);
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) {
      return;
    }
    expect(firstResult.pack).toEqual(secondResult.pack);
  });
});
