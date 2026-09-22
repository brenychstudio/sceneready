import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVITY_LIFECYCLE_STATES,
  LIFECYCLE_REASON_CODES,
  PRODUCTION_PHASES,
} from '@sceneready/domain';
import { createEvidenceEnvelope, fingerprintEvidenceContent } from '@sceneready/evidence';
import { compileProductionGraph, propagateRisk } from '@sceneready/production-graph';
import { activateProductionPack, fingerprintProductionPack } from '@sceneready/production-pack';
import {
  calculateOutcomeMetrics,
  evaluateProductionReadiness,
  SCENEREADY_POLICY_V1,
  type OperationalOutcomeMetrics,
  type ProductionReadinessAssessment,
  type ReadinessRiskFact,
} from '@sceneready/readiness-engine';

import {
  ACTIVATED_AT,
  CANONICAL_DRIFT_EVIDENCE,
  WEATHER_EVIDENCE_ID,
  loadCanonicalPack,
  overlayCompoundEvidence,
  r0Input,
  r1Input,
  r2Input,
  r2Risks,
  recoveredComparison,
} from './sr02-scenarios.js';

export const SR02_EVIDENCE_REPORT_SCHEMA = 'SR-02-EVIDENCE-REPORT-v1';

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
  readonly lifecycle: {
    readonly productionPhases: readonly string[];
    readonly activityStates: readonly string[];
    readonly reasonCodes: readonly string[];
  };
  readonly metrics: OperationalOutcomeMetrics;
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

  const r0Evaluated = evaluateProductionReadiness(r0Input());
  const r1Evaluated = evaluateProductionReadiness(r1Input());
  const r2Evaluated = evaluateProductionReadiness(r2Input());
  const r0 = snapshotAssessment(r0Evaluated);
  const r1 = snapshotAssessment(r1Evaluated);
  const r2 = snapshotAssessment(r2Evaluated);
  const metrics = calculateOutcomeMetrics(recoveredComparison(r2Evaluated, r1Evaluated));
  if (
    metrics.protectedCriticalDeliverables !== 2 ||
    metrics.predictedStudioDelayReductionMinutes !== 15 ||
    metrics.monetaryImpact !== null
  ) {
    throw new Error('outcome metrics drifted from explicit comparison facts');
  }

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

  const driftEnvelopes = CANONICAL_DRIFT_EVIDENCE.map((fact) =>
    createEvidenceEnvelope({
      evidenceId: fact.evidenceId,
      productionId: pack.production.id,
      kind: fact.kind,
      sourceType: 'EXTERNAL_PROVIDER',
      authorityClass: 'EXTERNAL_AUTHORITATIVE',
      trustState: 'LIVE',
      observedAt: fact.observedAt,
      receivedAt: fact.receivedAt,
      payload: fact.payload,
    }),
  );

  const evidence: Sr02EvidenceRecord[] = [
    ...pack.evidence.map((item) => ({
      evidenceId: item.id,
      fingerprint: fingerprintEvidenceContent(item),
    })),
    ...driftEnvelopes.map((envelope) => ({
      evidenceId: envelope.evidenceId,
      fingerprint: envelope.contentFingerprint,
    })),
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
    lifecycle: Object.freeze({
      productionPhases: PRODUCTION_PHASES,
      activityStates: ACTIVITY_LIFECYCLE_STATES,
      reasonCodes: LIFECYCLE_REASON_CODES,
    }),
    metrics,
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
