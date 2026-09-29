export { AuthorityContractError, canonicalize } from './canonicalize.js';
export {
  createApprovalChallenge,
  type ApprovalChallenge,
  type ApprovalChallengeInput,
} from './challenge.js';
export {
  AUTHORITY_NAMESPACES,
  AUTHORITY_ROLES,
  type AuthorityNamespace,
  type AuthorityRole,
  type BoundApprovalClaims,
} from './claims.js';
export { createProposalFingerprint, type AuthorityProposal } from './fingerprint.js';
export type { ApprovalSigner } from './signer.js';
