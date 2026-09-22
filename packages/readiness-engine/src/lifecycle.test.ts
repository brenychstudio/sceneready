import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACTIVITY_LIFECYCLE_STATES,
  LIFECYCLE_REASON_CODES,
  PRODUCTION_PHASES,
  canInterveneOnActivity,
  canTransitionProductionPhase,
  type ActivityInterventionDecision,
  type LifecycleReasonCode,
  type PhaseTransitionDecision,
} from '@sceneready/domain';

import {
  calculateOutcomeMetrics,
  evaluateProductionReadiness,
  HARD_GATE_IDS,
  PRODUCTION_DOMAINS,
  SCENEREADY_POLICY_V1,
  type ProductionEvaluationInput,
  type ProductionReadinessAssessment,
  type ReadinessComparison,
} from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function asLifecycleReason(reason: LifecycleReasonCode): LifecycleReasonCode {
  return reason;
}

function asPhaseDecision(decision: PhaseTransitionDecision): PhaseTransitionDecision {
  return decision;
}

function asActivityDecision(decision: ActivityInterventionDecision): ActivityInterventionDecision {
  return decision;
}

function passedDomains(): NonNullable<ProductionEvaluationInput['domainFacts']> {
  return PRODUCTION_DOMAINS.map((domain) => ({
    domain,
    state: 'PASSED' as const,
    reasons: [`${domain}_OK`],
  }));
}

function stubAssessment(): ProductionReadinessAssessment {
  return evaluateProductionReadiness({
    productionId: 'BCN-DEMO-01',
    productionDate: '2026-09-17',
    intendedUsageScope: 'PAID_CAMPAIGN',
    intendedDeliverableId: 'DELIVERABLE-D7',
    requiredPersonIds: ['PERSON-MODEL'],
    requiredLocationIds: [],
    hardGates: HARD_GATE_IDS.map((id) => ({
      id,
      subjectType: id === 'RIGHTS' ? 'DOCUMENT' : 'LOCATION',
      subjectIds: [],
    })),
    documents: [],
    capturePaths: [],
    equipment: [],
    proofs: [],
    domainFacts: passedDomains(),
    policy: SCENEREADY_POLICY_V1,
    risks: [],
    impacts: [],
    deliverables: [
      { deliverableId: 'DELIVERABLE-D1', importance: 'CRITICAL' },
      { deliverableId: 'DELIVERABLE-D5', importance: 'CRITICAL' },
    ],
    confidenceFacts: [
      {
        scope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        coverage: 'RESOLVED',
        polarity: 'CONFIRMED',
        evidenceId: 'EVD-MODEL-RELEASE',
        fingerprint: 'fp-EVD-MODEL-RELEASE',
        trustState: 'LIVE',
      },
    ],
    requiredEvidenceScopes: ['DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY'],
  });
}

function makeR2ToRecoveredComparison(): ReadinessComparison {
  const before = stubAssessment();
  const after = stubAssessment();
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
      {
        deliverableId: 'DELIVERABLE-D1',
        importance: 'CRITICAL',
        beforeProtected: false,
        afterProtected: true,
      },
      {
        deliverableId: 'DELIVERABLE-D2',
        importance: 'HIGH',
        beforeProtected: false,
        afterProtected: true,
      },
    ],
    preservedCreativeEnvelopeIds: [
      'ENVELOPE-EIXAMPLE-LOOK',
      'ENVELOPE-GOTHIC-LOOK',
      'ENVELOPE-GOTHIC-LOOK',
    ],
    beforePredictedStudioDelayMinutes: 25,
    afterPredictedStudioDelayMinutes: 10,
    affectedPersonIds: ['PERSON-MODEL', 'PERSON-PRODUCTION-LEAD', 'PERSON-MODEL'],
    riskTransitions: [
      {
        riskId: 'RISK-STUDIO-LOAD-IN',
        subjectId: 'ACT-STUDIO-LOAD-IN',
        beforeSeverity: 'MEDIUM',
        afterSeverity: 'LOW',
      },
      {
        riskId: 'RISK-GOTHIC-LOOK-03',
        subjectId: 'ACT-GOTHIC-LOOK-03',
        beforeSeverity: 'CRITICAL',
        afterSeverity: null,
      },
    ],
  };
}

