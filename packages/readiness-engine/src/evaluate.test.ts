import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateProductionReadiness,
  HARD_GATE_IDS,
  PRODUCTION_DOMAINS,
  SCENEREADY_POLICY_V1,
  type DomainFact,
  type EvidenceConfidenceFact,
  type ProductionEvaluationInput,
  type ReadinessImpactFact,
  type ReadinessRiskFact,
  type RightsDocumentFact,
  type SubjectProof,
} from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const COMPOUND_INCIDENT_ID = 'INCIDENT-COMPOUND-DRIFT';
const WEATHER_EVIDENCE_ID = 'EVIDENCE-WEATHER-DRIFT';
const TRAVEL_EVIDENCE_ID = 'EVIDENCE-TRAVEL-DRIFT';
const GOTHIC_RISK_ID = 'RISK-GOTHIC-LOOK-03';
const EIXAMPLE_RISK_ID = 'RISK-EIXAMPLE-LOOK-05';
const STUDIO_RISK_ID = 'RISK-STUDIO-LOAD-IN';

function passedDomains(): DomainFact[] {
  return PRODUCTION_DOMAINS.map((domain) => ({
    domain,
    state: 'PASSED',
    reasons: [`${domain}_OK`],
  }));
}

function r0Domains(): DomainFact[] {
  return PRODUCTION_DOMAINS.map((domain) => ({
    domain,
    state: domain === 'DOCUMENTS_RIGHTS' ? 'FAILED' : 'PASSED',
    reasons: domain === 'DOCUMENTS_RIGHTS' ? ['RIGHTS_USAGE_SCOPE_MISMATCH'] : [`${domain}_OK`],
  }));
}

function modelRelease(usageScopes: readonly string[] = ['PAID_CAMPAIGN']): RightsDocumentFact {
  return {
    id: 'DOCUMENT-MODEL-RELEASE',
    kind: 'MODEL_RELEASE',
    validFromDate: null,
    validThroughDate: null,
    personIds: ['PERSON-MODEL'],
    locationIds: [],
    coversDeliverableIds: ['DELIVERABLE-D7'],
    usageScopes,
  };
}

function proof(input: SubjectProof): SubjectProof {
  return input;
}

function rightsProof(state: SubjectProof['state']): SubjectProof {
  return proof({
    subjectId: 'DOCUMENT-MODEL-RELEASE',
    subjectType: 'DOCUMENT',
    aspect: 'VALIDITY',
    scope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
    state,
    value: state === 'DENIED' ? 'INVALID' : 'VALID',
  });
}

function locationDeniedProof(): SubjectProof {
  return proof({
    subjectId: 'LOC-GOTHIC',
    subjectType: 'LOCATION',
    aspect: 'ACCESS',
    scope: 'LOCATION:LOC-GOTHIC:ACCESS',
    state: 'DENIED',
    value: 'REVOKED',
  });
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

function risk(input: ReadinessRiskFact): ReadinessRiskFact {
  return input;
}

function impact(input: ReadinessImpactFact): ReadinessImpactFact {
  return input;
}

function confidence(input: EvidenceConfidenceFact): EvidenceConfidenceFact {
  return input;
}

function confirmedScope(scope: string, evidenceId: string): EvidenceConfidenceFact {
  return confidence({
    scope,
    coverage: 'RESOLVED',
    polarity: 'CONFIRMED',
    evidenceId,
    fingerprint: `fp-${evidenceId}`,
    trustState: 'LIVE',
  });
}

function deniedRightsConfidence(): EvidenceConfidenceFact {
  return confidence({
    scope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
    coverage: 'RESOLVED',
    polarity: 'DENIED',
    evidenceId: 'EVD-MODEL-RELEASE',
    fingerprint: 'fp-EVD-MODEL-RELEASE',
    trustState: 'LIVE',
  });
}

function r1ConfidenceFacts(): EvidenceConfidenceFact[] {
  return [
    confirmedScope('LOCATION:LOC-GOTHIC:ACCESS', 'EVD-GOTHIC-ACCESS'),
    confirmedScope('PERSON:PERSON-MODEL:AVAILABILITY', 'EVD-MODEL-AVAIL'),
    confirmedScope('DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY', 'EVD-MODEL-RELEASE'),
  ];
}

function r1RequiredScopes(): string[] {
  return r1ConfidenceFacts().map((fact) => fact.scope);
}

function r2Risks(): ReadinessRiskFact[] {
  return [
    risk({
      riskId: GOTHIC_RISK_ID,
      incidentId: COMPOUND_INCIDENT_ID,
      subjectId: 'ACT-GOTHIC-LOOK-03',
      severity: 'CRITICAL',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID],
      reasons: ['WEATHER_WINDOW_COMPRESSION'],
    }),
    risk({
      riskId: EIXAMPLE_RISK_ID,
      incidentId: COMPOUND_INCIDENT_ID,
      subjectId: 'ACT-EIXAMPLE-LOOK-05',
      severity: 'HIGH',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID, TRAVEL_EVIDENCE_ID],
      reasons: ['WEATHER_WINDOW_COMPRESSION'],
    }),
    risk({
      riskId: STUDIO_RISK_ID,
      incidentId: COMPOUND_INCIDENT_ID,
      subjectId: 'ACT-STUDIO-LOAD-IN',
      severity: 'MEDIUM',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID],
      reasons: ['TRAVEL_LOAD_IN_DELAY'],
    }),
  ];
}

