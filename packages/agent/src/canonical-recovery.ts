import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveZonedProductionTime } from '@sceneready/domain';
import {
  parseIntervention,
  validateInterventionPolicy,
  evaluateInterventionFeasibility,
  type InterventionPolicyContext,
  type InterventionPrimitive,
} from '@sceneready/intervention-engine';
import {
  compileProductionGraph,
  createGraphEdge,
  createGraphNode,
  createProductionGraph,
  type ProductionGraph,
} from '@sceneready/production-graph';
import {
  activateProductionPack,
  validateProductionPack,
  type ProductionPack,
} from '@sceneready/production-pack';
import {
  SCENEREADY_POLICY_V1,
  type ProductionEvaluationInput,
  type ProductionReadinessAssessment,
  type ReadinessRiskFact,
} from '@sceneready/readiness-engine';
import {
  CREATIVE_PRESERVATION_ALGORITHM_VERSION,
  CREW_DISRUPTION_ALGORITHM_VERSION,
  evaluateCreativePreservation,
  evaluateCrewDisruption,
  evaluateLogisticsImpact,
  evaluateNewRiskIntroduced,
  evaluateScheduleStability,
  LOGISTICS_IMPACT_ALGORITHM_VERSION,
  NEW_RISK_INTRODUCED_ALGORITHM_VERSION,
  SCHEDULE_STABILITY_ALGORITHM_VERSION,
  type CrewDisruptionEvent,
  type LogisticsImpactEvent,
  type ScheduleChangeEvent,
} from '@sceneready/recovery-outcomes';
import {
  IMPACT_RANK,
  rankRecoveryOptions,
  type ImpactLevel,
  type ProductionPriorityProfile,
  type RecoveryMetricId,
  type RecoveryOutcomeMetrics,
  type RecoveryRankingOption,
  type RecoveryRankingResult,
} from '@sceneready/recovery-ranking';
import {
  RECOVERY_PROJECTION_SCHEMA_VERSION,
  simulateShadowProduction,
  type ProjectionPredicate,
  type RecoveryProjectionPolicy,
  type ShadowRiskTransition,
  type ShadowSimulation,
} from '@sceneready/shadow-simulation';
import {
  calculateSolarEvidence,
  evaluateCreativeIntentEnvelope,
  type CreativeIntentEnvelope,
} from '@sceneready/solar-engine';
import { graphRevisionReferenceId, type GroundingContext } from './grounding-schema.js';
import {
  validateGroundedReasoning,
  type GroundingValidationResult,
} from './grounding-validator.js';

export const SR03_EVIDENCE_REPORT_SCHEMA = 'SR-03-EVIDENCE-REPORT-v1';

/** Canonical activation instant already bound by the SR-02 evidence report. */
const CANONICAL_ACTIVATED_AT = '2026-09-17T03:45:00Z';

/**
 * Fixture locations do not carry access windows. Gothic uses the confirmed
 * window from the accepted shadow canonical recovery context so the early
 * shift remains inside that window.
 */
const ACCEPTED_GOTHIC_ACCESS_WINDOW = Object.freeze({
  windowStartLocal: '05:00',
  windowEndLocal: '09:00',
});

/** Call baseline used by the accepted shadow canonical recovery context. */
const ACCEPTED_SHADOW_CALL_LOCAL = '06:30';

const GOTHIC_LOOK = 'ACT-GOTHIC-LOOK-03';
const STUDIO_LOAD_IN = 'ACT-STUDIO-LOAD-IN';
const GOTHIC_LOCATION = 'LOC-GOTHIC';

export const CREATIVE_FIRST_PROFILE: ProductionPriorityProfile = {
  profileId: 'CREATIVE-FIRST',
  tiers: [
    { metricIds: ['CREATIVE_PRESERVATION'] },
    { metricIds: ['READINESS_IMPROVEMENT'] },
    { metricIds: ['SCHEDULE_STABILITY'] },
    { metricIds: ['EVIDENCE_CONFIDENCE'] },
    { metricIds: ['LOGISTICS_IMPACT'] },
    { metricIds: ['CREW_DISRUPTION'] },
    { metricIds: ['NEW_RISK_INTRODUCED'] },
  ],
};

const RANKING_POLICY = Object.freeze({ confidence: Object.freeze({ degradedFloor: 60 }) });

const OPTION_A_INTERVENTIONS = Object.freeze([
  Object.freeze({ kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: -25 }),
  Object.freeze({ kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 }),
  Object.freeze({ kind: 'ADJUST_CALL_TIME', personId: 'PERSON-HMU', deltaMinutes: -25 }),
  Object.freeze({
    kind: 'ADJUST_CALL_TIME',
    personId: 'PERSON-PHOTO-ASSISTANT',
    deltaMinutes: -25,
  }),
  Object.freeze({
    kind: 'ADJUST_DEPARTURE',
    transferActivityId: 'ACT-DEPART-GOTHIC',
    deltaMinutes: -20,
  }),
]) as readonly InterventionPrimitive[];

const OPTION_B_INTERVENTIONS = Object.freeze([
  Object.freeze({ kind: 'ADD_BUFFER', beforeActivityId: 'ACT-EIXAMPLE-SETUP', minutes: 10 }),
]) as readonly InterventionPrimitive[];

const OPTION_C_INTERVENTIONS = Object.freeze([]) as readonly InterventionPrimitive[];

const LEGACY_INVALID_INTERVENTIONS = Object.freeze([
  Object.freeze({ kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC_LOOK, minutes: 20 }),
  Object.freeze({ kind: 'ADD_BUFFER', beforeActivityId: 'ACT-EIXAMPLE-SETUP', minutes: 10 }),
]) as readonly InterventionPrimitive[];

export interface CanonicalOptionDeclaration {
  readonly optionId: 'OPTION-A' | 'OPTION-B' | 'OPTION-C';
  readonly interventions: readonly InterventionPrimitive[];
}

export const CANONICAL_OPTION_DECLARATIONS: readonly CanonicalOptionDeclaration[] = Object.freeze([
  Object.freeze({ optionId: 'OPTION-A' as const, interventions: OPTION_A_INTERVENTIONS }),
  Object.freeze({ optionId: 'OPTION-B' as const, interventions: OPTION_B_INTERVENTIONS }),
  Object.freeze({ optionId: 'OPTION-C' as const, interventions: OPTION_C_INTERVENTIONS }),
]);

