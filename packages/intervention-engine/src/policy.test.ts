import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGraphNode, createProductionGraph } from '@sceneready/production-graph';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  INTERVENTION_DESCRIPTORS,
  INTERVENTION_KINDS,
  REVERSIBILITY_CLASSES,
} from './primitives.js';
import { parseIntervention } from './schema.js';
import { validateInterventionPolicy, type InterventionPolicyContext } from './policy.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const GOTHIC = 'ACT-GOTHIC-LOOK-03';
const EIXAMPLE = 'ACT-EIXAMPLE-LOOK-05';
const STUDIO = 'ACT-STUDIO-LOAD-IN';
const TRANSFER = 'ACT-TRANSFER-01';
const GOTHIC_LOCATION = 'LOC-GOTHIC';
const FALLBACK_LOCATION = 'LOC-FALLBACK';
const OTHER_LOCATION = 'LOC-OTHER';
const PERSON = 'PERSON-MODEL';
const BACKUP_PATH = 'PATH-BACKUP-KIT';
const EQUIPMENT = 'EQUIPMENT-CAMERA-A';

function baseContext(
  overrides: Partial<InterventionPolicyContext> = {},
): InterventionPolicyContext {
  const graph = createProductionGraph({
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
      createGraphNode(OTHER_LOCATION, 'LOCATION'),
      createGraphNode(PERSON, 'PERSON'),
      createGraphNode(BACKUP_PATH, 'RESOURCE'),
      createGraphNode(EQUIPMENT, 'RESOURCE'),
    ],
    edges: [],
  });
  return {
    graph,
    policyVersion: 'SR-POLICY-v1',
    productionPhase: 'PREFLIGHT',
    activities: [
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
    activityStates: [
      { activityId: GOTHIC, state: 'PENDING' },
      { activityId: EIXAMPLE, state: 'PENDING' },
      { activityId: STUDIO, state: 'PENDING' },
      { activityId: TRANSFER, state: 'PENDING' },
    ],
    locationConstraints: [
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
      {
        locationId: OTHER_LOCATION,
        access: 'PASSED',
        rights: 'PASSED',
        windowStartLocal: '08:00',
        windowEndLocal: '20:00',
      },
    ],
    approvedFallbacks: [{ activityId: GOTHIC, fallbackLocationId: FALLBACK_LOCATION }],
    approvedBackupPathIds: [BACKUP_PATH],
    equipmentIds: [EQUIPMENT],
    requestableEvidenceScopes: ['DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY'],
    ...overrides,
  };
}

function freezeValue(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const item of Object.values(value)) {
    freezeValue(item);
  }
}

const canonicalPrimitives = [
  { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 30 },
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
  {
    kind: 'REQUEST_MISSING_CONFIRMATION',
    evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
  },
] as const;

