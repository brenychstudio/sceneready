import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGraphEdge,
  createGraphNode,
  createProductionGraph,
  graphEdgeKey,
  isRiskSeverity,
  propagateRisk,
  RISK_SEVERITIES,
  traceCausalImpact,
  type ProductionGraph,
  type RiskIncidentInput,
  type RiskSeverity,
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
const GOTHIC_SUBJECT_ID = 'ACT-GOTHIC-LOOK-03';
const EIXAMPLE_SUBJECT_ID = 'ACT-EIXAMPLE-LOOK-05';
const STUDIO_SUBJECT_ID = 'ACT-STUDIO-LOAD-IN';
const GOTHIC_ALT_ID = 'ACT-GOTHIC-ALT-PATH';
const DELIVERABLE_D2 = 'DELIVERABLE-D2';

function makeGraph(
  nodes: Parameters<typeof createGraphNode>[],
  edges: Parameters<typeof createGraphEdge>[],
): ProductionGraph {
  return createProductionGraph({
    productionId: 'BCN-DEMO-01',
    policyVersion: 'SR-POLICY-v1',
    fixtureVersion: 'BCN-DEMO-v1',
    nodes: nodes.map(([id, type]) => createGraphNode(id, type)),
    edges: edges.map(([from, to, type]) => createGraphEdge(from, to, type)),
  });
}

function incident(input: RiskIncidentInput): RiskIncidentInput {
  return input;
}

function compoundSeeds(): readonly RiskIncidentInput[] {
  return [
    incident({
      incidentId: COMPOUND_INCIDENT_ID,
      riskId: GOTHIC_RISK_ID,
      subjectId: GOTHIC_SUBJECT_ID,
      severity: 'CRITICAL',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID, TRAVEL_EVIDENCE_ID],
      reasons: ['TRAVEL_LOAD_IN_DELAY', 'WEATHER_WINDOW_COMPRESSION'],
    }),
    incident({
      incidentId: COMPOUND_INCIDENT_ID,
      riskId: EIXAMPLE_RISK_ID,
      subjectId: EIXAMPLE_SUBJECT_ID,
      severity: 'HIGH',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID, TRAVEL_EVIDENCE_ID],
      reasons: ['WEATHER_WINDOW_COMPRESSION'],
    }),
    incident({
      incidentId: COMPOUND_INCIDENT_ID,
      riskId: STUDIO_RISK_ID,
      subjectId: STUDIO_SUBJECT_ID,
      severity: 'MEDIUM',
      sourceEvidenceIds: [TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID],
      reasons: ['TRAVEL_LOAD_IN_DELAY'],
    }),
  ];
}

function compoundGraph(): ProductionGraph {
  return makeGraph(
    [
      [WEATHER_EVIDENCE_ID, 'EVIDENCE'],
      [TRAVEL_EVIDENCE_ID, 'EVIDENCE'],
      [GOTHIC_SUBJECT_ID, 'ACTIVITY'],
      [EIXAMPLE_SUBJECT_ID, 'ACTIVITY'],
      [STUDIO_SUBJECT_ID, 'ACTIVITY'],
      [GOTHIC_ALT_ID, 'ACTIVITY'],
      [DELIVERABLE_D2, 'DELIVERABLE'],
    ],
    [
      [WEATHER_EVIDENCE_ID, GOTHIC_SUBJECT_ID, 'AFFECTS'],
      [WEATHER_EVIDENCE_ID, EIXAMPLE_SUBJECT_ID, 'AFFECTS'],
      [TRAVEL_EVIDENCE_ID, STUDIO_SUBJECT_ID, 'AFFECTS'],
      [GOTHIC_SUBJECT_ID, GOTHIC_ALT_ID, 'AFFECTS'],
      [DELIVERABLE_D2, GOTHIC_SUBJECT_ID, 'REQUIRES'],
      [DELIVERABLE_D2, GOTHIC_ALT_ID, 'REQUIRES'],
    ],
  );
}

describe('risk severity contract', () => {
  it('supports exactly LOW, MEDIUM, HIGH, and CRITICAL', () => {
    expect(RISK_SEVERITIES).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    expect(isRiskSeverity('LOW')).toBe(true);
    expect(isRiskSeverity('MEDIUM')).toBe(true);
    expect(isRiskSeverity('HIGH')).toBe(true);
    expect(isRiskSeverity('CRITICAL')).toBe(true);
    expect(isRiskSeverity('BLOCKED')).toBe(false);
    expect(RISK_SEVERITIES).not.toContain('BLOCKED');
    expect(RISK_SEVERITIES).not.toContain('AT_RISK');
    expect(RISK_SEVERITIES).not.toContain('READY');
  });
});

