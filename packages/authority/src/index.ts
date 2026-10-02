export {
  EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
  confirmApprovalChallenge,
  openApprovalChallenge,
  type ApprovalDenialReason,
  type ConfirmApprovalChallengeInput,
  type ConfirmApprovalResult,
  type ConfirmableChallenge,
  type OpenApprovalChallengeInput,
  type OpenApprovalDenialReason,
  type OpenApprovalResult,
} from './challenge-service.js';
export {
  ROLE_NAMESPACE_POLICY_VERSION,
  authorizedApprovalRole,
  decideRoleNamespace,
  type ApprovalAuthorityRole,
  type RoleNamespaceDecision,
} from './role-policy.js';
export {
  AUTHORITY_SESSION_NAMESPACES,
  AUTHORITY_SESSION_ROLES,
  AuthorityBoundaryError,
  readAuthenticatedAuthoritySession,
  type AuthenticatedAuthoritySession,
  type AuthoritySessionNamespace,
  type AuthoritySessionRole,
} from './session.js';
export { InMemoryAuthoritativeState } from './in-memory-state.js';
export {
  deriveDurableOutboxJobs,
  durableOutboxIdentity,
  type DurableOutboxJob,
  type RevisionAppliedEvent,
} from './ledger.js';
export { applyConditionalRevision, type ConditionalRevisionInput } from './mutation-lane.js';
export { applyApprovedProductionRevision, type ApprovedRevisionInput } from './revision-service.js';
export {
  MUTATION_DENIAL_REASONS,
  type ApprovedRevisionCommand,
  type ApprovedRevisionResult,
  type AuthoritativeNamespace,
  type AuthoritativeScope,
  type AuthoritativeSnapshot,
  type AuthoritativeStateRepository,
  type ConditionalRevisionCommand,
  type ConditionalRevisionResult,
  type MutationDenialReason,
} from './state-ports.js';