export interface MetricProducers {
  readonly readinessImprovement: 'shadowAssessment.readinessScore-liveAssessment.readinessScore';
  readonly creativePreservation: typeof CREATIVE_PRESERVATION_ALGORITHM_VERSION;
  readonly scheduleStability: typeof SCHEDULE_STABILITY_ALGORITHM_VERSION;
  readonly logisticsImpact: typeof LOGISTICS_IMPACT_ALGORITHM_VERSION;
  readonly crewDisruption: typeof CREW_DISRUPTION_ALGORITHM_VERSION;
  readonly evidenceConfidence: 'shadowAssessment.confidenceScore';
  readonly newRiskIntroduced: typeof NEW_RISK_INTRODUCED_ALGORITHM_VERSION;
}

export interface CanonicalOptionResult {
  readonly optionId: 'OPTION-A' | 'OPTION-B' | 'OPTION-C';
  readonly interventions: readonly InterventionPrimitive[];
  readonly schemaValid: boolean;
  readonly policyValid: boolean;
  readonly policyDenialCodes: readonly string[];
  readonly feasible: boolean;
  readonly feasibilityReasons: readonly string[];
  readonly liveReadiness: number;
  readonly liveStatus: ProductionReadinessAssessment['status'];
  readonly liveCertification: ProductionReadinessAssessment['certification'];
  readonly shadowReadiness: number;
  readonly readinessImprovement: number;
  readonly liveConfidence: number;
  readonly shadowConfidence: number;
  readonly creativePreservation: number;
  readonly staticEnvelopeQuality: number;
  readonly scheduleStability: number;
  readonly logisticsImpact: ImpactLevel;
  readonly crewDisruption: ImpactLevel;
  readonly evidenceConfidence: number;
  readonly newRiskIntroduced: ImpactLevel;
  readonly riskTransitions: readonly ShadowRiskTransition[];
  readonly shadowRisks: readonly Pick<ReadinessRiskFact, 'riskId' | 'subjectId' | 'severity'>[];
  readonly crewEventCount: number;
  readonly logisticsEventCount: number;
  readonly operationalMutation: boolean;
  readonly technicalShadowRevisionDelta: number;
  readonly simulationFingerprint: string;
  readonly shadowGraphFingerprint: string;
  readonly metrics: RecoveryOutcomeMetrics;
}

export interface RejectedCandidate {
  readonly optionId: 'LEGACY-INVALID-OPTION-B';
  readonly interventions: readonly InterventionPrimitive[];
  readonly schemaValid: boolean;
  readonly policyValid: boolean;
  readonly rejectionCodes: readonly string[];
  readonly ranked: false;
}

export interface RankingSafetyProofs {
  readonly noViablePlan: RecoveryRankingResult;
  readonly insufficientEvidence: RecoveryRankingResult;
  readonly tradeOff: RecoveryRankingResult;
  readonly exactTie: RecoveryRankingResult;
}

export interface GroundingCertification {
  readonly positive: GroundingValidationResult;
  readonly negative: GroundingValidationResult;
  readonly negativeRejectedClaims: readonly string[];
  readonly initialInvalid: GroundingValidationResult;
  readonly retryInvalid: GroundingValidationResult;
  readonly deterministicExplanationAccepted: boolean;
}

export interface CanonicalRecoveryCertification {
  readonly schemaVersion: typeof SR03_EVIDENCE_REPORT_SCHEMA;
  readonly fixtureVersion: string;
  readonly graphSchemaVersion: string;
  readonly policyVersion: string;
  readonly scoringVersion: string;
  readonly producers: MetricProducers;
  readonly priorityProfile: ProductionPriorityProfile;
  readonly live: {
    readonly readiness: number;
    readonly confidence: number;
    readonly status: ProductionReadinessAssessment['status'];
    readonly certification: ProductionReadinessAssessment['certification'];
    readonly creativePreservation: number;
    readonly staticEnvelopeQuality: number;
  };
  readonly options: readonly CanonicalOptionResult[];
  readonly legacyInvalidOptionB: RejectedCandidate;
  readonly ranking: RecoveryRankingResult;
  readonly orderedOptionIds: readonly string[];
  readonly optionAWinsOnCreativeTier: boolean;
  readonly bcAuthorityTie: boolean;
  readonly bcDistinguishingMetric: RecoveryMetricId | null;
  readonly rankingSafety: RankingSafetyProofs;
  readonly grounding: GroundingCertification;
  readonly noModelInvocation: true;
  readonly liveGraphFingerprint: string;
  readonly liveGraphFingerprintUnchanged: boolean;
  readonly liveGraphSerializedUnchanged: boolean;
  readonly fingerprintsRepeatStable: boolean;
  readonly optionCTechnicalShadowIdentity: boolean;
  readonly optionCOperationalNoChange: boolean;
}

interface ScheduleActivity {
  readonly id: string;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly locationId: string;
  readonly assignedPersonIds: readonly string[];
  readonly constraint: InterventionPolicyContext['activities'][number]['constraint'];
}

interface PreparedContext {
  readonly pack: ProductionPack;
  readonly policyContext: InterventionPolicyContext;
  readonly projection: RecoveryProjectionPolicy;
  readonly callTimes: readonly { readonly personId: string; readonly callLocal: string }[];
  readonly looks: ReturnType<typeof evaluateLooks>;
}

function fixtureDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/barcelona-aer-ss27');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(directory: string, fileName: string): Promise<unknown> {
  return JSON.parse(await readFile(join(directory, fileName), 'utf8')) as unknown;
}

