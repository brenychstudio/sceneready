import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGraphNode, createProductionGraph } from '@sceneready/production-graph';
import type {
  InterventionPolicyContext,
  InterventionPrimitive,
} from '@sceneready/intervention-engine';
import {
  evaluateProductionReadiness,
  HARD_GATE_IDS,
  PRODUCTION_DOMAINS,
  SCENEREADY_POLICY_V1,
  type ProductionEvaluationInput,
  type ReadinessImpactFact,
  type ReadinessRiskFact,
} from '@sceneready/readiness-engine';
import { describe, expect, it } from 'vitest';

import { compareProductionAssessments } from './compare.js';
import {
  EMPTY_RECOVERY_PROJECTION,
  RECOVERY_PROJECTION_SCHEMA_VERSION,
  type ProjectionPredicate,
  type RecoveryProjectionPolicy,
  type RiskProjectionRule,
} from './projection.js';
import { simulateShadowProduction, type ShadowSimulationInput } from './simulate.js';

const GOTHIC = 'ACT-GOTHIC-LOOK-03';
const EIXAMPLE = 'ACT-EIXAMPLE-LOOK-05';
const STUDIO = 'ACT-STUDIO-LOAD-IN';
const TRANSFER = 'ACT-TRANSFER-01';
const GOTHIC_LOCATION = 'LOC-GOTHIC';
const FALLBACK_LOCATION = 'LOC-FALLBACK';
const PERSON = 'PERSON-MODEL';
const BACKUP_PATH = 'PATH-BACKUP-KIT';
const EQUIPMENT = 'EQUIPMENT-CAMERA-A';
const CONFIRMATION_SCOPE = 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function passedDomains(): NonNullable<ProductionEvaluationInput['domainFacts']> {
  return PRODUCTION_DOMAINS.map((domain) => ({
    domain,
    state: 'PASSED' as const,
    reasons: [`${domain}_OK`],
  }));
}

function evaluation(overrides: Partial<ProductionEvaluationInput> = {}): ProductionEvaluationInput {
  return {
    productionId: overrides.productionId ?? 'BCN-DEMO-01',
    productionDate: overrides.productionDate ?? '2026-09-17',
    intendedUsageScope: overrides.intendedUsageScope ?? 'PAID_CAMPAIGN',
    intendedDeliverableId: overrides.intendedDeliverableId ?? 'DELIVERABLE-D7',
    requiredPersonIds: overrides.requiredPersonIds ?? [PERSON],
    requiredLocationIds: overrides.requiredLocationIds ?? [],
    hardGates:
      overrides.hardGates ??
      HARD_GATE_IDS.map((id) => ({
        id,
        subjectType: id === 'RIGHTS' ? 'DOCUMENT' : 'LOCATION',
        subjectIds: [],
      })),
    documents: overrides.documents ?? [],
    capturePaths: overrides.capturePaths ?? [],
    equipment: overrides.equipment ?? [],
    proofs: overrides.proofs ?? [],
    domainFacts: overrides.domainFacts !== undefined ? overrides.domainFacts : passedDomains(),
    policy: overrides.policy ?? SCENEREADY_POLICY_V1,
    risks: overrides.risks ?? [],
    impacts: overrides.impacts ?? [],
    deliverables: overrides.deliverables ?? [
      { deliverableId: 'DELIVERABLE-D2', importance: 'HIGH' },
      { deliverableId: 'DELIVERABLE-D3', importance: 'HIGH' },
      { deliverableId: 'DELIVERABLE-D5', importance: 'CRITICAL' },
    ],
    confidenceFacts: overrides.confidenceFacts ?? [
      {
        scope: CONFIRMATION_SCOPE,
        coverage: 'RESOLVED',
        polarity: 'CONFIRMED',
        evidenceId: 'EVD-MODEL-RELEASE',
        fingerprint: 'fp-EVD-MODEL-RELEASE',
        trustState: 'LIVE',
      },
    ],
    requiredEvidenceScopes: overrides.requiredEvidenceScopes ?? [CONFIRMATION_SCOPE],
  };
}

function policyContext(
  overrides: Partial<InterventionPolicyContext> = {},
): InterventionPolicyContext {
  const graph =
    overrides.graph ??
    createProductionGraph({
      productionId: 'BCN-DEMO-01',
      policyVersion: 'SR-POLICY-v1',
      fixtureVersion: 'BCN-DEMO-v1',
      nodes: [
        createGraphNode(GOTHIC, 'ACTIVITY'),
        createGraphNode(EIXAMPLE, 'ACTIVITY'),
        createGraphNode(STUDIO, 'ACTIVITY'),
        createGraphNode(TRANSFER, 'ACTIVITY'),
        createGraphNode(GOTHIC_LOCATION, 'LOCATION'),
        createGraphNode(FALLBACK_LOCATION, 'LOCATION'),
        createGraphNode(PERSON, 'PERSON'),
        createGraphNode(BACKUP_PATH, 'RESOURCE'),
        createGraphNode(EQUIPMENT, 'RESOURCE'),
      ],
      edges: [],
    });
  return {
    graph,
    policyVersion: overrides.policyVersion ?? 'SR-POLICY-v1',
    productionPhase: overrides.productionPhase ?? 'PREFLIGHT',
    activities: overrides.activities ?? [
      {
        activityId: GOTHIC,
        startLocal: '10:00',
        endLocal: '11:00',
        locationId: GOTHIC_LOCATION,
        constraint: 'FLEXIBLE',
      },
      {
        activityId: EIXAMPLE,
        startLocal: '12:00',
        endLocal: '13:00',
        locationId: GOTHIC_LOCATION,
        constraint: 'FLEXIBLE',
      },
      {
        activityId: STUDIO,
        startLocal: '16:00',
        endLocal: '17:00',
        locationId: GOTHIC_LOCATION,
        constraint: 'FIXED',
      },
      {
        activityId: TRANSFER,
        startLocal: '09:00',
        endLocal: '09:30',
        locationId: GOTHIC_LOCATION,
        constraint: 'FLEXIBLE',
      },
    ],
    activityStates: overrides.activityStates ?? [
      { activityId: GOTHIC, state: 'PENDING' },
      { activityId: EIXAMPLE, state: 'PENDING' },
      { activityId: STUDIO, state: 'PENDING' },
      { activityId: TRANSFER, state: 'PENDING' },
    ],
    locationConstraints: overrides.locationConstraints ?? [
      {
        locationId: GOTHIC_LOCATION,
        access: 'PASSED',
        rights: 'PASSED',
        windowStartLocal: '08:00',
        windowEndLocal: '18:00',
      },
      {
        locationId: FALLBACK_LOCATION,
        access: 'PASSED',
        rights: 'PASSED',
        windowStartLocal: '08:00',
        windowEndLocal: '20:00',
      },
    ],
    approvedFallbacks: overrides.approvedFallbacks ?? [
      { activityId: GOTHIC, fallbackLocationId: FALLBACK_LOCATION },
    ],
    approvedBackupPathIds: overrides.approvedBackupPathIds ?? [BACKUP_PATH],
    equipmentIds: overrides.equipmentIds ?? [EQUIPMENT],
    requestableEvidenceScopes: overrides.requestableEvidenceScopes ?? [CONFIRMATION_SCOPE],
  };
}

