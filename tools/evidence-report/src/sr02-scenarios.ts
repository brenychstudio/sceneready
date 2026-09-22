import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createGraphEdge,
  createGraphNode,
  createProductionGraph,
  type ProductionGraph,
  type ProductionGraphEdge,
} from '@sceneready/production-graph';
import { validateProductionPack, type ProductionPack } from '@sceneready/production-pack';
import {
  HARD_GATE_IDS,
  PRODUCTION_DOMAINS,
  SCENEREADY_POLICY_V1,
  type ProductionEvaluationInput,
  type ProductionReadinessAssessment,
  type ReadinessComparison,
  type ReadinessImpactFact,
  type ReadinessRiskFact,
} from '@sceneready/readiness-engine';

export const WEATHER_EVIDENCE_ID = 'EVIDENCE-WEATHER-DRIFT';
export const TRAVEL_EVIDENCE_ID = 'EVIDENCE-TRAVEL-DRIFT';
const COMPOUND_INCIDENT_ID = 'INCIDENT-COMPOUND-DRIFT';
const GOTHIC_RISK_ID = 'RISK-GOTHIC-LOOK-03';
const EIXAMPLE_RISK_ID = 'RISK-EIXAMPLE-LOOK-05';
const STUDIO_RISK_ID = 'RISK-STUDIO-LOAD-IN';
export const ACTIVATED_AT = '2026-09-17T03:45:00Z';

export interface CanonicalDriftEvidenceFact {
  readonly evidenceId: string;
  readonly kind: 'WEATHER' | 'TRAVEL';
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly payload: Readonly<Record<string, number>>;
}

export const CANONICAL_DRIFT_EVIDENCE: readonly CanonicalDriftEvidenceFact[] = Object.freeze([
  Object.freeze({
    evidenceId: WEATHER_EVIDENCE_ID,
    kind: 'WEATHER',
    observedAt: '2026-09-17T06:00:00Z',
    receivedAt: '2026-09-17T06:00:30Z',
    payload: Object.freeze({ windowCompressionMinutes: -35 }),
  }),
  Object.freeze({
    evidenceId: TRAVEL_EVIDENCE_ID,
    kind: 'TRAVEL',
    observedAt: '2026-09-17T06:00:00Z',
    receivedAt: '2026-09-17T06:00:30Z',
    payload: Object.freeze({ loadInDelayMinutes: 14 }),
  }),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fixtureDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/barcelona-aer-ss27');
}

async function readJson(directory: string, fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, fileName), 'utf8')) as unknown;
}

export async function loadCanonicalPack(): Promise<ProductionPack> {
  const directory = fixtureDirectory();
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
    readJson(directory, 'manifest.json'),
    readJson(directory, 'production.json'),
    readJson(directory, 'crew.json'),
    readJson(directory, 'locations.json'),
    readJson(directory, 'schedule.json'),
    readJson(directory, 'deliverables.json'),
    readJson(directory, 'equipment.json'),
    readJson(directory, 'rights.json'),
    readJson(directory, 'priorities.json'),
  ]);
  if (!isRecord(manifest) || !isRecord(equipment) || !isRecord(rights)) {
    throw new Error('canonical Barcelona fixture sections are malformed');
  }
  const validated = validateProductionPack({
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
  });
  if (!validated.ok) {
    throw new Error('canonical Barcelona pack failed validation');
  }
  return validated.pack;
}

function passedDomains(): NonNullable<ProductionEvaluationInput['domainFacts']> {
  return PRODUCTION_DOMAINS.map((domain) => ({
    domain,
    state: 'PASSED' as const,
    reasons: [`${domain}_OK`],
  }));
}

function modelRelease(): ProductionEvaluationInput['documents'][number] {
  return {
    id: 'DOCUMENT-MODEL-RELEASE',
    kind: 'MODEL_RELEASE',
    validFromDate: null,
    validThroughDate: null,
    personIds: ['PERSON-MODEL'],
    locationIds: [],
    coversDeliverableIds: ['DELIVERABLE-D7'],
    usageScopes: ['PAID_CAMPAIGN'],
  };
}