describe('compound R2 causal drift', () => {
  it('produces Gothic CRITICAL, Eixample HIGH, and Studio load-in MEDIUM risks', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const randomSpy = vi.spyOn(Math, 'random');
    const result = propagateRisk({
      graph: compoundGraph(),
      incidents: compoundSeeds(),
    });
    const bySubject = Object.fromEntries(result.risks.map((risk) => [risk.subjectId, risk]));

    expect(result.rejected).toEqual([]);
    expect(result.risks.map((risk) => risk.subjectId).sort()).toEqual([
      EIXAMPLE_SUBJECT_ID,
      GOTHIC_SUBJECT_ID,
      STUDIO_SUBJECT_ID,
    ]);
    expect(bySubject[GOTHIC_SUBJECT_ID]?.riskId).toBe(GOTHIC_RISK_ID);
    expect(bySubject[GOTHIC_SUBJECT_ID]?.severity).toBe('CRITICAL');
    expect(bySubject[EIXAMPLE_SUBJECT_ID]?.riskId).toBe(EIXAMPLE_RISK_ID);
    expect(bySubject[EIXAMPLE_SUBJECT_ID]?.severity).toBe('HIGH');
    expect(bySubject[STUDIO_SUBJECT_ID]?.riskId).toBe(STUDIO_RISK_ID);
    expect(bySubject[STUDIO_SUBJECT_ID]?.severity).toBe('MEDIUM');
    expect(nowSpy).not.toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('traces RISK-GOTHIC-LOOK-03 from EVIDENCE-WEATHER-DRIFT to DELIVERABLE-D2', () => {
    const gothic = compoundSeeds()[0];
    if (gothic === undefined) {
      throw new Error('compound gothic seed is missing');
    }
    const traced = traceCausalImpact({
      graph: compoundGraph(),
      incident: gothic,
    });
    const d2 = traced.impacts.find((impact) => impact.deliverableId === DELIVERABLE_D2);

    expect(traced.rejected).toBeNull();
    expect(d2).toBeDefined();
    expect(d2?.pathNodeIds[0]).toBe(WEATHER_EVIDENCE_ID);
    expect(d2?.pathNodeIds.at(-1)).toBe(DELIVERABLE_D2);
    expect(d2?.pathNodeIds).toContain(GOTHIC_SUBJECT_ID);
    expect(d2?.severity).toBe('CRITICAL');
    expect(d2?.incidentId).toBe(COMPOUND_INCIDENT_ID);
  });

  it('emits one D2 impact for the compound incident even when multiple paths converge', () => {
    const result = propagateRisk({
      graph: compoundGraph(),
      incidents: compoundSeeds(),
    });
    const d2Impacts = result.impacts.filter(
      (impact) =>
        impact.incidentId === COMPOUND_INCIDENT_ID && impact.deliverableId === DELIVERABLE_D2,
    );

    expect(d2Impacts).toHaveLength(1);
    expect(d2Impacts[0]?.pathNodeIds).toEqual([
      WEATHER_EVIDENCE_ID,
      GOTHIC_SUBJECT_ID,
      DELIVERABLE_D2,
    ]);
    expect(d2Impacts[0]?.pathNodeIds).not.toContain(GOTHIC_ALT_ID);
    expect(d2Impacts[0]?.dedupeKey).toBe(`${COMPOUND_INCIDENT_ID}\u0000${DELIVERABLE_D2}`);
    expect(d2Impacts[0]?.dedupeKey).not.toContain(GOTHIC_SUBJECT_ID);
    expect(d2Impacts[0]?.dedupeKey).not.toContain(GOTHIC_ALT_ID);
    expect(d2Impacts[0]?.pathEdgeIds).toEqual([
      graphEdgeKey(createGraphEdge(WEATHER_EVIDENCE_ID, GOTHIC_SUBJECT_ID, 'AFFECTS')),
      graphEdgeKey(createGraphEdge(DELIVERABLE_D2, GOTHIC_SUBJECT_ID, 'REQUIRES')),
    ]);
  });

  it('preserves both compound-drift source evidence IDs through risk and impact provenance', () => {
    const result = propagateRisk({
      graph: compoundGraph(),
      incidents: compoundSeeds(),
    });
    const gothic = result.risks.find((risk) => risk.riskId === GOTHIC_RISK_ID);
    const d2 = result.impacts.find(
      (impact) =>
        impact.incidentId === COMPOUND_INCIDENT_ID && impact.deliverableId === DELIVERABLE_D2,
    );

    expect(gothic?.sourceEvidenceIds).toEqual([TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID]);
    expect(d2?.sourceEvidenceIds).toEqual([TRAVEL_EVIDENCE_ID, WEATHER_EVIDENCE_ID]);
    expect(d2?.riskIds).toEqual([GOTHIC_RISK_ID]);
  });
});

describe('deduplication', () => {
  it('does not merge two different incidents that reach the same deliverable', () => {
    const graph = compoundGraph();
    const gothic = compoundSeeds()[0];
    if (gothic === undefined) {
      throw new Error('compound gothic seed is missing');
    }
    const result = propagateRisk({
      graph,
      incidents: [
        gothic,
        incident({
          incidentId: 'INCIDENT-RIGHTS-GAP',
          riskId: 'RISK-RIGHTS-D2',
          subjectId: GOTHIC_SUBJECT_ID,
          severity: 'HIGH',
          sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
        }),
      ],
    });
    const d2Impacts = result.impacts.filter((impact) => impact.deliverableId === DELIVERABLE_D2);

    expect(d2Impacts).toHaveLength(2);
    expect(d2Impacts.map((impact) => impact.incidentId).sort()).toEqual([
      COMPOUND_INCIDENT_ID,
      'INCIDENT-RIGHTS-GAP',
    ]);
    expect(new Set(d2Impacts.map((impact) => impact.dedupeKey)).size).toBe(2);
  });

  it('unions contributing source evidence IDs when one incident converges on a deliverable', () => {
    const graph = makeGraph(
      [
        ['E-A', 'EVIDENCE'],
        ['E-B', 'EVIDENCE'],
        ['ACT-A', 'ACTIVITY'],
        ['ACT-B', 'ACTIVITY'],
        ['DELIVERABLE-SHARED', 'DELIVERABLE'],
      ],
      [
        ['E-A', 'ACT-A', 'AFFECTS'],
        ['E-B', 'ACT-B', 'AFFECTS'],
        ['DELIVERABLE-SHARED', 'ACT-A', 'REQUIRES'],
        ['DELIVERABLE-SHARED', 'ACT-B', 'REQUIRES'],
      ],
    );
    const result = propagateRisk({
      graph,
      incidents: [
        incident({
          incidentId: 'INCIDENT-UNION',
          riskId: 'RISK-A',
          subjectId: 'ACT-A',
          severity: 'MEDIUM',
          sourceEvidenceIds: ['E-A'],
        }),
        incident({
          incidentId: 'INCIDENT-UNION',
          riskId: 'RISK-B',
          subjectId: 'ACT-B',
          severity: 'HIGH',
          sourceEvidenceIds: ['E-B'],
        }),
      ],
    });
    const shared = result.impacts.filter((impact) => impact.deliverableId === 'DELIVERABLE-SHARED');

    expect(shared).toHaveLength(1);
    expect(shared[0]?.severity).toBe('HIGH');
    expect(shared[0]?.sourceEvidenceIds).toEqual(['E-A', 'E-B']);
    expect(shared[0]?.riskIds).toEqual(['RISK-A', 'RISK-B']);
    expect(shared[0]?.dedupeKey).toBe('INCIDENT-UNION\u0000DELIVERABLE-SHARED');
  });

  it('selects the shortest causal path, then the lexicographically smallest serialized path', () => {
    const graph = makeGraph(
      [
        ['ACT-S', 'ACTIVITY'],
        ['ACT-A', 'ACTIVITY'],
        ['ACT-B', 'ACTIVITY'],
        ['ACT-LONG', 'ACTIVITY'],
        ['DELIVERABLE-TIE', 'DELIVERABLE'],
      ],
      [
        ['ACT-S', 'ACT-A', 'AFFECTS'],
        ['ACT-S', 'ACT-B', 'AFFECTS'],
        ['ACT-S', 'ACT-LONG', 'AFFECTS'],
        ['ACT-LONG', 'ACT-A', 'AFFECTS'],
        ['DELIVERABLE-TIE', 'ACT-A', 'REQUIRES'],
        ['DELIVERABLE-TIE', 'ACT-B', 'REQUIRES'],
      ],
    );
    const result = propagateRisk({
      graph,
      incidents: [
        incident({
          incidentId: 'INCIDENT-TIE',
          riskId: 'RISK-TIE',
          subjectId: 'ACT-S',
          severity: 'LOW',
          sourceEvidenceIds: [],
        }),
      ],
    });
    const impact = result.impacts[0];

    expect(result.impacts).toHaveLength(1);
    expect(impact?.pathNodeIds).toEqual(['ACT-S', 'ACT-A', 'DELIVERABLE-TIE']);
    expect(impact?.pathNodeIds).not.toEqual(['ACT-S', 'ACT-B', 'DELIVERABLE-TIE']);
    expect(impact?.pathNodeIds).not.toContain('ACT-LONG');
  });
});

describe('causal edge semantics', () => {
  it('propagates REQUIRES as dependency -> consumer', () => {
    const graph = makeGraph(
      [
        ['EQ-LENS', 'RESOURCE'],
        ['DELIVERABLE-SHOT', 'DELIVERABLE'],
      ],
      [['DELIVERABLE-SHOT', 'EQ-LENS', 'REQUIRES']],
    );
    const result = propagateRisk({
      graph,
      incidents: [
        incident({
          incidentId: 'INCIDENT-REQUIRES',
          riskId: 'RISK-LENS',
          subjectId: 'EQ-LENS',
          severity: 'HIGH',
          sourceEvidenceIds: [],
        }),
      ],
    });

    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.deliverableId).toBe('DELIVERABLE-SHOT');
    expect(result.impacts[0]?.pathNodeIds).toEqual(['EQ-LENS', 'DELIVERABLE-SHOT']);
    expect(result.impacts[0]?.pathEdgeIds).toEqual([
      graphEdgeKey(createGraphEdge('DELIVERABLE-SHOT', 'EQ-LENS', 'REQUIRES')),
    ]);
  });

  it('propagates SCHEDULED_BEFORE forward in schedule order', () => {
    const graph = makeGraph(
      [
        ['ACT-EARLY', 'ACTIVITY'],
        ['ACT-LATE', 'ACTIVITY'],
        ['DELIVERABLE-LATE', 'DELIVERABLE'],
      ],
      [
        ['ACT-EARLY', 'ACT-LATE', 'SCHEDULED_BEFORE'],
        ['DELIVERABLE-LATE', 'ACT-LATE', 'REQUIRES'],
      ],
    );
    const result = propagateRisk({
      graph,
      incidents: [
        incident({
          incidentId: 'INCIDENT-SCHEDULE',
          riskId: 'RISK-EARLY',
          subjectId: 'ACT-EARLY',
          severity: 'MEDIUM',
          sourceEvidenceIds: [],
        }),
      ],
    });

    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.deliverableId).toBe('DELIVERABLE-LATE');
    expect(result.impacts[0]?.pathNodeIds).toEqual(['ACT-EARLY', 'ACT-LATE', 'DELIVERABLE-LATE']);
  });

  it('does not automatically propagate damage across FALLBACK_FOR', () => {
    const graph = makeGraph(
      [
        ['EQ-PRIMARY', 'RESOURCE'],
        ['EQ-BACKUP', 'RESOURCE'],
        ['DELIVERABLE-PRIMARY', 'DELIVERABLE'],
        ['DELIVERABLE-BACKUP', 'DELIVERABLE'],
      ],
      [
        ['EQ-BACKUP', 'EQ-PRIMARY', 'FALLBACK_FOR'],
        ['DELIVERABLE-PRIMARY', 'EQ-PRIMARY', 'REQUIRES'],
        ['DELIVERABLE-BACKUP', 'EQ-BACKUP', 'REQUIRES'],
      ],
    );
    const primary = propagateRisk({
      graph,
      incidents: [
        incident({
          incidentId: 'INCIDENT-PRIMARY',
          riskId: 'RISK-PRIMARY',
          subjectId: 'EQ-PRIMARY',
          severity: 'CRITICAL',
          sourceEvidenceIds: [],
        }),
      ],
    });
    const backup = propagateRisk({
      graph,
      incidents: [
        incident({
          incidentId: 'INCIDENT-BACKUP',
          riskId: 'RISK-BACKUP',
          subjectId: 'EQ-BACKUP',
          severity: 'HIGH',
          sourceEvidenceIds: [],
        }),
      ],
    });

    expect(primary.impacts.map((impact) => impact.deliverableId)).toEqual(['DELIVERABLE-PRIMARY']);
    expect(backup.impacts.map((impact) => impact.deliverableId)).toEqual(['DELIVERABLE-BACKUP']);
  });
});

