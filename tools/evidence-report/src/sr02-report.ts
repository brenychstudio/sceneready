import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEvidenceEnvelope, fingerprintEvidenceContent } from '@sceneready/evidence';
import {
  compileProductionGraph,
  createGraphEdge,
  createGraphNode,
  createProductionGraph,
  propagateRisk,
  type ProductionGraph,
  type ProductionGraphEdge,
} from '@sceneready/production-graph';
import {
  activateProductionPack,
  fingerprintProductionPack,
  validateProductionPack,
  type ProductionPack,
} from '@sceneready/production-pack';
import {
  evaluateProductionReadiness,
  HARD_GATE_IDS,
  PRODUCTION_DOMAINS,
  SCENEREADY_POLICY_V1,
  type ProductionEvaluationInput,
  type ProductionReadinessAssessment,
  type ReadinessImpactFact,
  type ReadinessRiskFact,
} from '@sceneready/readiness-engine';

export const SR02_EVIDENCE_REPORT_SCHEMA = 'SR-02-EVIDENCE-REPORT-v1';

const WEATHER_EVIDENCE_ID = 'EVIDENCE-WEATHER-DRIFT';
const TRAVEL_EVIDENCE_ID = 'EVIDENCE-TRAVEL-DRIFT';
const COMPOUND_INCIDENT_ID = 'INCIDENT-COMPOUND-DRIFT';
const GOTHIC_RISK_ID = 'RISK-GOTHIC-LOOK-03';
const EIXAMPLE_RISK_ID = 'RISK-EIXAMPLE-LOOK-05';
const STUDIO_RISK_ID = 'RISK-STUDIO-LOAD-IN';
const ACTIVATED_AT = '2026-09-17T03:45:00Z';

export interface Sr02EvidenceRecord {
  readonly evidenceId: string;
  readonly fingerprint: string;
}

export interface Sr02AssessmentRecord {
  readonly readinessScore: number;
  readonly confidenceScore: number;
  readonly status: ProductionReadinessAssessment['status'];
  readonly certification: ProductionReadinessAssessment['certification'];
  readonly failedGateIds: readonly string[];
  readonly unresolvedGateIds: readonly string[];
}

export interface Sr02R2AssessmentRecord extends Sr02AssessmentRecord {
  readonly risks: readonly ReadinessRiskFact[];
  readonly impacts: readonly {
    readonly incidentId: string;
    readonly deliverableId: string;
    readonly severity: string;
    readonly pathNodeIds: readonly string[];
    readonly pathEdgeIds: readonly string[];
    readonly sourceEvidenceIds: readonly string[];
    readonly riskIds: readonly string[];
  }[];
}

export interface Sr02EvidenceReport {
  readonly reportSchemaVersion: typeof SR02_EVIDENCE_REPORT_SCHEMA;
  readonly fixture: {
    readonly fixtureVersion: string;
    readonly productionId: string;
    readonly fingerprint: string;
  };
  readonly policy: {
    readonly policyVersion: string;
    readonly scoringVersion: string;
    readonly graphSchemaVersion: string;
    readonly fingerprint: string;
  };
  readonly graph: {
    readonly fingerprint: string;
  };
  readonly evidence: readonly Sr02EvidenceRecord[];
  readonly assessments: {
    readonly R0: Sr02AssessmentRecord;
    readonly R1: Sr02AssessmentRecord;
    readonly R2: Sr02R2AssessmentRecord;
  };
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fixtureDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/barcelona-aer-ss27');
}

async function readJson(directory: string, fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, fileName), 'utf8')) as unknown;
}

