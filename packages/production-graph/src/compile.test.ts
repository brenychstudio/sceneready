import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createEvidenceEnvelope,
  createScopedEvidence,
  resolveEvidenceSet,
  type ResolvedEvidenceSet,
} from '@sceneready/evidence';
import {
  activateProductionPack,
  validateProductionPack,
  type ProductionActivationManifest,
  type ProductionPack,
} from '@sceneready/production-pack';
import { SCENEREADY_POLICY_V1 } from '@sceneready/readiness-engine';

import { compileProductionGraph, type ProductionGraph } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/barcelona-aer-ss27',
);

const EMPTY_EVIDENCE: ResolvedEvidenceSet = Object.freeze({
  active: Object.freeze([]),
  superseded: Object.freeze([]),
  conflicts: Object.freeze([]),
});

const ACTIVATED_AT = '2026-09-17T03:45:00Z';
const NOW_INSTANT = '2026-09-17T05:00:00Z';

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

async function loadCanonicalContext(): Promise<{
  readonly pack: ProductionPack;
  readonly activation: ProductionActivationManifest;
}> {
  const input = await loadCanonicalBarcelonaPack();
  const validated = validateProductionPack(input);
  expect(validated.ok).toBe(true);
  if (!validated.ok) {
    throw new Error('canonical Barcelona pack failed validation');
  }
  return {
    pack: validated.pack,
    activation: activateProductionPack(validated.pack, ACTIVATED_AT),
  };
}

function compileCanonical(
  pack: ProductionPack,
  activation: ProductionActivationManifest,
  evidence: ResolvedEvidenceSet = EMPTY_EVIDENCE,
): ProductionGraph {
  return compileProductionGraph({ pack, activation, evidence });
}

function packEntityIds(pack: ProductionPack): string[] {
  return [
    ...pack.crew.map((item) => item.id),
    ...pack.locations.map((item) => item.id),
    ...pack.schedule.map((item) => item.id),
    ...pack.deliverables.map((item) => item.id),
    ...pack.equipment.map((item) => item.id),
    ...pack.capturePaths.map((item) => item.id),
    ...pack.rights.map((item) => item.id),
    ...pack.hardGates.map((item) => item.id),
    ...pack.evidence.map((item) => item.id),
  ];
}

function hasEdge(graph: ProductionGraph, from: string, to: string, type: string): boolean {
  return graph.edges.some((edge) => edge.from === from && edge.to === to && edge.type === type);
}

function reversePack(pack: ProductionPack): ProductionPack {
  return {
    ...pack,
    crew: [...pack.crew].reverse(),
    locations: [...pack.locations].reverse(),
    schedule: [...pack.schedule].reverse(),
    deliverables: [...pack.deliverables].reverse(),
    equipment: [...pack.equipment].reverse(),
    capturePaths: [...pack.capturePaths].reverse(),
    rights: [...pack.rights].reverse(),
    hardGates: [...pack.hardGates].reverse(),
    evidence: [...pack.evidence].reverse(),
  };
}