describe('intervention primitive schema', () => {
  it('parses all 11 canonical primitive kinds', () => {
    const parsed = canonicalPrimitives.map((primitive) => parseIntervention(primitive));
    expect(parsed.every((result) => result.ok)).toBe(true);
    expect(parsed.map((result) => (result.ok ? result.intervention.kind : result.code))).toEqual(
      INTERVENTION_KINDS,
    );
  });

  it('rejects a 12th unknown mutation kind', () => {
    expect(parseIntervention({ kind: 'DELETE_ACTIVITY', activityId: GOTHIC }).ok).toBe(false);
  });

  it('rejects unknown properties on every variant', () => {
    for (const primitive of canonicalPrimitives) {
      expect(parseIntervention({ ...primitive, unexpected: true }).ok).toBe(false);
    }
  });

  it('enforces numeric bounds exactly', () => {
    expect(
      parseIntervention({ kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: -120 }).ok,
    ).toBe(true);
    expect(
      parseIntervention({ kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 120 }).ok,
    ).toBe(true);
    expect(
      parseIntervention({ kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: -121 }).ok,
    ).toBe(false);
    expect(
      parseIntervention({ kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 121 }).ok,
    ).toBe(false);
    expect(
      parseIntervention({ kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 1.5 }).ok,
    ).toBe(false);
    expect(parseIntervention({ kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 5 }).ok).toBe(
      true,
    );
    expect(
      parseIntervention({ kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 60 }).ok,
    ).toBe(true);
    expect(parseIntervention({ kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 4 }).ok).toBe(
      false,
    );
    expect(
      parseIntervention({ kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 61 }).ok,
    ).toBe(false);
    expect(parseIntervention({ kind: 'ADD_BUFFER', beforeActivityId: GOTHIC, minutes: 5 }).ok).toBe(
      true,
    );
    expect(
      parseIntervention({ kind: 'ADD_BUFFER', beforeActivityId: GOTHIC, minutes: 45 }).ok,
    ).toBe(true);
    expect(parseIntervention({ kind: 'ADD_BUFFER', beforeActivityId: GOTHIC, minutes: 4 }).ok).toBe(
      false,
    );
    expect(
      parseIntervention({ kind: 'ADD_BUFFER', beforeActivityId: GOTHIC, minutes: 46 }).ok,
    ).toBe(false);
    expect(
      parseIntervention({ kind: 'ADJUST_CALL_TIME', personId: PERSON, deltaMinutes: -90 }).ok,
    ).toBe(true);
    expect(
      parseIntervention({ kind: 'ADJUST_CALL_TIME', personId: PERSON, deltaMinutes: 90 }).ok,
    ).toBe(true);
    expect(
      parseIntervention({ kind: 'ADJUST_CALL_TIME', personId: PERSON, deltaMinutes: -91 }).ok,
    ).toBe(false);
    expect(
      parseIntervention({ kind: 'ADJUST_CALL_TIME', personId: PERSON, deltaMinutes: 91 }).ok,
    ).toBe(false);
    expect(
      parseIntervention({
        kind: 'ADJUST_DEPARTURE',
        transferActivityId: TRANSFER,
        deltaMinutes: -90,
      }).ok,
    ).toBe(true);
    expect(
      parseIntervention({
        kind: 'ADJUST_DEPARTURE',
        transferActivityId: TRANSFER,
        deltaMinutes: 90,
      }).ok,
    ).toBe(true);
    expect(
      parseIntervention({
        kind: 'ADJUST_DEPARTURE',
        transferActivityId: TRANSFER,
        deltaMinutes: 91,
      }).ok,
    ).toBe(false);
    expect(
      parseIntervention({
        kind: 'INCREASE_TRANSFER_BUFFER',
        transferActivityId: TRANSFER,
        minutes: 5,
      }).ok,
    ).toBe(true);
    expect(
      parseIntervention({
        kind: 'INCREASE_TRANSFER_BUFFER',
        transferActivityId: TRANSFER,
        minutes: 45,
      }).ok,
    ).toBe(true);
    expect(
      parseIntervention({
        kind: 'INCREASE_TRANSFER_BUFFER',
        transferActivityId: TRANSFER,
        minutes: 4,
      }).ok,
    ).toBe(false);
    expect(parseIntervention({ kind: 'REORDER_ACTIVITIES', activityIds: [GOTHIC] }).ok).toBe(false);
    expect(
      parseIntervention({
        kind: 'REORDER_ACTIVITIES',
        activityIds: [GOTHIC, EIXAMPLE, STUDIO, TRANSFER, 'ACT-EXTRA-01', 'ACT-EXTRA-02'],
      }).ok,
    ).toBe(false);
  });

  it('rejects duplicate activity ids when reordering', () => {
    expect(
      parseIntervention({ kind: 'REORDER_ACTIVITIES', activityIds: [GOTHIC, GOTHIC] }).ok,
    ).toBe(false);
  });

  it('rejects free-form evidence scope prose and accepts structured scope', () => {
    expect(
      parseIntervention({
        kind: 'REQUEST_MISSING_CONFIRMATION',
        evidenceScope: 'Please confirm the model release before the Gothic look.',
      }).ok,
    ).toBe(false);
    expect(
      parseIntervention({
        kind: 'REQUEST_MISSING_CONFIRMATION',
        evidenceScope: 'document:document-model-release:validity',
      }).ok,
    ).toBe(false);
    const parsed = parseIntervention({
      kind: 'REQUEST_MISSING_CONFIRMATION',
      evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
    });
    expect(parsed).toEqual({
      ok: true,
      intervention: {
        kind: 'REQUEST_MISSING_CONFIRMATION',
        evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
      },
    });
  });
});