async function loadCanonicalPack(): Promise<ProductionPack> {
  const directory = fixtureDirectory();
  const [manifest, equipment, rights] = await Promise.all([
    readJson(directory, 'manifest.json'),
    readJson(directory, 'equipment.json'),
    readJson(directory, 'rights.json'),
  ]);
  if (!isRecord(manifest) || !isRecord(equipment) || !isRecord(rights)) {
    throw new Error('canonical Barcelona fixture sections are malformed');
  }
  const validated = validateProductionPack({
    fixtureVersion: manifest.fixtureVersion,
    policyVersion: manifest.policyVersion,
    syntheticDataDeclaration: manifest.syntheticDataDeclaration,
    production: await readJson(directory, 'production.json'),
    crew: await readJson(directory, 'crew.json'),
    locations: await readJson(directory, 'locations.json'),
    schedule: await readJson(directory, 'schedule.json'),
    deliverables: await readJson(directory, 'deliverables.json'),
    equipment: equipment.assets,
    capturePaths: equipment.capturePaths,
    rights: rights.documents,
    priorities: await readJson(directory, 'priorities.json'),
    hardGates: rights.hardGates,
    evidence: rights.evidence,
  });
  if (!validated.ok) {
    throw new Error('canonical Barcelona pack failed validation');
  }
  return validated.pack;
}

