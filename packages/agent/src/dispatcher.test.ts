import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseIntervention } from '@sceneready/intervention-engine';
import { describe, expect, it } from 'vitest';

import type {
  AuthoritativeChanges,
  AuthoritativeExecutionStatus,
  AuthoritativeReadiness,
  AuthoritativeRecoveryContext,
  AuthoritativeRiskContext,
  RecoveryCompositionInput,
} from './context.js';
import {
  INVALID_INTELLIGENCE_REQUEST,
  INVALID_RECOVERY_COMPOSER_OUTPUT,
  MAX_RECOVERY_OPTIONS,
  RECOVERY_COMPOSER_FAILED,
  dispatchIntelligence,
  type IntelligenceDispatchResult,
  type RecoveryPlanningSuccess,
} from './dispatcher.js';
import { DeterministicRecoveryComposer } from './deterministic-composer.js';
import {
  INTELLIGENCE_PATHS,
  INTELLIGENCE_REQUEST_KINDS,
  type IntelligenceRequest,
  type RecoveryCandidate,
  type RecoveryComposer,
  type SceneReadyStatePort,
} from './ports.js';

const PRODUCTION_ID = 'PROD-CANON-01';
const RISK_ID = 'RISK-CANON-01';
const OBJECTIVE = 'PROTECT_EXTERIOR';

const SHIFT = {
  kind: 'SHIFT_ACTIVITY',
  activityId: 'ACT-EXTERIOR-01',
  deltaMinutes: 30,
} as const;

const BUFFER = {
  kind: 'ADD_BUFFER',
  beforeActivityId: 'ACT-EXTERIOR-01',
  minutes: 15,
} as const;

const REORDER = {
  kind: 'REORDER_ACTIVITIES',
  activityIds: ['ACT-EXTERIOR-01', 'ACT-STUDIO-01'],
} as const;

interface StateCalls {
  readiness: number;
  changes: number;
  execution: number;
  risk: number;
  recovery: number;
  readinessId: string | null;
  changesId: string | null;
  executionId: string | null;
  riskId: string | null;
  riskProductionId: string | null;
  recoveryId: string | null;
}

function emptyCalls(): StateCalls {
  return {
    readiness: 0,
    changes: 0,
    execution: 0,
    risk: 0,
    recovery: 0,
    readinessId: null,
    changesId: null,
    executionId: null,
    riskId: null,
    riskProductionId: null,
    recoveryId: null,
  };
}

function readinessView(): AuthoritativeReadiness {
  return {
    productionId: PRODUCTION_ID,
    facts: {
      certification: 'READY',
      marker: 'AUTHORITATIVE-READINESS',
      window: { start: '10:00', end: '12:00' },
    },
  };
}

function changesView(): AuthoritativeChanges {
  return {
    productionId: PRODUCTION_ID,
    changes: [{ changeId: 'CHG-01', summary: 'call time moved' }],
  };
}

function executionView(): AuthoritativeExecutionStatus {
  return {
    productionId: PRODUCTION_ID,
    facts: { executionState: 'IDLE', revision: 7 },
  };
}

function riskView(): AuthoritativeRiskContext {
  return {
    productionId: PRODUCTION_ID,
    riskId: RISK_ID,
    facts: { severity: 'HIGH', evidenceIds: ['EVIDENCE-01'] },
  };
}

function recoveryView(
  openRiskIds: readonly string[] = ['RISK-CANON-01'],
): AuthoritativeRecoveryContext {
  return {
    productionId: PRODUCTION_ID,
    facts: { phase: 'PRELIGHT', openRiskIds: [...openRiskIds] },
  };
}

