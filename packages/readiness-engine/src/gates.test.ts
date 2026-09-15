import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateProductionPack, type ProductionPack } from '@sceneready/production-pack';

import {
  evaluateApprovedCapturePath,
  evaluateCriticalGates,
  evaluateDomainHealth,
  HARD_GATE_IDS,
  type DomainFact,
  type ReadinessEvaluationInput,
  type SubjectProof,
} from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/barcelona-aer-ss27',
);

const CANONICAL_GATES = [
  'LOCATION_ACCESS',
  'CRITICAL_TALENT',
  'RIGHTS',
  'CRITICAL_CAPTURE_KIT',
  'STUDIO_AVAILABILITY',
] as const;

const CANONICAL_DOMAINS = [
  'PEOPLE',
  'LOCATION',
  'TIME_ENVIRONMENT',
  'EQUIPMENT',
  'DOCUMENTS_RIGHTS',
  'LOGISTICS',
] as const;

async function readJson(fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(join(fixtureDir, fileName), 'utf8')) as unknown;
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

function clonePack(pack: ProductionPack): ProductionPack {
  return JSON.parse(JSON.stringify(pack)) as ProductionPack;
}

function proof(input: SubjectProof): SubjectProof {
  return input;
}

function confirmedAccess(subjectId: string): SubjectProof {
  return proof({
    subjectId,
    subjectType: 'LOCATION',
    aspect: 'ACCESS',
    scope: `LOCATION:${subjectId}:ACCESS`,
    state: 'CONFIRMED',
    value: 'VALID',
  });
}

function deniedAccess(subjectId: string): SubjectProof {
  return proof({
    subjectId,
    subjectType: 'LOCATION',
    aspect: 'ACCESS',
    scope: `LOCATION:${subjectId}:ACCESS`,
    state: 'DENIED',
    value: 'REVOKED',
  });
}

function canonicalProofs(): SubjectProof[] {
  return [
    confirmedAccess('LOC-GOTHIC'),
    confirmedAccess('LOC-EIXAMPLE'),
    proof({
      subjectId: 'PERSON-MODEL',
      subjectType: 'PERSON',
      aspect: 'AVAILABILITY',
      scope: 'PERSON:PERSON-MODEL:AVAILABILITY',
      state: 'CONFIRMED',
      value: 'AVAILABLE',
    }),
    proof({
      subjectId: 'DOCUMENT-MODEL-RELEASE',
      subjectType: 'DOCUMENT',
      aspect: 'VALIDITY',
      scope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
      state: 'CONFIRMED',
      value: 'VALID',
    }),
    proof({
      subjectId: 'LOC-STUDIO-NORTH',
      subjectType: 'LOCATION',
      aspect: 'AVAILABILITY',
      scope: 'LOCATION:LOC-STUDIO-NORTH:AVAILABILITY',
      state: 'CONFIRMED',
      value: 'AVAILABLE',
    }),
    proof({
      subjectId: 'PATH-CAPTURE-PRIMARY',
      subjectType: 'EQUIPMENT_PATH',
      aspect: 'OPERATIONAL_STATE',
      scope: 'EQUIPMENT_PATH:PATH-CAPTURE-PRIMARY:OPERATIONAL_STATE',
      state: 'CONFIRMED',
      value: 'READY',
    }),
  ];
}