function r2Impacts(): ReadinessImpactFact[] {
  return [
    impact({
      incidentId: COMPOUND_INCIDENT_ID,
      deliverableId: 'DELIVERABLE-D2',
      severity: 'CRITICAL',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID, TRAVEL_EVIDENCE_ID],
      riskIds: [GOTHIC_RISK_ID],
    }),
    impact({
      incidentId: COMPOUND_INCIDENT_ID,
      deliverableId: 'DELIVERABLE-D3',
      severity: 'HIGH',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
      riskIds: [EIXAMPLE_RISK_ID],
    }),
    impact({
      incidentId: COMPOUND_INCIDENT_ID,
      deliverableId: 'DELIVERABLE-D5',
      severity: 'MEDIUM',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID],
      riskIds: [STUDIO_RISK_ID],
    }),
  ];
}

function r1Impacts(): ReadinessImpactFact[] {
  return [
    impact({
      incidentId: 'INCIDENT-RESIDUAL-A',
      deliverableId: 'DELIVERABLE-D5',
      severity: 'MEDIUM',
      sourceEvidenceIds: ['EVD-RESIDUAL-A'],
      riskIds: ['RISK-RESIDUAL-A'],
    }),
    impact({
      incidentId: 'INCIDENT-RESIDUAL-B',
      deliverableId: 'DELIVERABLE-D2',
      severity: 'MEDIUM',
      sourceEvidenceIds: ['EVD-RESIDUAL-B'],
      riskIds: ['RISK-RESIDUAL-B'],
    }),
    impact({
      incidentId: 'INCIDENT-RESIDUAL-C',
      deliverableId: 'DELIVERABLE-D3',
      severity: 'MEDIUM',
      sourceEvidenceIds: ['EVD-RESIDUAL-C'],
      riskIds: ['RISK-RESIDUAL-C'],
    }),
  ];
}

function r1Risks(): ReadinessRiskFact[] {
  return [
    risk({
      riskId: 'RISK-RESIDUAL-A',
      incidentId: 'INCIDENT-RESIDUAL-A',
      subjectId: 'ACT-STUDIO-LOAD-IN',
      severity: 'MEDIUM',
      sourceEvidenceIds: ['EVD-RESIDUAL-A'],
    }),
    risk({
      riskId: 'RISK-RESIDUAL-B',
      incidentId: 'INCIDENT-RESIDUAL-B',
      subjectId: 'ACT-GOTHIC-LOOK-03',
      severity: 'MEDIUM',
      sourceEvidenceIds: ['EVD-RESIDUAL-B'],
    }),
    risk({
      riskId: 'RISK-RESIDUAL-C',
      incidentId: 'INCIDENT-RESIDUAL-C',
      subjectId: 'ACT-EIXAMPLE-LOOK-05',
      severity: 'MEDIUM',
      sourceEvidenceIds: ['EVD-RESIDUAL-C'],
    }),
  ];
}