function createState(
  calls: StateCalls,
  views: {
    readonly readiness: AuthoritativeReadiness;
    readonly changes: AuthoritativeChanges;
    readonly execution: AuthoritativeExecutionStatus;
    readonly risk: AuthoritativeRiskContext;
    readonly recovery: AuthoritativeRecoveryContext;
  },
): SceneReadyStatePort {
  return {
    async getReadiness(productionId) {
      calls.readiness += 1;
      calls.readinessId = productionId;
      return views.readiness;
    },
    async getChanges(productionId) {
      calls.changes += 1;
      calls.changesId = productionId;
      return views.changes;
    },
    async getExecutionStatus(productionId) {
      calls.execution += 1;
      calls.executionId = productionId;
      return views.execution;
    },
    async getRiskContext(productionId, riskId) {
      calls.risk += 1;
      calls.riskProductionId = productionId;
      calls.riskId = riskId;
      return views.risk;
    },
    async getRecoveryContext(productionId) {
      calls.recovery += 1;
      calls.recoveryId = productionId;
      return views.recovery;
    },
  };
}

function throwingComposer(calls: { count: number }): RecoveryComposer {
  return {
    async compose() {
      calls.count += 1;
      throw new Error('composer must not run');
    },
  };
}

function scriptedComposer(
  candidates: unknown,
  calls: { count: number },
  seen: { input: RecoveryCompositionInput | null },
): RecoveryComposer {
  return {
    async compose(input) {
      calls.count += 1;
      seen.input = input;
      return candidates as readonly RecoveryCandidate[];
    },
  };
}

function candidate(optionId: string, interventions: readonly unknown[] = [SHIFT]): unknown {
  return { optionId, interventions };
}

async function finishOrWait(pending: Promise<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('WAITED'), 500);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function expectCalls(calls: StateCalls, expected: Partial<StateCalls>): void {
  expect(calls).toEqual({ ...emptyCalls(), ...expected });
}

function asSuccess(result: IntelligenceDispatchResult): RecoveryPlanningSuccess {
  expect(result).toMatchObject({ ok: true, path: 'RECOVERY_PLANNING' });
  if (!result.ok || result.path !== 'RECOVERY_PLANNING') {
    throw new Error('expected recovery success');
  }
  return result;
}

describe('tiered intelligence paths', () => {
  it('defines exactly the three canonical paths and request kinds', () => {
    expect([...INTELLIGENCE_PATHS]).toEqual(['FAST_OPERATIONAL', 'REASONING', 'RECOVERY_PLANNING']);
    expect([...INTELLIGENCE_REQUEST_KINDS]).toEqual([
      'GET_READINESS',
      'GET_CHANGES',
      'GET_EXECUTION_STATUS',
      'EXPLAIN_RISK',
      'PLAN_RECOVERY',
    ]);
    expect(MAX_RECOVERY_OPTIONS).toBe(3);
  });

  it('does not infer a path from free text', async () => {
    const calls = emptyCalls();
    const views = {
      readiness: readinessView(),
      changes: changesView(),
      execution: executionView(),
      risk: riskView(),
      recovery: recoveryView(),
    };
    const composerCalls = { count: 0 };
    const state = createState(calls, views);
    const fast = await dispatchIntelligence({ state, composer: throwingComposer(composerCalls) }, {
      kind: 'GET_READINESS',
      productionId: PRODUCTION_ID,
      text: 'please plan recovery and explain the risk',
    } as IntelligenceRequest);
    expect(fast).toMatchObject({ path: 'FAST_OPERATIONAL', requestKind: 'GET_READINESS' });
    const recoveryCalls = { count: 0 };
    const seen = { input: null as RecoveryCompositionInput | null };
    const recovery = await dispatchIntelligence(
      {
        state,
        composer: scriptedComposer([candidate('OPT-1')], recoveryCalls, seen),
      },
      {
        kind: 'PLAN_RECOVERY',
        productionId: PRODUCTION_ID,
        objective: 'please explain the risk and get readiness',
      },
    );
    expect(recovery).toMatchObject({ path: 'RECOVERY_PLANNING', ok: true });
    expect(seen.input?.objective).toBe('please explain the risk and get readiness');
    expect(composerCalls.count).toBe(0);
    expect(recoveryCalls.count).toBe(1);
  });
});

