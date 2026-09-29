import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { r2Input } from '@sceneready/evidence-report';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  certifyCanonicalRecovery,
  CREATIVE_FIRST_PROFILE,
  type CanonicalOptionResult,
  type CanonicalRecoveryCertification,
} from './canonical-recovery.js';

let certification: CanonicalRecoveryCertification;
let repeated: CanonicalRecoveryCertification;

function option(optionId: 'OPTION-A' | 'OPTION-B' | 'OPTION-C'): CanonicalOptionResult {
  const found = certification.options.find((item) => item.optionId === optionId);
  if (found === undefined) {
    throw new Error(`missing ${optionId}`);
  }
  return found;
}

function transition(optionId: 'OPTION-A' | 'OPTION-B' | 'OPTION-C', subjectId: string) {
  return option(optionId).riskTransitions.find((item) => item.subjectId === subjectId);
}

beforeAll(async () => {
  const evaluation = r2Input();
  certification = await certifyCanonicalRecovery(evaluation);
  repeated = await certifyCanonicalRecovery(r2Input());
}, 120000);

describe('canonical recovery certification', () => {
  it('proves exactly the viable canonical options A, B, and C', () => {
    expect(certification.options.map((item) => item.optionId)).toEqual([
      'OPTION-A',
      'OPTION-B',
      'OPTION-C',
    ]);
    expect(
      certification.options.every((item) => item.schemaValid && item.policyValid && item.feasible),
    ).toBe(true);
    expect(certification.orderedOptionIds).not.toContain('LEGACY-INVALID-OPTION-B');
  });

  it('proves the exact Option A interventions', () => {
    expect(option('OPTION-A').interventions).toEqual([
      { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: -25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-HMU', deltaMinutes: -25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-PHOTO-ASSISTANT', deltaMinutes: -25 },
      { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
    ]);
  });

  it('proves the resolved Option B buffer', () => {
    expect(option('OPTION-B').interventions).toEqual([
      { kind: 'ADD_BUFFER', beforeActivityId: 'ACT-EIXAMPLE-SETUP', minutes: 10 },
    ]);
  });

  it('proves Option C is empty', () => {
    expect(option('OPTION-C').interventions).toEqual([]);
  });

  it('rejects legacy invalid Option B before ranking', () => {
    expect(certification.legacyInvalidOptionB.ranked).toBe(false);
    expect(certification.legacyInvalidOptionB.policyValid).toBe(false);
    expect(certification.legacyInvalidOptionB.rejectionCodes).toContain('DURATION_NOT_POSITIVE');
    expect(certification.ranking.orderedOptions.map((item) => item.optionId)).not.toContain(
      'LEGACY-INVALID-OPTION-B',
    );
  });

  it('derives R2 readiness 74', () => {
    expect(certification.live.readiness).toBe(74);
  });

  it('derives R2 confidence 96', () => {
    expect(certification.live.confidence).toBe(96);
  });

  it('derives R2 creative preservation 59', () => {
    expect(certification.live.creativePreservation).toBe(59);
    expect(certification.live.status).toBe('AT_RISK');
    expect(certification.live.certification).toBe('CERTIFIED');
  });

  it('derives Option A shadow readiness 89', () => {
    expect(option('OPTION-A').shadowReadiness).toBe(89);
    expect(option('OPTION-A').liveReadiness).toBe(74);
  });

  it('derives Option A readiness improvement 15', () => {
    expect(option('OPTION-A').readinessImprovement).toBe(15);
  });

  it('derives Option A creative preservation 71', () => {
    expect(option('OPTION-A').creativePreservation).toBe(71);
    expect(option('OPTION-A').staticEnvelopeQuality).toBe(82);
  });

  it('derives Option A schedule stability 72', () => {
    expect(option('OPTION-A').scheduleStability).toBe(72);
  });

  it('derives Option A logistics impact LOW', () => {
    expect(option('OPTION-A').logisticsImpact).toBe('LOW');
  });

  it('derives Option A crew disruption HIGH', () => {
    expect(option('OPTION-A').crewDisruption).toBe('HIGH');
  });

  it('derives Option A evidence confidence 96', () => {
    expect(option('OPTION-A').evidenceConfidence).toBe(96);
  });

  it('derives Option A new risk NONE', () => {
    expect(option('OPTION-A').newRiskIntroduced).toBe('NONE');
  });

  it('removes Gothic Look 03 CRITICAL', () => {
    expect(transition('OPTION-A', 'ACT-GOTHIC-LOOK-03')).toMatchObject({
      beforeSeverity: 'CRITICAL',
      afterSeverity: null,
    });
  });

  it('keeps Eixample Look 05 HIGH', () => {
    expect(
      option('OPTION-A').shadowRisks.find((risk) => risk.subjectId === 'ACT-EIXAMPLE-LOOK-05'),
    ).toMatchObject({ severity: 'HIGH' });
    expect(transition('OPTION-A', 'ACT-EIXAMPLE-LOOK-05')).toBeUndefined();
  });

  it('lowers studio load-in from MEDIUM to LOW', () => {
    expect(transition('OPTION-A', 'ACT-STUDIO-LOAD-IN')).toMatchObject({
      beforeSeverity: 'MEDIUM',
      afterSeverity: 'LOW',
    });
  });

  it('keeps Option B readiness at 74 and creative preservation at 59', () => {
    expect(option('OPTION-B').shadowReadiness).toBe(74);
    expect(option('OPTION-B').creativePreservation).toBe(59);
  });

  it('derives Option B schedule stability 78', () => {
    expect(option('OPTION-B').scheduleStability).toBe(78);
  });

  it('derives Option B logistics NONE', () => {
    expect(option('OPTION-B').logisticsImpact).toBe('NONE');
    expect(option('OPTION-B').logisticsEventCount).toBe(0);
  });

  it('derives Option B crew NONE', () => {
    expect(option('OPTION-B').crewDisruption).toBe('NONE');
    expect(option('OPTION-B').crewEventCount).toBe(0);
  });

  it('derives Option B new risk NONE', () => {
    expect(option('OPTION-B').newRiskIntroduced).toBe('NONE');
  });

  it('records no Option B risk transition', () => {
    expect(option('OPTION-B').riskTransitions).toEqual([]);
  });

  it('keeps Option C readiness at 74 and creative preservation at 59', () => {
    expect(option('OPTION-C').shadowReadiness).toBe(74);
    expect(option('OPTION-C').creativePreservation).toBe(59);
  });

  it('derives Option C schedule stability 100', () => {
    expect(option('OPTION-C').scheduleStability).toBe(100);
  });

  it('derives Option C logistics NONE', () => {
    expect(option('OPTION-C').logisticsImpact).toBe('NONE');
  });

  it('derives Option C crew NONE', () => {
    expect(option('OPTION-C').crewDisruption).toBe('NONE');
  });

  it('derives Option C new risk NONE', () => {
    expect(option('OPTION-C').newRiskIntroduced).toBe('NONE');
  });

  it('binds all seven metrics to deterministic producers', () => {
    expect(certification.producers).toEqual({
      readinessImprovement: 'shadowAssessment.readinessScore-liveAssessment.readinessScore',
      creativePreservation: 'SR-CREATIVE-PRESERVATION-v1',
      scheduleStability: 'SR-SCHEDULE-STABILITY-v1',
      logisticsImpact: 'SR-LOGISTICS-IMPACT-v1',
      crewDisruption: 'SR-CREW-DISRUPTION-v1',
      evidenceConfidence: 'shadowAssessment.confidenceScore',
      newRiskIntroduced: 'SR-NEW-RISK-INTRODUCED-v1',
    });
    for (const item of certification.options) {
      expect(item.metrics.readinessImprovement).toBe(item.shadowReadiness - item.liveReadiness);
      expect(item.metrics.creativePreservation).toBe(item.creativePreservation);
      expect(item.metrics.scheduleStability).toBe(item.scheduleStability);
      expect(item.metrics.logisticsImpact).toBe(item.logisticsImpact);
      expect(item.metrics.crewDisruption).toBe(item.crewDisruption);
      expect(item.metrics.evidenceConfidence).toBe(item.shadowConfidence);
      expect(item.metrics.newRiskIntroduced).toBe(item.newRiskIntroduced);
    }
  });

  it('recommends Option A under the Creative-first profile', () => {
    expect(CREATIVE_FIRST_PROFILE.tiers[0]?.metricIds).toEqual(['CREATIVE_PRESERVATION']);
    expect(certification.ranking.decision).toBe('RECOMMEND');
    expect(certification.ranking.recommendedOptionId).toBe('OPTION-A');
    expect(certification.ranking.escalationReason).toBeNull();
  });

  it('lets Option A win on the creative tier rather than option id', () => {
    expect(certification.optionAWinsOnCreativeTier).toBe(true);
    expect(option('OPTION-A').creativePreservation).toBeGreaterThan(
      option('OPTION-B').creativePreservation,
    );
    expect(option('OPTION-A').creativePreservation).toBeGreaterThan(
      option('OPTION-C').creativePreservation,
    );
  });

  it('records that schedule stability distinguishes B and C', () => {
    expect(certification.bcAuthorityTie).toBe(false);
    expect(certification.bcDistinguishingMetric).toBe('SCHEDULE_STABILITY');
    expect(certification.orderedOptionIds).toEqual(['OPTION-A', 'OPTION-C', 'OPTION-B']);
  });

  it('escalates when no plan is viable', () => {
    expect(certification.rankingSafety.noViablePlan).toMatchObject({
      decision: 'ESCALATE',
      recommendedOptionId: null,
      escalationReason: 'NO_VIABLE_PLAN',
    });
  });

  it('escalates when evidence is insufficient', () => {
    expect(certification.rankingSafety.insufficientEvidence).toMatchObject({
      decision: 'ESCALATE',
      recommendedOptionId: null,
      escalationReason: 'INSUFFICIENT_EVIDENCE',
    });
  });

  it('presents a trade-off without recommending either side', () => {
    expect(certification.rankingSafety.tradeOff).toMatchObject({
      decision: 'PRESENT_TRADE_OFF',
      recommendedOptionId: null,
      escalationReason: 'PRIORITY_CONFLICT',
    });
  });

  it('does not fabricate a recommendation for an exact tie', () => {
    expect(certification.rankingSafety.exactTie.decision).not.toBe('RECOMMEND');
    expect(certification.rankingSafety.exactTie.recommendedOptionId).toBeNull();
  });

  it('accepts the deterministic Option A grounding', () => {
    expect(certification.grounding.positive.ok).toBe(true);
  });

  it('rejects superseded creative and crew claims', () => {
    expect(certification.grounding.negative.ok).toBe(false);
    if (certification.grounding.negative.ok) {
      return;
    }
    expect(certification.grounding.negative.issues.map((issue) => issue.code)).toContain(
      'UNSUPPORTED_CLAIM',
    );
    expect(certification.grounding.negativeRejectedClaims).toEqual([
      'Creative preservation becomes 95.',
      'Option A crew disruption is MEDIUM.',
    ]);
  });

  it('regenerates once after an invalid initial grounding attempt', () => {
    expect(certification.grounding.initialInvalid).toMatchObject({
      ok: false,
      disposition: 'REGENERATE_ONCE',
    });
  });

  it('uses the deterministic explanation after an invalid retry', () => {
    expect(certification.grounding.retryInvalid).toMatchObject({
      ok: false,
      disposition: 'USE_DETERMINISTIC_EXPLANATION',
    });
    expect(certification.grounding.deterministicExplanationAccepted).toBe(true);
  });

  it('leaves the live graph fingerprint and serialization unchanged', () => {
    expect(certification.liveGraphFingerprintUnchanged).toBe(true);
    expect(certification.liveGraphSerializedUnchanged).toBe(true);
    expect(certification.liveGraphFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('repeats canonical fingerprints exactly', () => {
    expect(certification.fingerprintsRepeatStable).toBe(true);
    expect(repeated.liveGraphFingerprint).toBe(certification.liveGraphFingerprint);
    expect(repeated.options.map((item) => item.simulationFingerprint)).toEqual(
      certification.options.map((item) => item.simulationFingerprint),
    );
    expect(repeated.options.map((item) => item.shadowGraphFingerprint)).toEqual(
      certification.options.map((item) => item.shadowGraphFingerprint),
    );
  });

  it('invokes no model, clock, random, or network source', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'canonical-recovery.ts'),
      'utf8',
    );
    expect(certification.noModelInvocation).toBe(true);
    for (const pattern of [
      /Date\.now/,
      /Math\.random/,
      /randomUUID/,
      /\bfetch\s*\(/,
      /bedrock/i,
      /@aws-sdk/,
      /optionId === 'OPTION-A'/,
    ]) {
      expect(source).not.toMatch(pattern);
    }
  });

  it('repeats the canonical analysis byte for byte', () => {
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(certification));
  });

  it('distinguishes Option C operational no-change from the shadow revision', () => {
    expect(certification.optionCOperationalNoChange).toBe(true);
    expect(certification.optionCTechnicalShadowIdentity).toBe(true);
    expect(option('OPTION-C').riskTransitions).toEqual([]);
    expect(option('OPTION-C').crewEventCount).toBe(0);
    expect(option('OPTION-C').logisticsEventCount).toBe(0);
  });
});