function baseInput(overrides: Partial<ProductionEvaluationInput> = {}): ProductionEvaluationInput {
  return {
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
    documents: [modelRelease()],
    capturePaths: [],
    equipment: [],
    proofs: [],
    domainFacts: passedDomains(),
    policy: SCENEREADY_POLICY_V1,
    risks: [],
    impacts: [],
    deliverables: canonicalDeliverables(),
    confidenceFacts: r1ConfidenceFacts(),
    requiredEvidenceScopes: r1RequiredScopes(),
    ...overrides,
  };
}

function r0Input(): ProductionEvaluationInput {
  return baseInput({
    hardGates: HARD_GATE_IDS.map((id) => ({
      id,
      subjectType: id === 'RIGHTS' ? 'DOCUMENT' : 'LOCATION',
      subjectIds: id === 'RIGHTS' ? ['DOCUMENT-MODEL-RELEASE'] : [],
    })),
    proofs: [rightsProof('DENIED')],
    domainFacts: r0Domains(),
    confidenceFacts: [deniedRightsConfidence()],
    requiredEvidenceScopes: ['DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY'],
  });
}

function r1Input(): ProductionEvaluationInput {
  return baseInput({
    risks: r1Risks(),
    impacts: r1Impacts(),
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
    requiredEvidenceScopes: [...r1RequiredScopes(), 'WEATHER:WINDOW:DRIFT', 'TRAVEL:LOAD-IN:DRIFT'],
  });
}