describe('fast operational path', () => {
  function setup() {
    const calls = emptyCalls();
    const views = {
      readiness: readinessView(),
      changes: changesView(),
      execution: executionView(),
      risk: riskView(),
      recovery: recoveryView(),
    };
    const composerCalls = { count: 0 };
    const state = createState(calls, views);
    return { calls, views, composerCalls, state };
  }

  it('returns authoritative readiness without calling the composer', async () => {
    const { calls, views, composerCalls, state } = setup();
    const result = await dispatchIntelligence(
      { state, composer: throwingComposer(composerCalls) },
      { kind: 'GET_READINESS', productionId: PRODUCTION_ID },
    );
    expect(result).toEqual({
      ok: true,
      path: 'FAST_OPERATIONAL',
      requestKind: 'GET_READINESS',
      data: views.readiness,
    });
    if (result.ok && result.path === 'FAST_OPERATIONAL' && result.requestKind === 'GET_READINESS') {
      expect(result.data).toBe(views.readiness);
      expect(result.data.facts.marker).toBe('AUTHORITATIVE-READINESS');
      expect(result.data.facts.window).toEqual({ start: '10:00', end: '12:00' });
    }
    expect(composerCalls.count).toBe(0);
    expectCalls(calls, { readiness: 1, readinessId: PRODUCTION_ID });
  });

  it('returns authoritative changes without calling the composer', async () => {
    const { calls, views, composerCalls, state } = setup();
    const result = await dispatchIntelligence(
      { state, composer: throwingComposer(composerCalls) },
      { kind: 'GET_CHANGES', productionId: PRODUCTION_ID },
    );
    expect(result).toEqual({
      ok: true,
      path: 'FAST_OPERATIONAL',
      requestKind: 'GET_CHANGES',
      data: views.changes,
    });
    if (result.ok && result.path === 'FAST_OPERATIONAL' && result.requestKind === 'GET_CHANGES') {
      expect(result.data).toBe(views.changes);
    }
    expect(composerCalls.count).toBe(0);
    expectCalls(calls, { changes: 1, changesId: PRODUCTION_ID });
  });

  it('returns authoritative execution status without calling the composer', async () => {
    const { calls, views, composerCalls, state } = setup();
    const result = await dispatchIntelligence(
      { state, composer: throwingComposer(composerCalls) },
      { kind: 'GET_EXECUTION_STATUS', productionId: PRODUCTION_ID },
    );
    expect(result).toEqual({
      ok: true,
      path: 'FAST_OPERATIONAL',
      requestKind: 'GET_EXECUTION_STATUS',
      data: views.execution,
    });
    if (
      result.ok &&
      result.path === 'FAST_OPERATIONAL' &&
      result.requestKind === 'GET_EXECUTION_STATUS'
    ) {
      expect(result.data).toBe(views.execution);
      expect(result.data.facts.executionState).toBe('IDLE');
      expect(result.data.facts.revision).toBe(7);
    }
    expect(composerCalls.count).toBe(0);
    expectCalls(calls, { execution: 1, executionId: PRODUCTION_ID });
  });

  it('does not wait for a composer on the fast or reasoning paths', async () => {
    const requests: readonly IntelligenceRequest[] = [
      { kind: 'GET_READINESS', productionId: PRODUCTION_ID },
      { kind: 'GET_CHANGES', productionId: PRODUCTION_ID },
      { kind: 'GET_EXECUTION_STATUS', productionId: PRODUCTION_ID },
      { kind: 'EXPLAIN_RISK', productionId: PRODUCTION_ID, riskId: RISK_ID },
    ];
    for (const request of requests) {
      const { state } = setup();
      let composerCalls = 0;
      const composer: RecoveryComposer = {
        compose() {
          composerCalls += 1;
          return new Promise(() => undefined);
        },
      };
      const outcome = await finishOrWait(dispatchIntelligence({ state, composer }, request));
      expect(outcome).not.toBe('WAITED');
      expect(composerCalls).toBe(0);
    }
  });
});