function canonicalDeliverables(): ProductionEvaluationInput['deliverables'] {
  return [
    { deliverableId: 'DELIVERABLE-D1', importance: 'CRITICAL' },
    { deliverableId: 'DELIVERABLE-D2', importance: 'HIGH' },
    { deliverableId: 'DELIVERABLE-D3', importance: 'HIGH' },
    { deliverableId: 'DELIVERABLE-D4', importance: 'MEDIUM' },
    { deliverableId: 'DELIVERABLE-D5', importance: 'CRITICAL' },
    { deliverableId: 'DELIVERABLE-D6', importance: 'HIGH' },
    { deliverableId: 'DELIVERABLE-D7', importance: 'CRITICAL' },
  ];
}

function confirmedScope(scope: string, evidenceId: string) {
  return {
    scope,
    coverage: 'RESOLVED' as const,
    polarity: 'CONFIRMED' as const,
    evidenceId,
    fingerprint: `fp-${evidenceId}`,
    trustState: 'LIVE',
  };
}

function r1ConfidenceFacts() {
  return [
    confirmedScope('LOCATION:LOC-GOTHIC:ACCESS', 'EVD-GOTHIC-ACCESS'),
    confirmedScope('PERSON:PERSON-MODEL:AVAILABILITY', 'EVD-MODEL-AVAIL'),
    confirmedScope('DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY', 'EVD-MODEL-RELEASE'),
  ];
}

function baseInput(overrides: Partial<ProductionEvaluationInput> = {}): ProductionEvaluationInput {
  return {
    productionId: overrides.productionId ?? 'BCN-DEMO-01',
    productionDate: overrides.productionDate ?? '2026-09-17',
    intendedUsageScope: overrides.intendedUsageScope ?? 'PAID_CAMPAIGN',
    intendedDeliverableId: overrides.intendedDeliverableId ?? 'DELIVERABLE-D7',
    requiredPersonIds: overrides.requiredPersonIds ?? ['PERSON-MODEL'],
    requiredLocationIds: overrides.requiredLocationIds ?? [],
    hardGates:
      overrides.hardGates ??
      HARD_GATE_IDS.map((id) => ({
        id,
        subjectType: id === 'RIGHTS' ? 'DOCUMENT' : 'LOCATION',
        subjectIds: [],
      })),
    documents: overrides.documents ?? [modelRelease()],
    capturePaths: overrides.capturePaths ?? [],
    equipment: overrides.equipment ?? [],
    proofs: overrides.proofs ?? [],
    domainFacts: overrides.domainFacts !== undefined ? overrides.domainFacts : passedDomains(),
    policy: overrides.policy ?? SCENEREADY_POLICY_V1,
    risks: overrides.risks ?? [],
    impacts: overrides.impacts ?? [],
    deliverables: overrides.deliverables ?? canonicalDeliverables(),
    confidenceFacts: overrides.confidenceFacts ?? r1ConfidenceFacts(),
    requiredEvidenceScopes:
      overrides.requiredEvidenceScopes ?? r1ConfidenceFacts().map((item) => item.scope),
  };
}

export function r0Input(): ProductionEvaluationInput {
  return baseInput({
    hardGates: HARD_GATE_IDS.map((id) => ({
      id,
      subjectType: id === 'RIGHTS' ? 'DOCUMENT' : 'LOCATION',
      subjectIds: id === 'RIGHTS' ? ['DOCUMENT-MODEL-RELEASE'] : [],
    })),
    proofs: [
      {
        subjectId: 'DOCUMENT-MODEL-RELEASE',
        subjectType: 'DOCUMENT',
        aspect: 'VALIDITY',
        scope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        state: 'DENIED',
        value: 'ABSENT',
      },
    ],
    confidenceFacts: [
      {
        scope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        coverage: 'RESOLVED',
        polarity: 'DENIED',
        evidenceId: 'EVD-MODEL-RELEASE',
        fingerprint: 'fp-EVD-MODEL-RELEASE',
        trustState: 'LIVE',
      },
    ],
    requiredEvidenceScopes: ['DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY'],
  });
}

