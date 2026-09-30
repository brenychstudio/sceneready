import {
  createApprovalChallenge,
  createProposalFingerprint,
  type ApprovalSigner,
  type AuthorityProposal,
  type BoundApprovalClaims,
} from '@sceneready/mcp-human-authority';

import { authorizedApprovalRole } from './role-policy.js';
import {
  AuthorityBoundaryError,
  expiresAtFromTtl,
  isStrictlyBefore,
  readAuthenticatedAuthoritySession,
  readCanonicalInstant,
  type AuthenticatedAuthoritySession,
} from './session.js';

export const EXPLICIT_APPROVE_ACTIVE_PROPOSAL = 'EXPLICIT_APPROVE_ACTIVE_PROPOSAL';

export interface OpenApprovalChallengeInput {
  readonly session: AuthenticatedAuthoritySession;
  readonly proposal: AuthorityProposal;
  readonly authorityNamespace: 'LIVE' | 'REPLAY';
  readonly challengeId: string;
  readonly now: string;
  readonly ttlSeconds: number;
}

export type OpenApprovalDenialReason =
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_SCOPE_MISMATCH'
  | 'PRODUCTION_SCOPE_MISMATCH'
  | 'AUTHORITY_NAMESPACE_MISMATCH';

export type OpenApprovalResult =
  | {
      readonly status: 'OPENED';
      readonly challenge: ReturnType<typeof createApprovalChallenge>;
    }
  | {
      readonly status: 'DENIED';
      readonly challenge: null;
      readonly reason: OpenApprovalDenialReason;
    };

export type ApprovalDenialReason =
  | 'SESSION_EXPIRED'
  | 'CHALLENGE_EXPIRED'
  | 'CHALLENGE_NOT_ACTIVE'
  | 'ACCOUNT_SCOPE_MISMATCH'
  | 'PRODUCTION_SCOPE_MISMATCH'
  | 'AUTHORITY_NAMESPACE_MISMATCH'
  | 'ROLE_NOT_AUTHORIZED'
  | 'PROPOSAL_FINGERPRINT_MISMATCH'
  | 'PROPOSAL_ID_MISMATCH'
  | 'BASE_PRODUCTION_REVISION_MISMATCH'
  | 'BASE_GRAPH_REVISION_MISMATCH'
  | 'POLICY_VERSION_MISMATCH';

export interface ConfirmableChallenge {
  readonly proposalFingerprint: string;
  readonly proposalId: string;
  readonly accountId: string;
  readonly productionId: string;
  readonly baseProductionRevision: number;
  readonly baseGraphRevision: number;
  readonly policyVersion: string;
  readonly authorityNamespace: string;
  readonly expiresAt: string;
  readonly status: string;
}

export interface ConfirmApprovalChallengeInput {
  readonly intent: string;
  readonly session: AuthenticatedAuthoritySession;
  readonly challenge: ConfirmableChallenge;
  readonly currentProposal: AuthorityProposal;
  readonly now: string;
  readonly tokenId: string;
  readonly ttlSeconds: number;
  readonly signer: ApprovalSigner;
}

export type ConfirmApprovalResult =
  | {
      readonly status: 'APPROVED';
      readonly token: string;
      readonly claims: BoundApprovalClaims;
      readonly reason: null;
    }
  | {
      readonly status: 'NOT_APPROVED';
      readonly token: null;
      readonly claims: null;
      readonly reason: 'NO_EXPLICIT_APPROVAL';
    }
  | {
      readonly status: 'DENIED';
      readonly token: null;
      readonly claims: null;
      readonly reason: ApprovalDenialReason;
    };

function fail(code: string, message: string): never {
  throw new AuthorityBoundaryError(code, message);
}

function deniedOpen(reason: OpenApprovalDenialReason): OpenApprovalResult {
  return Object.freeze({
    status: 'DENIED',
    challenge: null,
    reason,
  });
}

function notApproved(): ConfirmApprovalResult {
  return Object.freeze({
    status: 'NOT_APPROVED',
    token: null,
    claims: null,
    reason: 'NO_EXPLICIT_APPROVAL',
  });
}

function denied(reason: ApprovalDenialReason): ConfirmApprovalResult {
  return Object.freeze({
    status: 'DENIED',
    token: null,
    claims: null,
    reason,
  });
}

function requireTokenId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_TOKEN', 'tokenId must be a non-empty string');
  }
  return value;
}

/**
 * Presents one exact proposal as an active challenge.
 * This is not approval and it does not sign.
 */