describe('reasoning path', () => {
  it('returns the authoritative risk context and does not call the composer', async () => {
    const calls = emptyCalls();
    const risk = riskView();
    const state = createState(calls, {
      readiness: readinessView(),
      changes: changesView(),
      execution: executionView(),
      risk,
      recovery: recoveryView(),
    });
    const composerCalls = { count: 0 };
    const result = await dispatchIntelligence(
      { state, composer: throwingComposer(composerCalls) },
      { kind: 'EXPLAIN_RISK', productionId: PRODUCTION_ID, riskId: RISK_ID },
    );
    expect(result).toEqual({
      ok: true,
      path: 'REASONING',
      requestKind: 'EXPLAIN_RISK',
      context: risk,
    });
    if (result.ok && result.path === 'REASONING') {
      expect(result.context).toBe(risk);
      expect(Object.keys(result).sort()).toEqual(['context', 'ok', 'path', 'requestKind']);
      expect(result.context.facts).toEqual({ severity: 'HIGH', evidenceIds: ['EVIDENCE-01'] });
    }
    expect(composerCalls.count).toBe(0);
    expectCalls(calls, {
      risk: 1,
      riskId: RISK_ID,
      riskProductionId: PRODUCTION_ID,
    });
  });

  it('does not invent an explanation string', async () => {
    const calls = emptyCalls();
    const risk = riskView();
    const state = createState(calls, {
      readiness: readinessView(),
      changes: changesView(),
      execution: executionView(),
      risk,
      recovery: recoveryView(),
    });
    const result = await dispatchIntelligence(
      { state, composer: throwingComposer({ count: 0 }) },
      { kind: 'EXPLAIN_RISK', productionId: PRODUCTION_ID, riskId: RISK_ID },
    );
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('explanation');
    expect(result).not.toHaveProperty('narrative');
    expect(result).not.toHaveProperty('completion');
    expect(JSON.stringify(result)).toBe(
      JSON.stringify({
        ok: true,
        path: 'REASONING',
        requestKind: 'EXPLAIN_RISK',
        context: risk,
      }),
    );
  });
});