describe('fail-closed graph behavior', () => {
  it('rejects an unknown subject without inventing a causal path', () => {
    const result = propagateRisk({
      graph: compoundGraph(),
      incidents: [
        incident({
          incidentId: COMPOUND_INCIDENT_ID,
          riskId: 'RISK-UNKNOWN',
          subjectId: 'ACT-DOES-NOT-EXIST',
          severity: 'HIGH',
          sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
        }),
      ],
    });

    expect(result.risks).toEqual([]);
    expect(result.impacts).toEqual([]);
    expect(result.rejected).toEqual([
      {
        incidentId: COMPOUND_INCIDENT_ID,
        riskId: 'RISK-UNKNOWN',
        subjectId: 'ACT-DOES-NOT-EXIST',
        reasons: ['UNKNOWN_SUBJECT'],
      },
    ]);
    expect(result.impacts.some((impact) => impact.pathNodeIds.includes('ACT-DOES-NOT-EXIST'))).toBe(
      false,
    );
  });

  it('rejects BLOCKED as a risk severity', () => {
    const result = propagateRisk({
      graph: compoundGraph(),
      incidents: [
        incident({
          incidentId: 'INCIDENT-BLOCKED',
          riskId: GOTHIC_RISK_ID,
          subjectId: GOTHIC_SUBJECT_ID,
          severity: 'BLOCKED' as RiskSeverity,
          sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
        }),
      ],
    });

    expect(result.risks).toEqual([]);
    expect(result.impacts).toEqual([]);
    expect(result.rejected[0]?.reasons).toEqual(['INVALID_SEVERITY']);
  });

  it('terminates graph cycles deterministically without duplicate explosion', () => {
    const graph = makeGraph(
      [
        ['ACT-A', 'ACTIVITY'],
        ['ACT-B', 'ACTIVITY'],
        ['DELIVERABLE-CYCLE', 'DELIVERABLE'],
      ],
      [
        ['ACT-A', 'ACT-B', 'AFFECTS'],
        ['ACT-B', 'ACT-A', 'AFFECTS'],
        ['DELIVERABLE-CYCLE', 'ACT-A', 'REQUIRES'],
      ],
    );
    const result = propagateRisk({
      graph,
      incidents: [
        incident({
          incidentId: 'INCIDENT-CYCLE',
          riskId: 'RISK-CYCLE',
          subjectId: 'ACT-A',
          severity: 'LOW',
          sourceEvidenceIds: [],
        }),
      ],
    });

    expect(result.rejected).toEqual([]);
    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]?.deliverableId).toBe('DELIVERABLE-CYCLE');
    expect(result.impacts[0]?.pathNodeIds[0]).toBe('ACT-A');
    expect(result.impacts[0]?.pathNodeIds.at(-1)).toBe('DELIVERABLE-CYCLE');
    expect(result.impacts[0]?.pathNodeIds.filter((id) => id === 'ACT-A').length).toBe(1);
  });
});