function inputFromPack(
  pack: ProductionPack,
  proofs: readonly SubjectProof[],
  overrides: Partial<ReadinessEvaluationInput> = {},
): ReadinessEvaluationInput {
  return {
    productionId: pack.production.id,
    productionDate: pack.production.date,
    intendedUsageScope: 'PAID_CAMPAIGN',
    intendedDeliverableId: 'DELIVERABLE-D7',
    hardGates: pack.hardGates.map((gate) => ({
      id: gate.id,
      subjectType: gate.subjectType,
      subjectIds: gate.subjectIds,
    })),
    documents: pack.rights.map((document) => ({
      id: document.id,
      kind: document.kind,
      validFromDate: document.validFromDate,
      validThroughDate: document.validThroughDate,
      personIds: document.personIds,
      locationIds: document.locationIds,
      coversDeliverableIds: document.coversDeliverableIds,
      usageScopes: document.usageScopes,
    })),
    capturePaths: pack.capturePaths.map((path) => ({
      id: path.id,
      primaryEquipmentIds: path.primaryEquipmentIds,
      backupEquipmentIds: path.backupEquipmentIds,
    })),
    equipment: pack.equipment.map((asset) => ({
      id: asset.id,
      category: asset.category,
      operationalState: asset.operationalState,
    })),
    proofs,
    requiredPersonIds: ['PERSON-MODEL'],
    requiredLocationIds: [],
    domainFacts: [],
    ...overrides,
  };
}

function gateState(
  result: ReturnType<typeof evaluateCriticalGates>,
  id: string,
): string | undefined {
  return result.gates.find((gate) => gate.id === id)?.state;
}

function setEquipmentState(
  pack: ProductionPack,
  equipmentId: string,
  operationalState: ProductionPack['equipment'][number]['operationalState'],
): ProductionPack {
  const next = clonePack(pack);
  return {
    ...next,
    equipment: next.equipment.map((asset) =>
      asset.id === equipmentId ? { ...asset, operationalState } : asset,
    ),
  };
}