describe('intervention reversibility descriptors', () => {
  it('covers exactly the 11 canonical kinds with deterministic metadata', () => {
    expect(INTERVENTION_KINDS).toEqual([
      'SHIFT_ACTIVITY',
      'SHORTEN_ACTIVITY',
      'REORDER_ACTIVITIES',
      'ADD_BUFFER',
      'ADJUST_CALL_TIME',
      'ACTIVATE_BACKUP_KIT',
      'REQUIRE_REVERIFICATION',
      'SWITCH_TO_APPROVED_FALLBACK',
      'ADJUST_DEPARTURE',
      'INCREASE_TRANSFER_BUFFER',
      'REQUEST_MISSING_CONFIRMATION',
    ]);
    expect(REVERSIBILITY_CLASSES).toEqual([
      'REVERSIBLE_BY_NEW_REVISION',
      'CORRECTIVE_ACTION_REQUIRED',
      'IRREVERSIBLE',
    ]);
    expect(INTERVENTION_DESCRIPTORS.map((descriptor) => descriptor.kind)).toEqual([
      ...INTERVENTION_KINDS,
    ]);
    expect(new Set(INTERVENTION_DESCRIPTORS.map((descriptor) => descriptor.kind)).size).toBe(11);
    expect(
      INTERVENTION_DESCRIPTORS.filter((descriptor) => descriptor.reversibility === 'IRREVERSIBLE'),
    ).toEqual([]);
    expect(
      INTERVENTION_DESCRIPTORS.find((descriptor) => descriptor.kind === 'REQUIRE_REVERIFICATION')
        ?.reversibility,
    ).toBe('CORRECTIVE_ACTION_REQUIRED');
    expect(
      INTERVENTION_DESCRIPTORS.find(
        (descriptor) => descriptor.kind === 'REQUEST_MISSING_CONFIRMATION',
      )?.reversibility,
    ).toBe('CORRECTIVE_ACTION_REQUIRED');
    expect(
      INTERVENTION_DESCRIPTORS.filter(
        (descriptor) => descriptor.reversibility === 'REVERSIBLE_BY_NEW_REVISION',
      ).map((descriptor) => descriptor.kind),
    ).toEqual([
      'SHIFT_ACTIVITY',
      'SHORTEN_ACTIVITY',
      'REORDER_ACTIVITIES',
      'ADD_BUFFER',
      'ADJUST_CALL_TIME',
      'ACTIVATE_BACKUP_KIT',
      'SWITCH_TO_APPROVED_FALLBACK',
      'ADJUST_DEPARTURE',
      'INCREASE_TRANSFER_BUFFER',
    ]);
    expect(JSON.stringify(INTERVENTION_DESCRIPTORS)).toBe(JSON.stringify(INTERVENTION_DESCRIPTORS));
  });
});

