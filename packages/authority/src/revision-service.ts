import type {
  ApprovedRevisionCommand,
  ApprovedRevisionResult,
  AuthoritativeStateRepository,
} from './state-ports.js';

export interface ApprovedRevisionInput extends ApprovedRevisionCommand {
  readonly repository: AuthoritativeStateRepository;
}

/**
 * Applies one approved revision through the existing mutation lane.
 * Ledger append and outbox creation happen in that same commit, or not at all.
 * Delivery is not invoked here.
 */
export async function applyApprovedProductionRevision(
  input: ApprovedRevisionInput,
): Promise<ApprovedRevisionResult> {
  return input.repository.applyApprovedProductionRevision(input);
}