describe('canonical protected assessments', () => {
  it('evaluates R0 as 78 / 94 / BLOCKED / CERTIFIED with only RIGHTS failed', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const randomSpy = vi.spyOn(Math, 'random');
    const assessment = evaluateProductionReadiness(r0Input());

    expect(assessment.scoringVersion).toBe('SR-SCORE-v1');
    expect(assessment.readinessScore).toBe(78);
    expect(assessment.confidenceScore).toBe(94);
    expect(assessment.status).toBe('BLOCKED');
    expect(assessment.certification).toBe('CERTIFIED');
    expect(assessment.failedGateIds).toEqual(['RIGHTS']);
    expect(assessment.unresolvedGateIds).toEqual([]);
    expect(assessment.failedGateIds.every((id) => id === 'RIGHTS')).toBe(true);
    expect(nowSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('evaluates R1 as 86 / 96 / READY / CERTIFIED', () => {
    const assessment = evaluateProductionReadiness(r1Input());

    expect(assessment.readinessScore).toBe(86);
    expect(assessment.confidenceScore).toBe(96);
    expect(assessment.status).toBe('READY');
    expect(assessment.certification).toBe('CERTIFIED');
    expect(assessment.failedGateIds).toEqual([]);
    expect(assessment.unresolvedGateIds).toEqual([]);
    expect(assessment.unresolvedRequiredEvidenceScopes).toEqual([]);
    expect(
      assessment.risks.every((item) => item.severity !== 'HIGH' && item.severity !== 'CRITICAL'),
    ).toBe(true);
  });

  it('evaluates R2 as 74 / 96 / AT_RISK / CERTIFIED with compound drift risks', () => {
    const assessment = evaluateProductionReadiness(r2Input());
    const bySubject = Object.fromEntries(assessment.risks.map((item) => [item.subjectId, item]));

    expect(assessment.readinessScore).toBe(74);
    expect(assessment.confidenceScore).toBe(96);
    expect(assessment.status).toBe('AT_RISK');
    expect(assessment.certification).toBe('CERTIFIED');
    expect(bySubject['ACT-GOTHIC-LOOK-03']?.severity).toBe('CRITICAL');
    expect(bySubject['ACT-GOTHIC-LOOK-03']?.riskId).toBe(GOTHIC_RISK_ID);
    expect(bySubject['ACT-EIXAMPLE-LOOK-05']?.severity).toBe('HIGH');
    expect(bySubject['ACT-STUDIO-LOAD-IN']?.severity).toBe('MEDIUM');
  });
});

describe('operational status', () => {
  it('treats a failed hard gate as BLOCKED even when readiness is 100', () => {
    const assessment = evaluateProductionReadiness(
      baseInput({
        hardGates: HARD_GATE_IDS.map((id) => ({
          id,
          subjectType: 'LOCATION',
          subjectIds: id === 'LOCATION_ACCESS' ? ['LOC-GOTHIC'] : [],
        })),
        proofs: [locationDeniedProof()],
        requiredLocationIds: ['LOC-GOTHIC'],
      }),
    );

    expect(assessment.readinessScore).toBe(100);
    expect(assessment.failedGateIds).toEqual(['LOCATION_ACCESS']);
    expect(assessment.status).toBe('BLOCKED');
  });

  it('treats CRITICAL risk with all gates passed as AT_RISK, never BLOCKED', () => {
    const assessment = evaluateProductionReadiness(
      baseInput({
        risks: [
          risk({
            riskId: GOTHIC_RISK_ID,
            incidentId: COMPOUND_INCIDENT_ID,
            subjectId: 'ACT-GOTHIC-LOOK-03',
            severity: 'CRITICAL',
            sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
          }),
        ],
        impacts: [
          impact({
            incidentId: COMPOUND_INCIDENT_ID,
            deliverableId: 'DELIVERABLE-D2',
            severity: 'CRITICAL',
            sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
            riskIds: [GOTHIC_RISK_ID],
          }),
        ],
      }),
    );

    expect(assessment.failedGateIds).toEqual([]);
    expect(assessment.unresolvedGateIds).toEqual([]);
    expect(assessment.status).toBe('AT_RISK');
    expect(assessment.status).not.toBe('BLOCKED');
  });

  it('treats readiness below 85 with passed gates as AT_RISK', () => {
    const assessment = evaluateProductionReadiness(r2Input());

    expect(assessment.readinessScore).toBeLessThan(85);
    expect(assessment.failedGateIds).toEqual([]);
    expect(assessment.status).toBe('AT_RISK');
  });

  it('treats an unresolved hard gate as AT_RISK, not BLOCKED', () => {
    const assessment = evaluateProductionReadiness(
      baseInput({
        hardGates: HARD_GATE_IDS.map((id) => ({
          id,
          subjectType: 'LOCATION',
          subjectIds: id === 'LOCATION_ACCESS' ? ['LOC-GOTHIC'] : [],
        })),
        proofs: [],
        requiredLocationIds: ['LOC-GOTHIC'],
      }),
    );

    expect(assessment.unresolvedGateIds).toEqual(['LOCATION_ACCESS']);
    expect(assessment.failedGateIds).toEqual([]);
    expect(assessment.status).toBe('AT_RISK');
    expect(assessment.status).not.toBe('BLOCKED');
  });

  it('prevents READY when required evidence is unresolved', () => {
    const assessment = evaluateProductionReadiness(r1Input());
    const withMissing = evaluateProductionReadiness(
      baseInput({
        risks: r1Risks(),
        impacts: r1Impacts(),
        confidenceFacts: [
          confirmedScope('LOCATION:LOC-GOTHIC:ACCESS', 'EVD-GOTHIC-ACCESS'),
          confidence({
            scope: 'PERSON:PERSON-MODEL:AVAILABILITY',
            coverage: 'MISSING',
            evidenceId: 'EVD-MODEL-AVAIL',
            fingerprint: 'fp-EVD-MODEL-AVAIL',
            trustState: 'MISSING',
          }),
        ],
        requiredEvidenceScopes: ['LOCATION:LOC-GOTHIC:ACCESS', 'PERSON:PERSON-MODEL:AVAILABILITY'],
      }),
    );

    expect(assessment.status).toBe('READY');
    expect(withMissing.status).not.toBe('READY');
    expect(withMissing.unresolvedRequiredEvidenceScopes).toEqual([
      'PERSON:PERSON-MODEL:AVAILABILITY',
    ]);
  });
});

describe('certification', () => {
  it('prevents CERTIFIED when required evidence is unresolved', () => {
    const assessment = evaluateProductionReadiness(
      baseInput({
        confidenceFacts: [
          confidence({
            scope: 'LOCATION:LOC-GOTHIC:ACCESS',
            coverage: 'CONFLICTED',
            evidenceId: 'EVD-GOTHIC-ACCESS',
            fingerprint: 'fp-EVD-GOTHIC-ACCESS',
            trustState: 'LIVE',
          }),
        ],
        requiredEvidenceScopes: ['LOCATION:LOC-GOTHIC:ACCESS'],
      }),
    );

    expect(assessment.certification).not.toBe('CERTIFIED');
    expect(assessment.unresolvedRequiredEvidenceScopes).toEqual(['LOCATION:LOC-GOTHIC:ACCESS']);
  });

  it('keeps a failed gate CERTIFIED when required evidence is sufficient', () => {
    const assessment = evaluateProductionReadiness(r0Input());

    expect(assessment.status).toBe('BLOCKED');
    expect(assessment.certification).toBe('CERTIFIED');
    expect(assessment.confidenceScore).toBeGreaterThanOrEqual(85);
    expect(assessment.unresolvedRequiredEvidenceScopes).toEqual([]);
  });

  it('certifies when confidence is at least 85 and required evidence is complete', () => {
    const assessment = evaluateProductionReadiness(r1Input());

    expect(assessment.confidenceScore).toBeGreaterThanOrEqual(85);
    expect(assessment.unresolvedRequiredEvidenceScopes).toEqual([]);
    expect(assessment.certification).toBe('CERTIFIED');
  });

  it('marks DEGRADED when confidence is between 60 and 84 with complete evidence', () => {
    const assessment = evaluateProductionReadiness(
      baseInput({
        confidenceFacts: [
          confidence({
            scope: 'LOCATION:LOC-GOTHIC:ACCESS',
            coverage: 'RESOLVED',
            polarity: 'CONFIRMED',
            quality: 70,
            evidenceId: 'EVD-GOTHIC-ACCESS',
            fingerprint: 'fp-EVD-GOTHIC-ACCESS',
            trustState: 'LIVE',
          }),
        ],
        requiredEvidenceScopes: ['LOCATION:LOC-GOTHIC:ACCESS'],
      }),
    );

    expect(assessment.confidenceScore).toBe(70);
    expect(assessment.unresolvedRequiredEvidenceScopes).toEqual([]);
    expect(assessment.certification).toBe('DEGRADED');
  });

  it('marks INSUFFICIENT when confidence is below 60', () => {
    const assessment = evaluateProductionReadiness(
      baseInput({
        confidenceFacts: [
          confidence({
            scope: 'LOCATION:LOC-GOTHIC:ACCESS',
            coverage: 'RESOLVED',
            polarity: 'CONFIRMED',
            quality: 40,
            evidenceId: 'EVD-GOTHIC-ACCESS',
            fingerprint: 'fp-EVD-GOTHIC-ACCESS',
            trustState: 'LIVE',
          }),
        ],
        requiredEvidenceScopes: ['LOCATION:LOC-GOTHIC:ACCESS'],
      }),
    );

    expect(assessment.confidenceScore).toBe(40);
    expect(assessment.certification).toBe('INSUFFICIENT');
  });
});

describe('score independence and penalties', () => {
  it('does not change readinessScore when only confidence facts change', () => {
    const baseline = evaluateProductionReadiness(r2Input());
    const altered = evaluateProductionReadiness({
      ...r2Input(),
      confidenceFacts: [
        confidence({
          scope: 'LOCATION:LOC-GOTHIC:ACCESS',
          coverage: 'RESOLVED',
          polarity: 'CONFIRMED',
          quality: 61,
          evidenceId: 'EVD-GOTHIC-ACCESS',
          fingerprint: 'fp-EVD-GOTHIC-ACCESS',
          trustState: 'LIVE',
        }),
      ],
      requiredEvidenceScopes: ['LOCATION:LOC-GOTHIC:ACCESS'],
    });

    expect(altered.confidenceScore).not.toBe(baseline.confidenceScore);
    expect(altered.readinessScore).toBe(baseline.readinessScore);
  });

  it('does not double-penalize duplicate incident+deliverable impacts', () => {
    const once = evaluateProductionReadiness(
      baseInput({
        impacts: [r2Impacts()[0]!],
      }),
    );
    const duplicated = evaluateProductionReadiness(
      baseInput({
        impacts: [r2Impacts()[0]!, r2Impacts()[0]!],
      }),
    );

    expect(duplicated.readinessScore).toBe(once.readinessScore);
  });

  it('keeps separate incidents on the same deliverable as separate penalty sources', () => {
    const one = evaluateProductionReadiness(
      baseInput({
        impacts: [
          impact({
            incidentId: 'INCIDENT-A',
            deliverableId: 'DELIVERABLE-D2',
            severity: 'HIGH',
            sourceEvidenceIds: ['E-A'],
            riskIds: ['RISK-A'],
          }),
        ],
      }),
    );
    const two = evaluateProductionReadiness(
      baseInput({
        impacts: [
          impact({
            incidentId: 'INCIDENT-A',
            deliverableId: 'DELIVERABLE-D2',
            severity: 'HIGH',
            sourceEvidenceIds: ['E-A'],
            riskIds: ['RISK-A'],
          }),
          impact({
            incidentId: 'INCIDENT-B',
            deliverableId: 'DELIVERABLE-D2',
            severity: 'HIGH',
            sourceEvidenceIds: ['E-B'],
            riskIds: ['RISK-B'],
          }),
        ],
      }),
    );

    expect(two.readinessScore).toBeLessThan(one.readinessScore);
  });

  it('applies a strictly larger penalty for CRITICAL than HIGH than MEDIUM than LOW', () => {
    const scores = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map(
      (severity) =>
        evaluateProductionReadiness(
          baseInput({
            impacts: [
              impact({
                incidentId: 'INCIDENT-SEV',
                deliverableId: 'DELIVERABLE-D2',
                severity,
                sourceEvidenceIds: ['E-SEV'],
                riskIds: ['RISK-SEV'],
              }),
            ],
          }),
        ).readinessScore,
    );

    expect(scores[3]).toBeLessThan(scores[2]!);
    expect(scores[2]).toBeLessThan(scores[1]!);
    expect(scores[1]).toBeLessThan(scores[0]!);
  });

  it('weights CRITICAL deliverable importance at least as strongly as HIGH, and HIGH at least as MEDIUM', () => {
    const scoreFor = (deliverableId: string): number =>
      evaluateProductionReadiness(
        baseInput({
          impacts: [
            impact({
              incidentId: 'INCIDENT-IMP',
              deliverableId,
              severity: 'HIGH',
              sourceEvidenceIds: ['E-IMP'],
              riskIds: ['RISK-IMP'],
            }),
          ],
        }),
      ).readinessScore;

    const critical = scoreFor('DELIVERABLE-D5');
    const high = scoreFor('DELIVERABLE-D2');
    const medium = scoreFor('DELIVERABLE-D4');

    expect(critical).toBeLessThanOrEqual(high);
    expect(high).toBeLessThanOrEqual(medium);
  });

  it('clamps scores to 0..100', () => {
    const high = evaluateProductionReadiness(baseInput());
    const low = evaluateProductionReadiness(
      baseInput({
        domainFacts: PRODUCTION_DOMAINS.map((domain) => ({
          domain,
          state: 'FAILED',
          reasons: [`${domain}_FAILED`],
        })),
        impacts: Array.from({ length: 20 }, (_, index) =>
          impact({
            incidentId: `INCIDENT-${index}`,
            deliverableId: 'DELIVERABLE-D1',
            severity: 'CRITICAL',
            sourceEvidenceIds: [`E-${index}`],
            riskIds: [`RISK-${index}`],
          }),
        ),
      }),
    );

    expect(high.readinessScore).toBeLessThanOrEqual(100);
    expect(high.readinessScore).toBeGreaterThanOrEqual(0);
    expect(high.confidenceScore).toBeLessThanOrEqual(100);
    expect(high.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(low.readinessScore).toBe(0);
    expect(low.readinessScore).toBeGreaterThanOrEqual(0);
  });
});

describe('deterministic assessment output', () => {
  it('produces byte-equivalent assessments for reordered domains, risks, impacts, and evidence', () => {
    const forward = evaluateProductionReadiness(r2Input());
    const reversed = evaluateProductionReadiness(r2Input());
    const shuffled = evaluateProductionReadiness({
      ...r2Input(),
      domainFacts: [...(r2Input().domainFacts ?? [])].reverse(),
      risks: [...r2Risks()].reverse(),
      impacts: [...r2Impacts()].reverse(),
      deliverables: [...canonicalDeliverables()].reverse(),
      confidenceFacts: [...r2Input().confidenceFacts].reverse(),
      requiredEvidenceScopes: [...r2Input().requiredEvidenceScopes].reverse(),
    });

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(forward));
  });

  it('orders unresolved required evidence scopes deterministically', () => {
    const assessment = evaluateProductionReadiness(
      baseInput({
        confidenceFacts: [
          confidence({
            scope: 'WEATHER:WINDOW:DRIFT',
            coverage: 'MISSING',
          }),
          confidence({
            scope: 'PERSON:PERSON-MODEL:AVAILABILITY',
            coverage: 'CONFLICTED',
            evidenceId: 'EVD-MODEL-AVAIL',
            fingerprint: 'fp-EVD-MODEL-AVAIL',
          }),
        ],
        requiredEvidenceScopes: [
          'WEATHER:WINDOW:DRIFT',
          'PERSON:PERSON-MODEL:AVAILABILITY',
          'Z-SCOPE',
        ],
      }),
    );

    expect(assessment.unresolvedRequiredEvidenceScopes).toEqual([
      'PERSON:PERSON-MODEL:AVAILABILITY',
      'WEATHER:WINDOW:DRIFT',
      'Z-SCOPE',
    ]);
  });

  it('preserves stable evidence IDs and fingerprints on references', () => {
    const assessment = evaluateProductionReadiness(r2Input());
    const ids = assessment.evidenceReferences.map((item) => item.evidenceId);
    const fingerprints = assessment.evidenceReferences.map((item) => item.fingerprint);

    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain(WEATHER_EVIDENCE_ID);
    expect(ids).toContain(TRAVEL_EVIDENCE_ID);
    expect(fingerprints).toContain(`fp-${WEATHER_EVIDENCE_ID}`);
    expect(fingerprints).toContain(`fp-${TRAVEL_EVIDENCE_ID}`);
  });
});

describe('readiness-engine Task 7 source authority', () => {
  it('does not use Date.now, random, UUID, or scenario-specific score branching', async () => {
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const sources = await Promise.all(
      ['scoring.ts', 'confidence.ts', 'certification.ts', 'evaluate.ts', 'index.ts'].map(
        (fileName) => readFile(join(sourceDir, fileName), 'utf8'),
      ),
    );
    const joined = sources.join('\n');

    expect(joined).not.toMatch(/Date\.now\s*\(/);
    expect(joined).not.toMatch(/Math\.random\s*\(/);
    expect(joined).not.toMatch(/randomUUID/);
    expect(joined).not.toMatch(/uuid/i);
    expect(joined).not.toMatch(/\bR0\b/);
    expect(joined).not.toMatch(/\bR1\b/);
    expect(joined).not.toMatch(/\bR2\b/);
    expect(joined).not.toMatch(/RISK-GOTHIC-LOOK-03/);
    expect(joined).not.toMatch(/if\s*\(.*R0/);
    expect(joined).not.toMatch(/shadow simulation/i);
    expect(joined).not.toMatch(/bedrock/i);
    expect(joined).not.toMatch(/@sceneready\/evidence/);
    expect(joined).not.toMatch(/@sceneready\/production-graph/);
  });
});