describe('production lifecycle', () => {
  it('uses the SR-02 bounded BCN phase sequence', () => {
    expect(PRODUCTION_PHASES).toEqual([
      'PREFLIGHT',
      'GOTHIC_ACTIVE',
      'EIXAMPLE_ACTIVE',
      'STUDIO_ACTIVE',
      'COMPLETE',
    ]);
    expect(ACTIVITY_LIFECYCLE_STATES).toEqual(['PENDING', 'ACTIVE', 'COMPLETED']);
  });

  it('allows only monotonic adjacent forward phase transitions', () => {
    expect(canTransitionProductionPhase('PREFLIGHT', 'GOTHIC_ACTIVE')).toEqual({ allowed: true });
    expect(canTransitionProductionPhase('GOTHIC_ACTIVE', 'EIXAMPLE_ACTIVE')).toEqual({
      allowed: true,
    });
    expect(canTransitionProductionPhase('EIXAMPLE_ACTIVE', 'STUDIO_ACTIVE')).toEqual({
      allowed: true,
    });
    expect(canTransitionProductionPhase('STUDIO_ACTIVE', 'COMPLETE')).toEqual({ allowed: true });
  });

  it('rejects backward and skipped phase transitions', () => {
    expect(canTransitionProductionPhase('GOTHIC_ACTIVE', 'PREFLIGHT')).toEqual({
      allowed: false,
      reason: 'PHASE_SEQUENCE_MONOTONIC',
    });
    expect(canTransitionProductionPhase('PREFLIGHT', 'STUDIO_ACTIVE')).toEqual({
      allowed: false,
      reason: 'PHASE_SEQUENCE_MONOTONIC',
    });
  });

  it('treats COMPLETE as terminal', () => {
    expect(canTransitionProductionPhase('COMPLETE', 'PREFLIGHT').allowed).toBe(false);
    expect(canTransitionProductionPhase('COMPLETE', 'STUDIO_ACTIVE').allowed).toBe(false);
    const decision = asPhaseDecision(canTransitionProductionPhase('COMPLETE', 'COMPLETE'));
    expect(decision).toEqual({
      allowed: false,
      reason: 'COMPLETE_IS_TERMINAL',
    });
    if (!decision.allowed) {
      expect(asLifecycleReason(decision.reason)).toBe('COMPLETE_IS_TERMINAL');
    }
  });

  it('rejects SHIFT_ACTIVITY on a COMPLETED Gothic activity during EIXAMPLE_ACTIVE', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const decision = canInterveneOnActivity({
      productionPhase: 'EIXAMPLE_ACTIVE',
      activityState: 'COMPLETED',
      interventionKind: 'SHIFT_ACTIVITY',
    });

    expect(decision).toEqual({
      allowed: false,
      reason: 'ACTIVITY_IMMUTABLE_AFTER_COMPLETION',
    });
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('always rejects SHIFT_ACTIVITY on a COMPLETED activity', () => {
    for (const phase of PRODUCTION_PHASES) {
      const decision = canInterveneOnActivity({
        productionPhase: phase,
        activityState: 'COMPLETED',
        interventionKind: 'SHIFT_ACTIVITY',
      });
      expect(decision).toEqual({
        allowed: false,
        reason: 'ACTIVITY_IMMUTABLE_AFTER_COMPLETION',
      });
    }
  });

  it('does not apply SR-03 intervention-policy checks to PENDING or ACTIVE activities', () => {
    expect(
      asActivityDecision(
        canInterveneOnActivity({
          productionPhase: 'EIXAMPLE_ACTIVE',
          activityState: 'ACTIVE',
          interventionKind: 'SHIFT_ACTIVITY',
        }),
      ),
    ).toEqual({ allowed: true });
    expect(
      canInterveneOnActivity({
        productionPhase: 'GOTHIC_ACTIVE',
        activityState: 'PENDING',
        interventionKind: 'SHIFT_ACTIVITY',
      }),
    ).toEqual({ allowed: true });
  });

  it('rejects SHIFT_ACTIVITY when production is COMPLETE and the activity is still ACTIVE', () => {
    const decision = asActivityDecision(
      canInterveneOnActivity({
        productionPhase: 'COMPLETE',
        activityState: 'ACTIVE',
        interventionKind: 'SHIFT_ACTIVITY',
      }),
    );
    expect(decision).toEqual({
      allowed: false,
      reason: 'PRODUCTION_COMPLETE_IMMUTABLE',
    });
    if (!decision.allowed) {
      expect(asLifecycleReason(decision.reason)).toBe('PRODUCTION_COMPLETE_IMMUTABLE');
    }
  });

  it('rejects SHIFT_ACTIVITY when production is COMPLETE and the activity is still PENDING', () => {
    expect(
      canInterveneOnActivity({
        productionPhase: 'COMPLETE',
        activityState: 'PENDING',
        interventionKind: 'SHIFT_ACTIVITY',
      }),
    ).toEqual({
      allowed: false,
      reason: 'PRODUCTION_COMPLETE_IMMUTABLE',
    });
  });

  it('keeps completed-activity immutability ahead of a COMPLETE production phase', () => {
    expect(
      canInterveneOnActivity({
        productionPhase: 'COMPLETE',
        activityState: 'COMPLETED',
        interventionKind: 'SHIFT_ACTIVITY',
      }),
    ).toEqual({
      allowed: false,
      reason: 'ACTIVITY_IMMUTABLE_AFTER_COMPLETION',
    });
  });

  it('lets productionPhase change the SHIFT_ACTIVITY result for the same activity state', () => {
    const duringEixample = canInterveneOnActivity({
      productionPhase: 'EIXAMPLE_ACTIVE',
      activityState: 'ACTIVE',
      interventionKind: 'SHIFT_ACTIVITY',
    });
    const afterComplete = canInterveneOnActivity({
      productionPhase: 'COMPLETE',
      activityState: 'ACTIVE',
      interventionKind: 'SHIFT_ACTIVITY',
    });
    expect(duringEixample).toEqual({ allowed: true });
    expect(afterComplete).not.toEqual(duringEixample);
    expect(afterComplete).toEqual({
      allowed: false,
      reason: 'PRODUCTION_COMPLETE_IMMUTABLE',
    });
  });

  it('publishes the canonical lifecycle reason codes including production completion', () => {
    expect(LIFECYCLE_REASON_CODES).toEqual([
      'PHASE_SEQUENCE_MONOTONIC',
      'COMPLETE_IS_TERMINAL',
      'ACTIVITY_IMMUTABLE_AFTER_COMPLETION',
      'PRODUCTION_COMPLETE_IMMUTABLE',
    ]);
  });
});

describe('operational outcome metrics', () => {
  it('computes the canonical R2-to-recovered comparison without inventing money', () => {
    const metrics = calculateOutcomeMetrics(makeR2ToRecoveredComparison());

    expect(metrics.protectedCriticalDeliverables).toBe(2);
    expect(metrics.predictedStudioDelayReductionMinutes).toBe(15);
    expect(metrics.monetaryImpact).toBeNull();
    expect(metrics.preservedCreativeEnvelopes).toBe(2);
    expect(metrics.crewMembersAffected).toBe(2);
    expect(metrics.riskReductions.map((item) => item.riskId)).toEqual([
      'RISK-GOTHIC-LOOK-03',
      'RISK-STUDIO-LOAD-IN',
    ]);
    expect(metrics.riskReductions[0]?.afterSeverity).toBeNull();
  });

  it('does not count the same CRITICAL deliverable twice', () => {
    const metrics = calculateOutcomeMetrics(makeR2ToRecoveredComparison());
    expect(metrics.protectedCriticalDeliverables).toBe(2);
  });

  it('clamps studio delay reduction at zero', () => {
    const comparison = makeR2ToRecoveredComparison();
    const metrics = calculateOutcomeMetrics({
      ...comparison,
      beforePredictedStudioDelayMinutes: 5,
      afterPredictedStudioDelayMinutes: 12,
    });
    expect(metrics.predictedStudioDelayReductionMinutes).toBe(0);
  });

  it('counts unique affected person IDs', () => {
    const metrics = calculateOutcomeMetrics(makeR2ToRecoveredComparison());
    expect(metrics.crewMembersAffected).toBe(2);
  });

  it('keeps monetaryImpact null without an explicit cost profile', () => {
    const withUndefined = calculateOutcomeMetrics(makeR2ToRecoveredComparison());
    const withNull = calculateOutcomeMetrics({
      ...makeR2ToRecoveredComparison(),
      costProfile: null,
    });
    expect(withUndefined.monetaryImpact).toBeNull();
    expect(withNull.monetaryImpact).toBeNull();
  });

  it('calculates monetaryImpact only from explicit cost-profile numbers', () => {
    const metrics = calculateOutcomeMetrics({
      ...makeR2ToRecoveredComparison(),
      costProfile: {
        costPerMinute: 20,
        currency: 'EUR',
      },
    });
    expect(metrics.monetaryImpact).toEqual({
      amount: 300,
      currency: 'EUR',
      basis: 'EXPLICIT_DELAY_MINUTES_RATE',
    });
  });

  it('is deterministic under reordered comparison facts', () => {
    const forward = calculateOutcomeMetrics(makeR2ToRecoveredComparison());
    const reversed = calculateOutcomeMetrics({
      ...makeR2ToRecoveredComparison(),
      deliverableOutcomes: [...makeR2ToRecoveredComparison().deliverableOutcomes].reverse(),
      preservedCreativeEnvelopeIds: [
        ...makeR2ToRecoveredComparison().preservedCreativeEnvelopeIds,
      ].reverse(),
      affectedPersonIds: [...makeR2ToRecoveredComparison().affectedPersonIds].reverse(),
      riskTransitions: [...makeR2ToRecoveredComparison().riskTransitions].reverse(),
    });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

describe('readiness mathematics documentation', () => {
  it('documents an SR-SCORE-v1 zero-penalty readiness score of 100', async () => {
    const readinessDir = dirname(fileURLToPath(import.meta.url));
    const doc = await readFile(
      join(readinessDir, '../../../docs/architecture/READINESS-MATHEMATICS.md'),
      'utf8',
    );
    const claims = await readFile(
      join(readinessDir, '../../../docs/submission/CLAIM-TO-EVIDENCE.md'),
      'utf8',
    );

    expect(doc).not.toMatch(/headroom below 100/);
    expect(doc).toMatch(/all six domains are `PASSED`, the domain penalty is zero/i);
    expect(doc).toMatch(/zero causal impact penalties means the impact penalty is zero/i);
    expect(doc).toMatch(/Therefore `readinessScore = 100`/);
    expect(doc).toMatch(/R1 readiness `86` is a canonical scenario output/);
    expect(doc).toMatch(/It is not a model cap/);
    expect(doc).toMatch(/explicit deterministic comparison facts/);
    expect(doc).toMatch(/not Shadow Simulation/);
    expect(doc).toMatch(/not an implemented recovery proposal engine/);
    expect(claims).toMatch(/explicit deterministic comparison facts/);
    expect(claims).toMatch(/not Shadow Simulation/);
    expect(claims).toMatch(/not an implemented recovery proposal engine/);
    expect(claims).toMatch(/2 protected CRITICAL deliverables/);
    expect(claims).toMatch(/15 minute studio-delay reduction/);
    expect(claims).toMatch(/monetaryImpact=null/);
  });
});

describe('task 8 source authority', () => {
  it('does not use clock, random, UUID, or scenario score branching in production source', async () => {
    const readinessDir = dirname(fileURLToPath(import.meta.url));
    const domainLifecycle = await readFile(
      join(readinessDir, '../../domain/src/lifecycle.ts'),
      'utf8',
    );
    const outcomes = await readFile(join(readinessDir, 'outcomes.ts'), 'utf8');
    const index = await readFile(join(readinessDir, 'index.ts'), 'utf8');
    const joined = [domainLifecycle, outcomes, index].join('\n');

    expect(joined).not.toMatch(/Date\.now\s*\(/);
    expect(joined).not.toMatch(/Math\.random\s*\(/);
    expect(joined).not.toMatch(/randomUUID/);
    expect(joined).not.toMatch(/uuid/i);
    expect(joined).not.toMatch(/if\s*\(.*R0/);
    expect(joined).not.toMatch(/@sceneready\/evidence/);
    expect(joined).not.toMatch(/@sceneready\/production-graph/);
    expect(joined).not.toMatch(/hourly rate/i);
    expect(joined).not.toMatch(/shadow simulation/i);
  });
});