describe('recovery planning path', () => {
  function setup(candidates: unknown, composer?: RecoveryComposer) {
    const calls = emptyCalls();
    const openRiskIds = ['RISK-CANON-01'];
    const recovery = recoveryView(openRiskIds);
    const state = createState(calls, {
      readiness: readinessView(),
      changes: changesView(),
      execution: executionView(),
      risk: riskView(),
      recovery,
    });
    const composerCalls = { count: 0 };
    const seen = { input: null as RecoveryCompositionInput | null };
    const selected = composer ?? scriptedComposer(candidates, composerCalls, seen);
    return {
      calls,
      recovery,
      openRiskIds,
      composerCalls,
      seen,
      dispatch: (request: IntelligenceRequest) =>
        dispatchIntelligence({ state, composer: selected }, request),
    };
  }

  const plan: IntelligenceRequest = {
    kind: 'PLAN_RECOVERY',
    productionId: PRODUCTION_ID,
    objective: OBJECTIVE,
  };

  it('routes plan recovery and invokes the composer once with bounded context', async () => {
    const liveApprove = () => 'approved';
    const calls = emptyCalls();
    const openRiskIds = ['RISK-CANON-01'];
    const recovery = {
      productionId: PRODUCTION_ID,
      facts: {
        phase: 'PRELIGHT',
        openRiskIds,
        mutate: () => undefined,
      },
      approve: liveApprove,
    };
    const state: SceneReadyStatePort = {
      async getReadiness() {
        calls.readiness += 1;
        return readinessView();
      },
      async getChanges() {
        calls.changes += 1;
        return changesView();
      },
      async getExecutionStatus() {
        calls.execution += 1;
        return executionView();
      },
      async getRiskContext() {
        calls.risk += 1;
        return riskView();
      },
      async getRecoveryContext(productionId) {
        calls.recovery += 1;
        calls.recoveryId = productionId;
        return recovery as unknown as AuthoritativeRecoveryContext;
      },
    };
    const composerCalls = { count: 0 };
    const seen = { input: null as RecoveryCompositionInput | null };
    const result = await dispatchIntelligence(
      {
        state,
        composer: scriptedComposer([candidate('OPT-1', [SHIFT, BUFFER])], composerCalls, seen),
      },
      {
        kind: 'PLAN_RECOVERY',
        productionId: PRODUCTION_ID,
        objective: OBJECTIVE,
        approvalToken: 'must-not-forward',
      } as IntelligenceRequest,
    );
    const success = asSuccess(result);
    expect(success.requestKind).toBe('PLAN_RECOVERY');
    expect(composerCalls.count).toBe(1);
    expectCalls(calls, { recovery: 1, recoveryId: PRODUCTION_ID });
    const input = seen.input;
    expect(input).not.toBeNull();
    if (input === null) {
      return;
    }
    expect(input.productionId).toBe(PRODUCTION_ID);
    expect(input.objective).toBe(OBJECTIVE);
    expect(input).not.toHaveProperty('approvalToken');
    expect(input.recoveryContext).not.toHaveProperty('approve');
    expect(input.recoveryContext.facts).not.toHaveProperty('mutate');
    expect(input.recoveryContext.productionId).toBe(PRODUCTION_ID);
    expect(input.recoveryContext.facts.phase).toBe('PRELIGHT');
    expect(input.recoveryContext.facts.openRiskIds).toEqual(['RISK-CANON-01']);
    expect(input.recoveryContext.facts.openRiskIds).not.toBe(openRiskIds);
    expect(Object.isFrozen(recovery)).toBe(false);
    expect(Object.isFrozen(openRiskIds)).toBe(false);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.recoveryContext)).toBe(true);
    expect(Object.isFrozen(input.recoveryContext.facts)).toBe(true);
    expect(() => {
      (input as { objective: string }).objective = 'OTHER';
    }).toThrow(TypeError);
    const parsedShift = parseIntervention(SHIFT);
    const parsedBuffer = parseIntervention(BUFFER);
    expect(parsedShift.ok).toBe(true);
    expect(parsedBuffer.ok).toBe(true);
    expect(success.options).toHaveLength(1);
    expect(success.options[0]?.interventions).toEqual([
      parsedShift.ok ? parsedShift.intervention : null,
      parsedBuffer.ok ? parsedBuffer.intervention : null,
    ]);
  });

  it('keeps only the first three valid options in composer order', async () => {
    const { dispatch, composerCalls } = setup([
      candidate('OPT-C'),
      candidate('OPT-A'),
      candidate('OPT-E'),
      candidate('OPT-B'),
      candidate('OPT-D'),
    ]);
    const success = asSuccess(await dispatch(plan));
    expect(success.options.map((option) => option.optionId)).toEqual(['OPT-C', 'OPT-A', 'OPT-E']);
    expect(composerCalls.count).toBe(1);
  });

  it('preserves exactly three options', async () => {
    const { dispatch } = setup([candidate('OPT-B'), candidate('OPT-A'), candidate('OPT-C')]);
    const success = asSuccess(await dispatch(plan));
    expect(success.options.map((option) => option.optionId)).toEqual(['OPT-B', 'OPT-A', 'OPT-C']);
  });

  it('preserves fewer than three options', async () => {
    const { dispatch } = setup([candidate('OPT-2'), candidate('OPT-1')]);
    const success = asSuccess(await dispatch(plan));
    expect(success.options.map((option) => option.optionId)).toEqual(['OPT-2', 'OPT-1']);
  });

  it('accepts zero candidates without fabricating options', async () => {
    const { dispatch, composerCalls } = setup([]);
    const success = asSuccess(await dispatch(plan));
    expect(success.options).toEqual([]);
    expect(composerCalls.count).toBe(1);
  });

  it('allows an option with no interventions', async () => {
    const { dispatch } = setup([candidate('OPT-HOLD', [])]);
    const success = asSuccess(await dispatch(plan));
    expect(success.options).toEqual([{ optionId: 'OPT-HOLD', interventions: [] }]);
  });

  it('strips non-authoritative candidate metadata and keeps canonical interventions', async () => {
    const handed = [
      {
        optionId: 'OPT-1',
        interventions: [{ ...SHIFT }],
        readinessScore: 88,
        approvalToken: 'nope',
        recommended: true,
      },
    ];
    const calls = { count: 0 };
    const composer: RecoveryComposer = {
      async compose() {
        calls.count += 1;
        return handed as unknown as readonly RecoveryCandidate[];
      },
    };
    const { dispatch } = setup([], composer);
    const success = asSuccess(await dispatch(plan));
    expect(Object.keys(success.options[0] ?? {})).toEqual(['optionId', 'interventions']);
    expect(handed[0]?.readinessScore).toBe(88);
    expect(handed[0]?.approvalToken).toBe('nope');
    expect(Object.isFrozen(handed[0])).toBe(false);
    expect(calls.count).toBe(1);
    const returned = success.options[0]?.interventions[0];
    expect(returned).not.toBe(handed[0]?.interventions[0]);
    expect(returned).not.toHaveProperty('readinessScore');
  });

  it('fails closed when any primitive is invalid, including past the cap', async () => {
    const cases = [
      [candidate('OPT-1'), candidate('OPT-2', [{ kind: 'DELETE_ACTIVITY', activityId: 'ACT-01' }])],
      [
        candidate('OPT-1'),
        candidate('OPT-2'),
        candidate('OPT-3'),
        candidate('OPT-4', [{ ...SHIFT, unexpected: true }]),
      ],
      [candidate('OPT-1', [{ ...SHIFT, unexpected: true }])],
    ];
    for (const candidates of cases) {
      const { dispatch, composerCalls } = setup(candidates);
      const result = await dispatch(plan);
      expect(result).toEqual({
        ok: false,
        path: 'RECOVERY_PLANNING',
        requestKind: 'PLAN_RECOVERY',
        code: INVALID_RECOVERY_COMPOSER_OUTPUT,
        options: [],
      });
      expect(composerCalls.count).toBe(1);
    }
  });

  it('fails closed on a duplicate option id anywhere in the composer output', async () => {
    const cases = [
      [candidate('OPT-1'), candidate('OPT-1')],
      [candidate('OPT-1'), candidate('OPT-2'), candidate('OPT-3'), candidate('OPT-1')],
    ];
    for (const candidates of cases) {
      const { dispatch } = setup(candidates);
      await expect(dispatch(plan)).resolves.toEqual({
        ok: false,
        path: 'RECOVERY_PLANNING',
        requestKind: 'PLAN_RECOVERY',
        code: INVALID_RECOVERY_COMPOSER_OUTPUT,
        options: [],
      });
    }
  });

  it('fails closed on malformed composer output', async () => {
    const cases: unknown[] = [
      { options: [] },
      null,
      'OPT-1',
      [null],
      [{ interventions: [SHIFT] }],
      [{ optionId: '', interventions: [] }],
      [{ optionId: 'OPT-1' }],
      [{ optionId: 'OPT-1', interventions: 'nope' }],
      [{ optionId: 1, interventions: [] }],
    ];
    for (const candidates of cases) {
      const { dispatch, composerCalls } = setup(candidates);
      await expect(dispatch(plan)).resolves.toMatchObject({
        ok: false,
        code: INVALID_RECOVERY_COMPOSER_OUTPUT,
        options: [],
      });
      expect(composerCalls.count).toBe(1);
    }
  });

  it('fails closed when the composer throws or rejects', async () => {
    const thrown = setup([], {
      async compose() {
        throw new Error('provider down');
      },
    });
    await expect(thrown.dispatch(plan)).resolves.toEqual({
      ok: false,
      path: 'RECOVERY_PLANNING',
      requestKind: 'PLAN_RECOVERY',
      code: RECOVERY_COMPOSER_FAILED,
      options: [],
    });

    let calls = 0;
    const rejected = setup([], {
      compose() {
        calls += 1;
        return Promise.reject(new Error('provider rejected'));
      },
    });
    await expect(rejected.dispatch(plan)).resolves.toMatchObject({
      ok: false,
      code: RECOVERY_COMPOSER_FAILED,
      options: [],
    });
    expect(calls).toBe(1);
  });

  it('freezes recovery results and canonical interventions', async () => {
    const { dispatch } = setup([candidate('OPT-1', [SHIFT, REORDER]), candidate('OPT-HOLD', [])]);
    const success = asSuccess(await dispatch(plan));
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(success.options)).toBe(true);
    const first = success.options[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.interventions)).toBe(true);
    expect(Object.isFrozen(first.interventions[0])).toBe(true);
    const reorder = first.interventions[1];
    expect(reorder?.kind).toBe('REORDER_ACTIVITIES');
    if (reorder?.kind === 'REORDER_ACTIVITIES') {
      expect(Object.isFrozen(reorder.activityIds)).toBe(true);
      expect(() => {
        (reorder.activityIds as string[]).push('ACT-OTHER-01');
      }).toThrow(TypeError);
    }
    expect(() => {
      (success.options as RecoveryCandidate[]).push({
        optionId: 'OPT-X',
        interventions: [],
      });
    }).toThrow(TypeError);
    expect(() => {
      (first as { optionId: string }).optionId = 'OPT-MUTATED';
    }).toThrow(TypeError);
    const failure = await setup([candidate('OPT-1'), candidate('OPT-1')]).dispatch(plan);
    expect(Object.isFrozen(failure)).toBe(true);
    if (!failure.ok && 'path' in failure && failure.path === 'RECOVERY_PLANNING') {
      expect(Object.isFrozen(failure.options)).toBe(true);
    }
  });

  it('does not mutate the composer fixture', async () => {
    const fixture = [
      {
        optionId: 'OPT-1',
        interventions: [{ ...SHIFT }],
      },
    ];
    const before = JSON.stringify(fixture);
    const composer = new DeterministicRecoveryComposer(fixture);
    const { dispatch } = setup([], composer);
    const success = asSuccess(await dispatch(plan));
    expect(JSON.stringify(fixture)).toBe(before);
    expect(Object.isFrozen(fixture)).toBe(false);
    expect(Object.isFrozen(fixture[0])).toBe(false);
    expect(success.options[0]).not.toBe(fixture[0]);
    expect(success.options[0]?.interventions[0]).not.toBe(fixture[0]?.interventions[0]);
  });
});

