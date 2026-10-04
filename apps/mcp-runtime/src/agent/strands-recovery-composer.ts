import type {
  RecoveryCandidate,
  RecoveryComposer,
  RecoveryCompositionInput,
} from '@sceneready/agent';

import { assertPinnedModel, pinnedBedrockConfig } from './bedrock-model.js';
import { reasonWithPinnedModel } from './strands-reasoning.js';

export class StrandsRecoveryComposer implements RecoveryComposer {
  constructor(
    private readonly complete: (prompt: string) => Promise<string>,
    private readonly context: unknown,
    private readonly fallback: readonly RecoveryCandidate[],
  ) {}

  async compose(input: RecoveryCompositionInput): Promise<readonly RecoveryCandidate[]> {
    const config = pinnedBedrockConfig('RECOVERY_PLANNING');
    assertPinnedModel(config.modelId ?? '');
    const reasoned = await reasonWithPinnedModel({
      path: 'RECOVERY_PLANNING',
      prompt: input.objective,
      context: this.context,
      complete: this.complete,
    });
    if (reasoned.status === 'TEMPORARILY_UNAVAILABLE') {
      throw new Error('TEMPORARILY_UNAVAILABLE');
    }
    return this.fallback;
  }
}
