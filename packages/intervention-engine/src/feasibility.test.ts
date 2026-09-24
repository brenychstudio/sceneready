import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ActivityWindowConstraint, FeasibilityActivityView } from './constraints.js';
import {
  evaluateInterventionFeasibility,
  type FeasibilityRiskTransitionView,
  type FeasibilitySimulationView,
  type RecoveryFeasibilityPolicy,
} from './feasibility.js';

const CANONICAL_POLICY: RecoveryFeasibilityPolicy = {
  maxIntroducedCriticalRisks: 0,
  maxIntroducedHighRisks: 1,
};

function activity(overrides: Partial<FeasibilityActivityView> = {}): FeasibilityActivityView {
  return {
    activityId: 'ACT-GOTHIC-SETUP',
    startMinute: 7 * 60 + 10,
    endMinute: 7 * 60 + 20,
    locationId: 'LOC-GOTHIC',
    bufferBeforeMinutes: 0,
    transferBufferMinutes: 0,
    ...overrides,
  };
}

function gothicWindow(overrides: Partial<ActivityWindowConstraint> = {}): ActivityWindowConstraint {
  return {
    kind: 'ACTIVITY_WITHIN_WINDOW',
    constraintId: 'GOTHIC_ACCESS_WINDOW',
    activityId: 'ACT-GOTHIC-SETUP',
    locationId: 'LOC-GOTHIC',
    windowStartMinute: 6 * 60,
    windowEndMinute: 9 * 60,
    ...overrides,
  };
}

function risk(
  afterSeverity: FeasibilityRiskTransitionView['afterSeverity'],
  beforeSeverity: FeasibilityRiskTransitionView['beforeSeverity'] = null,
  riskId = `RISK-${afterSeverity ?? 'NONE'}-${beforeSeverity ?? 'NEW'}`,
): FeasibilityRiskTransitionView {
  return {
    riskId,
    incidentId: 'INCIDENT-1',
    subjectId: 'ACT-GOTHIC-SETUP',
    beforeSeverity,
    afterSeverity,
  };
}

function simulation(
  options: {
    readonly activities?: readonly FeasibilityActivityView[];
    readonly failedGatesIntroduced?: readonly string[];
    readonly introducedRisks?: readonly FeasibilityRiskTransitionView[];
  } = {},
): FeasibilitySimulationView {
  return {
    comparison: { failedGatesIntroduced: options.failedGatesIntroduced ?? [] },
    introducedRisks: options.introducedRisks ?? [],
    shadowGraph: { operational: { activities: options.activities ?? [activity()] } },
  };
}

function evaluate(
  view: FeasibilitySimulationView = simulation(),
  constraints: readonly ActivityWindowConstraint[] = [gothicWindow()],
  policy: RecoveryFeasibilityPolicy = CANONICAL_POLICY,
) {
  return evaluateInterventionFeasibility(view, constraints, policy);
}