export function r2Risks(): readonly ReadinessRiskFact[] {
  return [
    {
      riskId: GOTHIC_RISK_ID,
      incidentId: COMPOUND_INCIDENT_ID,
      subjectId: 'ACT-GOTHIC-LOOK-03',
      severity: 'CRITICAL',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID],
      reasons: ['WEATHER_WINDOW_COMPRESSION'],
    },
    {
      riskId: EIXAMPLE_RISK_ID,
      incidentId: COMPOUND_INCIDENT_ID,
      subjectId: 'ACT-EIXAMPLE-LOOK-05',
      severity: 'HIGH',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID, TRAVEL_EVIDENCE_ID],
      reasons: ['WEATHER_WINDOW_COMPRESSION'],
    },
    {
      riskId: STUDIO_RISK_ID,
      incidentId: COMPOUND_INCIDENT_ID,
      subjectId: 'ACT-STUDIO-LOAD-IN',
      severity: 'MEDIUM',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID],
      reasons: ['TRAVEL_LOAD_IN_DELAY'],
    },
  ];
}

export function r2Impacts(): readonly ReadinessImpactFact[] {
  return [
    {
      incidentId: COMPOUND_INCIDENT_ID,
      deliverableId: 'DELIVERABLE-D2',
      severity: 'CRITICAL',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID, TRAVEL_EVIDENCE_ID],
      riskIds: [GOTHIC_RISK_ID],
    },
    {
      incidentId: COMPOUND_INCIDENT_ID,
      deliverableId: 'DELIVERABLE-D3',
      severity: 'HIGH',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
      riskIds: [EIXAMPLE_RISK_ID],
    },
    {
      incidentId: COMPOUND_INCIDENT_ID,
      deliverableId: 'DELIVERABLE-D5',
      severity: 'MEDIUM',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID],
      riskIds: [STUDIO_RISK_ID],
    },
  ];
}

export function r1Input(): ProductionEvaluationInput {
  return baseInput({
    risks: [
      {
        riskId: 'RISK-RESIDUAL-A',
        incidentId: 'INCIDENT-RESIDUAL-A',
        subjectId: 'ACT-STUDIO-LOAD-IN',
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVD-RESIDUAL-A'],
      },
      {
        riskId: 'RISK-RESIDUAL-B',
        incidentId: 'INCIDENT-RESIDUAL-B',
        subjectId: 'ACT-GOTHIC-LOOK-03',
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVD-RESIDUAL-B'],
      },
      {
        riskId: 'RISK-RESIDUAL-C',
        incidentId: 'INCIDENT-RESIDUAL-C',
        subjectId: 'ACT-EIXAMPLE-LOOK-05',
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVD-RESIDUAL-C'],
      },
    ],
    impacts: [
      {
        incidentId: 'INCIDENT-RESIDUAL-A',
        deliverableId: 'DELIVERABLE-D5',
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVD-RESIDUAL-A'],
        riskIds: ['RISK-RESIDUAL-A'],
      },
      {
        incidentId: 'INCIDENT-RESIDUAL-B',
        deliverableId: 'DELIVERABLE-D2',
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVD-RESIDUAL-B'],
        riskIds: ['RISK-RESIDUAL-B'],
      },
      {
        incidentId: 'INCIDENT-RESIDUAL-C',
        deliverableId: 'DELIVERABLE-D3',
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVD-RESIDUAL-C'],
        riskIds: ['RISK-RESIDUAL-C'],
      },
    ],
  });
}

