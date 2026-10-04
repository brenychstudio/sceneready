import type { IntelligencePath } from '@sceneready/agent';
import type { BedrockModelOptions } from '@strands-agents/sdk';

export const PINNED_REGION = 'eu-west-1' as const;
export const PINNED_MODEL_ID = 'eu.anthropic.claude-sonnet-5' as const;
export const MAX_TOOL_ITERATIONS = 4;
export const REASONING_MAX_TOKENS = 1024;
export const RECOVERY_MAX_TOKENS = 2048;

export function assertPinnedModel(modelId: string): void {
  if (modelId !== PINNED_MODEL_ID) {
    throw new Error(`pinned model rejected substitution for ${modelId}`);
  }
}

export function pinnedBedrockConfig(path: IntelligencePath): BedrockModelOptions {
  if (path === 'FAST_OPERATIONAL') {
    throw new Error('fast operational path does not call a model');
  }
  assertPinnedModel(PINNED_MODEL_ID);
  const effort = path === 'RECOVERY_PLANNING' ? 'medium' : 'low';
  return {
    region: PINNED_REGION,
    modelId: PINNED_MODEL_ID,
    maxTokens: path === 'RECOVERY_PLANNING' ? RECOVERY_MAX_TOKENS : REASONING_MAX_TOKENS,
    additionalRequestFields: {
      thinking: { type: 'adaptive' },
      output_config: { effort },
    },
  };
}