describe('evaluateInterventionFeasibility', () => {
  it('accepts an option that introduces no hard failure', () => {
    expect(evaluate()).toEqual({ viable: true, reasons: [] });
  });

  it('rejects a shadow activity that leaves the trusted access window', () => {
    const result = evaluate(simulation({ activities: [activity({ endMinute: 10 * 60 })] }));
    expect(result.viable).toBe(false);
    expect(result.reasons).toEqual(['GOTHIC_ACCESS_WINDOW_VIOLATION']);
  });

  it('rejects an option that introduces a failed hard gate', () => {
    const result = evaluate(simulation({ failedGatesIntroduced: ['STUDIO_AVAILABILITY'] }));
    expect(result).toEqual({
      viable: false,
      reasons: ['INTRODUCES_FAILED_HARD_GATE'],
    });
  });

  it('does not reject a gate that was already failed before the option', () => {
    expect(evaluate(simulation({ failedGatesIntroduced: [] }))).toEqual({
      viable: true,
      reasons: [],
    });
  });

  it('rejects one introduced critical risk when the limit is zero', () => {
    const result = evaluate(simulation({ introducedRisks: [risk('CRITICAL')] }));
    expect(result).toEqual({
      viable: false,
      reasons: ['INTRODUCES_TOO_MANY_CRITICAL_RISKS'],
    });
  });

  it('allows one introduced high risk at the canonical limit', () => {
    expect(evaluate(simulation({ introducedRisks: [risk('HIGH')] }))).toEqual({
      viable: true,
      reasons: [],
    });
  });

  it('rejects two introduced high risks above the canonical limit', () => {
    const result = evaluate(
      simulation({
        introducedRisks: [risk('HIGH', null, 'RISK-A'), risk('HIGH', null, 'RISK-B')],
      }),
    );
    expect(result).toEqual({
      viable: false,
      reasons: ['INTRODUCES_TOO_MANY_HIGH_RISKS'],
    });
  });

  it('counts a risk worsened to high against the high-risk limit', () => {
    const result = evaluate(
      simulation({ introducedRisks: [risk('HIGH', 'MEDIUM')] }),
      [gothicWindow()],
      { maxIntroducedCriticalRisks: 0, maxIntroducedHighRisks: 0 },
    );
    expect(result).toEqual({
      viable: false,
      reasons: ['INTRODUCES_TOO_MANY_HIGH_RISKS'],
    });
  });

  it('does not spend the introduced-risk budget on an unchanged high risk', () => {
    expect(evaluate(simulation({ introducedRisks: [] }))).toEqual({
      viable: true,
      reasons: [],
    });
  });

  it('does not count a resolved or reduced risk as introduced', () => {
    const result = evaluate(
      simulation({
        introducedRisks: [
          risk('LOW', 'CRITICAL', 'RISK-REDUCED'),
          risk(null, 'CRITICAL', 'RISK-REMOVED'),
        ],
      }),
    );
    expect(result).toEqual({ viable: true, reasons: [] });
  });

  it('rejects a leading buffer that occupies time outside the window', () => {
    const result = evaluate(
      simulation({
        activities: [activity({ startMinute: 6 * 60 + 10, bufferBeforeMinutes: 20 })],
      }),
    );
    expect(result.reasons).toEqual(['GOTHIC_ACCESS_WINDOW_VIOLATION']);
  });

  it('rejects a transfer buffer that occupies time outside the window', () => {
    const result = evaluate(
      simulation({
        activities: [activity({ endMinute: 8 * 60 + 50, transferBufferMinutes: 20 })],
      }),
    );
    expect(result.reasons).toEqual(['GOTHIC_ACCESS_WINDOW_VIOLATION']);
  });

  it('fails closed when the constrained activity is missing', () => {
    const result = evaluate(simulation({ activities: [] }));
    expect(result).toEqual({
      viable: false,
      reasons: ['FEASIBILITY_CONSTRAINT_TARGET_MISSING'],
    });
  });

  it('fails closed for a malformed activity window', () => {
    expect(evaluate(simulation(), [gothicWindow({ windowStartMinute: -1 })])).toEqual({
      viable: false,
      reasons: ['INVALID_FEASIBILITY_CONSTRAINT'],
    });
    expect(evaluate(simulation(), [gothicWindow({ windowEndMinute: 24 * 60 + 1 })])).toEqual({
      viable: false,
      reasons: ['INVALID_FEASIBILITY_CONSTRAINT'],
    });
    expect(
      evaluate(simulation(), [gothicWindow({ windowStartMinute: 500, windowEndMinute: 500 })]),
    ).toEqual({
      viable: false,
      reasons: ['INVALID_FEASIBILITY_CONSTRAINT'],
    });
  });

  it('fails closed when a constraint id is repeated', () => {
    const result = evaluate(simulation(), [
      gothicWindow(),
      gothicWindow({ windowEndMinute: 8 * 60 }),
    ]);
    expect(result).toEqual({
      viable: false,
      reasons: ['INVALID_FEASIBILITY_CONSTRAINT'],
    });
  });

  it('returns the same sorted reasons when semantically irrelevant order changes', () => {
    const studioWindow: ActivityWindowConstraint = {
      kind: 'ACTIVITY_WITHIN_WINDOW',
      constraintId: 'STUDIO_ACCESS_WINDOW',
      activityId: 'ACT-STUDIO-LOAD-IN',
      locationId: 'LOC-STUDIO',
      windowStartMinute: 16 * 60,
      windowEndMinute: 18 * 60,
    };
    const gothic = activity({ endMinute: 10 * 60 });
    const studio = activity({
      activityId: 'ACT-STUDIO-LOAD-IN',
      locationId: 'LOC-STUDIO',
      startMinute: 15 * 60,
      endMinute: 16 * 60,
    });
    const risks = [risk('HIGH', null, 'RISK-B'), risk('HIGH', null, 'RISK-A')];
    const forward = evaluate(
      simulation({
        activities: [gothic, studio],
        failedGatesIntroduced: ['STUDIO_AVAILABILITY'],
        introducedRisks: risks,
      }),
      [gothicWindow(), studioWindow],
    );
    const reversed = evaluate(
      simulation({
        activities: [studio, gothic],
        failedGatesIntroduced: ['STUDIO_AVAILABILITY'],
        introducedRisks: [...risks].reverse(),
      }),
      [studioWindow, gothicWindow()],
    );
    expect(forward.reasons).toEqual([
      'GOTHIC_ACCESS_WINDOW_VIOLATION',
      'INTRODUCES_FAILED_HARD_GATE',
      'INTRODUCES_TOO_MANY_HIGH_RISKS',
      'STUDIO_ACCESS_WINDOW_VIOLATION',
    ]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(new Set(forward.reasons).size).toBe(forward.reasons.length);
  });

  it('does not mutate the simulation view or the constraints', () => {
    const view = simulation({ failedGatesIntroduced: ['STUDIO_AVAILABILITY'] });
    const constraints = [gothicWindow()];
    const before = JSON.stringify({ view, constraints });
    Object.freeze(view);
    Object.freeze(constraints);
    evaluate(view, constraints);
    expect(JSON.stringify({ view, constraints })).toBe(before);
  });

  it('returns every applicable rejection together', () => {
    const result = evaluate(
      simulation({
        activities: [activity({ endMinute: 10 * 60 })],
        failedGatesIntroduced: ['STUDIO_AVAILABILITY'],
        introducedRisks: [risk('HIGH', null, 'RISK-A'), risk('HIGH', null, 'RISK-B')],
      }),
    );
    expect(result.viable).toBe(false);
    expect(result.reasons).toEqual([
      'GOTHIC_ACCESS_WINDOW_VIOLATION',
      'INTRODUCES_FAILED_HARD_GATE',
      'INTRODUCES_TOO_MANY_HIGH_RISKS',
    ]);
  });
});

describe('intervention feasibility boundary', () => {
  it('does not import shadow simulation or hidden authority', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    const forbidden = [
      /@sceneready\/shadow-simulation/,
      /Date\.now/,
      /Math\.random/,
      /randomUUID/,
      /\bfetch\s*\(/,
      /bedrock/i,
      /node:fs/,
      /node:http/,
      /approvalToken/,
      /sendNotification/,
      /\bexecute\s*\(/,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
    const manifest = JSON.parse(readFileSync(join(directory, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@sceneready/domain',
      '@sceneready/production-graph',
      'zod',
    ]);
  });
});
