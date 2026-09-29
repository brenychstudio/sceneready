import { describe, expect, it } from 'vitest';

import { evaluateNewRiskIntroduced as evaluateFromBarrel } from './index.js';
import {
  NEW_RISK_INTRODUCED_ALGORITHM_VERSION,
  NEW_RISK_INTRODUCED_ISSUES,
  NEW_RISK_LEVELS,
  evaluateNewRiskIntroduced,
  type NewRiskIntroducedAvailable,
  type NewRiskIntroducedResult,
  type NewRiskLevel,
} from './new-risk-introduced.js';

function risk(riskId: string, severity: string) {
  return { riskId, severity };
}

const OPTION_A_INTRODUCED_RISKS: readonly unknown[] = [];
const OPTION_B_INTRODUCED_RISKS: readonly unknown[] = [];
const OPTION_C_INTRODUCED_RISKS: readonly unknown[] = [];

function available(result: NewRiskIntroducedResult): NewRiskIntroducedAvailable {
  expect(result.status).toBe('AVAILABLE');
  if (result.status !== 'AVAILABLE') {
    throw new Error('expected an available new-risk result');
  }
  return result;
}

function levelOf(risks: unknown): NewRiskLevel {
  return available(evaluateNewRiskIntroduced(risks)).level;
}

function issuesOf(risks: unknown): readonly string[] {
  const result = evaluateNewRiskIntroduced(risks);
  expect(result.status).toBe('WITHHELD');
  if (result.status !== 'WITHHELD') {
    throw new Error('expected a withheld new-risk result');
  }
  expect(result).not.toHaveProperty('level');
  expect(result.algorithmVersion).toBe(NEW_RISK_INTRODUCED_ALGORITHM_VERSION);
  return result.issues;
}

describe('evaluateNewRiskIntroduced classification', () => {
  it('classifies an empty introduced-risk set as NONE', () => {
    expect(available(evaluateNewRiskIntroduced([]))).toEqual({
      status: 'AVAILABLE',
      algorithmVersion: 'SR-NEW-RISK-INTRODUCED-v1',
      level: 'NONE',
    });
    expect([...NEW_RISK_LEVELS]).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });

  it('maps one severity onto itself', () => {
    expect(levelOf([risk('RISK-LOW', 'LOW')])).toBe('LOW');
    expect(levelOf([risk('RISK-MEDIUM', 'MEDIUM')])).toBe('MEDIUM');
    expect(levelOf([risk('RISK-HIGH', 'HIGH')])).toBe('HIGH');
    expect(levelOf([risk('RISK-CRITICAL', 'CRITICAL')])).toBe('CRITICAL');
  });

  it('keeps the worst severity among several introduced risks', () => {
    expect(
      levelOf([risk('RISK-LOW', 'LOW'), risk('RISK-HIGH', 'HIGH'), risk('RISK-MEDIUM', 'MEDIUM')]),
    ).toBe('HIGH');
    expect(levelOf([risk('RISK-LOW', 'LOW'), risk('RISK-CRITICAL', 'CRITICAL')])).toBe('CRITICAL');
  });

  it('dedupes an exact duplicate deterministically', () => {
    expect(levelOf([risk('RISK-LOW', 'LOW'), risk('RISK-LOW', 'LOW')])).toBe('LOW');
  });
});

describe('evaluateNewRiskIntroduced canonical vectors', () => {
  it('scores canonical option A as NONE from an empty introduced-risk set', () => {
    expect(levelOf(OPTION_A_INTRODUCED_RISKS)).toBe('NONE');
  });

  it('scores canonical option B as NONE from an empty introduced-risk set', () => {
    expect(levelOf(OPTION_B_INTRODUCED_RISKS)).toBe('NONE');
  });

  it('scores canonical option C as NONE from an empty introduced-risk set', () => {
    expect(levelOf(OPTION_C_INTRODUCED_RISKS)).toBe('NONE');
  });
});

describe('evaluateNewRiskIntroduced determinism', () => {
  it('is invariant to input order and repeats', () => {
    const risks = [
      risk('RISK-HIGH', 'HIGH'),
      risk('RISK-LOW', 'LOW'),
      risk('RISK-MEDIUM', 'MEDIUM'),
    ];
    const forward = evaluateNewRiskIntroduced(risks);
    const reversed = evaluateNewRiskIntroduced([...risks].reverse());
    const repeated = evaluateNewRiskIntroduced(risks);

    expect(available(forward).level).toBe('HIGH');
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(forward));
  });

  it('freezes the output and does not mutate the input', () => {
    const risks = [risk('RISK-MEDIUM', 'MEDIUM'), risk('RISK-LOW', 'LOW')];
    const before = JSON.stringify(risks);
    for (const entry of risks) {
      Object.freeze(entry);
    }
    Object.freeze(risks);

    const result = available(evaluateNewRiskIntroduced(risks));

    expect(JSON.stringify(risks)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.level).toBe('MEDIUM');
    expect(evaluateFromBarrel).toBe(evaluateNewRiskIntroduced);
  });
});

describe('evaluateNewRiskIntroduced fail closed', () => {
  it('withholds a conflicting duplicate risk id', () => {
    expect(issuesOf([risk('RISK-1', 'LOW'), risk('RISK-1', 'HIGH')])).toEqual(['CONFLICTING_RISK']);
    expect(issuesOf([risk('RISK-1', 'CRITICAL'), risk('RISK-1', 'LOW')])).toEqual([
      'CONFLICTING_RISK',
    ]);
  });

  it('withholds a malformed severity or malformed input', () => {
    expect(() => evaluateNewRiskIntroduced(null)).not.toThrow();
    expect(issuesOf(null)).toEqual(['MALFORMED_INPUT']);
    expect(issuesOf([null])).toEqual(['MALFORMED_INPUT']);
    expect(issuesOf([risk('RISK-1', 'NONE')])).toEqual(['MALFORMED_SEVERITY']);
    expect(issuesOf([risk('RISK-1', 'low')])).toEqual(['MALFORMED_SEVERITY']);
    expect(issuesOf([{ riskId: 'RISK-1' }])).toEqual(['MALFORMED_SEVERITY']);
    expect(issuesOf([risk('', 'LOW')])).toEqual(['MALFORMED_RISK_ID']);
    expect(issuesOf([{ severity: 'LOW' }])).toEqual(['MALFORMED_RISK_ID']);
  });

  it('collects every issue code and freezes the withheld result', () => {
    const issues = issuesOf([
      null,
      risk('', 'NOPE'),
      risk('RISK-1', 'LOW'),
      risk('RISK-1', 'CRITICAL'),
    ]);

    expect(issues).toEqual([...NEW_RISK_INTRODUCED_ISSUES]);
    const withheld = evaluateNewRiskIntroduced([risk('RISK-1', 'NONE')]);
    expect(Object.isFrozen(withheld)).toBe(true);
    if (withheld.status === 'WITHHELD') {
      expect(Object.isFrozen(withheld.issues)).toBe(true);
    }
  });
});
