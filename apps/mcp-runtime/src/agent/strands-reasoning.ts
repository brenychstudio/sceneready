import { InterventionActions, InterventionHandler } from '@strands-agents/sdk';
import {
  validateGroundedReasoning,
  type GroundedReasoningResult,
  type GroundingAttempt,
} from '@sceneready/agent';

import { MAX_TOOL_ITERATIONS } from './bedrock-model.js';

export const MAX_REGENERATIONS = 1;

export type ReasoningPath = 'REASONING' | 'RECOVERY_PLANNING';

export type SceneReadyReasoningResult =
  | {
      readonly status: 'GROUNDED';
      readonly path: ReasoningPath;
      readonly output: GroundedReasoningResult;
    }
  | { readonly status: 'DETERMINISTIC_FALLBACK'; readonly path: ReasoningPath }
  | { readonly status: 'TEMPORARILY_UNAVAILABLE'; readonly path: ReasoningPath };

export class BoundedToolIterationHandler extends InterventionHandler {
  readonly name = 'sceneready-tool-bound';
  private calls = 0;

  override beforeToolCall(): ReturnType<InterventionHandler['beforeToolCall']> {
    this.calls += 1;
    if (this.calls > MAX_TOOL_ITERATIONS) {
      return InterventionActions.deny('tool iteration limit reached');
    }
    return InterventionActions.proceed();
  }
}

export async function reasonWithPinnedModel(input: {
  readonly path: ReasoningPath;
  readonly prompt: string;
  readonly context: unknown;
  readonly complete: (prompt: string) => Promise<string>;
}): Promise<SceneReadyReasoningResult> {
  let attempt: GroundingAttempt = 'INITIAL_ATTEMPT';
  let prompt = input.prompt;
  for (let regeneration = 0; regeneration <= MAX_REGENERATIONS; regeneration += 1) {
    let text: string;
    try {
      text = await input.complete(prompt);
    } catch {
      return Object.freeze({ status: 'TEMPORARILY_UNAVAILABLE', path: input.path });
    }
    const output = parseModelOutput(text);
    const validated = validateGroundedReasoning({ output, context: input.context, attempt });
    if (validated.ok) {
      return Object.freeze({ status: 'GROUNDED', path: input.path, output: validated.data });
    }
    if (validated.disposition !== 'REGENERATE_ONCE' || regeneration === MAX_REGENERATIONS) {
      return Object.freeze({ status: 'DETERMINISTIC_FALLBACK', path: input.path });
    }
    attempt = 'RETRY_ATTEMPT';
    prompt = `${input.prompt}\nReplace the previous output with grounded JSON only.`;
  }
  return Object.freeze({ status: 'DETERMINISTIC_FALLBACK', path: input.path });
}

function parseModelOutput(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