describe('evaluateCriticalGates', () => {
  it('returns exactly the five canonical hard gates and never a weather gate', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const randomSpy = vi.spyOn(Math, 'random');
    const pack = await loadCanonicalPack();
    const result = evaluateCriticalGates(inputFromPack(pack, canonicalProofs()));

    expect(result.gates.map((gate) => gate.id)).toEqual([...CANONICAL_GATES]);
    expect(result.gates).toHaveLength(5);
    expect(result.failedGateIds).toEqual([]);
    expect(result.unresolvedGateIds).toEqual([]);
    expect(result.gates.some((gate) => String(gate.id).includes('WEATHER'))).toBe(false);
    expect(nowSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('treats missing proof as UNRESOLVED, not FAILED', async () => {
    const pack = await loadCanonicalPack();
    const result = evaluateCriticalGates(inputFromPack(pack, []));

    expect(gateState(result, 'LOCATION_ACCESS')).toBe('UNRESOLVED');
    expect(gateState(result, 'CRITICAL_TALENT')).toBe('UNRESOLVED');
    expect(gateState(result, 'RIGHTS')).toBe('UNRESOLVED');
    expect(gateState(result, 'STUDIO_AVAILABILITY')).toBe('UNRESOLVED');
    expect(result.failedGateIds).toEqual(
      result.gates.filter((gate) => gate.state === 'FAILED').map((gate) => gate.id),
    );
    expect(result.unresolvedGateIds).toEqual(
      result.gates.filter((gate) => gate.state === 'UNRESOLVED').map((gate) => gate.id),
    );
    expect(result.unresolvedGateIds.every((id) => HARD_GATE_IDS.includes(id))).toBe(true);
    expect(
      result.gates.every((gate) => gate.state !== 'FAILED' || gate.id === 'CRITICAL_CAPTURE_KIT'),
    ).toBe(true);
  });

  it('keeps an unresolved evidence conflict from becoming authoritative gate truth', async () => {
    const pack = await loadCanonicalPack();
    const result = evaluateCriticalGates(
      inputFromPack(pack, [
        proof({
          subjectId: 'LOC-GOTHIC',
          subjectType: 'LOCATION',
          aspect: 'ACCESS',
          scope: 'LOCATION:LOC-GOTHIC:ACCESS',
          state: 'CONFLICTED',
          value: 'VALID',
        }),
        confirmedAccess('LOC-EIXAMPLE'),
      ]),
    );

    expect(gateState(result, 'LOCATION_ACCESS')).toBe('UNRESOLVED');
    expect(result.gates.find((gate) => gate.id === 'LOCATION_ACCESS')?.reasons).not.toContain(
      'FAILED',
    );
  });

  it('does not let an unrelated conflict poison unrelated gates', async () => {
    const pack = await loadCanonicalPack();
    const proofs = [
      ...canonicalProofs(),
      proof({
        subjectId: 'PERSON-STYLIST',
        subjectType: 'PERSON',
        aspect: 'AVAILABILITY',
        scope: 'PERSON:PERSON-STYLIST:AVAILABILITY',
        state: 'CONFLICTED',
        value: 'UNAVAILABLE',
      }),
    ];
    const result = evaluateCriticalGates(inputFromPack(pack, proofs));

    expect(gateState(result, 'CRITICAL_TALENT')).toBe('PASSED');
    expect(gateState(result, 'LOCATION_ACCESS')).toBe('PASSED');
    expect(gateState(result, 'STUDIO_AVAILABILITY')).toBe('PASSED');
  });

  it('fails RIGHTS when a present model release does not cover PAID_CAMPAIGN usage', async () => {
    const pack = clonePack(await loadCanonicalPack());
    const mutated: ProductionPack = {
      ...pack,
      rights: pack.rights.map((document) =>
        document.id === 'DOCUMENT-MODEL-RELEASE'
          ? { ...document, usageScopes: ['EDITORIAL'] }
          : document,
      ),
    };
    const result = evaluateCriticalGates(inputFromPack(mutated, canonicalProofs()));
    expect(gateState(result, 'RIGHTS')).toBe('FAILED');
  });

  it('fails RIGHTS when deliverable coverage is wrong', async () => {
    const pack = clonePack(await loadCanonicalPack());
    const mutated: ProductionPack = {
      ...pack,
      rights: pack.rights.map((document) =>
        document.id === 'DOCUMENT-MODEL-RELEASE'
          ? { ...document, coversDeliverableIds: ['DELIVERABLE-D1'] }
          : document,
      ),
    };
    const result = evaluateCriticalGates(inputFromPack(mutated, canonicalProofs()));
    expect(gateState(result, 'RIGHTS')).toBe('FAILED');
  });

  it('passes RIGHTS for a valid scoped model release with authoritative proof', async () => {
    const pack = await loadCanonicalPack();
    const result = evaluateCriticalGates(inputFromPack(pack, canonicalProofs()));
    expect(gateState(result, 'RIGHTS')).toBe('PASSED');
  });

  it('fails RIGHTS when a required person is outside the document person scope', async () => {
    const pack = await loadCanonicalPack();
    const result = evaluateCriticalGates(
      inputFromPack(pack, canonicalProofs(), { requiredPersonIds: ['PERSON-STYLIST'] }),
    );
    expect(gateState(result, 'RIGHTS')).toBe('FAILED');
    expect(result.gates.find((gate) => gate.id === 'RIGHTS')?.reasons.join(' ')).toMatch(
      /PERSON_SCOPE_MISMATCH/,
    );
  });

  it('passes RIGHTS when the required person is in the document person scope', async () => {
    const pack = await loadCanonicalPack();
    const result = evaluateCriticalGates(
      inputFromPack(pack, canonicalProofs(), { requiredPersonIds: ['PERSON-MODEL'] }),
    );
    expect(gateState(result, 'RIGHTS')).toBe('PASSED');
  });

  it('fails RIGHTS when a location-scoped document does not cover the required location', async () => {
    const pack = clonePack(await loadCanonicalPack());
    const mutated: ProductionPack = {
      ...pack,
      rights: pack.rights.map((document) =>
        document.id === 'DOCUMENT-MODEL-RELEASE'
          ? { ...document, locationIds: ['LOC-GOTHIC'] }
          : document,
      ),
    };
    const result = evaluateCriticalGates(
      inputFromPack(mutated, canonicalProofs(), { requiredLocationIds: ['LOC-EIXAMPLE'] }),
    );
    expect(gateState(result, 'RIGHTS')).toBe('FAILED');
    expect(result.gates.find((gate) => gate.id === 'RIGHTS')?.reasons.join(' ')).toMatch(
      /LOCATION_SCOPE_MISMATCH/,
    );
  });

  it('treats omitted rights person or location context as UNRESOLVED, not FAILED', async () => {
    const pack = await loadCanonicalPack();
    const base = inputFromPack(pack, canonicalProofs());
    const withoutPeople = { ...base };
    delete (withoutPeople as { requiredPersonIds?: unknown }).requiredPersonIds;
    const withoutLocations = { ...base };
    delete (withoutLocations as { requiredLocationIds?: unknown }).requiredLocationIds;

    const missingPeople = evaluateCriticalGates(withoutPeople);
    const missingLocations = evaluateCriticalGates(withoutLocations);
    expect(gateState(missingPeople, 'RIGHTS')).toBe('UNRESOLVED');
    expect(missingPeople.gates.find((gate) => gate.id === 'RIGHTS')?.reasons).toContain(
      'RIGHTS_SCOPE_CONTEXT_MISSING',
    );
    expect(gateState(missingLocations, 'RIGHTS')).toBe('UNRESOLVED');
    expect(missingLocations.gates.find((gate) => gate.id === 'RIGHTS')?.reasons).toContain(
      'RIGHTS_SCOPE_CONTEXT_MISSING',
    );
  });

  it('does not invent a location restriction from empty document locationIds', async () => {
    const pack = await loadCanonicalPack();
    const modelRelease = pack.rights.find((item) => item.id === 'DOCUMENT-MODEL-RELEASE');
    expect(modelRelease?.locationIds).toEqual([]);
    const result = evaluateCriticalGates(
      inputFromPack(pack, canonicalProofs(), { requiredLocationIds: ['LOC-GOTHIC'] }),
    );
    expect(gateState(result, 'RIGHTS')).toBe('PASSED');
  });

  it('does not invent expiration failure from null rights date bounds', async () => {
    const pack = await loadCanonicalPack();
    const modelRelease = pack.rights.find((item) => item.id === 'DOCUMENT-MODEL-RELEASE');
    expect(modelRelease?.validFromDate).toBeNull();
    expect(modelRelease?.validThroughDate).toBeNull();
    expect(gateState(evaluateCriticalGates(inputFromPack(pack, canonicalProofs())), 'RIGHTS')).toBe(
      'PASSED',
    );
  });

  it('enforces rights validity bounds when they exist', async () => {
    const pack = clonePack(await loadCanonicalPack());
    const bounded: ProductionPack = {
      ...pack,
      rights: pack.rights.map((document) =>
        document.id === 'DOCUMENT-MODEL-RELEASE'
          ? { ...document, validFromDate: '2026-09-17', validThroughDate: '2026-09-17' }
          : document,
      ),
    };
    const passing = evaluateCriticalGates(inputFromPack(bounded, canonicalProofs()));
    const expired = evaluateCriticalGates(
      inputFromPack(bounded, canonicalProofs(), { productionDate: '2026-09-18' }),
    );
    expect(gateState(passing, 'RIGHTS')).toBe('PASSED');
    expect(gateState(expired, 'RIGHTS')).toBe('FAILED');
  });

  it('passes CRITICAL_CAPTURE_KIT when primary body failed but a complete backup path is ready', async () => {
    const pack = setEquipmentState(await loadCanonicalPack(), 'EQ-BODY-PRIMARY', 'FAILED');
    const result = evaluateCriticalGates(inputFromPack(pack, canonicalProofs()));
    expect(gateState(result, 'CRITICAL_CAPTURE_KIT')).toBe('PASSED');
  });

  it('fails CRITICAL_CAPTURE_KIT when no complete approved capture path is operational', async () => {
    let pack = await loadCanonicalPack();
    pack = setEquipmentState(pack, 'EQ-BODY-PRIMARY', 'FAILED');
    pack = setEquipmentState(pack, 'EQ-BODY-BACKUP', 'FAILED');
    const result = evaluateCriticalGates(inputFromPack(pack, canonicalProofs()));
    expect(gateState(result, 'CRITICAL_CAPTURE_KIT')).toBe('FAILED');
  });

  it('treats missing capture-path proof as UNRESOLVED', async () => {
    const pack = await loadCanonicalPack();
    const proofs = canonicalProofs().filter((item) => item.subjectId !== 'PATH-CAPTURE-PRIMARY');
    proofs.push(
      proof({
        subjectId: 'PATH-CAPTURE-PRIMARY',
        subjectType: 'EQUIPMENT_PATH',
        aspect: 'OPERATIONAL_STATE',
        scope: 'EQUIPMENT_PATH:PATH-CAPTURE-PRIMARY:OPERATIONAL_STATE',
        state: 'MISSING',
      }),
    );
    const result = evaluateCriticalGates(inputFromPack(pack, proofs));
    expect(gateState(result, 'CRITICAL_CAPTURE_KIT')).toBe('UNRESOLVED');
  });

  it('passes LOCATION_ACCESS when Gothic and Eixample access are confirmed', async () => {
    const pack = await loadCanonicalPack();
    expect(
      gateState(evaluateCriticalGates(inputFromPack(pack, canonicalProofs())), 'LOCATION_ACCESS'),
    ).toBe('PASSED');
  });

  it('fails LOCATION_ACCESS on explicit access denial', async () => {
    const pack = await loadCanonicalPack();
    const proofs = [
      deniedAccess('LOC-GOTHIC'),
      confirmedAccess('LOC-EIXAMPLE'),
      ...canonicalProofs().filter((item) => item.aspect !== 'ACCESS'),
    ];
    expect(gateState(evaluateCriticalGates(inputFromPack(pack, proofs)), 'LOCATION_ACCESS')).toBe(
      'FAILED',
    );
  });

  it('lists failed and unresolved gate IDs in canonical order', async () => {
    const pack = await loadCanonicalPack();
    const proofs = [
      deniedAccess('LOC-GOTHIC'),
      confirmedAccess('LOC-EIXAMPLE'),
      proof({
        subjectId: 'PERSON-MODEL',
        subjectType: 'PERSON',
        aspect: 'AVAILABILITY',
        scope: 'PERSON:PERSON-MODEL:AVAILABILITY',
        state: 'MISSING',
      }),
    ];
    const result = evaluateCriticalGates(inputFromPack(pack, proofs));
    expect(result.failedGateIds).toEqual(['LOCATION_ACCESS']);
    expect(result.unresolvedGateIds).toEqual(['CRITICAL_TALENT', 'RIGHTS', 'STUDIO_AVAILABILITY']);
  });

  it('passes confirmed critical talent and fails explicit unavailability', async () => {
    const pack = await loadCanonicalPack();
    const passing = evaluateCriticalGates(inputFromPack(pack, canonicalProofs()));
    const failingProofs = canonicalProofs().map((item) =>
      item.subjectId === 'PERSON-MODEL'
        ? {
            ...item,
            state: 'DENIED' as const,
            value: 'UNAVAILABLE',
          }
        : item,
    );
    const failing = evaluateCriticalGates(inputFromPack(pack, failingProofs));
    expect(gateState(passing, 'CRITICAL_TALENT')).toBe('PASSED');
    expect(gateState(failing, 'CRITICAL_TALENT')).toBe('FAILED');
  });

  it('passes confirmed Studio North booking and fails explicit cancellation', async () => {
    const pack = await loadCanonicalPack();
    const passing = evaluateCriticalGates(inputFromPack(pack, canonicalProofs()));
    const failingProofs = canonicalProofs().map((item) =>
      item.subjectId === 'LOC-STUDIO-NORTH'
        ? {
            ...item,
            state: 'DENIED' as const,
            value: 'CANCELLED',
          }
        : item,
    );
    const failing = evaluateCriticalGates(inputFromPack(pack, failingProofs));
    expect(gateState(passing, 'STUDIO_AVAILABILITY')).toBe('PASSED');
    expect(gateState(failing, 'STUDIO_AVAILABILITY')).toBe('FAILED');
  });

  it('does not let weather evidence create or fail a hard gate', async () => {
    const pack = await loadCanonicalPack();
    const proofs = [
      ...canonicalProofs(),
      proof({
        subjectId: 'LOC-GOTHIC',
        subjectType: 'LOCATION',
        aspect: 'ACCESS',
        scope: 'LOCATION:LOC-GOTHIC:WEATHER',
        state: 'DENIED',
        value: 'STORM',
      }),
    ];
    const result = evaluateCriticalGates(inputFromPack(pack, proofs));
    expect(result.gates.map((gate) => gate.id)).toEqual([...CANONICAL_GATES]);
    expect(gateState(result, 'LOCATION_ACCESS')).toBe('PASSED');
  });
});

describe('evaluateDomainHealth', () => {
  it('evaluates exactly the six canonical production domains', async () => {
    const pack = await loadCanonicalPack();
    const result = evaluateDomainHealth(inputFromPack(pack, canonicalProofs()));
    expect(result.domains.map((item) => item.domain)).toEqual([...CANONICAL_DOMAINS]);
    expect(result.domains).toHaveLength(6);
  });

  it('produces identical gate and domain results for reordered equivalent input', async () => {
    const pack = await loadCanonicalPack();
    const proofs = canonicalProofs();
    const forwardInput = inputFromPack(pack, proofs);
    const reversedInput: ReadinessEvaluationInput = {
      ...forwardInput,
      hardGates: [...forwardInput.hardGates].reverse(),
      documents: [...forwardInput.documents].reverse(),
      capturePaths: [...forwardInput.capturePaths].reverse(),
      equipment: [...forwardInput.equipment].reverse(),
      proofs: [...proofs].reverse(),
    };

    const forwardGates = evaluateCriticalGates(forwardInput);
    const reversedGates = evaluateCriticalGates(reversedInput);
    const forwardDomains = evaluateDomainHealth(forwardInput);
    const reversedDomains = evaluateDomainHealth(reversedInput);

    expect(JSON.stringify(reversedGates)).toBe(JSON.stringify(forwardGates));
    expect(JSON.stringify(reversedDomains)).toBe(JSON.stringify(forwardDomains));
  });

  it('passes all six domains when baseline facts and relevant gates pass', async () => {
    const pack = await loadCanonicalPack();
    const domainFacts: DomainFact[] = [...CANONICAL_DOMAINS].reverse().map((domain) => ({
      domain,
      state: 'PASSED',
      reasons: [`FACT_${domain}_PASSED`],
    }));
    const result = evaluateDomainHealth(inputFromPack(pack, canonicalProofs(), { domainFacts }));
    expect(result.domains.map((item) => item.domain)).toEqual([...CANONICAL_DOMAINS]);
    expect(result.domains.every((item) => item.state === 'PASSED')).toBe(true);
  });

  it('lets TIME_ENVIRONMENT pass or stay unresolved without affecting unrelated domains', async () => {
    const pack = await loadCanonicalPack();
    const passingFacts: DomainFact[] = CANONICAL_DOMAINS.map((domain) => ({
      domain,
      state: 'PASSED',
      reasons: [`FACT_${domain}_PASSED`],
    }));
    const unresolvedTime: DomainFact[] = passingFacts.map((fact) =>
      fact.domain === 'TIME_ENVIRONMENT'
        ? { ...fact, state: 'UNRESOLVED', reasons: ['FACT_TIME_ENVIRONMENT_UNRESOLVED'] }
        : fact,
    );
    const passed = evaluateDomainHealth(
      inputFromPack(pack, canonicalProofs(), { domainFacts: passingFacts }),
    );
    const unresolved = evaluateDomainHealth(
      inputFromPack(pack, canonicalProofs(), { domainFacts: unresolvedTime }),
    );
    expect(passed.domains.find((item) => item.domain === 'TIME_ENVIRONMENT')?.state).toBe('PASSED');
    expect(unresolved.domains.find((item) => item.domain === 'TIME_ENVIRONMENT')?.state).toBe(
      'UNRESOLVED',
    );
    expect(unresolved.domains.find((item) => item.domain === 'PEOPLE')?.state).toBe('PASSED');
    expect(unresolved.domains.find((item) => item.domain === 'EQUIPMENT')?.state).toBe('PASSED');
  });

  it('evaluates LOGISTICS facts independently of the studio gate and lets a failed gate dominate', async () => {
    const pack = await loadCanonicalPack();
    const logisticsFailed: DomainFact[] = CANONICAL_DOMAINS.map((domain) => ({
      domain,
      state: domain === 'LOGISTICS' ? 'FAILED' : 'PASSED',
      reasons: [`FACT_${domain}`],
    }));
    const peoplePassed: DomainFact[] = CANONICAL_DOMAINS.map((domain) => ({
      domain,
      state: 'PASSED',
      reasons: [`FACT_${domain}`],
    }));
    const studioPassing = evaluateDomainHealth(
      inputFromPack(pack, canonicalProofs(), { domainFacts: logisticsFailed }),
    );
    const talentDenied = canonicalProofs().map((item) =>
      item.subjectId === 'PERSON-MODEL'
        ? { ...item, state: 'DENIED' as const, value: 'UNAVAILABLE' }
        : item,
    );
    const talentFailed = evaluateDomainHealth(
      inputFromPack(pack, talentDenied, { domainFacts: peoplePassed }),
    );
    expect(studioPassing.domains.find((item) => item.domain === 'LOGISTICS')?.state).toBe('FAILED');
    expect(studioPassing.domains.find((item) => item.domain === 'LOCATION')?.state).toBe('PASSED');
    expect(talentFailed.domains.find((item) => item.domain === 'PEOPLE')?.state).toBe('FAILED');
  });

  it('treats a missing TIME_ENVIRONMENT domain fact as UNRESOLVED', async () => {
    const pack = await loadCanonicalPack();
    const result = evaluateDomainHealth(
      inputFromPack(pack, canonicalProofs(), { domainFacts: [] }),
    );
    expect(result.domains.find((item) => item.domain === 'TIME_ENVIRONMENT')?.state).toBe(
      'UNRESOLVED',
    );
  });

  it('treats missing gated domain facts as UNRESOLVED even when the relevant gate passed', async () => {
    const pack = await loadCanonicalPack();
    const cases = ['PEOPLE', 'LOCATION', 'EQUIPMENT', 'DOCUMENTS_RIGHTS', 'LOGISTICS'] as const;
    for (const missing of cases) {
      const domainFacts: DomainFact[] = CANONICAL_DOMAINS.filter(
        (domain) => domain !== missing,
      ).map((domain) => ({
        domain,
        state: 'PASSED',
        reasons: [`FACT_${domain}_PASSED`],
      }));
      const result = evaluateDomainHealth(inputFromPack(pack, canonicalProofs(), { domainFacts }));
      const health = result.domains.find((item) => item.domain === missing);
      expect(health?.state, missing).toBe('UNRESOLVED');
      expect(health?.reasons.join(' '), missing).toContain(`${missing}_FACT_MISSING`);
    }
  });

  it('keeps domain order stable when domain facts are reversed', async () => {
    const pack = await loadCanonicalPack();
    const facts: DomainFact[] = CANONICAL_DOMAINS.map((domain) => ({
      domain,
      state: 'PASSED',
      reasons: [`FACT_${domain}_PASSED`],
    }));
    const forward = evaluateDomainHealth(
      inputFromPack(pack, canonicalProofs(), { domainFacts: facts }),
    );
    const reversed = evaluateDomainHealth(
      inputFromPack(pack, canonicalProofs(), { domainFacts: [...facts].reverse() }),
    );
    expect(reversed.domains.map((item) => item.domain)).toEqual([...CANONICAL_DOMAINS]);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

describe('evaluateApprovedCapturePath', () => {
  const motionOnly = [
    { id: 'EQ-MOTION-GIMBAL', category: 'MOTION' as const, operationalState: 'READY' as const },
    { id: 'EQ-TETHER', category: 'TETHERING' as const, operationalState: 'READY' as const },
  ];
  const failedPrimaryStills = [
    { id: 'EQ-BODY-PRIMARY', category: 'BODY' as const, operationalState: 'FAILED' as const },
    { id: 'EQ-LENS-PRIMARY', category: 'LENS' as const, operationalState: 'READY' as const },
    { id: 'EQ-MEDIA-PRIMARY', category: 'MEDIA' as const, operationalState: 'READY' as const },
    { id: 'EQ-POWER-PRIMARY', category: 'POWER' as const, operationalState: 'READY' as const },
  ];
  const unknownBackupBody = [
    { id: 'EQ-BODY-BACKUP', category: 'BODY' as const, operationalState: 'UNKNOWN' as const },
    { id: 'EQ-LENS-BACKUP', category: 'LENS' as const, operationalState: 'READY' as const },
    { id: 'EQ-MEDIA-BACKUP', category: 'MEDIA' as const, operationalState: 'READY' as const },
    { id: 'EQ-POWER-BACKUP', category: 'POWER' as const, operationalState: 'READY' as const },
  ];

  it('fails when both approved capture lists are structurally incomplete', () => {
    expect(
      evaluateApprovedCapturePath(
        {
          id: 'PATH-INCOMPLETE',
          primaryEquipmentIds: ['EQ-MOTION-GIMBAL'],
          backupEquipmentIds: ['EQ-TETHER'],
        },
        motionOnly,
      ),
    ).toBe('FAILED');
  });

  it('fails when one list is failed and the other is structurally incomplete', () => {
    expect(
      evaluateApprovedCapturePath(
        {
          id: 'PATH-FAILED-INCOMPLETE',
          primaryEquipmentIds: [
            'EQ-BODY-PRIMARY',
            'EQ-LENS-PRIMARY',
            'EQ-MEDIA-PRIMARY',
            'EQ-POWER-PRIMARY',
          ],
          backupEquipmentIds: ['EQ-TETHER'],
        },
        [...failedPrimaryStills, ...motionOnly],
      ),
    ).toBe('FAILED');
  });

  it('stays unresolved when a failed list is paired with unresolved proof', () => {
    expect(
      evaluateApprovedCapturePath(
        {
          id: 'PATH-FAILED-UNRESOLVED',
          primaryEquipmentIds: [
            'EQ-BODY-PRIMARY',
            'EQ-LENS-PRIMARY',
            'EQ-MEDIA-PRIMARY',
            'EQ-POWER-PRIMARY',
          ],
          backupEquipmentIds: [
            'EQ-BODY-BACKUP',
            'EQ-LENS-BACKUP',
            'EQ-MEDIA-BACKUP',
            'EQ-POWER-BACKUP',
          ],
        },
        [...failedPrimaryStills, ...unknownBackupBody],
      ),
    ).toBe('UNRESOLVED');
  });
});

describe('readiness-engine source authority', () => {
  it('does not use Date.now, Math.random, or UUID operational authority', async () => {
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const sources = await Promise.all(
      ['domain-health.ts', 'equipment-paths.ts', 'rights.ts', 'gates.ts', 'index.ts'].map(
        (fileName) => readFile(join(sourceDir, fileName), 'utf8'),
      ),
    );
    const joined = sources.join('\n');
    expect(joined).not.toMatch(/Date\.now\s*\(/);
    expect(joined).not.toMatch(/Math\.random\s*\(/);
    expect(joined).not.toMatch(/randomUUID/);
    expect(joined).not.toMatch(/uuid/i);
    expect(joined).not.toMatch(/readiness\.readyFloor/);
    expect(joined).not.toMatch(/causal/i);
    expect(joined).not.toMatch(/shadow/i);
  });
});
