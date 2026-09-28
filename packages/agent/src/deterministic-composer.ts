import { copyStructuredData, type RecoveryCompositionInput } from './context.js';
import type { RecoveryCandidate, RecoveryComposer } from './ports.js';

export class DeterministicRecoveryComposer implements RecoveryComposer {
  readonly #candidates: readonly unknown[];

  constructor(candidates: readonly unknown[]) {
    this.#candidates = candidates;
  }

  async compose(input: RecoveryCompositionInput): Promise<readonly RecoveryCandidate[]> {
    void input;
    return copyStructuredData(this.#candidates) as readonly RecoveryCandidate[];
  }
}
