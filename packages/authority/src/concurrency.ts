import {
  createProposalFingerprint,
  type AuthorityProposal,
  type BoundApprovalClaims,
} from '@sceneready/mcp-human-authority';

import { decideRoleNamespace } from './role-policy.js';
import { AuthorityBoundaryError, isStrictlyBefore, readCanonicalInstant } from './session.js';
import type {
  AuthoritativeNamespace,
  AuthoritativeScope,
  AuthoritativeSnapshot,
  ConditionalRevisionCommand,
  MutationDenialReason,
} from './state-ports.js';

const CLAIM_KEYS = [
  'accountId',
  'actorId',
  'authorityNamespace',
  'baseGraphRevision',
  'baseProductionRevision',
  'expiresAt',
  'issuedAt',
  'policyVersion',
  'productionId',
  'proposalFingerprint',
  'proposalId',
  'role',
  'singleUse',
  'tokenId',
] as const;

export type MutationAuthorization =
  | { readonly ok: true; readonly claims: BoundApprovalClaims }
  | { readonly ok: false; readonly reason: MutationDenialReason };

function fail(code: string, message: string): never {
  throw new AuthorityBoundaryError(code, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requireRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function authoritativeScopeKey(scope: AuthoritativeScope): string {
  return [scope.accountId, scope.productionId, scope.authorityNamespace].join('\u001f');
}

export function readAuthoritativeScope(scope: AuthoritativeScope): AuthoritativeScope {
  if (!isPlainRecord(scope)) {
    fail('INVALID_SCOPE', 'scope must be a plain object');
  }
  const accountId = requireText(scope.accountId);
  const productionId = requireText(scope.productionId);
  const authorityNamespace = scope.authorityNamespace;
  if (accountId === null || productionId === null) {
    fail('INVALID_SCOPE', 'scope ids must be non-empty strings');
  }
  if (authorityNamespace !== 'LIVE' && authorityNamespace !== 'REPLAY') {
    fail('INVALID_SCOPE', 'authority namespace must be LIVE or REPLAY');
  }
  return Object.freeze({
    accountId,
    productionId,
    authorityNamespace,
  });
}

export function readAuthoritativeSnapshot(snapshot: AuthoritativeSnapshot): AuthoritativeSnapshot {
  const scope = readAuthoritativeScope(snapshot);
  const productionRevision = requireRevision(snapshot.productionRevision);
  const graphRevision = requireRevision(snapshot.graphRevision);
  if (productionRevision === null || graphRevision === null) {
    fail('INVALID_REVISION', 'revisions must be non-negative safe integers');
  }
  if (snapshot.productionState === undefined) {
    fail('INVALID_STATE', 'production state is required');
  }
  return Object.freeze({
    accountId: scope.accountId,
    productionId: scope.productionId,
    authorityNamespace: scope.authorityNamespace,
    productionRevision,
    graphRevision,
    productionState: snapshot.productionState,
  });
}

function readNamespace(value: unknown): AuthoritativeNamespace | null {
  return value === 'LIVE' || value === 'REPLAY' ? value : null;
}

function readRole(value: unknown): BoundApprovalClaims['role'] | null {
  return value === 'PRODUCTION_LEAD' || value === 'DEMO_PRODUCTION_LEAD' ? value : null;
}

function readInstant(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return readCanonicalInstant(value);
  } catch {
    return null;
  }
}

function rejected(reason: MutationDenialReason): MutationAuthorization {
  return Object.freeze({ ok: false, reason });
}

function readBoundClaims(value: unknown): MutationAuthorization {
  if (!isPlainRecord(value)) {
    return rejected('TOKEN_REJECTED');
  }
  if (Object.hasOwn(value, 'singleUse') && value.singleUse !== true) {
    return rejected('APPROVAL_NOT_SINGLE_USE');
  }
  const keys = Object.keys(value);
  if (keys.length !== CLAIM_KEYS.length || CLAIM_KEYS.some((key) => !Object.hasOwn(value, key))) {
    return rejected('TOKEN_REJECTED');
  }
  const tokenId = requireText(value.tokenId);
  const accountId = requireText(value.accountId);
  const productionId = requireText(value.productionId);
  const authorityNamespace = readNamespace(value.authorityNamespace);
  const proposalId = requireText(value.proposalId);
  const proposalFingerprint = requireText(value.proposalFingerprint);
  const baseProductionRevision = requireRevision(value.baseProductionRevision);
  const baseGraphRevision = requireRevision(value.baseGraphRevision);
  const policyVersion = requireText(value.policyVersion);
  const actorId = requireText(value.actorId);
  const role = readRole(value.role);
  const issuedAt = readInstant(value.issuedAt);
  const expiresAt = readInstant(value.expiresAt);
  if (
    tokenId === null ||
    accountId === null ||
    productionId === null ||
    authorityNamespace === null ||
    proposalId === null ||
    proposalFingerprint === null ||
    baseProductionRevision === null ||
    baseGraphRevision === null ||
    policyVersion === null ||
    actorId === null ||
    role === null ||
    issuedAt === null ||
    expiresAt === null ||
    !isStrictlyBefore(issuedAt, expiresAt)
  ) {
    return rejected('TOKEN_REJECTED');
  }
  return Object.freeze({
    ok: true,
    claims: Object.freeze({
      tokenId,
      accountId,
      productionId,
      authorityNamespace,
      proposalId,
      proposalFingerprint,
      baseProductionRevision,
      baseGraphRevision,
      policyVersion,
      actorId,
      role,
      issuedAt,
      expiresAt,
      singleUse: true,
    }),
  });
}

export async function authorizeMutation(
  input: ConditionalRevisionCommand,
): Promise<MutationAuthorization> {
  const scope = readAuthoritativeScope(input.scope);
  const now = readCanonicalInstant(input.now);
  if (typeof input.token !== 'string' || input.token.length === 0) {
    return rejected('TOKEN_REJECTED');
  }
  let verified: unknown;
  try {
    verified = await input.signer.verify(input.token);
  } catch {
    return rejected('TOKEN_REJECTED');
  }
  const claimsResult = readBoundClaims(verified);
  if (!claimsResult.ok) {
    return claimsResult;
  }
  const claims = claimsResult.claims;
  if (isStrictlyBefore(now, claims.issuedAt)) {
    return rejected('TOKEN_REJECTED');
  }
  if (!isStrictlyBefore(now, claims.expiresAt)) {
    return rejected('APPROVAL_EXPIRED');
  }
  const proposal: AuthorityProposal = input.proposal;
  if (claims.accountId !== scope.accountId || proposal.accountId !== scope.accountId) {
    return rejected('ACCOUNT_SCOPE_MISMATCH');
  }
  if (claims.productionId !== scope.productionId || proposal.productionId !== scope.productionId) {
    return rejected('PRODUCTION_SCOPE_MISMATCH');
  }
  if (claims.authorityNamespace !== scope.authorityNamespace) {
    return rejected('AUTHORITY_NAMESPACE_MISMATCH');
  }
  if (decideRoleNamespace(claims.role, claims.authorityNamespace) !== 'ALLOW') {
    return rejected('ROLE_NOT_AUTHORIZED');
  }
  const fingerprint = createProposalFingerprint(proposal);
  if (fingerprint !== claims.proposalFingerprint) {
    return rejected('PROPOSAL_FINGERPRINT_MISMATCH');
  }
  if (proposal.proposalId !== claims.proposalId) {
    return rejected('PROPOSAL_ID_MISMATCH');
  }
  if (
    proposal.baseProductionRevision !== claims.baseProductionRevision ||
    proposal.baseGraphRevision !== claims.baseGraphRevision
  ) {
    return rejected('BASE_REVISION_STALE');
  }
  if (proposal.policyVersion !== claims.policyVersion) {
    return rejected('POLICY_VERSION_MISMATCH');
  }
  return claimsResult;
}