describe('deterministic ordering', () => {
  it('produces byte-equivalent sorted risks and impacts for reversed incident input', () => {
    const graph = compoundGraph();
    const seeds = compoundSeeds();
    const extra = incident({
      incidentId: 'INCIDENT-RIGHTS-GAP',
      riskId: 'RISK-RIGHTS-D2',
      subjectId: GOTHIC_SUBJECT_ID,
      severity: 'HIGH',
      sourceEvidenceIds: [WEATHER_EVIDENCE_ID],
    });
    const forward = propagateRisk({
      graph,
      incidents: [...seeds, extra],
    });
    const reversed = propagateRisk({
      graph,
      incidents: [extra, ...[...seeds].reverse()],
    });

    expect(JSON.stringify(reversed.risks)).toBe(JSON.stringify(forward.risks));
    expect(JSON.stringify(reversed.impacts)).toBe(JSON.stringify(forward.impacts));
    expect(JSON.stringify(reversed.rejected)).toBe(JSON.stringify(forward.rejected));
  });
});

describe('production-graph causal source authority', () => {
  it('does not use Date.now, Math.random, or UUID operational authority', async () => {
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const sources = await Promise.all(
      ['risk.ts', 'propagate.ts', 'trace.ts', 'deduplicate.ts', 'index.ts'].map((fileName) =>
        readFile(join(sourceDir, fileName), 'utf8'),
      ),
    );
    const joined = sources.join('\n');

    expect(joined).not.toMatch(/Date\.now\s*\(/);
    expect(joined).not.toMatch(/Math\.random\s*\(/);
    expect(joined).not.toMatch(/randomUUID/);
    expect(joined).not.toMatch(/uuid/i);
    expect(joined).not.toMatch(/\bBLOCKED\b/);
    expect(joined).not.toMatch(/readiness score/i);
    expect(joined).not.toMatch(/AT_RISK/);
    expect(joined).not.toMatch(/SR-SCORE-v1/);
    expect(joined).not.toMatch(/shadow simulation/i);
    expect(joined).not.toMatch(/bedrock/i);
  });
});