describe('phase-aware intervention policy', () => {
  it('allows a preflight shift inside a confirmed location window', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const decision = validateInterventionPolicy(
      { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 30 },
      baseContext(),
    );
    expect(decision).toEqual({ allowed: true });
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('rejects a completed Gothic activity during EIXAMPLE_ACTIVE', () => {
    const context = baseContext({
      productionPhase: 'EIXAMPLE_ACTIVE',
      activityStates: [
        { activityId: GOTHIC, state: 'COMPLETED' },
        { activityId: EIXAMPLE, state: 'PENDING' },
        { activityId: STUDIO, state: 'PENDING' },
        { activityId: TRANSFER, state: 'PENDING' },
      ],
    });
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'ACTIVITY_IMMUTABLE_AFTER_COMPLETION' });
  });

  it('rejects a mutable activity after production is COMPLETE', () => {
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
        baseContext({ productionPhase: 'COMPLETE' }),
      ),
    ).toEqual({ allowed: false, code: 'PRODUCTION_COMPLETE_IMMUTABLE' });
  });

  it('keeps completed-activity immutability ahead of production completion', () => {
    const context = baseContext({
      productionPhase: 'COMPLETE',
      activityStates: [
        { activityId: GOTHIC, state: 'COMPLETED' },
        { activityId: EIXAMPLE, state: 'PENDING' },
        { activityId: STUDIO, state: 'PENDING' },
        { activityId: TRANSFER, state: 'PENDING' },
      ],
    });
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'ACTIVITY_IMMUTABLE_AFTER_COMPLETION' });
  });

  it('rejects an unknown activity target', () => {
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-MISSING-01', deltaMinutes: 15 },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'TARGET_NOT_FOUND' });
  });

  it('rejects a target with the wrong graph node type', () => {
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: PERSON, deltaMinutes: 15 },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'TARGET_TYPE_MISMATCH' });
  });

  it('rejects shifting or shortening a FIXED activity', () => {
    const context = baseContext({
      activities: baseContext().activities.map((activity) =>
        activity.activityId === GOTHIC ? { ...activity, constraint: 'FIXED' as const } : activity,
      ),
    });
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'FIXED_ACTIVITY_CONSTRAINT' });
    expect(
      validateInterventionPolicy(
        { kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 10 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'FIXED_ACTIVITY_CONSTRAINT' });
  });

  it('rejects reordering when any activity is FIXED', () => {
    expect(
      validateInterventionPolicy(
        { kind: 'REORDER_ACTIVITIES', activityIds: [GOTHIC, STUDIO] },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'FIXED_ACTIVITY_CONSTRAINT' });
  });

  it('rejects buffers and transfer changes that would move a FIXED activity', () => {
    const context = baseContext({
      activities: baseContext().activities.map((activity) =>
        activity.activityId === TRANSFER ? { ...activity, constraint: 'FIXED' as const } : activity,
      ),
    });
    expect(
      validateInterventionPolicy(
        { kind: 'ADD_BUFFER', beforeActivityId: STUDIO, minutes: 10 },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'FIXED_ACTIVITY_CONSTRAINT' });
    expect(
      validateInterventionPolicy(
        { kind: 'ADJUST_DEPARTURE', transferActivityId: TRANSFER, deltaMinutes: 10 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'FIXED_ACTIVITY_CONSTRAINT' });
    expect(
      validateInterventionPolicy(
        { kind: 'INCREASE_TRANSFER_BUFFER', transferActivityId: TRANSFER, minutes: 10 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'FIXED_ACTIVITY_CONSTRAINT' });
  });

  it('rejects location access that is not PASSED', () => {
    for (const access of ['FAILED', 'UNRESOLVED'] as const) {
      const context = baseContext({
        locationConstraints: baseContext().locationConstraints.map((constraint) =>
          constraint.locationId === GOTHIC_LOCATION ? { ...constraint, access } : constraint,
        ),
      });
      expect(
        validateInterventionPolicy(
          { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
          context,
        ),
      ).toEqual({ allowed: false, code: 'LOCATION_ACCESS_NOT_CONFIRMED' });
    }
  });

  it('rejects location rights that are not PASSED', () => {
    for (const rights of ['FAILED', 'UNRESOLVED'] as const) {
      const context = baseContext({
        locationConstraints: baseContext().locationConstraints.map((constraint) =>
          constraint.locationId === GOTHIC_LOCATION ? { ...constraint, rights } : constraint,
        ),
      });
      expect(
        validateInterventionPolicy(
          { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
          context,
        ),
      ).toEqual({ allowed: false, code: 'RIGHTS_NOT_CONFIRMED' });
    }
  });

  it('rejects a proposed shift outside the location window', () => {
    const context = baseContext({
      locationConstraints: baseContext().locationConstraints.map((constraint) =>
        constraint.locationId === GOTHIC_LOCATION
          ? { ...constraint, windowEndLocal: '12:00' }
          : constraint,
      ),
    });
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 90 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'LOCATION_WINDOW_VIOLATION' });
  });

  it('rejects a proposed shift that crosses the local-day boundary', () => {
    const context = baseContext({
      activities: baseContext().activities.map((activity) =>
        activity.activityId === GOTHIC
          ? { ...activity, startLocal: '23:00', endLocal: '23:30' }
          : activity,
      ),
    });
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 60 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'DAY_BOUNDARY_CROSSING' });
  });

  it('allows only an exact approved fallback with confirmed access and rights', () => {
    expect(
      validateInterventionPolicy(
        {
          kind: 'SWITCH_TO_APPROVED_FALLBACK',
          activityId: GOTHIC,
          fallbackLocationId: FALLBACK_LOCATION,
        },
        baseContext(),
      ),
    ).toEqual({ allowed: true });
    expect(
      validateInterventionPolicy(
        {
          kind: 'SWITCH_TO_APPROVED_FALLBACK',
          activityId: GOTHIC,
          fallbackLocationId: OTHER_LOCATION,
        },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'FALLBACK_NOT_APPROVED' });
    for (const access of ['FAILED', 'UNRESOLVED'] as const) {
      const context = baseContext({
        locationConstraints: baseContext().locationConstraints.map((constraint) =>
          constraint.locationId === FALLBACK_LOCATION ? { ...constraint, access } : constraint,
        ),
      });
      expect(
        validateInterventionPolicy(
          {
            kind: 'SWITCH_TO_APPROVED_FALLBACK',
            activityId: GOTHIC,
            fallbackLocationId: FALLBACK_LOCATION,
          },
          context,
        ),
      ).toEqual({ allowed: false, code: 'LOCATION_ACCESS_NOT_CONFIRMED' });
    }
  });

  it('requires an approved backup path and known equipment without mutating evidence', () => {
    expect(
      validateInterventionPolicy(
        { kind: 'ACTIVATE_BACKUP_KIT', equipmentPathId: 'RES-UNAPPROVED' },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'TARGET_NOT_FOUND' });
    const context = baseContext();
    const graph = createProductionGraph({
      productionId: context.graph.productionId,
      policyVersion: context.graph.policyVersion,
      fixtureVersion: context.graph.fixtureVersion,
      nodes: [...context.graph.nodes, createGraphNode('RES-UNAPPROVED', 'RESOURCE')],
      edges: [],
    });
    expect(
      validateInterventionPolicy(
        { kind: 'ACTIVATE_BACKUP_KIT', equipmentPathId: 'RES-UNAPPROVED' },
        { ...context, graph },
      ),
    ).toEqual({ allowed: false, code: 'BACKUP_PATH_NOT_APPROVED' });
    expect(
      validateInterventionPolicy(
        { kind: 'REQUIRE_REVERIFICATION', equipmentId: 'EQUIPMENT-MISSING' },
        context,
      ),
    ).toEqual({ allowed: false, code: 'TARGET_NOT_FOUND' });
    expect(
      validateInterventionPolicy(
        { kind: 'REQUIRE_REVERIFICATION', equipmentId: BACKUP_PATH },
        context,
      ),
    ).toEqual({ allowed: false, code: 'EQUIPMENT_NOT_KNOWN' });
  });

  it('requires a PERSON target for call-time adjustment', () => {
    expect(
      validateInterventionPolicy(
        { kind: 'ADJUST_CALL_TIME', personId: PERSON, deltaMinutes: -10 },
        baseContext(),
      ),
    ).toEqual({ allowed: true });
    expect(
      validateInterventionPolicy(
        { kind: 'ADJUST_CALL_TIME', personId: GOTHIC, deltaMinutes: -10 },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'TARGET_TYPE_MISMATCH' });
    expect(
      validateInterventionPolicy(
        { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MISSING', deltaMinutes: -10 },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'TARGET_NOT_FOUND' });
  });

  it('rejects shortening that would leave a non-positive duration', () => {
    const context = baseContext({
      activities: baseContext().activities.map((activity) =>
        activity.activityId === GOTHIC
          ? { ...activity, startLocal: '10:00', endLocal: '10:10' }
          : activity,
      ),
    });
    expect(
      validateInterventionPolicy(
        { kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 10 },
        context,
      ),
    ).toEqual({ allowed: false, code: 'DURATION_NOT_POSITIVE' });
    expect(
      validateInterventionPolicy(
        { kind: 'SHORTEN_ACTIVITY', activityId: GOTHIC, minutes: 5 },
        context,
      ),
    ).toEqual({ allowed: true });
  });

  it('returns the same decision when policy-context arrays are reversed', () => {
    const context = baseContext();
    const reversed: InterventionPolicyContext = {
      ...context,
      activities: [...context.activities].reverse(),
      activityStates: [...context.activityStates].reverse(),
      locationConstraints: [...context.locationConstraints].reverse(),
      approvedFallbacks: [...context.approvedFallbacks].reverse(),
      approvedBackupPathIds: [...context.approvedBackupPathIds].reverse(),
      equipmentIds: [...context.equipmentIds].reverse(),
      requestableEvidenceScopes: [...context.requestableEvidenceScopes].reverse(),
    };
    const intervention = { kind: 'SHIFT_ACTIVITY' as const, activityId: GOTHIC, deltaMinutes: 30 };
    expect(JSON.stringify(validateInterventionPolicy(intervention, reversed))).toBe(
      JSON.stringify(validateInterventionPolicy(intervention, context)),
    );
  });

  it('does not mutate the graph, context, or intervention', () => {
    const context = baseContext();
    const intervention = { kind: 'SHIFT_ACTIVITY' as const, activityId: GOTHIC, deltaMinutes: 30 };
    freezeValue(context);
    freezeValue(intervention);
    const before = JSON.stringify({ context, intervention });
    validateInterventionPolicy(intervention, context);
    expect(JSON.stringify({ context, intervention })).toBe(before);
  });

  it('allows a canonical requestable evidence scope', () => {
    expect(
      validateInterventionPolicy(
        {
          kind: 'REQUEST_MISSING_CONFIRMATION',
          evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        },
        baseContext(),
      ),
    ).toEqual({ allowed: true });
  });

  it('rejects a syntactically valid evidence scope that is not requestable', () => {
    expect(
      validateInterventionPolicy(
        {
          kind: 'REQUEST_MISSING_CONFIRMATION',
          evidenceScope: 'DOCUMENT:DOCUMENT-DOES-NOT-EXIST:VALIDITY',
        },
        baseContext(),
      ),
    ).toEqual({ allowed: false, code: 'EVIDENCE_SCOPE_NOT_REQUESTABLE' });
  });

  it('rejects the canonical scope when no evidence scopes are requestable', () => {
    expect(
      validateInterventionPolicy(
        {
          kind: 'REQUEST_MISSING_CONFIRMATION',
          evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        },
        baseContext({ requestableEvidenceScopes: [] }),
      ),
    ).toEqual({ allowed: false, code: 'EVIDENCE_SCOPE_NOT_REQUESTABLE' });
  });

  it('returns the same confirmation decision when requestable scopes are reversed', () => {
    const context = baseContext({
      requestableEvidenceScopes: [
        'WEATHER:WINDOW:DRIFT',
        'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
      ],
    });
    const reversed = baseContext({
      requestableEvidenceScopes: [
        'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        'WEATHER:WINDOW:DRIFT',
      ],
    });
    const intervention = {
      kind: 'REQUEST_MISSING_CONFIRMATION' as const,
      evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
    };
    expect(JSON.stringify(validateInterventionPolicy(intervention, reversed))).toBe(
      JSON.stringify(validateInterventionPolicy(intervention, context)),
    );
  });

  it('treats duplicate requestable scopes as the same allowlist', () => {
    const intervention = {
      kind: 'REQUEST_MISSING_CONFIRMATION' as const,
      evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
    };
    const once = validateInterventionPolicy(intervention, baseContext());
    const duplicated = validateInterventionPolicy(
      intervention,
      baseContext({
        requestableEvidenceScopes: [
          'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
          'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        ],
      }),
    );
    expect(JSON.stringify(duplicated)).toBe(JSON.stringify(once));
    expect(duplicated).toEqual({ allowed: true });
  });

  it('rejects a requestable scope after production is COMPLETE', () => {
    expect(
      validateInterventionPolicy(
        {
          kind: 'REQUEST_MISSING_CONFIRMATION',
          evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
        },
        baseContext({ productionPhase: 'COMPLETE' }),
      ),
    ).toEqual({ allowed: false, code: 'PRODUCTION_COMPLETE_IMMUTABLE' });
  });

  it('does not mutate a confirmation request or its requestable scopes', () => {
    const context = baseContext();
    const intervention = {
      kind: 'REQUEST_MISSING_CONFIRMATION' as const,
      evidenceScope: 'DOCUMENT:DOCUMENT-MODEL-RELEASE:VALIDITY',
    };
    freezeValue(context);
    freezeValue(intervention);
    const before = JSON.stringify({ context, intervention });
    validateInterventionPolicy(intervention, context);
    expect(JSON.stringify({ context, intervention })).toBe(before);
  });

  it('rejects a policy version other than SR-POLICY-v1', () => {
    expect(
      validateInterventionPolicy(
        { kind: 'SHIFT_ACTIVITY', activityId: GOTHIC, deltaMinutes: 15 },
        baseContext({ policyVersion: 'SR-POLICY-v2' }),
      ),
    ).toEqual({ allowed: false, code: 'POLICY_VERSION_MISMATCH' });
  });
});

describe('intervention source authority', () => {
  it('exposes no clock, random, UUID, execution, approval, or network surface', async () => {
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const sources = await Promise.all(
      ['primitives.ts', 'schema.ts', 'policy.ts', 'index.ts'].map((fileName) =>
        readFile(join(sourceDir, fileName), 'utf8'),
      ),
    );
    const joined = sources.join('\n');
    expect(joined).not.toMatch(/Date\.now\s*\(/);
    expect(joined).not.toMatch(/new Date\s*\(/);
    expect(joined).not.toMatch(/Math\.random\s*\(/);
    expect(joined).not.toMatch(/randomUUID/);
    expect(joined).not.toMatch(/\buuid\b/i);
    expect(joined).not.toMatch(/\bfetch\s*\(/);
    expect(joined).not.toMatch(/bedrock/i);
    expect(joined).not.toMatch(/@aws-sdk/);
    expect(joined).not.toMatch(/function execute/);
    expect(joined).not.toMatch(/approveIntervention/);
    expect(joined).not.toMatch(/sendNotification/);
    expect(joined).not.toMatch(/@sceneready\/evidence/);
    expect(joined).not.toMatch(/@sceneready\/readiness-engine/);
    expect(joined).not.toMatch(/@sceneready\/shadow-simulation/);
    expect(joined).not.toMatch(/@sceneready\/agent/);
  });
});