describe('request validation', () => {
  it('rejects empty identities before calling state or the composer', async () => {
    const calls = emptyCalls();
    const state = createState(calls, {
      readiness: readinessView(),
      changes: changesView(),
      execution: executionView(),
      risk: riskView(),
      recovery: recoveryView(),
    });
    const composerCalls = { count: 0 };
    const requests = [
      { kind: 'GET_READINESS', productionId: '' },
      { kind: 'GET_CHANGES', productionId: '' },
      { kind: 'GET_EXECUTION_STATUS', productionId: '' },
      { kind: 'EXPLAIN_RISK', productionId: PRODUCTION_ID, riskId: '' },
      { kind: 'EXPLAIN_RISK', productionId: PRODUCTION_ID },
      { kind: 'PLAN_RECOVERY', productionId: PRODUCTION_ID, objective: '' },
      { kind: 'PLAN_RECOVERY', productionId: '', objective: OBJECTIVE },
      { kind: 'FREE_TEXT', productionId: PRODUCTION_ID, objective: OBJECTIVE },
      null,
    ] as unknown as readonly IntelligenceRequest[];
    for (const request of requests) {
      const result = await dispatchIntelligence(
        { state, composer: throwingComposer(composerCalls) },
        request,
      );
      expect(result).toEqual({ ok: false, code: INVALID_INTELLIGENCE_REQUEST });
    }
    expect(composerCalls.count).toBe(0);
    expectCalls(calls, {});
  });
});

