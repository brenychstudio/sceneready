import { readFileSync } from 'node:fs';

import { graphRevisionReferenceId, type RecoveryCandidate } from '@sceneready/agent';
import { describe, expect, it } from 'vitest';

import {
  MAX_TOOL_ITERATIONS,
  PINNED_MODEL_ID,
  PINNED_REGION,
  REASONING_MAX_TOKENS,
  RECOVERY_MAX_TOKENS,
  assertPinnedModel,
  pinnedBedrockConfig,
} from './bedrock-model.js';
import { StrandsRecoveryComposer } from './strands-recovery-composer.js';
import { BoundedToolIterationHandler, reasonWithPinnedModel } from './strands-reasoning.js';
import {
  AI_TOOL_NAMES,
  assertAiToolsHaveNoAuthority,
  createAiTools,
  type ReadOnlyProductionFacts,
} from './tool-source.js';

const CURRENT_EVIDENCE = 'EVIDENCE:CURRENT';
const CURRENT_TEXT = 'Current readiness is recorded.';
const CURRENT_SUMMARY = 'Current readiness is explained from recorded evidence.';
const FORBIDDEN_TOOL_NAMES = [
  'confirm_active_proposal',
  'execute_revision',
  'write_production_state',
] as const;

function currentContext() {
  const revision = graphRevisionReferenceId(4);
  return {
    graphRevision: 4,
    validReferences: [
      { referenceId: revision, kind: 'GRAPH_REVISION' },
      { referenceId: CURRENT_EVIDENCE, kind: 'EVIDENCE' },
    ],
    allowedClaims: [
      {
        statementId: 'current-readiness',
        text: CURRENT_TEXT,
        requiredReferences: [CURRENT_EVIDENCE, revision],
      },
    ],
    allowedSummaries: [CURRENT_SUMMARY],
    allowedTradeOffs: [],
    ranking: null,
  };
}

function currentOutput() {
  const revision = graphRevisionReferenceId(4);
  return {
    summary: CURRENT_SUMMARY,
    claims: [
      {
        claimId: 'current-readiness',
        text: CURRENT_TEXT,
        references: [CURRENT_EVIDENCE, revision],
      },
    ],
    recommendationOptionId: null,
    disclosedTradeOffs: [],
  };
}

function compositionInput() {
  return {
    productionId: 'BCN-DEMO-01',
    objective: 'Restore the next departure.',
    recoveryContext: {
      productionId: 'BCN-DEMO-01',
      facts: {},
    },
  };
}

function fallbackCandidates(): readonly RecoveryCandidate[] {
  return [{ optionId: 'OPTION-A', interventions: [] }];
}

