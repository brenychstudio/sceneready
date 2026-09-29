import { AuthorityContractError } from './canonicalize.js';
import { AUTHORITY_NAMESPACES, type AuthorityNamespace } from './claims.js';

export interface ApprovalChallengeInput {
  readonly challengeId: string;
  readonly proposalFingerprint: string;
  readonly proposalId: string;
  readonly accountId: string;
  readonly productionId: string;
  readonly baseProductionRevision: number;
  readonly baseGraphRevision: number;
  readonly policyVersion: string;
  readonly actorId: string;
  readonly authorityNamespace: AuthorityNamespace;
  readonly now: string;
  readonly ttlSeconds: number;
}

export interface ApprovalChallenge {
  readonly challengeId: string;
  readonly proposalFingerprint: string;
  readonly proposalId: string;
  readonly accountId: string;
  readonly productionId: string;
  readonly baseProductionRevision: number;
  readonly baseGraphRevision: number;
  readonly policyVersion: string;
  readonly actorId: string;
  readonly authorityNamespace: AuthorityNamespace;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'ACTIVE';
}

const CANONICAL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const NAMESPACE_SET = new Set<string>(AUTHORITY_NAMESPACES);

function fail(code: string, message: string): never {
  throw new AuthorityContractError(code, message);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_CHALLENGE', `${field} must be a non-empty string`);
  }
  return value;
}

function requireRevision(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail('INVALID_CHALLENGE', `${field} must be a safe integer`);
  }
  return value;
}

/**
 * Calendar arithmetic for an injected UTC instant.
 * The instant is the caller's `now`; this function does not read a clock.
 */
function instantMilliseconds(timestamp: string): number {
  const match = CANONICAL_TIMESTAMP.exec(timestamp);
  if (match === null) {
    fail('INVALID_TIMESTAMP', 'timestamps must be canonical UTC instants');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7]);
  const instant = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (new Date(instant).toISOString() !== timestamp) {
    fail('INVALID_TIMESTAMP', 'timestamp is not a real UTC instant');
  }
  return instant;
}

function formatInstant(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

/** Binds a proposal fingerprint to an actor and window. This is not approval. */
export function createApprovalChallenge(input: ApprovalChallengeInput): ApprovalChallenge {
  const authorityNamespace = input.authorityNamespace;
  if (!NAMESPACE_SET.has(authorityNamespace)) {
    fail('INVALID_NAMESPACE', 'authority namespace must be LIVE or REPLAY');
  }
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    fail('INVALID_TTL', 'ttlSeconds must be a positive integer');
  }
  const createdAt = requireText(input.now, 'now');
  const createdMilliseconds = instantMilliseconds(createdAt);
  const expiresAt = formatInstant(createdMilliseconds + input.ttlSeconds * 1000);
  if (expiresAt <= createdAt) {
    fail('INVALID_TTL', 'expiry must be strictly after creation');
  }
  const proposalFingerprint = requireText(input.proposalFingerprint, 'proposalFingerprint');
  if (!FINGERPRINT.test(proposalFingerprint)) {
    fail('INVALID_FINGERPRINT', 'proposal fingerprint must be 64 lowercase hex characters');
  }
  return Object.freeze({
    challengeId: requireText(input.challengeId, 'challengeId'),
    proposalFingerprint,
    proposalId: requireText(input.proposalId, 'proposalId'),
    accountId: requireText(input.accountId, 'accountId'),
    productionId: requireText(input.productionId, 'productionId'),
    baseProductionRevision: requireRevision(input.baseProductionRevision, 'baseProductionRevision'),
    baseGraphRevision: requireRevision(input.baseGraphRevision, 'baseGraphRevision'),
    policyVersion: requireText(input.policyVersion, 'policyVersion'),
    actorId: requireText(input.actorId, 'actorId'),
    authorityNamespace,
    createdAt,
    expiresAt,
    status: 'ACTIVE',
  });
}