describe('compileProductionGraph', () => {
  it('compiles BCN-DEMO-v1 into a deterministic SR-GRAPH-v1 graph', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const randomSpy = vi.spyOn(Math, 'random');
    const { pack, activation } = await loadCanonicalContext();
    const graph = compileCanonical(pack, activation);
    const entityIds = packEntityIds(pack);
    const nodeIds = graph.nodes.map((node) => node.id);

    expect(graph.schemaVersion).toBe('SR-GRAPH-v1');
    expect(graph.productionId).toBe('BCN-DEMO-01');
    expect(graph.productionRevision).toBe(1);
    expect(graph.graphRevision).toBe(1);
    expect(graph.policyVersion).toBe('SR-POLICY-v1');
    expect(graph.fixtureVersion).toBe('BCN-DEMO-v1');
    expect(graph.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(nodeIds).toContain('DELIVERABLE-D1');
    expect(hasEdge(graph, 'DOCUMENT-MODEL-RELEASE', 'DELIVERABLE-D7', 'BLOCKS')).toBe(true);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(nodeIds).toEqual([...nodeIds].sort());
    expect(entityIds.every((id) => nodeIds.includes(id))).toBe(true);
    expect(nodeIds.length).toBe(entityIds.length);
    expect(graph.edges.some((edge) => edge.type === 'SCHEDULED_BEFORE')).toBe(true);
    expect(nowSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('compiles every canonical entity exactly once and rejects duplicate node IDs', async () => {
    const { pack, activation } = await loadCanonicalContext();
    const graph = compileCanonical(pack, activation);
    const firstCrew = pack.crew[0];
    if (firstCrew === undefined) {
      throw new Error('canonical crew is empty');
    }

    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
    expect(() =>
      compileCanonical(
        {
          ...pack,
          crew: [firstCrew, { ...firstCrew }],
        },
        activation,
      ),
    ).toThrow(/duplicate node/i);
  });

  it('rejects dangling edges', async () => {
    const { pack, activation } = await loadCanonicalContext();
    const firstActivity = pack.schedule[0];
    if (firstActivity === undefined) {
      throw new Error('canonical schedule is empty');
    }

    expect(() =>
      compileCanonical(
        {
          ...pack,
          schedule: [
            { ...firstActivity, dependsOn: ['ACT-DOES-NOT-EXIST'] },
            ...pack.schedule.slice(1),
          ],
        },
        activation,
      ),
    ).toThrow(/dangling edge/i);
  });

  it('produces identical nodes, edges, and fingerprint for reversed pack input', async () => {
    const { pack, activation } = await loadCanonicalContext();
    const forward = compileCanonical(pack, activation);
    const reversed = compileCanonical(reversePack(pack), activation);

    expect(reversed.nodes).toEqual(forward.nodes);
    expect(reversed.edges).toEqual(forward.edges);
    expect(reversed.fingerprint).toBe(forward.fingerprint);
  });

  it('does not let an unresolved evidence conflict become active graph truth', async () => {
    const { pack, activation } = await loadCanonicalContext();
    const permit = createScopedEvidence({
      envelope: createEvidenceEnvelope({
        evidenceId: 'E-PERMIT',
        productionId: pack.production.id,
        kind: 'LOCATION_ACCESS',
        sourceType: 'EXTERNAL_PROVIDER',
        authorityClass: 'DOCUMENT_AUTHORITY',
        trustState: 'LIVE',
        observedAt: '2026-09-17T04:00:00Z',
        receivedAt: '2026-09-17T04:01:00Z',
        payload: { value: 'VALID' },
      }),
      scope: 'LOCATION:LOC-GOTHIC:ACCESS',
      value: 'VALID',
    });
    const lead = createScopedEvidence({
      envelope: createEvidenceEnvelope({
        evidenceId: 'E-LEAD',
        productionId: pack.production.id,
        kind: 'LOCATION_ACCESS',
        sourceType: 'EXTERNAL_PROVIDER',
        authorityClass: 'PRODUCTION_LEAD_ASSERTION',
        trustState: 'LIVE',
        observedAt: '2026-09-17T04:00:00Z',
        receivedAt: '2026-09-17T04:01:00Z',
        payload: { value: 'REVOKED' },
      }),
      scope: 'LOCATION:LOC-GOTHIC:ACCESS',
      value: 'REVOKED',
    });
    const resolved = resolveEvidenceSet([permit, lead], NOW_INSTANT, SCENEREADY_POLICY_V1);
    const graph = compileCanonical(pack, activation, resolved);
    const gothic = graph.nodes.find((node) => node.id === 'LOC-GOTHIC');

    expect(resolved.conflicts).toHaveLength(1);
    expect(resolved.active).toEqual([]);
    expect(resolved.conflicts[0]?.status).toBe('UNRESOLVED');
    expect(gothic).toEqual({ id: 'LOC-GOTHIC', type: 'LOCATION' });
    expect(Object.keys(gothic ?? {}).sort()).toEqual(['id', 'type']);
    expect(
      graph.edges.some(
        (edge) => edge.type === 'AFFECTS' && (edge.from === 'E-PERMIT' || edge.from === 'E-LEAD'),
      ),
    ).toBe(false);
    expect(graph.nodes.some((node) => 'value' in node && node.value === 'VALID')).toBe(false);
    expect(graph.nodes.some((node) => 'value' in node && node.value === 'REVOKED')).toBe(false);
  });

  it('changes the graph fingerprint when semantic graph content changes', async () => {
    const { pack, activation } = await loadCanonicalContext();
    const baseline = compileCanonical(pack, activation);
    const mutated = compileCanonical(
      {
        ...pack,
        crew: [
          ...pack.crew,
          {
            id: 'PERSON-EXTRA',
            role: 'Observer',
            name: 'Synthetic Extra Crew',
            critical: false,
          },
        ],
      },
      activation,
    );

    expect(mutated.nodes.some((node) => node.id === 'PERSON-EXTRA')).toBe(true);
    expect(mutated.fingerprint).not.toBe(baseline.fingerprint);
    expect(mutated.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