async function loadCanonicalPack(): Promise<ProductionPack> {
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

function r0Input(): ProductionEvaluationInput {
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

function r2Risks(): readonly ReadinessRiskFact[] {
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

function r2Impacts(): readonly ReadinessImpactFact[] {
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

function r1Input(): ProductionEvaluationInput {
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

function r2Input(): ProductionEvaluationInput {
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

function snapshotAssessment(assessment: ProductionReadinessAssessment): Sr02AssessmentRecord {
  return {
    readinessScore: assessment.readinessScore,
    confidenceScore: assessment.confidenceScore,
    status: assessment.status,
    certification: assessment.certification,
    failedGateIds: [...assessment.failedGateIds],
    unresolvedGateIds: [...assessment.unresolvedGateIds],
  };
}

function assertProtected(
  actual: Sr02AssessmentRecord,
  expected: {
    readonly readinessScore: number;
    readonly confidenceScore: number;
    readonly status: Sr02AssessmentRecord['status'];
    readonly certification: Sr02AssessmentRecord['certification'];
    readonly failedGateIds: readonly string[];
  },
  label: string,
): void {
  if (actual.readinessScore !== expected.readinessScore) {
    throw new Error(`${label} readinessScore drifted`);
  }
  if (actual.confidenceScore !== expected.confidenceScore) {
    throw new Error(`${label} confidenceScore drifted`);
  }
  if (actual.status !== expected.status) {
    throw new Error(`${label} status drifted`);
  }
  if (actual.certification !== expected.certification) {
    throw new Error(`${label} certification drifted`);
  }
  if (JSON.stringify(actual.failedGateIds) !== JSON.stringify(expected.failedGateIds)) {
    throw new Error(`${label} failedGateIds drifted`);
  }
}

function hasEdge(
  edges: readonly ProductionGraphEdge[],
  from: string,
  to: string,
  type: ProductionGraphEdge['type'],
): boolean {
  return edges.some((edge) => edge.from === from && edge.to === to && edge.type === type);
}

function overlayCompoundEvidence(graph: ProductionGraph): ProductionGraph {
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

export async function generateSr02EvidenceReport(): Promise<Sr02EvidenceReport> {
  const pack = await loadCanonicalPack();
  const activation = activateProductionPack(pack, ACTIVATED_AT);
  const graph = compileProductionGraph({
    pack,
    activation,
    evidence: { active: [], superseded: [], conflicts: [] },
  });
  const traced = propagateRisk({
    graph: overlayCompoundEvidence(graph),
    incidents: r2Risks(),
  });

  const r0 = snapshotAssessment(evaluateProductionReadiness(r0Input()));
  const r1 = snapshotAssessment(evaluateProductionReadiness(r1Input()));
  const r2Evaluated = evaluateProductionReadiness(r2Input());
  const r2 = snapshotAssessment(r2Evaluated);

  assertProtected(
    r0,
    {
      readinessScore: 78,
      confidenceScore: 94,
      status: 'BLOCKED',
      certification: 'CERTIFIED',
      failedGateIds: ['RIGHTS'],
    },
    'R0',
  );
  assertProtected(
    r1,
    {
      readinessScore: 86,
      confidenceScore: 96,
      status: 'READY',
      certification: 'CERTIFIED',
      failedGateIds: [],
    },
    'R1',
  );
  assertProtected(
    r2,
    {
      readinessScore: 74,
      confidenceScore: 96,
      status: 'AT_RISK',
      certification: 'CERTIFIED',
      failedGateIds: [],
    },
    'R2',
  );

  const gothic = r2Evaluated.risks.find((item) => item.subjectId === 'ACT-GOTHIC-LOOK-03');
  const eixample = r2Evaluated.risks.find((item) => item.subjectId === 'ACT-EIXAMPLE-LOOK-05');
  const studio = r2Evaluated.risks.find((item) => item.subjectId === 'ACT-STUDIO-LOAD-IN');
  if (
    gothic?.severity !== 'CRITICAL' ||
    eixample?.severity !== 'HIGH' ||
    studio?.severity !== 'MEDIUM'
  ) {
    throw new Error('R2 canonical risk severities drifted');
  }

  const weatherPath = traced.impacts.find(
    (item) =>
      item.deliverableId === 'DELIVERABLE-D2' &&
      item.pathNodeIds[0] === WEATHER_EVIDENCE_ID &&
      item.pathNodeIds[item.pathNodeIds.length - 1] === 'DELIVERABLE-D2',
  );
  if (weatherPath === undefined) {
    throw new Error('R2 weather-to-D2 causal path was not computed');
  }

  const weatherEnvelope = createEvidenceEnvelope({
    evidenceId: WEATHER_EVIDENCE_ID,
    productionId: pack.production.id,
    kind: 'WEATHER',
    sourceType: 'EXTERNAL_PROVIDER',
    authorityClass: 'EXTERNAL_AUTHORITATIVE',
    trustState: 'LIVE',
    observedAt: '2026-09-17T06:00:00Z',
    receivedAt: '2026-09-17T06:00:30Z',
    payload: { windowCompressionMinutes: -35 },
  });
  const travelEnvelope = createEvidenceEnvelope({
    evidenceId: TRAVEL_EVIDENCE_ID,
    productionId: pack.production.id,
    kind: 'TRAVEL',
    sourceType: 'EXTERNAL_PROVIDER',
    authorityClass: 'EXTERNAL_AUTHORITATIVE',
    trustState: 'LIVE',
    observedAt: '2026-09-17T06:00:00Z',
    receivedAt: '2026-09-17T06:00:30Z',
    payload: { loadInDelayMinutes: 14 },
  });

  const evidence: Sr02EvidenceRecord[] = [
    ...pack.evidence.map((item) => ({
      evidenceId: item.id,
      fingerprint: fingerprintEvidenceContent(item),
    })),
    { evidenceId: weatherEnvelope.evidenceId, fingerprint: weatherEnvelope.contentFingerprint },
    { evidenceId: travelEnvelope.evidenceId, fingerprint: travelEnvelope.contentFingerprint },
  ].sort((left, right) => compareOrdinal(left.evidenceId, right.evidenceId));

  const impacts = [...traced.impacts]
    .map((item) =>
      Object.freeze({
        incidentId: item.incidentId,
        deliverableId: item.deliverableId,
        severity: item.severity,
        pathNodeIds: item.pathNodeIds,
        pathEdgeIds: item.pathEdgeIds,
        sourceEvidenceIds: item.sourceEvidenceIds,
        riskIds: item.riskIds,
      }),
    )
    .sort((left, right) => {
      const incidentOrder = compareOrdinal(left.incidentId, right.incidentId);
      if (incidentOrder !== 0) {
        return incidentOrder;
      }
      return compareOrdinal(left.deliverableId, right.deliverableId);
    });

  return Object.freeze({
    reportSchemaVersion: SR02_EVIDENCE_REPORT_SCHEMA,
    fixture: Object.freeze({
      fixtureVersion: pack.fixtureVersion,
      productionId: pack.production.id,
      fingerprint: fingerprintProductionPack(pack),
    }),
    policy: Object.freeze({
      policyVersion: SCENEREADY_POLICY_V1.policyVersion,
      scoringVersion: SCENEREADY_POLICY_V1.scoringVersion,
      graphSchemaVersion: SCENEREADY_POLICY_V1.graphSchemaVersion,
      fingerprint: fingerprintProductionPack(SCENEREADY_POLICY_V1),
    }),
    graph: Object.freeze({
      fingerprint: graph.fingerprint,
    }),
    evidence: Object.freeze(evidence),
    assessments: Object.freeze({
      R0: Object.freeze(r0),
      R1: Object.freeze(r1),
      R2: Object.freeze({
        ...r2,
        risks: r2Evaluated.risks,
        impacts: Object.freeze(impacts),
      }),
    }),
  });
}

function isDirectCliInvocation(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(invoked);
}

async function runCli(): Promise<number> {
  try {
    const report = await generateSr02EvidenceReport();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sr02 evidence report failed';
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

if (isDirectCliInvocation()) {
  process.exitCode = await runCli();
}