describe('deterministic recovery composer', () => {
  it('returns independent copies and ignores objective text', async () => {
    const fixture = [
      {
        optionId: 'OPT-1',
        interventions: [{ ...SHIFT }],
        note: 'advisory only',
      },
    ];
    const before = JSON.stringify(fixture);
    const composer = new DeterministicRecoveryComposer(fixture);
    const input: RecoveryCompositionInput = {
      productionId: PRODUCTION_ID,
      objective: OBJECTIVE,
      recoveryContext: recoveryView(),
    };
    const first = await composer.compose(input);
    const second = await composer.compose({ ...input, objective: 'HOLD_CURRENT_PLAN' });
    expect(first).toEqual(second);
    expect(first).toEqual(fixture);
    expect(first[0]).not.toBe(fixture[0]);
    expect(first[0]?.interventions).not.toBe(fixture[0]?.interventions);
    expect(first[0]?.interventions[0]).not.toBe(fixture[0]?.interventions[0]);
    (first[0] as { optionId: string }).optionId = 'CHANGED';
    const third = await composer.compose(input);
    expect(third[0]?.optionId).toBe('OPT-1');
    expect(JSON.stringify(fixture)).toBe(before);
  });
});

describe('agent trust boundary', () => {
  it('keeps recovery composition off projection, scoring, and authority surfaces', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    const forbidden = [
      /Bedrock/,
      /Strands/,
      /bedrock/,
      /strands/,
      /\bfetch\s*\(/,
      /Date\.now/,
      /Math\.random/,
      /randomUUID/,
      /approvalToken/,
      /issueToken/,
      /approveProduction/,
      /executeProduction/,
      /sendNotification/,
      /mutateProduction/,
      /OPTION-A/,
      /BCN-DEMO/,
      /GOTHIC/,
      /PROTECT_EXTERIOR/,
      /RecoveryProjectionPolicy/,
      /RiskProjectionRule/,
      /afterSeverity/,
      /readinessOverride/,
      /recoveryScoreOverride/,
      /simulateShadowProduction/,
      /evaluateInterventionFeasibility/,
      /rankRecoveryOptions/,
      /node:fs/,
      /node:http/,
      /node:net/,
      /node:crypto/,
      /process\.env/,
      /from 'zod'/,
      /SHORTEN_ACTIVITY/,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
    expect(source).toContain('parseIntervention');
    expect(source).toContain("from '@sceneready/intervention-engine'");
    expect(source).not.toContain('intervention-engine/src');
    const specifiers = [...source.matchAll(/@sceneready\/[A-Za-z0-9-]+/g)].map((match) => match[0]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.every((specifier) => specifier === '@sceneready/intervention-engine')).toBe(
      true,
    );

    const repoRoot = join(directory, '..', '..', '..');
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, 'packages/agent/package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({ '@sceneready/intervention-engine': '0.0.0' });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();

    const corePackages = [
      'domain',
      'evidence',
      'production-pack',
      'production-graph',
      'readiness-engine',
      'solar-engine',
      'intervention-engine',
      'shadow-simulation',
      'recovery-ranking',
    ];
    for (const name of corePackages) {
      const packageDirectory = join(repoRoot, 'packages', name);
      const packageManifest = readFileSync(join(packageDirectory, 'package.json'), 'utf8');
      expect(packageManifest).not.toContain('@sceneready/agent');
      expect(readPackageSource(join(packageDirectory, 'src'))).not.toContain('@sceneready/agent');
    }
  });
});

function readPackageSource(directory: string): string {
  const chunks: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') {
        continue;
      }
      chunks.push(readPackageSource(fullPath));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.json')) {
      chunks.push(readFileSync(fullPath, 'utf8'));
    }
  }
  return chunks.join('\n');
}