function simulationInput(
  interventions: readonly InterventionPrimitive[],
  overrides: {
    readonly policy?: Partial<InterventionPolicyContext>;
    readonly evaluation?: Partial<ProductionEvaluationInput>;
    readonly callTimes?: ShadowSimulationInput['callTimes'];
    readonly projection?: RecoveryProjectionPolicy;
  } = {},
): ShadowSimulationInput {
  return {
    policyContext: policyContext(overrides.policy),
    evaluation: evaluation(overrides.evaluation),
    interventions,
    callTimes: overrides.callTimes ?? [{ personId: PERSON, callLocal: '08:00' }],
    projection: overrides.projection ?? EMPTY_RECOVERY_PROJECTION,
  };
}

function freezeInput(input: ShadowSimulationInput): ShadowSimulationInput {
  return deepFreeze(input);
}

function inputSnapshot(input: ShadowSimulationInput): string {
  return JSON.stringify({
    callTimes: input.callTimes,
    evaluation: input.evaluation,
    interventions: input.interventions,
    policyContext: input.policyContext,
    projection: input.projection,
  });
}

function activityOverlay(
  input: ShadowSimulationInput,
  activityId: string,
): { readonly startMinute: number; readonly endMinute: number; readonly locationId: string } {
  const frozen = freezeInput(input);
  const result = simulateShadowProduction(frozen);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('expected simulation to succeed');
  }
  const found = result.simulation.shadowGraph.operational.activities.find(
    (item) => item.activityId === activityId,
  );
  expect(found).toBeDefined();
  if (found === undefined) {
    throw new Error(`missing activity ${activityId}`);
  }
  return found;
}

function implementationSource(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n');
}

function ownKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      ownKeys(item, found);
    }
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      ownKeys(child, found);
    }
  }
  return found;
}

const shiftGothic: InterventionPrimitive = {
  kind: 'SHIFT_ACTIVITY',
  activityId: GOTHIC,
  deltaMinutes: 30,
};

