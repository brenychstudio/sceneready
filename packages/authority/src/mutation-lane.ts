import type {
  AuthoritativeStateRepository,
  ConditionalRevisionCommand,
  ConditionalRevisionResult,
} from './state-ports.js';

export interface ConditionalRevisionInput extends ConditionalRevisionCommand {
  readonly repository: AuthoritativeStateRepository;
}

/**
 * The only production mutation lane.
 * Verification and the revision compare-and-set run inside the repository lock.
 * A caller-supplied boolean is not an input and is not consulted.
 */
export async function applyConditionalRevision(
  input: ConditionalRevisionInput,
): Promise<ConditionalRevisionResult> {
  return input.repository.applyConditionalRevision(input);
}