export function recoveredComparison(
  before: ProductionReadinessAssessment,
  after: ProductionReadinessAssessment,
): ReadinessComparison {
  return {
    before,
    after,
    deliverableOutcomes: [
      {
        deliverableId: 'DELIVERABLE-D1',
        importance: 'CRITICAL',
        beforeProtected: false,
        afterProtected: true,
      },
      {
        deliverableId: 'DELIVERABLE-D5',
        importance: 'CRITICAL',
        beforeProtected: false,
        afterProtected: true,
      },
    ],
    preservedCreativeEnvelopeIds: ['ENVELOPE-EIXAMPLE-LOOK', 'ENVELOPE-GOTHIC-LOOK'],
    beforePredictedStudioDelayMinutes: 25,
    afterPredictedStudioDelayMinutes: 10,
    affectedPersonIds: ['PERSON-MODEL', 'PERSON-PRODUCTION-LEAD'],
    riskTransitions: [
      {
        riskId: GOTHIC_RISK_ID,
        subjectId: 'ACT-GOTHIC-LOOK-03',
        beforeSeverity: 'CRITICAL',
        afterSeverity: null,
      },
      {
        riskId: STUDIO_RISK_ID,
        subjectId: 'ACT-STUDIO-LOAD-IN',
        beforeSeverity: 'MEDIUM',
        afterSeverity: 'LOW',
      },
    ],
  };
}

export function r2Input(): ProductionEvaluationInput {
  return baseInput({
    risks: r2Risks(),
    impacts: r2Impacts(),
    confidenceFacts: [
      ...r1ConfidenceFacts(),
      confirmedScope('WEATHER:WINDOW:DRIFT', WEATHER_EVIDENCE_ID),
      confirmedScope('TRAVEL:LOAD-IN:DRIFT', TRAVEL_EVIDENCE_ID),
    ],
    requiredEvidenceScopes: [
      ...r1ConfidenceFacts().map((item) => item.scope),
      'WEATHER:WINDOW:DRIFT',
      'TRAVEL:LOAD-IN:DRIFT',
    ],
  });
}

function hasEdge(
  edges: readonly ProductionGraphEdge[],
  from: string,
  to: string,
  type: ProductionGraphEdge['type'],
): boolean {
  return edges.some((edge) => edge.from === from && edge.to === to && edge.type === type);
}

export function overlayCompoundEvidence(graph: ProductionGraph): ProductionGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodes = [...graph.nodes];
  if (!nodeIds.has(WEATHER_EVIDENCE_ID)) {
    nodes.push(createGraphNode(WEATHER_EVIDENCE_ID, 'EVIDENCE'));
  }
  if (!nodeIds.has(TRAVEL_EVIDENCE_ID)) {
    nodes.push(createGraphNode(TRAVEL_EVIDENCE_ID, 'EVIDENCE'));
  }
  const edges = [...graph.edges];
  if (!hasEdge(edges, WEATHER_EVIDENCE_ID, 'ACT-GOTHIC-LOOK-03', 'AFFECTS')) {
    edges.push(createGraphEdge(WEATHER_EVIDENCE_ID, 'ACT-GOTHIC-LOOK-03', 'AFFECTS'));
  }
  if (!hasEdge(edges, WEATHER_EVIDENCE_ID, 'ACT-EIXAMPLE-LOOK-05', 'AFFECTS')) {
    edges.push(createGraphEdge(WEATHER_EVIDENCE_ID, 'ACT-EIXAMPLE-LOOK-05', 'AFFECTS'));
  }
  if (!hasEdge(edges, TRAVEL_EVIDENCE_ID, 'ACT-STUDIO-LOAD-IN', 'AFFECTS')) {
    edges.push(createGraphEdge(TRAVEL_EVIDENCE_ID, 'ACT-STUDIO-LOAD-IN', 'AFFECTS'));
  }
  return createProductionGraph({
    productionId: graph.productionId,
    policyVersion: graph.policyVersion,
    fixtureVersion: graph.fixtureVersion,
    nodes,
    edges,
  });
}