describe('simulateShadowProduction', () => {
  it('does not mutate deeply frozen live graph, evaluation facts, or interventions', () => {
    const input = freezeInput(simulationInput([shiftGothic]));
    const beforeGraph = JSON.stringify(input.policyContext.graph);
    const beforeFingerprint = input.policyContext.graph.fingerprint;
    const beforeProductionRevision = input.policyContext.graph.productionRevision;
    const beforeSnapshot = inputSnapshot(input);

    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    expect(inputSnapshot(input)).toBe(beforeSnapshot);
    expect(JSON.stringify(input.policyContext.graph)).toBe(beforeGraph);
    expect(input.policyContext.graph.fingerprint).toBe(beforeFingerprint);
    expect(input.policyContext.graph.productionRevision).toBe(beforeProductionRevision);
    expect(Object.isFrozen(input.policyContext.graph)).toBe(true);
    expect(Object.isFrozen(input.evaluation)).toBe(true);
    expect(Object.isFrozen(input.interventions)).toBe(true);
  });

  it('fails closed on a policy denial before any shadow result is returned', () => {
    const input = freezeInput(
      simulationInput([shiftGothic, { kind: 'SHORTEN_ACTIVITY', activityId: STUDIO, minutes: 15 }]),
    );
    const before = inputSnapshot(input);
    const result = simulateShadowProduction(input);

    expect(result).toEqual({
      ok: false,
      code: 'FIXED_ACTIVITY_CONSTRAINT',
      interventionIndex: 1,
    });
    expect(inputSnapshot(input)).toBe(before);
    expect(result).not.toHaveProperty('simulation');
  });

  it('applies a shift of a fixed activity only to shadow operational state', () => {
    const input = freezeInput(
      simulationInput([{ kind: 'SHIFT_ACTIVITY', activityId: STUDIO, deltaMinutes: 15 }]),
    );
    const before = inputSnapshot(input);
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    expect(inputSnapshot(input)).toBe(before);
    if (!result.ok) {
      return;
    }
    expect(
      result.simulation.shadowGraph.operational.activities.find(
        (item) => item.activityId === STUDIO,
      ),
    ).toMatchObject({
      constraint: 'FIXED',
      startMinute: 16 * 60 + 15,
      endMinute: 17 * 60 + 15,
    });
    expect(input.policyContext.graph.graphRevision).toBe(1);
    expect(result.simulation.shadowGraphRevision).toBe(2);
  });

  it('applies a departure adjustment of a fixed activity only to shadow operational state', () => {
    const input = freezeInput(
      simulationInput(
        [{ kind: 'ADJUST_DEPARTURE', transferActivityId: TRANSFER, deltaMinutes: 20 }],
        {
          policy: {
            activities: policyContext().activities.map((activity) =>
              activity.activityId === TRANSFER
                ? { ...activity, constraint: 'FIXED' as const }
                : activity,
            ),
          },
        },
      ),
    );
    const before = inputSnapshot(input);
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    expect(inputSnapshot(input)).toBe(before);
    if (!result.ok) {
      return;
    }
    expect(
      result.simulation.shadowGraph.operational.activities.find(
        (item) => item.activityId === TRANSFER,
      ),
    ).toMatchObject({
      constraint: 'FIXED',
      startMinute: 9 * 60 + 20,
      endMinute: 9 * 60 + 50,
    });
    expect(input.policyContext.graph.graphRevision).toBe(1);
    expect(result.simulation.shadowGraphRevision).toBe(2);
  });

  it('applies a buffer before a fixed activity only to shadow operational state', () => {
    const input = freezeInput(
      simulationInput([{ kind: 'ADD_BUFFER', beforeActivityId: STUDIO, minutes: 10 }]),
    );
    const before = inputSnapshot(input);
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    expect(inputSnapshot(input)).toBe(before);
    if (!result.ok) {
      return;
    }
    expect(
      result.simulation.shadowGraph.operational.activities.find(
        (item) => item.activityId === STUDIO,
      ),
    ).toMatchObject({
      constraint: 'FIXED',
      startMinute: 16 * 60,
      endMinute: 17 * 60,
      bufferBeforeMinutes: 10,
    });
    expect(input.policyContext.graph.graphRevision).toBe(1);
    expect(result.simulation.shadowGraphRevision).toBe(2);
  });

  it('fails a composed sequence closed when a later shift leaves the confirmed window', () => {
    const input = freezeInput(
      simulationInput(
        [
          { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 30 },
          { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 60 },
        ],
        {
          policy: {
            locationConstraints: [
              {
                locationId: GOTHIC_LOCATION,
                access: 'PASSED',
                rights: 'PASSED',
                windowStartLocal: '10:00',
                windowEndLocal: '12:00',
              },
              {
                locationId: FALLBACK_LOCATION,
                access: 'PASSED',
                rights: 'PASSED',
                windowStartLocal: '08:00',
                windowEndLocal: '20:00',
              },
            ],
          },
        },
      ),
    );

    expect(simulateShadowProduction(input)).toEqual({
      ok: false,
      code: 'LOCATION_WINDOW_VIOLATION',
      interventionIndex: 1,
    });
  });

  it('uses evaluateProductionReadiness for both the live and shadow assessments', () => {
    const input = freezeInput(simulationInput([shiftGothic]));
    const direct = evaluateProductionReadiness(input.evaluation);
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.simulation.liveAssessment).toEqual(direct);
    expect(result.simulation.shadowAssessment).toEqual(direct);
    expect(result.simulation.scoringVersion).toBe(direct.scoringVersion);
    expect(result.simulation.policyVersion).toBe(direct.policyVersion);
  });

  it('repeats an exact input as the same bytes, simulation id, and fingerprint', () => {
    const input = freezeInput(simulationInput([shiftGothic]));
    const first = simulateShadowProduction(input);
    const second = simulateShadowProduction(input);

    expect(first.ok).toBe(true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.simulation.simulationId).toBe(second.simulation.simulationId);
    expect(first.simulation.fingerprint).toBe(second.simulation.fingerprint);
    expect(first.simulation.simulationId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.simulation.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.simulation.simulationId).not.toBe(first.simulation.fingerprint);
  });

  it('changes the fingerprint when one intervention parameter changes', () => {
    const slower = freezeInput(
      simulationInput([{ kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 }]),
    );
    const faster = freezeInput(
      simulationInput([{ kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 16 }]),
    );
    const left = simulateShadowProduction(slower);
    const right = simulateShadowProduction(faster);

    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }
    expect(left.simulation.fingerprint).not.toBe(right.simulation.fingerprint);
    expect(left.simulation.simulationId).not.toBe(right.simulation.simulationId);
    expect(left.simulation.shadowGraph.fingerprint).not.toBe(
      slower.policyContext.graph.fingerprint,
    );
  });

  it('treats intervention order as proposal identity', () => {
    const forward = freezeInput(
      simulationInput([
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
        { kind: 'SHIFT_ACTIVITY', activityId: EIXAMPLE, deltaMinutes: 15 },
      ]),
    );
    const reversed = freezeInput(
      simulationInput([
        { kind: 'SHIFT_ACTIVITY', activityId: EIXAMPLE, deltaMinutes: 15 },
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
      ]),
    );
    const first = simulateShadowProduction(forward);
    const second = simulateShadowProduction(reversed);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.simulation.fingerprint).not.toBe(second.simulation.fingerprint);
    expect(
      first.simulation.interventions.map((item) => item.kind + JSON.stringify(item)),
    ).not.toEqual(second.simulation.interventions.map((item) => item.kind + JSON.stringify(item)));
  });

  it('ignores policy-context and evaluation array order', () => {
    const input = simulationInput([
      shiftGothic,
      { kind: 'ADD_BUFFER', beforeActivityId: EIXAMPLE, minutes: 10 },
    ]);
    const reversed: ShadowSimulationInput = {
      policyContext: {
        ...input.policyContext,
        activities: [...input.policyContext.activities].reverse(),
        activityStates: [...input.policyContext.activityStates].reverse(),
        locationConstraints: [...input.policyContext.locationConstraints].reverse(),
        approvedFallbacks: [...input.policyContext.approvedFallbacks].reverse(),
        approvedBackupPathIds: [...input.policyContext.approvedBackupPathIds].reverse(),
        equipmentIds: [...input.policyContext.equipmentIds].reverse(),
        requestableEvidenceScopes: [...input.policyContext.requestableEvidenceScopes].reverse(),
      },
      evaluation: {
        ...input.evaluation,
        hardGates: [...input.evaluation.hardGates].reverse(),
        deliverables: [...input.evaluation.deliverables].reverse(),
        confidenceFacts: [...input.evaluation.confidenceFacts].reverse(),
        requiredEvidenceScopes: [...input.evaluation.requiredEvidenceScopes].reverse(),
        requiredPersonIds: [...input.evaluation.requiredPersonIds].reverse(),
        domainFacts: [...(input.evaluation.domainFacts ?? [])].reverse(),
      },
      interventions: input.interventions,
      callTimes: [...input.callTimes].reverse(),
      projection: input.projection,
    };

    const forward = simulateShadowProduction(freezeInput(input));
    const backward = simulateShadowProduction(freezeInput(reversed));
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it('keeps the authoritative production revision and advances only the shadow graph revision', () => {
    const input = freezeInput(simulationInput([shiftGothic]));
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.simulation.baseGraphRevision).toBe(input.policyContext.graph.graphRevision);
    expect(result.simulation.baseProductionRevision).toBe(
      input.policyContext.graph.productionRevision,
    );
    expect(result.simulation.shadowGraphRevision).toBe(result.simulation.baseGraphRevision + 1);
    expect(result.simulation.shadowGraph.productionRevision).toBe(
      input.policyContext.graph.productionRevision,
    );
    expect(result.simulation.shadowGraph.baseGraphRevision).toBe(
      input.policyContext.graph.graphRevision,
    );
    expect(result.simulation.shadowGraph.shadowGraphRevision).toBe(
      input.policyContext.graph.graphRevision + 1,
    );
    expect(result.simulation.shadowGraph.graph).toBe(input.policyContext.graph);
    expect(input.policyContext.graph.productionRevision).toBe(1);
    expect(input.policyContext.graph.graphRevision).toBe(1);
  });

  it('derives introduced and reduced risks from the assessments rather than a fixed list', () => {
    const critical: ReadinessRiskFact = {
      riskId: 'RISK-ALPHA',
      incidentId: 'INCIDENT-ALPHA',
      subjectId: GOTHIC,
      severity: 'CRITICAL',
      sourceEvidenceIds: ['EVD-ALPHA'],
    };
    const medium: ReadinessRiskFact = {
      riskId: 'RISK-BETA',
      incidentId: 'INCIDENT-BETA',
      subjectId: EIXAMPLE,
      severity: 'MEDIUM',
      sourceEvidenceIds: ['EVD-BETA'],
    };
    const introduced: ReadinessRiskFact = {
      riskId: 'RISK-GAMMA',
      incidentId: 'INCIDENT-GAMMA',
      subjectId: STUDIO,
      severity: 'HIGH',
      sourceEvidenceIds: ['EVD-GAMMA'],
    };
    const reduced: ReadinessRiskFact = { ...critical, severity: 'LOW' };
    const before = evaluateProductionReadiness(
      evaluation({
        risks: [critical, medium],
        impacts: [
          {
            incidentId: 'INCIDENT-ALPHA',
            deliverableId: 'DELIVERABLE-D2',
            severity: 'CRITICAL',
            sourceEvidenceIds: ['EVD-ALPHA'],
            riskIds: ['RISK-ALPHA'],
          },
        ],
      }),
    );
    const after = evaluateProductionReadiness(
      evaluation({
        risks: [reduced, introduced],
        impacts: [],
      }),
    );
    const comparison = compareProductionAssessments(before, after);

    expect(comparison.introducedRisks.map((item) => item.riskId)).toEqual(['RISK-GAMMA']);
    expect(comparison.resolvedOrReducedRisks.map((item) => item.riskId).sort()).toEqual([
      'RISK-ALPHA',
      'RISK-BETA',
    ]);
    expect(comparison.preservedDeliverables).toEqual(['DELIVERABLE-D2']);
    expect(comparison.readinessDelta).toBe(after.readinessScore - before.readinessScore);

    const simulated = simulateShadowProduction(freezeInput(simulationInput([shiftGothic])));
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) {
      return;
    }
    expect(simulated.simulation.introducedRisks).toEqual(
      compareProductionAssessments(
        simulated.simulation.liveAssessment,
        simulated.simulation.shadowAssessment,
      ).introducedRisks,
    );
    expect(simulated.simulation.resolvedOrReducedRisks).toEqual(
      compareProductionAssessments(
        simulated.simulation.liveAssessment,
        simulated.simulation.shadowAssessment,
      ).resolvedOrReducedRisks,
    );
  });

  it('fails closed on an invalid mutation and on a duplicate intervention identity', () => {
    const invalid = freezeInput(
      simulationInput([
        { kind: 'DELETE_ACTIVITY', activityId: GOTHIC } as unknown as InterventionPrimitive,
      ]),
    );
    expect(simulateShadowProduction(invalid)).toEqual({
      ok: false,
      code: 'INVALID_INTERVENTION',
      interventionIndex: 0,
    });

    const duplicate = freezeInput(simulationInput([shiftGothic, { ...shiftGothic }]));
    expect(simulateShadowProduction(duplicate)).toEqual({
      ok: false,
      code: 'DUPLICATE_INTERVENTION',
      interventionIndex: 1,
    });
  });

  it('returns a deeply immutable result with no authority or execution surface', () => {
    const input = freezeInput(simulationInput([shiftGothic]));
    const result = simulateShadowProduction(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.simulation)).toBe(true);
    expect(Object.isFrozen(result.simulation.interventions)).toBe(true);
    expect(Object.isFrozen(result.simulation.introducedRisks)).toBe(true);
    expect(Object.isFrozen(result.simulation.shadowGraph)).toBe(true);
    expect(Object.isFrozen(result.simulation.shadowGraph.operational)).toBe(true);
    expect(() => {
      (result.simulation as { fingerprint: string }).fingerprint = 'mutated';
    }).toThrow(TypeError);

    const keys = ownKeys(result);
    for (const forbidden of [
      'approvalToken',
      'executionToken',
      'execute',
      'sendNotification',
      'repository',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('applies bounded schedule effects without fabricating readiness recovery', () => {
    const r2Risks: readonly ReadinessRiskFact[] = [
      {
        riskId: 'RISK-GOTHIC-LOOK-03',
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        subjectId: GOTHIC,
        severity: 'CRITICAL',
        sourceEvidenceIds: ['EVIDENCE-TRAVEL-DRIFT', 'EVIDENCE-WEATHER-DRIFT'],
        reasons: ['WEATHER_WINDOW_COMPRESSION'],
      },
      {
        riskId: 'RISK-EIXAMPLE-LOOK-05',
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        subjectId: EIXAMPLE,
        severity: 'HIGH',
        sourceEvidenceIds: ['EVIDENCE-WEATHER-DRIFT', 'EVIDENCE-TRAVEL-DRIFT'],
        reasons: ['WEATHER_WINDOW_COMPRESSION'],
      },
      {
        riskId: 'RISK-STUDIO-LOAD-IN',
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        subjectId: STUDIO,
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVIDENCE-TRAVEL-DRIFT', 'EVIDENCE-WEATHER-DRIFT'],
        reasons: ['TRAVEL_LOAD_IN_DELAY'],
      },
    ];
    const r2Impacts: readonly ReadinessImpactFact[] = [
      {
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        deliverableId: 'DELIVERABLE-D2',
        severity: 'CRITICAL',
        sourceEvidenceIds: ['EVIDENCE-WEATHER-DRIFT', 'EVIDENCE-TRAVEL-DRIFT'],
        riskIds: ['RISK-GOTHIC-LOOK-03'],
      },
      {
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        deliverableId: 'DELIVERABLE-D3',
        severity: 'HIGH',
        sourceEvidenceIds: ['EVIDENCE-WEATHER-DRIFT'],
        riskIds: ['RISK-EIXAMPLE-LOOK-05'],
      },
      {
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        deliverableId: 'DELIVERABLE-D5',
        severity: 'MEDIUM',
        sourceEvidenceIds: ['EVIDENCE-TRAVEL-DRIFT'],
        riskIds: ['RISK-STUDIO-LOAD-IN'],
      },
    ];
    const input = freezeInput(
      simulationInput(
        [
          shiftGothic,
          { kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 15 },
          { kind: 'REORDER_ACTIVITIES', activityIds: [GOTHIC, EIXAMPLE] },
          { kind: 'ADD_BUFFER', beforeActivityId: EIXAMPLE, minutes: 10 },
          { kind: 'ADJUST_CALL_TIME', personId: PERSON, deltaMinutes: -15 },
          { kind: 'ACTIVATE_BACKUP_KIT', equipmentPathId: BACKUP_PATH },
          { kind: 'REQUIRE_REVERIFICATION', equipmentId: EQUIPMENT },
          {
            kind: 'SWITCH_TO_APPROVED_FALLBACK',
            activityId: GOTHIC,
            fallbackLocationId: FALLBACK_LOCATION,
          },
          { kind: 'ADJUST_DEPARTURE', transferActivityId: TRANSFER, deltaMinutes: 20 },
          { kind: 'INCREASE_TRANSFER_BUFFER', transferActivityId: TRANSFER, minutes: 10 },
          { kind: 'REQUEST_MISSING_CONFIRMATION', evidenceScope: CONFIRMATION_SCOPE },
        ],
        { evaluation: { risks: r2Risks, impacts: r2Impacts } },
      ),
    );
    const direct = evaluateProductionReadiness(input.evaluation);
    const result = simulateShadowProduction(input);

    expect(direct.readinessScore).toBe(74);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.simulation.liveAssessment.readinessScore).toBe(74);
    expect(result.simulation.shadowAssessment.readinessScore).toBe(74);
    expect(result.simulation.comparison.readinessDelta).toBe(0);
    expect(result.simulation.shadowAssessment.readinessScore).not.toBe(89);
    expect(result.simulation.introducedRisks).toEqual([]);
    expect(result.simulation.resolvedOrReducedRisks).toEqual([]);
    expect(result.simulation.preservedDeliverables).toEqual([]);

    const gothic = result.simulation.shadowGraph.operational.activities.find(
      (item) => item.activityId === GOTHIC,
    );
    const transfer = result.simulation.shadowGraph.operational.activities.find(
      (item) => item.activityId === TRANSFER,
    );
    const eixample = result.simulation.shadowGraph.operational.activities.find(
      (item) => item.activityId === EIXAMPLE,
    );
    expect(gothic).toMatchObject({
      startMinute: 10 * 60 + 30,
      endMinute: 11 * 60 + 30 - 15,
      locationId: FALLBACK_LOCATION,
    });
    expect(transfer).toMatchObject({
      startMinute: 9 * 60 + 20,
      endMinute: 9 * 60 + 30 + 20,
      transferBufferMinutes: 10,
    });
    expect(eixample).toMatchObject({ bufferBeforeMinutes: 10 });
    expect(result.simulation.shadowGraph.operational.activatedBackupPathIds).toEqual([BACKUP_PATH]);
    expect(result.simulation.shadowGraph.operational.reverificationEquipmentIds).toEqual([
      EQUIPMENT,
    ]);
    expect(result.simulation.shadowGraph.operational.confirmationRequestScopes).toEqual([
      CONFIRMATION_SCOPE,
    ]);
    expect(
      result.simulation.shadowGraph.operational.callTimes.find((item) => item.personId === PERSON),
    ).toMatchObject({ callMinute: 8 * 60 - 15 });
    expect(result.simulation.shadowAssessment.evidenceReferences).toEqual(
      result.simulation.liveAssessment.evidenceReferences,
    );
  });

  it('rejects a call-time move that cannot stay inside the local day', () => {
    const input = freezeInput(
      simulationInput([{ kind: 'ADJUST_CALL_TIME', personId: PERSON, deltaMinutes: -90 }], {
        callTimes: [{ personId: PERSON, callLocal: '01:00' }],
      }),
    );
    expect(simulateShadowProduction(input)).toEqual({
      ok: false,
      code: 'DAY_BOUNDARY_CROSSING',
      interventionIndex: 0,
    });
  });

  it('rejects mismatched production identity before simulation', () => {
    const input = freezeInput(
      simulationInput([], { evaluation: { productionId: 'OTHER-PROD-01' } }),
    );
    expect(simulateShadowProduction(input)).toEqual({
      ok: false,
      code: 'PRODUCTION_IDENTITY_MISMATCH',
      interventionIndex: null,
    });
  });

  it('moves a shadowed activity without consulting wall-clock state', () => {
    const found = activityOverlay(simulationInput([shiftGothic]), GOTHIC);
    expect(found).toMatchObject({
      startMinute: 10 * 60 + 30,
      endMinute: 11 * 60 + 30,
      locationId: GOTHIC_LOCATION,
    });
  });

  it('keeps implementation free of clock, random, uuid, io, scoring, and authority shortcuts', () => {
    const source = implementationSource();
    const forbidden = [
      /Date\.now/,
      /Math\.random/,
      /randomUUID/,
      /node:fs/,
      /node:http/,
      /node:net/,
      /\bfetch\s*\(/,
      /@aws-sdk/,
      /bedrock/i,
      /strands/i,
      /evaluateShadowReadiness/,
      /shadowScore/,
      /optionAScore/,
      /recoveryScoreOverride/,
      /OPTION-A/,
      /BCN-DEMO-v1/,
      /recoveredComparison/,
      /approvalToken/,
      /executionToken/,
      /sendNotification/,
      /\bexecute\s*\(/,
      /\b74\b/,
      /\b89\b/,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toMatch(/evaluateProductionReadiness/);
    expect(source).toMatch(/validateInterventionPolicy/);
  });
});

const GOTHIC_SETUP = 'ACT-GOTHIC-SETUP';
const DEPART_GOTHIC = 'ACT-DEPART-GOTHIC';
const MODEL = 'PERSON-MODEL';
const HMU = 'PERSON-HMU';
const PHOTO_ASSISTANT = 'PERSON-PHOTO-ASSISTANT';

const earlyRecoveryRisks: readonly ReadinessRiskFact[] = [
  {
    riskId: 'RISK-GOTHIC-LOOK-03',
    incidentId: 'INCIDENT-COMPOUND-DRIFT',
    subjectId: GOTHIC,
    severity: 'CRITICAL',
    sourceEvidenceIds: ['EVIDENCE-TRAVEL-DRIFT', 'EVIDENCE-WEATHER-DRIFT'],
    reasons: ['WEATHER_WINDOW_COMPRESSION'],
  },
  {
    riskId: 'RISK-EIXAMPLE-LOOK-05',
    incidentId: 'INCIDENT-COMPOUND-DRIFT',
    subjectId: EIXAMPLE,
    severity: 'HIGH',
    sourceEvidenceIds: ['EVIDENCE-WEATHER-DRIFT', 'EVIDENCE-TRAVEL-DRIFT'],
    reasons: ['WEATHER_WINDOW_COMPRESSION'],
  },
  {
    riskId: 'RISK-STUDIO-LOAD-IN',
    incidentId: 'INCIDENT-COMPOUND-DRIFT',
    subjectId: STUDIO,
    severity: 'MEDIUM',
    sourceEvidenceIds: ['EVIDENCE-TRAVEL-DRIFT', 'EVIDENCE-WEATHER-DRIFT'],
    reasons: ['TRAVEL_LOAD_IN_DELAY'],
  },
];

const earlyRecoveryImpacts: readonly ReadinessImpactFact[] = [
  {
    incidentId: 'INCIDENT-COMPOUND-DRIFT',
    deliverableId: 'DELIVERABLE-D2',
    severity: 'CRITICAL',
    sourceEvidenceIds: ['EVIDENCE-WEATHER-DRIFT', 'EVIDENCE-TRAVEL-DRIFT'],
    riskIds: ['RISK-GOTHIC-LOOK-03'],
  },
  {
    incidentId: 'INCIDENT-COMPOUND-DRIFT',
    deliverableId: 'DELIVERABLE-D3',
    severity: 'HIGH',
    sourceEvidenceIds: ['EVIDENCE-WEATHER-DRIFT'],
    riskIds: ['RISK-EIXAMPLE-LOOK-05'],
  },
  {
    incidentId: 'INCIDENT-COMPOUND-DRIFT',
    deliverableId: 'DELIVERABLE-D5',
    severity: 'MEDIUM',
    sourceEvidenceIds: ['EVIDENCE-TRAVEL-DRIFT'],
    riskIds: ['RISK-STUDIO-LOAD-IN'],
  },
];

function activityDeltaAtMost(
  kind: 'ACTIVITY_START_DELTA_AT_MOST' | 'ACTIVITY_END_DELTA_AT_MOST',
  activityId: string,
  deltaMinutes: number,
): ProjectionPredicate {
  return { kind, activityId, deltaMinutes };
}

function callDeltaAtMost(personId: string, deltaMinutes: number): ProjectionPredicate {
  return { kind: 'CALL_TIME_DELTA_AT_MOST', personId, deltaMinutes };
}

const completeEarlyRecovery: readonly ProjectionPredicate[] = [
  activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, -25),
  activityDeltaAtMost('ACTIVITY_END_DELTA_AT_MOST', GOTHIC_SETUP, -25),
  activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', DEPART_GOTHIC, -20),
  activityDeltaAtMost('ACTIVITY_END_DELTA_AT_MOST', DEPART_GOTHIC, -20),
  callDeltaAtMost(MODEL, -25),
  callDeltaAtMost(HMU, -25),
  callDeltaAtMost(PHOTO_ASSISTANT, -25),
];

const studioLoadInRecovery: readonly ProjectionPredicate[] = [
  activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', DEPART_GOTHIC, -20),
  activityDeltaAtMost('ACTIVITY_END_DELTA_AT_MOST', DEPART_GOTHIC, -20),
  callDeltaAtMost(MODEL, -25),
  callDeltaAtMost(HMU, -25),
  callDeltaAtMost(PHOTO_ASSISTANT, -25),
];

function recoveryRule(
  ruleId: string,
  targetRiskId: string,
  when: readonly ProjectionPredicate[],
  afterSeverity: RiskProjectionRule['afterSeverity'],
): RiskProjectionRule {
  return { ruleId, targetRiskId, when, afterSeverity };
}

function canonicalProjection(
  rules: readonly RiskProjectionRule[] = [
    recoveryRule('RULE-EARLY-GOTHIC-BLOCK', 'RISK-GOTHIC-LOOK-03', completeEarlyRecovery, null),
    recoveryRule('RULE-EARLY-STUDIO-LOAD-IN', 'RISK-STUDIO-LOAD-IN', studioLoadInRecovery, 'LOW'),
  ],
): RecoveryProjectionPolicy {
  return { schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION, rules };
}

const canonicalInterventions: readonly InterventionPrimitive[] = [
  { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC_SETUP, deltaMinutes: -25 },
  { kind: 'ADJUST_CALL_TIME', personId: MODEL, deltaMinutes: -25 },
  { kind: 'ADJUST_CALL_TIME', personId: HMU, deltaMinutes: -25 },
  { kind: 'ADJUST_CALL_TIME', personId: PHOTO_ASSISTANT, deltaMinutes: -25 },
  { kind: 'ADJUST_DEPARTURE', transferActivityId: DEPART_GOTHIC, deltaMinutes: -20 },
];

const canonicalCallTimes: ShadowSimulationInput['callTimes'] = [
  { personId: MODEL, callLocal: '06:30' },
  { personId: HMU, callLocal: '06:30' },
  { personId: PHOTO_ASSISTANT, callLocal: '06:30' },
];

function canonicalRecoveryInput(
  interventions: readonly InterventionPrimitive[] = canonicalInterventions,
  projection: RecoveryProjectionPolicy = canonicalProjection(),
): ShadowSimulationInput {
  return simulationInput(interventions, {
    policy: {
      graph: createProductionGraph({
        productionId: 'BCN-DEMO-01',
        policyVersion: 'SR-POLICY-v1',
        fixtureVersion: 'BCN-DEMO-v1',
        nodes: [
          createGraphNode(DEPART_GOTHIC, 'ACTIVITY'),
          createGraphNode(GOTHIC_SETUP, 'ACTIVITY'),
          createGraphNode('LOC-GOTHIC', 'LOCATION'),
          createGraphNode(MODEL, 'PERSON'),
          createGraphNode(HMU, 'PERSON'),
          createGraphNode(PHOTO_ASSISTANT, 'PERSON'),
        ],
        edges: [],
      }),
      activities: [
        {
          activityId: DEPART_GOTHIC,
          startLocal: '06:40',
          endLocal: '07:10',
          locationId: 'LOC-GOTHIC',
          constraint: 'FIXED',
        },
        {
          activityId: GOTHIC_SETUP,
          startLocal: '07:10',
          endLocal: '07:20',
          locationId: 'LOC-GOTHIC',
          constraint: 'FIXED',
        },
      ],
      activityStates: [
        { activityId: DEPART_GOTHIC, state: 'PENDING' },
        { activityId: GOTHIC_SETUP, state: 'PENDING' },
      ],
      locationConstraints: [
        {
          locationId: 'LOC-GOTHIC',
          access: 'PASSED',
          rights: 'PASSED',
          windowStartLocal: '05:00',
          windowEndLocal: '09:00',
        },
      ],
      approvedFallbacks: [],
      approvedBackupPathIds: [],
      equipmentIds: [],
      requestableEvidenceScopes: [CONFIRMATION_SCOPE],
    },
    evaluation: { risks: earlyRecoveryRisks, impacts: earlyRecoveryImpacts },
    callTimes: canonicalCallTimes,
    projection,
  });
}

describe('operational recovery projection', () => {
  it('keeps readiness unchanged when the projection policy is empty', () => {
    const input = freezeInput(
      canonicalRecoveryInput(canonicalInterventions, EMPTY_RECOVERY_PROJECTION),
    );
    const before = inputSnapshot(input);
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    expect(inputSnapshot(input)).toBe(before);
    if (!result.ok) {
      return;
    }
    expect(result.simulation.liveAssessment.readinessScore).toBe(74);
    expect(result.simulation.shadowAssessment.readinessScore).toBe(74);
    expect(result.simulation.liveAssessment.confidenceScore).toBe(96);
    expect(result.simulation.shadowAssessment.confidenceScore).toBe(96);
    expect(result.simulation.comparison.readinessDelta).toBe(0);
    expect(result.simulation.resolvedOrReducedRisks).toEqual([]);
  });

  it('derives shadow readiness from the operational early-recovery deltas', () => {
    const input = freezeInput(canonicalRecoveryInput());
    const before = inputSnapshot(input);
    const direct = evaluateProductionReadiness(input.evaluation);
    const result = simulateShadowProduction(input);
    const repeated = simulateShadowProduction(input);

    expect(direct.readinessScore).toBe(74);
    expect(direct.confidenceScore).toBe(96);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toBe(JSON.stringify(repeated));
    expect(inputSnapshot(input)).toBe(before);
    if (!result.ok || !repeated.ok) {
      return;
    }

    const shadow = result.simulation.shadowAssessment;
    const rescored = evaluateProductionReadiness({
      ...input.evaluation,
      risks: shadow.risks,
      impacts: shadow.impacts,
    });
    expect(result.simulation.liveAssessment.readinessScore).toBe(74);
    expect(shadow.readinessScore).toBe(89);
    expect(shadow.readinessScore).toBe(rescored.readinessScore);
    expect(result.simulation.liveAssessment.confidenceScore).toBe(96);
    expect(shadow.confidenceScore).toBe(96);
    expect(shadow.evidenceReferences).toEqual(result.simulation.liveAssessment.evidenceReferences);
    expect(shadow.status).toBe(rescored.status);
    expect(result.simulation.comparison.statusAfter).toBe(shadow.status);
    expect(result.simulation.comparison.readinessDelta).toBe(
      shadow.readinessScore - result.simulation.liveAssessment.readinessScore,
    );

    expect(shadow.risks.map((risk) => [risk.riskId, risk.severity])).toEqual([
      ['RISK-EIXAMPLE-LOOK-05', 'HIGH'],
      ['RISK-STUDIO-LOAD-IN', 'LOW'],
    ]);
    expect(result.simulation.comparison.riskTransitions).toEqual([
      {
        riskId: 'RISK-GOTHIC-LOOK-03',
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        subjectId: GOTHIC,
        beforeSeverity: 'CRITICAL',
        afterSeverity: null,
      },
      {
        riskId: 'RISK-STUDIO-LOAD-IN',
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        subjectId: STUDIO,
        beforeSeverity: 'MEDIUM',
        afterSeverity: 'LOW',
      },
    ]);
    expect(shadow.impacts).toEqual([
      earlyRecoveryImpacts[1],
      {
        incidentId: 'INCIDENT-COMPOUND-DRIFT',
        deliverableId: 'DELIVERABLE-D5',
        severity: 'LOW',
        sourceEvidenceIds: ['EVIDENCE-TRAVEL-DRIFT', 'EVIDENCE-WEATHER-DRIFT'],
        riskIds: ['RISK-STUDIO-LOAD-IN'],
      },
    ]);
    expect(
      result.simulation.shadowGraph.operational.activities.find(
        (item) => item.activityId === GOTHIC_SETUP,
      ),
    ).toMatchObject({ constraint: 'FIXED', startMinute: 6 * 60 + 45, endMinute: 6 * 60 + 55 });
    expect(
      input.policyContext.activities.find((item) => item.activityId === GOTHIC_SETUP),
    ).toMatchObject({
      startLocal: '07:10',
      endLocal: '07:20',
    });
  });

  it('does not apply a recovery transition when one required delta is missing', () => {
    const input = freezeInput(
      canonicalRecoveryInput(
        canonicalInterventions.filter((item) => !('personId' in item) || item.personId !== HMU),
      ),
    );
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.simulation.shadowAssessment.readinessScore).toBe(74);
    expect(result.simulation.shadowAssessment.readinessScore).not.toBe(89);
    expect(result.simulation.comparison.riskTransitions).toEqual([]);
    expect(
      result.simulation.shadowAssessment.risks.find(
        (risk) => risk.riskId === 'RISK-GOTHIC-LOOK-03',
      ),
    ).toMatchObject({ severity: 'CRITICAL' });
    expect(
      result.simulation.shadowAssessment.risks.find(
        (risk) => risk.riskId === 'RISK-STUDIO-LOAD-IN',
      ),
    ).toMatchObject({ severity: 'MEDIUM' });
  });

  it('fails closed for an unknown target risk, a missing predicate target, and conflicting rules', () => {
    const unknown = simulateShadowProduction(
      freezeInput(
        canonicalRecoveryInput(canonicalInterventions, {
          schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
          rules: [
            recoveryRule(
              'RULE-UNKNOWN',
              'RISK-NOT-PRESENT',
              [activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, -25)],
              'LOW',
            ),
          ],
        }),
      ),
    );
    expect(unknown).toEqual({
      ok: false,
      code: 'UNKNOWN_PROJECTION_RISK',
      interventionIndex: null,
    });

    const missing = simulateShadowProduction(
      freezeInput(
        canonicalRecoveryInput(canonicalInterventions, {
          schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
          rules: [
            recoveryRule(
              'RULE-MISSING-TARGET',
              'RISK-GOTHIC-LOOK-03',
              [activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', 'ACT-NOT-PRESENT', -25)],
              null,
            ),
          ],
        }),
      ),
    );
    expect(missing).toEqual({
      ok: false,
      code: 'PROJECTION_PREDICATE_TARGET_MISSING',
      interventionIndex: null,
    });
    expect(missing).not.toHaveProperty('simulation');

    const conflict = simulateShadowProduction(
      freezeInput(
        canonicalRecoveryInput(canonicalInterventions, {
          schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
          rules: [
            recoveryRule(
              'RULE-REMOVE',
              'RISK-GOTHIC-LOOK-03',
              [activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, -25)],
              null,
            ),
            recoveryRule(
              'RULE-LOWER',
              'RISK-GOTHIC-LOOK-03',
              [activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, -25)],
              'LOW',
            ),
          ],
        }),
      ),
    );
    expect(conflict).toEqual({
      ok: false,
      code: 'CONFLICTING_PROJECTION_RULES',
      interventionIndex: null,
    });
  });

  it('fails closed for a duplicate rule id, a bad predicate, a version mismatch, and an undeclared impact risk', () => {
    const duplicate = simulateShadowProduction(
      freezeInput(
        canonicalRecoveryInput([], {
          schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
          rules: [
            recoveryRule(
              'RULE-SAME',
              'RISK-GOTHIC-LOOK-03',
              [activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, -25)],
              null,
            ),
            recoveryRule(
              'RULE-SAME',
              'RISK-GOTHIC-LOOK-03',
              [activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, -25)],
              'LOW',
            ),
          ],
        }),
      ),
    );
    expect(duplicate).toEqual({
      ok: false,
      code: 'DUPLICATE_PROJECTION_RULE',
      interventionIndex: null,
    });

    const unsupported = simulateShadowProduction(
      freezeInput(
        canonicalRecoveryInput([], {
          schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
          rules: [
            recoveryRule(
              'RULE-BAD',
              'RISK-GOTHIC-LOOK-03',
              [
                {
                  kind: 'NOT_A_PREDICATE',
                  activityId: GOTHIC_SETUP,
                  deltaMinutes: 0,
                } as unknown as ProjectionPredicate,
              ],
              null,
            ),
          ],
        }),
      ),
    );
    expect(unsupported).toEqual({
      ok: false,
      code: 'UNSUPPORTED_PROJECTION_PREDICATE',
      interventionIndex: null,
    });

    const mismatch = simulateShadowProduction(
      freezeInput(
        canonicalRecoveryInput([], {
          schemaVersion: 'SR-RECOVERY-PROJECTION-v0',
          rules: [],
        } as unknown as RecoveryProjectionPolicy),
      ),
    );
    expect(mismatch).toEqual({
      ok: false,
      code: 'PROJECTION_VERSION_MISMATCH',
      interventionIndex: null,
    });

    const undeclared = simulateShadowProduction(
      freezeInput(
        simulationInput([], {
          evaluation: {
            risks: earlyRecoveryRisks,
            impacts: [
              {
                incidentId: 'INCIDENT-COMPOUND-DRIFT',
                deliverableId: 'DELIVERABLE-D2',
                severity: 'CRITICAL',
                sourceEvidenceIds: ['EVIDENCE-WEATHER-DRIFT', 'EVIDENCE-TRAVEL-DRIFT'],
                riskIds: ['RISK-GOTHIC-LOOK-03', 'RISK-NOT-LIVE'],
              },
            ],
          },
          projection: EMPTY_RECOVERY_PROJECTION,
        }),
      ),
    );
    expect(undeclared).toEqual({
      ok: false,
      code: 'UNDECLARED_IMPACT_RISK',
      interventionIndex: null,
    });
  });

  it('rejects an empty rule and thresholds that do not require a real recovery move', () => {
    const deny = (rules: readonly RiskProjectionRule[], code: string) => {
      expect(
        simulateShadowProduction(
          freezeInput(
            canonicalRecoveryInput([], {
              schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
              rules,
            }),
          ),
        ),
      ).toEqual({ ok: false, code, interventionIndex: null });
    };
    const gothic = (deltaMinutes: number) =>
      activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, deltaMinutes);
    const gothicEnd = (deltaMinutes: number) =>
      activityDeltaAtMost('ACTIVITY_END_DELTA_AT_MOST', GOTHIC_SETUP, deltaMinutes);
    const call = (deltaMinutes: number): ProjectionPredicate => ({
      kind: 'CALL_TIME_DELTA_AT_MOST',
      personId: MODEL,
      deltaMinutes,
    });
    const buffer = (deltaMinutes: number): ProjectionPredicate => ({
      kind: 'BUFFER_BEFORE_AT_LEAST',
      activityId: GOTHIC_SETUP,
      deltaMinutes,
    });

    deny([recoveryRule('RULE-EMPTY', 'RISK-GOTHIC-LOOK-03', [], null)], 'EMPTY_PROJECTION_RULE');
    deny(
      [recoveryRule('RULE-START-ZERO', 'RISK-GOTHIC-LOOK-03', [gothic(0)], null)],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-START-LATER', 'RISK-GOTHIC-LOOK-03', [gothic(15)], null)],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-END-ZERO', 'RISK-GOTHIC-LOOK-03', [gothicEnd(0)], null)],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-START-TOO-EARLY', 'RISK-GOTHIC-LOOK-03', [gothic(-121)], null)],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-END-TOO-EARLY', 'RISK-GOTHIC-LOOK-03', [gothicEnd(-121)], null)],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-CALL-ZERO', 'RISK-GOTHIC-LOOK-03', [call(0)], null)],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-CALL-TOO-EARLY', 'RISK-GOTHIC-LOOK-03', [call(-91)], null)],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-BUFFER-ZERO', 'RISK-GOTHIC-LOOK-03', [buffer(0)], 'LOW')],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-BUFFER-NEGATIVE', 'RISK-GOTHIC-LOOK-03', [buffer(-1)], 'LOW')],
      'INVALID_PROJECTION_THRESHOLD',
    );
    deny(
      [recoveryRule('RULE-BUFFER-TOO-LARGE', 'RISK-GOTHIC-LOOK-03', [buffer(46)], 'LOW')],
      'INVALID_PROJECTION_THRESHOLD',
    );
  });

  it('rejects a repeated rule id even when the two copies are identical', () => {
    const predicate = activityDeltaAtMost('ACTIVITY_START_DELTA_AT_MOST', GOTHIC_SETUP, -25);
    const result = simulateShadowProduction(
      freezeInput(
        canonicalRecoveryInput([], {
          schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
          rules: [
            recoveryRule('RULE-SAME', 'RISK-GOTHIC-LOOK-03', [predicate], null),
            recoveryRule('RULE-SAME', 'RISK-GOTHIC-LOOK-03', [predicate], null),
          ],
        }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      code: 'DUPLICATE_PROJECTION_RULE',
      interventionIndex: null,
    });
  });

  it('does not change readiness when a material predicate does not match the operational delta', () => {
    const input = freezeInput(canonicalRecoveryInput([], canonicalProjection()));
    const before = inputSnapshot(input);
    const result = simulateShadowProduction(input);

    expect(result.ok).toBe(true);
    expect(inputSnapshot(input)).toBe(before);
    if (!result.ok) {
      return;
    }
    expect(result.simulation.liveAssessment.readinessScore).toBe(74);
    expect(result.simulation.shadowAssessment.readinessScore).toBe(74);
    expect(result.simulation.comparison.riskTransitions).toEqual([]);
    expect(
      result.simulation.shadowAssessment.risks.find(
        (risk) => risk.riskId === 'RISK-GOTHIC-LOOK-03',
      ),
    ).toMatchObject({ severity: 'CRITICAL' });
  });

  it('canonicalizes projection rule order and changes the fingerprint when a rule changes', () => {
    const forward = freezeInput(canonicalRecoveryInput());
    const reversed = freezeInput(
      canonicalRecoveryInput(
        canonicalInterventions,
        canonicalProjection([...canonicalProjection().rules].reverse()),
      ),
    );
    const changed = freezeInput(
      canonicalRecoveryInput(
        canonicalInterventions,
        canonicalProjection([
          recoveryRule(
            'RULE-EARLY-GOTHIC-BLOCK',
            'RISK-GOTHIC-LOOK-03',
            completeEarlyRecovery,
            'LOW',
          ),
          recoveryRule(
            'RULE-EARLY-STUDIO-LOAD-IN',
            'RISK-STUDIO-LOAD-IN',
            studioLoadInRecovery,
            'LOW',
          ),
        ]),
      ),
    );
    const first = simulateShadowProduction(forward);
    const second = simulateShadowProduction(reversed);
    const third = simulateShadowProduction(changed);

    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) {
      return;
    }
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.simulation.fingerprint).toBe(second.simulation.fingerprint);
    expect(first.simulation.simulationId).toBe(second.simulation.simulationId);
    expect(third.simulation.fingerprint).not.toBe(first.simulation.fingerprint);
    expect(third.simulation.simulationId).not.toBe(first.simulation.simulationId);
    expect(inputSnapshot(forward)).toBe(inputSnapshot(forward));
  });
});

describe('shadow-simulation package boundary', () => {
  it('depends only on the pure contracts required for simulation', () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@sceneready/intervention-engine',
      '@sceneready/production-graph',
      '@sceneready/production-pack',
      '@sceneready/readiness-engine',
    ]);
  });
});