export function openApprovalChallenge(input: OpenApprovalChallengeInput): OpenApprovalResult {
  const session = readAuthenticatedAuthoritySession(input.session);
  const now = readCanonicalInstant(input.now);
  if (!isStrictlyBefore(now, session.expiresAt)) {
    return deniedOpen('SESSION_EXPIRED');
  }
  if (session.accountId !== input.proposal.accountId) {
    return deniedOpen('ACCOUNT_SCOPE_MISMATCH');
  }
  if (session.productionId !== input.proposal.productionId) {
    return deniedOpen('PRODUCTION_SCOPE_MISMATCH');
  }
  if (session.authorityNamespace !== input.authorityNamespace) {
    return deniedOpen('AUTHORITY_NAMESPACE_MISMATCH');
  }

  const proposalFingerprint = createProposalFingerprint(input.proposal);
  const challenge = createApprovalChallenge({
    challengeId: input.challengeId,
    proposalFingerprint,
    proposalId: input.proposal.proposalId,
    accountId: input.proposal.accountId,
    productionId: input.proposal.productionId,
    baseProductionRevision: input.proposal.baseProductionRevision,
    baseGraphRevision: input.proposal.baseGraphRevision,
    policyVersion: input.proposal.policyVersion,
    actorId: session.actorId,
    authorityNamespace: input.authorityNamespace,
    now,
    ttlSeconds: input.ttlSeconds,
  });
  return Object.freeze({
    status: 'OPENED',
    challenge,
  });
}

/**
 * Confirms one explicit human approval.
 * Binding mismatches keep their own reasons; those fields also change the fingerprint.
 * The signer runs only after every check below has passed.
 */
export async function confirmApprovalChallenge(
  input: ConfirmApprovalChallengeInput,
): Promise<ConfirmApprovalResult> {
  if (input.intent !== EXPLICIT_APPROVE_ACTIVE_PROPOSAL) {
    return notApproved();
  }

  const session = readAuthenticatedAuthoritySession(input.session);
  const now = readCanonicalInstant(input.now);
  if (!isStrictlyBefore(now, session.expiresAt)) {
    return denied('SESSION_EXPIRED');
  }

  if (input.challenge.status !== 'ACTIVE') {
    return denied('CHALLENGE_NOT_ACTIVE');
  }
  if (!isStrictlyBefore(now, readCanonicalInstant(input.challenge.expiresAt))) {
    return denied('CHALLENGE_EXPIRED');
  }

  if (
    session.accountId !== input.challenge.accountId ||
    session.accountId !== input.currentProposal.accountId
  ) {
    return denied('ACCOUNT_SCOPE_MISMATCH');
  }
  if (
    session.productionId !== input.challenge.productionId ||
    session.productionId !== input.currentProposal.productionId
  ) {
    return denied('PRODUCTION_SCOPE_MISMATCH');
  }
  if (session.authorityNamespace !== input.challenge.authorityNamespace) {
    return denied('AUTHORITY_NAMESPACE_MISMATCH');
  }

  const role = authorizedApprovalRole(session.role, session.authorityNamespace);
  if (role === null) {
    return denied('ROLE_NOT_AUTHORIZED');
  }

  const proposalFingerprint = createProposalFingerprint(input.currentProposal);
  if (input.currentProposal.proposalId !== input.challenge.proposalId) {
    return denied('PROPOSAL_ID_MISMATCH');
  }
  if (input.currentProposal.baseProductionRevision !== input.challenge.baseProductionRevision) {
    return denied('BASE_PRODUCTION_REVISION_MISMATCH');
  }
  if (input.currentProposal.baseGraphRevision !== input.challenge.baseGraphRevision) {
    return denied('BASE_GRAPH_REVISION_MISMATCH');
  }
  if (input.currentProposal.policyVersion !== input.challenge.policyVersion) {
    return denied('POLICY_VERSION_MISMATCH');
  }
  if (proposalFingerprint !== input.challenge.proposalFingerprint) {
    return denied('PROPOSAL_FINGERPRINT_MISMATCH');
  }

  const claims: BoundApprovalClaims = Object.freeze({
    tokenId: requireTokenId(input.tokenId),
    accountId: session.accountId,
    productionId: session.productionId,
    authorityNamespace: session.authorityNamespace,
    proposalId: input.currentProposal.proposalId,
    proposalFingerprint,
    baseProductionRevision: input.currentProposal.baseProductionRevision,
    baseGraphRevision: input.currentProposal.baseGraphRevision,
    policyVersion: input.currentProposal.policyVersion,
    actorId: session.actorId,
    role,
    issuedAt: now,
    expiresAt: expiresAtFromTtl(now, input.ttlSeconds),
    singleUse: true,
  });
  const token = await input.signer.sign(claims);
  return Object.freeze({
    status: 'APPROVED',
    token,
    claims,
    reason: null,
  });
}