function localToMinute(value: string): number {
  const [hour, minute] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

/**
 * The accepted shadow clone denies a non-positive interval as a missing
 * operational fact. Instantaneous schedule markers stay on the pack, graph,
 * location windows, and creative evaluation, and are omitted only from the
 * cloneable activity set.
 */
function cloneableActivities(schedule: readonly ScheduleActivity[]): readonly ScheduleActivity[] {
  return schedule.filter(
    (activity) => localToMinute(activity.endLocal) > localToMinute(activity.startLocal),
  );
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function activityById(schedule: readonly ScheduleActivity[], activityId: string): ScheduleActivity {
  const found = schedule.find((item) => item.id === activityId);
  if (found === undefined) {
    throw new Error(`missing schedule activity ${activityId}`);
  }
  return found;
}

function overlayRiskEvidence(
  graph: ProductionGraph,
  risks: readonly ReadinessRiskFact[],
): ProductionGraph {
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const risk of risks) {
    for (const evidenceId of risk.sourceEvidenceIds) {
      if (!nodeIds.has(evidenceId)) {
        nodes.push(createGraphNode(evidenceId, 'EVIDENCE'));
        nodeIds.add(evidenceId);
      }
      const linked = edges.some(
        (edge) => edge.from === evidenceId && edge.to === risk.subjectId && edge.type === 'AFFECTS',
      );
      if (!linked) {
        edges.push(createGraphEdge(evidenceId, risk.subjectId, 'AFFECTS'));
      }
    }
  }
  return createProductionGraph({
    productionId: graph.productionId,
    policyVersion: graph.policyVersion,
    fixtureVersion: graph.fixtureVersion,
    nodes,
    edges,
  });
}

function locationWindow(locationId: string, schedule: readonly ScheduleActivity[]) {
  if (locationId === GOTHIC_LOCATION) {
    return ACCEPTED_GOTHIC_ACCESS_WINDOW;
  }
  const times = schedule.filter((item) => item.locationId === locationId);
  const starts = times.map((item) => item.startLocal).sort(compareText);
  const ends = times.map((item) => item.endLocal).sort(compareText);
  const windowStartLocal = starts[0];
  const windowEndLocal = ends[ends.length - 1];
  if (windowStartLocal === undefined || windowEndLocal === undefined) {
    throw new Error(`missing scheduled window for ${locationId}`);
  }
  return { windowStartLocal, windowEndLocal };
}

function riskIdForSubject(risks: readonly ReadinessRiskFact[], subjectId: string): string {
  const found = risks.find((risk) => risk.subjectId === subjectId);
  if (found === undefined) {
    throw new Error(`missing canonical risk for ${subjectId}`);
  }
  return found.riskId;
}

function activityWindow(activityId: string, deltaMinutes: number): readonly ProjectionPredicate[] {
  return [
    { kind: 'ACTIVITY_START_DELTA_AT_MOST', activityId, deltaMinutes },
    { kind: 'ACTIVITY_END_DELTA_AT_MOST', activityId, deltaMinutes },
  ];
}

function canonicalProjection(risks: readonly ReadinessRiskFact[]): RecoveryProjectionPolicy {
  const gothicRemoval: ProjectionPredicate[] = [];
  const studioRelief: ProjectionPredicate[] = [];
  for (const intervention of OPTION_A_INTERVENTIONS) {
    if (intervention.kind === 'SHIFT_ACTIVITY') {
      gothicRemoval.push(...activityWindow(intervention.activityId, intervention.deltaMinutes));
    } else if (intervention.kind === 'ADJUST_DEPARTURE') {
      const window = activityWindow(intervention.transferActivityId, intervention.deltaMinutes);
      gothicRemoval.push(...window);
      studioRelief.push(...window);
    } else if (intervention.kind === 'ADJUST_CALL_TIME') {
      const predicate: ProjectionPredicate = {
        kind: 'CALL_TIME_DELTA_AT_MOST',
        personId: intervention.personId,
        deltaMinutes: intervention.deltaMinutes,
      };
      gothicRemoval.push(predicate);
      studioRelief.push(predicate);
    }
  }
  return {
    schemaVersion: RECOVERY_PROJECTION_SCHEMA_VERSION,
    rules: [
      {
        ruleId: 'RULE-EARLY-GOTHIC-BLOCK',
        targetRiskId: riskIdForSubject(risks, GOTHIC_LOOK),
        when: gothicRemoval,
        afterSeverity: null,
      },
      {
        ruleId: 'RULE-EARLY-STUDIO-LOAD-IN',
        targetRiskId: riskIdForSubject(risks, STUDIO_LOAD_IN),
        when: studioRelief,
        afterSeverity: 'LOW',
      },
    ],
  };
}

function prepareContext(
  pack: ProductionPack,
  evaluation: ProductionEvaluationInput,
): PreparedContext {
  const schedule = pack.schedule as readonly ScheduleActivity[];
  const cloneable = cloneableActivities(schedule);
  const activation = activateProductionPack(pack, CANONICAL_ACTIVATED_AT);
  const compiled = compileProductionGraph({
    pack,
    activation,
    evidence: { active: [], superseded: [], conflicts: [] },
  });
  const graph = overlayRiskEvidence(compiled, evaluation.risks);
  const locationIds = [...new Set(schedule.map((item) => item.locationId))].sort(compareText);
  const policyContext: InterventionPolicyContext = {
    graph,
    policyVersion: pack.policyVersion,
    productionPhase: 'PREFLIGHT',
    activities: cloneable.map((item) => ({
      activityId: item.id,
      startLocal: item.startLocal,
      endLocal: item.endLocal,
      locationId: item.locationId,
      constraint: item.constraint,
    })),
    activityStates: cloneable.map((item) => ({ activityId: item.id, state: 'PENDING' as const })),
    locationConstraints: locationIds.map((locationId) => ({
      locationId,
      access: 'PASSED' as const,
      rights: 'PASSED' as const,
      ...locationWindow(locationId, schedule),
    })),
    approvedFallbacks: [],
    approvedBackupPathIds: [],
    equipmentIds: [],
    requestableEvidenceScopes: ['DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY'],
  };
  const callPeople = [
    ...new Set(
      CANONICAL_OPTION_DECLARATIONS.flatMap((option) =>
        option.interventions.flatMap((intervention) =>
          intervention.kind === 'ADJUST_CALL_TIME' ? [intervention.personId] : [],
        ),
      ),
    ),
  ].sort(compareText);
  return {
    pack,
    policyContext,
    projection: canonicalProjection(evaluation.risks),
    callTimes: callPeople.map((personId) => ({ personId, callLocal: ACCEPTED_SHADOW_CALL_LOCAL })),
    looks: evaluateLooks(pack),
  };
}

type LocatedEnvelope = CreativeIntentEnvelope & {
  readonly coordinates: { readonly latitude: number; readonly longitude: number };
};

/**
 * A canonical look is an activity required by a deliverable that names a
 * creative-intent envelope. Setup, transfer, and wrap activities can share
 * that location envelope without being looks.
 */
function canonicalLookBindings(
  pack: ProductionPack,
): readonly { readonly activityId: string; readonly envelopeId: string }[] {
  const bindings = new Map<string, string>();
  const deliverables = [...pack.deliverables].sort((left, right) => compareText(left.id, right.id));
  for (const deliverable of deliverables) {
    const envelopeId = deliverable.creativeIntentEnvelopeId;
    if (envelopeId === undefined) {
      continue;
    }
    for (const activityId of deliverable.requiredActivityIds) {
      const bound = bindings.get(activityId);
      if (bound !== undefined && bound !== envelopeId) {
        throw new Error(`conflicting creative envelopes for ${activityId}`);
      }
      bindings.set(activityId, envelopeId);
    }
  }
  return [...bindings.entries()]
    .sort((left, right) => compareText(left[0], right[0]))
    .map(([activityId, envelopeId]) => ({ activityId, envelopeId }));
}

function envelopesById(pack: ProductionPack): ReadonlyMap<string, LocatedEnvelope> {
  const envelopes = new Map<string, LocatedEnvelope>();
  for (const location of pack.locations) {
    if (location.solarCreativeIntent === undefined) {
      continue;
    }
    envelopes.set(location.solarCreativeIntent.envelopeId, {
      ...location.solarCreativeIntent,
      coordinates: location.coordinates,
    });
  }
  return envelopes;
}

function evaluateLooks(pack: ProductionPack) {
  const envelopes = envelopesById(pack);
  const schedule = pack.schedule as readonly ScheduleActivity[];
  const rows = [];
  for (const binding of canonicalLookBindings(pack)) {
    const envelope = envelopes.get(binding.envelopeId);
    if (envelope === undefined) {
      throw new Error(`missing creative envelope ${binding.envelopeId}`);
    }
    const activity = activityById(schedule, binding.activityId);
    const startInstant = resolveZonedProductionTime({
      date: pack.production.date,
      time: activity.startLocal,
      timeZone: pack.production.timeZone,
    }).instant;
    const endInstant = resolveZonedProductionTime({
      date: pack.production.date,
      time: activity.endLocal,
      timeZone: pack.production.timeZone,
    }).instant;
    const startSolar = calculateSolarEvidence({
      productionId: pack.production.id,
      evidenceId: `EVD-SOLAR-${activity.id}-START`,
      coordinates: envelope.coordinates,
      instant: startInstant,
    });
    const endSolar = calculateSolarEvidence({
      productionId: pack.production.id,
      evidenceId: `EVD-SOLAR-${activity.id}-END`,
      coordinates: envelope.coordinates,
      instant: endInstant,
    });
    const start = evaluateCreativeIntentEnvelope({
      envelope,
      localTime: activity.startLocal,
      sunAzimuthDegrees: startSolar.sunAzimuthDegrees,
      sunElevationDegrees: startSolar.sunElevationDegrees,
    });
    const end = evaluateCreativeIntentEnvelope({
      envelope,
      localTime: activity.endLocal,
      sunAzimuthDegrees: endSolar.sunAzimuthDegrees,
      sunElevationDegrees: endSolar.sunElevationDegrees,
    });
    rows.push({
      activityId: activity.id,
      envelopeId: envelope.envelopeId,
      envelopeImportance: envelope.importance,
      startScore: start.score,
      endScore: end.score,
    });
  }
  return rows;
}

function directRisks(risks: readonly ReadinessRiskFact[]) {
  return risks.map((risk) => ({
    riskId: risk.riskId,
    subjectId: risk.subjectId,
    severity: risk.severity,
  }));
}

function requireCreative(looks: PreparedContext['looks'], risks: readonly ReadinessRiskFact[]) {
  const result = evaluateCreativePreservation({ looks, risks: directRisks(risks) });
  if (result.status !== 'AVAILABLE') {
    throw new Error(`creative preservation withheld: ${result.issues.join(',')}`);
  }
  return result;
}

function adaptIntervention(
  intervention: InterventionPrimitive,
  schedule: readonly ScheduleActivity[],
): {
  readonly scheduleEvents: readonly ScheduleChangeEvent[];
  readonly crewEvents: readonly CrewDisruptionEvent[];
  readonly logisticsEvents: readonly LogisticsImpactEvent[];
} {
  switch (intervention.kind) {
    case 'SHIFT_ACTIVITY': {
      const activity = activityById(schedule, intervention.activityId);
      return {
        scheduleEvents: [
          {
            kind: 'ACTIVITY_TIME_CHANGED',
            subjectId: intervention.activityId,
            deltaMinutes: intervention.deltaMinutes,
          },
        ],
        crewEvents: [
          {
            kind: 'SHARED_ACTIVITY_TIME_CHANGED',
            activityId: intervention.activityId,
            deltaMinutes: intervention.deltaMinutes,
            affectedPersonIds: activity.assignedPersonIds,
          },
        ],
        logisticsEvents: [],
      };
    }
    case 'ADJUST_CALL_TIME':
      return {
        scheduleEvents: [
          {
            kind: 'PERSONAL_CALL_TIME_CHANGED',
            subjectId: intervention.personId,
            deltaMinutes: intervention.deltaMinutes,
          },
        ],
        crewEvents: [
          {
            kind: 'PERSONAL_CALL_TIME_CHANGED',
            personId: intervention.personId,
            deltaMinutes: intervention.deltaMinutes,
          },
        ],
        logisticsEvents: [],
      };
    case 'ADJUST_DEPARTURE': {
      const activity = activityById(schedule, intervention.transferActivityId);
      return {
        scheduleEvents: [
          {
            kind: 'DEPARTURE_TIME_CHANGED',
            subjectId: intervention.transferActivityId,
            deltaMinutes: intervention.deltaMinutes,
          },
        ],
        crewEvents: [
          {
            kind: 'SHARED_DEPARTURE_TIME_CHANGED',
            activityId: intervention.transferActivityId,
            deltaMinutes: intervention.deltaMinutes,
            affectedPersonIds: activity.assignedPersonIds,
          },
        ],
        logisticsEvents: [
          { kind: 'TRANSFER_TIMING_CHANGED', transferActivityId: intervention.transferActivityId },
        ],
      };
    }
    case 'ADD_BUFFER':
      return {
        scheduleEvents: [
          {
            kind: 'BUFFER_ADDED',
            subjectId: intervention.beforeActivityId,
            minutes: intervention.minutes,
          },
        ],
        crewEvents: [],
        logisticsEvents: [],
      };
    default:
      throw new Error(`NO_CANONICAL_ADAPTER:${intervention.kind}`);
  }
}

function requireLevel(
  result:
    | { readonly status: 'AVAILABLE'; readonly level: ImpactLevel }
    | { readonly status: 'WITHHELD'; readonly issues: readonly string[] },
  label: string,
): ImpactLevel {
  if (result.status !== 'AVAILABLE') {
    throw new Error(`${label} withheld: ${result.issues.join(',')}`);
  }
  return result.level;
}

function validateCandidate(
  interventions: readonly InterventionPrimitive[],
  context: InterventionPolicyContext,
) {
  const denialCodes: string[] = [];
  let schemaValid = true;
  for (const intervention of interventions) {
    const parsed = parseIntervention(intervention);
    if (!parsed.ok) {
      schemaValid = false;
      denialCodes.push(parsed.code);
      continue;
    }
    const decision = validateInterventionPolicy(parsed.intervention, context);
    if (!decision.allowed) {
      denialCodes.push(decision.code);
    }
  }
  return {
    schemaValid,
    policyValid: schemaValid && denialCodes.length === 0,
    denialCodes: [...new Set(denialCodes)].sort(compareText),
  };
}

function operationalMutation(
  simulation: ShadowSimulation,
  schedule: readonly ScheduleActivity[],
  callTimes: PreparedContext['callTimes'],
): boolean {
  const byId = new Map(schedule.map((item) => [item.id, item]));
  for (const activity of simulation.shadowGraph.operational.activities) {
    const planned = byId.get(activity.activityId);
    if (planned === undefined) {
      return true;
    }
    if (
      activity.startMinute !== localToMinute(planned.startLocal) ||
      activity.endMinute !== localToMinute(planned.endLocal) ||
      activity.locationId !== planned.locationId ||
      activity.bufferBeforeMinutes !== 0 ||
      activity.transferBufferMinutes !== 0
    ) {
      return true;
    }
  }
  const calls = new Map(callTimes.map((item) => [item.personId, localToMinute(item.callLocal)]));
  for (const call of simulation.shadowGraph.operational.callTimes) {
    if (call.callMinute !== calls.get(call.personId)) {
      return true;
    }
  }
  return false;
}

function analyzeOption(
  declaration: CanonicalOptionDeclaration,
  prepared: PreparedContext,
  evaluation: ProductionEvaluationInput,
): CanonicalOptionResult {
  const schedule = prepared.pack.schedule as readonly ScheduleActivity[];
  const validity = validateCandidate(declaration.interventions, prepared.policyContext);
  if (!validity.schemaValid || !validity.policyValid) {
    throw new Error(
      `${declaration.optionId} is not viable: ${validity.denialCodes.join(',') || 'invalid'}`,
    );
  }
  const simulated = simulateShadowProduction({
    policyContext: prepared.policyContext,
    evaluation,
    interventions: declaration.interventions,
    callTimes: prepared.callTimes,
    projection: prepared.projection,
  });
  if (!simulated.ok) {
    throw new Error(`${declaration.optionId} shadow simulation denied: ${simulated.code}`);
  }
  const simulation = simulated.simulation;
  const feasibility = evaluateInterventionFeasibility(
    {
      comparison: { failedGatesIntroduced: simulation.comparison.failedGatesIntroduced },
      introducedRisks: simulation.introducedRisks,
      shadowGraph: { operational: { activities: simulation.shadowGraph.operational.activities } },
    },
    [],
    {
      maxIntroducedCriticalRisks: SCENEREADY_POLICY_V1.recovery.maxIntroducedCriticalRisks,
      maxIntroducedHighRisks: SCENEREADY_POLICY_V1.recovery.maxIntroducedHighRisks,
    },
  );
  const adapted = declaration.interventions.map((intervention) =>
    adaptIntervention(intervention, schedule),
  );
  const scheduleEvents = adapted.flatMap((item) => item.scheduleEvents);
  const crewEvents = adapted.flatMap((item) => item.crewEvents);
  const logisticsEvents = adapted.flatMap((item) => item.logisticsEvents);
  const scheduleResult = evaluateScheduleStability(scheduleEvents);
  if (scheduleResult.status !== 'AVAILABLE') {
    throw new Error(`schedule stability withheld: ${scheduleResult.issues.join(',')}`);
  }
  const logisticsResult = evaluateLogisticsImpact(logisticsEvents);
  const crewResult = evaluateCrewDisruption(crewEvents);
  const introduced = simulation.introducedRisks.flatMap((risk) =>
    risk.afterSeverity === null ? [] : [{ riskId: risk.riskId, severity: risk.afterSeverity }],
  );
  const newRisk = evaluateNewRiskIntroduced(introduced);
  const creative = requireCreative(prepared.looks, simulation.shadowAssessment.risks);
  const readinessImprovement =
    simulation.shadowAssessment.readinessScore - simulation.liveAssessment.readinessScore;
  const metrics: RecoveryOutcomeMetrics = {
    readinessImprovement,
    creativePreservation: creative.creativePreservation,
    scheduleStability: scheduleResult.scheduleStability,
    logisticsImpact: requireLevel(logisticsResult, 'logistics impact'),
    crewDisruption: requireLevel(crewResult, 'crew disruption'),
    evidenceConfidence: simulation.shadowAssessment.confidenceScore,
    newRiskIntroduced: requireLevel(newRisk, 'new risk introduced'),
  };
  return {
    optionId: declaration.optionId,
    interventions: declaration.interventions,
    schemaValid: true,
    policyValid: true,
    policyDenialCodes: [],
    feasible: feasibility.viable,
    feasibilityReasons: feasibility.reasons,
    liveReadiness: simulation.liveAssessment.readinessScore,
    liveStatus: simulation.liveAssessment.status,
    liveCertification: simulation.liveAssessment.certification,
    shadowReadiness: simulation.shadowAssessment.readinessScore,
    readinessImprovement,
    liveConfidence: simulation.liveAssessment.confidenceScore,
    shadowConfidence: simulation.shadowAssessment.confidenceScore,
    creativePreservation: creative.creativePreservation,
    staticEnvelopeQuality: creative.staticEnvelopeQuality,
    scheduleStability: scheduleResult.scheduleStability,
    logisticsImpact: metrics.logisticsImpact,
    crewDisruption: metrics.crewDisruption,
    evidenceConfidence: metrics.evidenceConfidence,
    newRiskIntroduced: metrics.newRiskIntroduced,
    riskTransitions: simulation.comparison.riskTransitions,
    shadowRisks: simulation.shadowAssessment.risks.map((risk) => ({
      riskId: risk.riskId,
      subjectId: risk.subjectId,
      severity: risk.severity,
    })),
    crewEventCount: crewEvents.length,
    logisticsEventCount: logisticsEvents.length,
    operationalMutation: operationalMutation(simulation, schedule, prepared.callTimes),
    technicalShadowRevisionDelta:
      simulation.shadowGraph.shadowGraphRevision - simulation.shadowGraph.baseGraphRevision,
    simulationFingerprint: simulation.fingerprint,
    shadowGraphFingerprint: simulation.shadowGraph.fingerprint,
    metrics,
  };
}

function metricBetter(metricId: RecoveryMetricId, left: number, right: number): boolean {
  if (
    metricId === 'LOGISTICS_IMPACT' ||
    metricId === 'CREW_DISRUPTION' ||
    metricId === 'NEW_RISK_INTRODUCED'
  ) {
    return left < right;
  }
  return left > right;
}

function metricValue(metrics: RecoveryOutcomeMetrics, metricId: RecoveryMetricId): number {
  switch (metricId) {
    case 'CREATIVE_PRESERVATION':
      return metrics.creativePreservation;
    case 'READINESS_IMPROVEMENT':
      return metrics.readinessImprovement;
    case 'SCHEDULE_STABILITY':
      return metrics.scheduleStability;
    case 'EVIDENCE_CONFIDENCE':
      return metrics.evidenceConfidence;
    case 'LOGISTICS_IMPACT':
      return IMPACT_RANK[metrics.logisticsImpact];
    case 'CREW_DISRUPTION':
      return IMPACT_RANK[metrics.crewDisruption];
    case 'NEW_RISK_INTRODUCED':
      return IMPACT_RANK[metrics.newRiskIntroduced];
    default:
      return 0;
  }
}

function distinguishingMetric(
  left: RecoveryOutcomeMetrics,
  right: RecoveryOutcomeMetrics,
  profile: ProductionPriorityProfile,
): RecoveryMetricId | null {
  for (const tier of profile.tiers) {
    for (const metricId of tier.metricIds) {
      const leftValue = metricValue(left, metricId);
      const rightValue = metricValue(right, metricId);
      if (
        leftValue !== rightValue &&
        (metricBetter(metricId, leftValue, rightValue) ||
          metricBetter(metricId, rightValue, leftValue))
      ) {
        return metricId;
      }
    }
  }
  return null;
}

function labeledMetrics(overrides: Partial<RecoveryOutcomeMetrics>): RecoveryOutcomeMetrics {
  return {
    readinessImprovement: 0,
    creativePreservation: 50,
    scheduleStability: 50,
    logisticsImpact: 'LOW',
    crewDisruption: 'LOW',
    evidenceConfidence: 90,
    newRiskIntroduced: 'LOW',
    ...overrides,
  };
}

function labeledOption(
  optionId: string,
  overrides: Partial<RecoveryOutcomeMetrics>,
  viable = true,
): RecoveryRankingOption {
  return {
    optionId,
    feasibility: { viable, reasons: viable ? [] : ['INFEASIBLE'] },
    metrics: labeledMetrics(overrides),
  };
}

export function proveRankingSafety(): RankingSafetyProofs {
  const noViablePlan = rankRecoveryOptions(
    [
      labeledOption('NONCANON-NO-VIABLE-A', {}, false),
      labeledOption('NONCANON-NO-VIABLE-B', {}, false),
    ],
    CREATIVE_FIRST_PROFILE,
    RANKING_POLICY,
  );
  const insufficientEvidence = rankRecoveryOptions(
    [
      labeledOption('NONCANON-LOW-EVIDENCE-A', {
        evidenceConfidence: 59,
        creativePreservation: 99,
      }),
      labeledOption('NONCANON-LOW-EVIDENCE-B', {
        evidenceConfidence: 10,
        creativePreservation: 10,
      }),
    ],
    CREATIVE_FIRST_PROFILE,
    RANKING_POLICY,
  );
  const tradeOff = rankRecoveryOptions(
    [
      labeledOption('NONCANON-READY', {
        creativePreservation: 90,
        readinessImprovement: 40,
        crewDisruption: 'HIGH',
      }),
      labeledOption('NONCANON-CALM', {
        creativePreservation: 90,
        readinessImprovement: 5,
        crewDisruption: 'NONE',
      }),
    ],
    {
      profileId: 'NONCANON-CREATIVE-THEN-SPLIT',
      tiers: [
        { metricIds: ['CREATIVE_PRESERVATION'] },
        { metricIds: ['READINESS_IMPROVEMENT', 'CREW_DISRUPTION'] },
        { metricIds: ['SCHEDULE_STABILITY'] },
        { metricIds: ['EVIDENCE_CONFIDENCE'] },
        { metricIds: ['LOGISTICS_IMPACT'] },
        { metricIds: ['NEW_RISK_INTRODUCED'] },
      ],
    },
    RANKING_POLICY,
  );
  const exactTie = rankRecoveryOptions(
    [
      labeledOption('NONCANON-TIE-B', { creativePreservation: 70 }),
      labeledOption('NONCANON-TIE-A', { creativePreservation: 70 }),
    ],
    CREATIVE_FIRST_PROFILE,
    RANKING_POLICY,
  );
  return { noViablePlan, insufficientEvidence, tradeOff, exactTie };
}

function claim(statementId: string, text: string, requiredReferences: readonly string[]) {
  return { statementId, text, requiredReferences: [...requiredReferences] };
}

function certifyGrounding(
  optionA: CanonicalOptionResult,
  liveCreative: number,
  graphRevision: number,
): GroundingCertification {
  const revision = graphRevisionReferenceId(graphRevision);
  const simulationReference = `SIMULATION:${optionA.simulationFingerprint}`;
  const rankingReference = 'RANKING:CREATIVE-FIRST';
  const evidenceReference = 'EVIDENCE:R2-READINESS';
  const gothicReference = 'EVIDENCE:GOTHIC-LOOK-03';
  const readinessText = `R2 readiness is ${String(optionA.liveReadiness)}.`;
  const shadowText = `Option A shadow readiness is ${String(optionA.shadowReadiness)}.`;
  const creativeText = `Creative preservation moves from ${String(liveCreative)} to ${String(optionA.creativePreservation)}.`;
  const gothicText = 'Gothic Look 03 CRITICAL was removed.';
  const eixampleText = 'Eixample Look 05 remains HIGH.';
  const crewText = `Option A crew disruption is ${optionA.crewDisruption}.`;
  const rankingText = 'Creative-first ranking recommends OPTION-A.';
  const summary = [
    readinessText,
    shadowText,
    creativeText,
    gothicText,
    eixampleText,
    crewText,
    rankingText,
  ].join(' ');
  const context: GroundingContext = {
    graphRevision,
    validReferences: [
      { referenceId: revision, kind: 'GRAPH_REVISION' },
      { referenceId: simulationReference, kind: 'SIMULATION' },
      { referenceId: rankingReference, kind: 'RANKING' },
      { referenceId: evidenceReference, kind: 'EVIDENCE' },
      { referenceId: gothicReference, kind: 'EVIDENCE' },
    ],
    allowedClaims: [
      claim('readiness-r2', readinessText, [evidenceReference]),
      claim('readiness-shadow', shadowText, [simulationReference]),
      claim('creative', creativeText, [simulationReference]),
      claim('gothic', gothicText, [gothicReference, revision]),
      claim('eixample', eixampleText, [simulationReference]),
      claim('crew', crewText, [simulationReference]),
      claim('ranking', rankingText, [rankingReference]),
    ],
    allowedSummaries: [summary],
    allowedTradeOffs: [],
    ranking: { decision: 'RECOMMEND', recommendedOptionId: optionA.optionId },
  };
  const positiveOutput = {
    summary,
    claims: context.allowedClaims.map((template) => ({
      claimId: template.statementId,
      text: template.text,
      references: template.requiredReferences,
    })),
    recommendationOptionId: optionA.optionId,
    disclosedTradeOffs: [],
  };
  const supersededCreative = 'Creative preservation becomes 95.';
  const supersededCrew = 'Option A crew disruption is MEDIUM.';
  const negativeOutput = {
    ...positiveOutput,
    claims: [
      ...positiveOutput.claims.filter(
        (item) => item.claimId !== 'creative' && item.claimId !== 'crew',
      ),
      {
        claimId: 'superseded-creative',
        text: supersededCreative,
        references: [simulationReference],
      },
      {
        claimId: 'superseded-crew',
        text: supersededCrew,
        references: [simulationReference],
      },
    ],
  };
  const positive = validateGroundedReasoning({
    output: positiveOutput,
    context,
    attempt: 'INITIAL_ATTEMPT',
  });
  const negative = validateGroundedReasoning({
    output: negativeOutput,
    context,
    attempt: 'INITIAL_ATTEMPT',
  });
  const initialInvalid = validateGroundedReasoning({
    output: negativeOutput,
    context,
    attempt: 'INITIAL_ATTEMPT',
  });
  const retryInvalid = validateGroundedReasoning({
    output: negativeOutput,
    context,
    attempt: 'RETRY_ATTEMPT',
  });
  const deterministic = validateGroundedReasoning({
    output: positiveOutput,
    context,
    attempt: 'RETRY_ATTEMPT',
  });
  return {
    positive,
    negative,
    negativeRejectedClaims: [supersededCreative, supersededCrew],
    initialInvalid,
    retryInvalid,
    deterministicExplanationAccepted: deterministic.ok,
  };
}

function fingerprintSignature(
  options: readonly CanonicalOptionResult[],
  liveFingerprint: string,
): string {
  return JSON.stringify({
    liveFingerprint,
    options: options.map((option) => ({
      optionId: option.optionId,
      simulationFingerprint: option.simulationFingerprint,
      shadowGraphFingerprint: option.shadowGraphFingerprint,
    })),
  });
}

function optionResult(
  options: readonly CanonicalOptionResult[],
  optionId: CanonicalOptionResult['optionId'],
): CanonicalOptionResult | undefined {
  return options.find((option) => option.optionId === optionId);
}

function assemble(
  prepared: PreparedContext,
  evaluation: ProductionEvaluationInput,
): Omit<CanonicalRecoveryCertification, 'fingerprintsRepeatStable'> {
  const beforeFingerprint = prepared.policyContext.graph.fingerprint;
  const beforeSerialized = JSON.stringify(prepared.policyContext.graph);
  const beforeEvaluation = JSON.stringify(evaluation);
  const liveCreative = requireCreative(prepared.looks, evaluation.risks);
  const options = CANONICAL_OPTION_DECLARATIONS.map((declaration) =>
    analyzeOption(declaration, prepared, evaluation),
  );
  const viable = options.filter((option) => option.feasible);
  const ranking = rankRecoveryOptions(
    viable.map((option) => ({
      optionId: option.optionId,
      feasibility: { viable: option.feasible, reasons: option.feasibilityReasons },
      metrics: option.metrics,
    })),
    CREATIVE_FIRST_PROFILE,
    RANKING_POLICY,
  );
  const optionA = optionResult(options, 'OPTION-A');
  const optionB = optionResult(options, 'OPTION-B');
  const optionC = optionResult(options, 'OPTION-C');
  if (optionA === undefined || optionB === undefined || optionC === undefined) {
    throw new Error('canonical option set is incomplete');
  }
  const bcDistinguishingMetric = distinguishingMetric(
    optionB.metrics,
    optionC.metrics,
    CREATIVE_FIRST_PROFILE,
  );
  const legacyValidity = validateCandidate(LEGACY_INVALID_INTERVENTIONS, prepared.policyContext);
  const legacyInvalidOptionB: RejectedCandidate = {
    optionId: 'LEGACY-INVALID-OPTION-B',
    interventions: LEGACY_INVALID_INTERVENTIONS,
    schemaValid: legacyValidity.schemaValid,
    policyValid: legacyValidity.policyValid,
    rejectionCodes: legacyValidity.denialCodes,
    ranked: false,
  };
  const grounding = certifyGrounding(
    optionA,
    liveCreative.creativePreservation,
    prepared.policyContext.graph.graphRevision,
  );
  const afterFingerprint = prepared.policyContext.graph.fingerprint;
  const afterSerialized = JSON.stringify(prepared.policyContext.graph);
  const live = options[0];
  if (live === undefined) {
    throw new Error('missing live assessment');
  }
  return {
    schemaVersion: SR03_EVIDENCE_REPORT_SCHEMA,
    fixtureVersion: prepared.pack.fixtureVersion,
    graphSchemaVersion: prepared.policyContext.graph.schemaVersion,
    policyVersion: SCENEREADY_POLICY_V1.policyVersion,
    scoringVersion: SCENEREADY_POLICY_V1.scoringVersion,
    producers: {
      readinessImprovement: 'shadowAssessment.readinessScore-liveAssessment.readinessScore',
      creativePreservation: CREATIVE_PRESERVATION_ALGORITHM_VERSION,
      scheduleStability: SCHEDULE_STABILITY_ALGORITHM_VERSION,
      logisticsImpact: LOGISTICS_IMPACT_ALGORITHM_VERSION,
      crewDisruption: CREW_DISRUPTION_ALGORITHM_VERSION,
      evidenceConfidence: 'shadowAssessment.confidenceScore',
      newRiskIntroduced: NEW_RISK_INTRODUCED_ALGORITHM_VERSION,
    },
    priorityProfile: CREATIVE_FIRST_PROFILE,
    live: {
      readiness: live.liveReadiness,
      confidence: live.liveConfidence,
      status: live.liveStatus,
      certification: live.liveCertification,
      creativePreservation: liveCreative.creativePreservation,
      staticEnvelopeQuality: liveCreative.staticEnvelopeQuality,
    },
    options,
    legacyInvalidOptionB,
    ranking,
    orderedOptionIds: ranking.orderedOptions.map((option) => option.optionId),
    optionAWinsOnCreativeTier:
      CREATIVE_FIRST_PROFILE.tiers[0]?.metricIds[0] === 'CREATIVE_PRESERVATION' &&
      optionA.creativePreservation > optionB.creativePreservation &&
      optionA.creativePreservation > optionC.creativePreservation &&
      ranking.recommendedOptionId === optionA.optionId,
    bcAuthorityTie: bcDistinguishingMetric === null,
    bcDistinguishingMetric,
    rankingSafety: proveRankingSafety(),
    grounding,
    noModelInvocation: true,
    liveGraphFingerprint: beforeFingerprint,
    liveGraphFingerprintUnchanged:
      beforeFingerprint === afterFingerprint && beforeEvaluation === JSON.stringify(evaluation),
    liveGraphSerializedUnchanged: beforeSerialized === afterSerialized,
    optionCTechnicalShadowIdentity: optionC.technicalShadowRevisionDelta === 1,
    optionCOperationalNoChange:
      !optionC.operationalMutation &&
      optionC.riskTransitions.length === 0 &&
      optionC.crewEventCount === 0 &&
      optionC.logisticsEventCount === 0 &&
      optionC.interventions.length === 0,
  };
}

export async function certifyCanonicalRecovery(
  evaluation: ProductionEvaluationInput,
): Promise<CanonicalRecoveryCertification> {
  const pack = await loadCanonicalPack();
  const first = assemble(prepareContext(pack, evaluation), evaluation);
  const second = assemble(prepareContext(pack, evaluation), evaluation);
  const fingerprintsRepeatStable =
    fingerprintSignature(first.options, first.liveGraphFingerprint) ===
    fingerprintSignature(second.options, second.liveGraphFingerprint);
  return { ...first, fingerprintsRepeatStable };
}