describe('pinned Sonnet recovery reasoning', () => {
  it('pins Sonnet 5 effort without sampling, failover, or a fast-path model call', () => {
    const reasoning = pinnedBedrockConfig('REASONING');
    const recovery = pinnedBedrockConfig('RECOVERY_PLANNING');
    expect(reasoning).toMatchObject({
      region: PINNED_REGION,
      modelId: PINNED_MODEL_ID,
      maxTokens: REASONING_MAX_TOKENS,
      additionalRequestFields: {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
      },
    });
    expect(recovery).toMatchObject({
      region: PINNED_REGION,
      modelId: PINNED_MODEL_ID,
      maxTokens: RECOVERY_MAX_TOKENS,
      additionalRequestFields: {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
      },
    });
    for (const config of [reasoning, recovery]) {
      const encoded = JSON.stringify(config);
      expect(encoded).not.toContain('temperature');
      expect(encoded).not.toContain('topP');
      expect(encoded).not.toContain('top_k');
      expect(encoded).not.toContain('disabled');
      expect(encoded).not.toContain('additionalArgs');
    }
    expect(() => pinnedBedrockConfig('FAST_OPERATIONAL')).toThrow(/fast operational path/);
    expect(() => assertPinnedModel('eu.anthropic.claude-sonnet-4')).toThrow(
      /pinned model rejected substitution/,
    );
    const configSource = readFileSync(
      new URL('../../../../infrastructure/cdk/src/config.ts', import.meta.url),
      'utf8',
    );
    expect(configSource).toContain(`'${PINNED_MODEL_ID}'`);
    expect(configSource).toContain("AWS_REGION = 'eu-west-1'");
  });

  it('bounds tool iterations at four and does not construct a model client', () => {
    const handler = new BoundedToolIterationHandler();
    for (let call = 1; call <= MAX_TOOL_ITERATIONS; call += 1) {
      expect(handler.beforeToolCall()).toEqual({ type: 'proceed' });
    }
    expect(handler.beforeToolCall()).toEqual({
      type: 'deny',
      reason: 'tool iteration limit reached',
    });
    for (const name of [
      'bedrock-model.ts',
      'strands-reasoning.ts',
      'strands-recovery-composer.ts',
      'tool-source.ts',
    ]) {
      const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
      expect(source).not.toContain('new BedrockModel');
      expect(source).not.toContain('new Agent');
    }
  });

  it('regenerates one invalid response and then accepts grounded JSON', async () => {
    const prompts: string[] = [];
    const valid = JSON.stringify(currentOutput());
    const result = await reasonWithPinnedModel({
      path: 'REASONING',
      prompt: 'Explain current readiness.',
      context: currentContext(),
      complete: (prompt) => {
        prompts.push(prompt);
        return Promise.resolve(prompts.length === 1 ? '{"not":"grounded"}' : valid);
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('grounded JSON only');
    expect(result.status).toBe('GROUNDED');
    if (result.status === 'GROUNDED') {
      expect(result.output.summary).toBe(CURRENT_SUMMARY);
    }
  });

  it('falls back after the single regeneration is still ungrounded', async () => {
    let calls = 0;
    const result = await reasonWithPinnedModel({
      path: 'RECOVERY_PLANNING',
      prompt: 'Plan recovery.',
      context: currentContext(),
      complete: () => {
        calls += 1;
        return Promise.resolve('not-json');
      },
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ status: 'DETERMINISTIC_FALLBACK', path: 'RECOVERY_PLANNING' });
  });

  it('reports temporary unavailability when the model call fails', async () => {
    let calls = 0;
    const result = await reasonWithPinnedModel({
      path: 'REASONING',
      prompt: 'Explain current readiness.',
      context: currentContext(),
      complete: () => {
        calls += 1;
        return Promise.reject(new Error('network'));
      },
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ status: 'TEMPORARILY_UNAVAILABLE', path: 'REASONING' });
  });

  it('explains recovery from the caller candidates and throws when the model is unavailable', async () => {
    const fallback = fallbackCandidates();
    const grounded = new StrandsRecoveryComposer(
      () => Promise.resolve(JSON.stringify(currentOutput())),
      currentContext(),
      fallback,
    );
    await expect(grounded.compose(compositionInput())).resolves.toBe(fallback);

    const unavailable = new StrandsRecoveryComposer(
      () => Promise.reject(new Error('network')),
      currentContext(),
      fallback,
    );
    await expect(unavailable.compose(compositionInput())).rejects.toThrow(
      'TEMPORARILY_UNAVAILABLE',
    );
  });

  it('exposes only read, analyze, simulate, compose, and explain tools', async () => {
    const seen: string[] = [];
    const facts: ReadOnlyProductionFacts = {
      readProduction: (productionId) => {
        seen.push(`read:${productionId}`);
        return Promise.resolve('read');
      },
      analyzeRecovery: (productionId) => {
        seen.push(`analyze:${productionId}`);
        return Promise.resolve('analyze');
      },
      simulateOption: (optionId) => {
        seen.push(`simulate:${optionId}`);
        return Promise.resolve('simulate');
      },
      composeExplanation: (productionId) => {
        seen.push(`compose:${productionId}`);
        return Promise.resolve('compose');
      },
      explainRisk: (riskId) => {
        seen.push(`risk:${riskId}`);
        return Promise.resolve('risk');
      },
    };
    const tools = createAiTools(facts);
    expect(tools.map((entry) => entry.name)).toEqual([...AI_TOOL_NAMES]);
    assertAiToolsHaveNoAuthority(tools.map((entry) => entry.name));
    for (const name of FORBIDDEN_TOOL_NAMES) {
      expect(AI_TOOL_NAMES).not.toContain(name);
      expect(() => assertAiToolsHaveNoAuthority([name])).toThrow(name);
    }
    const source = readFileSync(new URL('./tool-source.ts', import.meta.url), 'utf8');
    for (const name of FORBIDDEN_TOOL_NAMES) {
      expect(source).not.toContain(`name: '${name}'`);
    }
    await tools[0]?.invoke({ productionId: 'BCN-DEMO-01' });
    await tools[1]?.invoke({ productionId: 'BCN-DEMO-01' });
    await tools[2]?.invoke({ optionId: 'OPTION-A' });
    await tools[3]?.invoke({ productionId: 'BCN-DEMO-01' });
    await tools[4]?.invoke({ riskId: 'RISK-1' });
    expect(seen).toEqual([
      'read:BCN-DEMO-01',
      'analyze:BCN-DEMO-01',
      'simulate:OPTION-A',
      'compose:BCN-DEMO-01',
      'risk:RISK-1',
    ]);
  });
});
