import type { ApprovalSigner, AuthorityProposal } from '@sceneready/mcp-human-authority';

export const AUTHORITATIVE_NAMESPACES = ['LIVE', 'REPLAY'] as const;

export type AuthoritativeNamespace = (typeof AUTHORITATIVE_NAMESPACES)[number];

export interface AuthoritativeScope {
  readonly accountId: string;
  readonly productionId: string;
  readonly authorityNamespace: AuthoritativeNamespace;
}

export interface AuthoritativeSnapshot {
  readonly accountId: string;
  readonly productionId: string;
  readonly authorityNamespace: AuthoritativeNamespace;
  readonly productionRevision: number;
  readonly graphRevision: number;
  readonly productionState: unknown;
}

export const MUTATION_DENIAL_REASONS = [
  'ACCOUNT_SCOPE_MISMATCH',
  'APPROVAL_ALREADY_CONSUMED',
  'APPROVAL_EXPIRED',
  'APPROVAL_NOT_SINGLE_USE',
  'AUTHORITY_NAMESPACE_MISMATCH',
  'BASE_REVISION_STALE',
  'POLICY_VERSION_MISMATCH',
  'PRODUCTION_SCOPE_MISMATCH',
  'PROPOSAL_FINGERPRINT_MISMATCH',
  'PROPOSAL_ID_MISMATCH',
  'ROLE_NOT_AUTHORIZED',
  'TOKEN_REJECTED',
  'UNKNOWN_PRODUCTION',
] as const;

export type MutationDenialReason = (typeof MUTATION_DENIAL_REASONS)[number];

export interface ConditionalRevisionCommand {
  readonly scope: AuthoritativeScope;
  readonly token: string;
  readonly now: string;
  readonly proposal: AuthorityProposal;
  readonly nextProductionState: unknown;
  readonly signer: ApprovalSigner;
}

export type ConditionalRevisionResult =
  | {
      readonly status: 'APPLIED';
      readonly reason: null;
      readonly productionRevision: number;
      readonly graphRevision: number;
      readonly productionState: unknown;
      readonly tokenId: string;
    }
  | {
      readonly status: 'DENIED';
      readonly reason: MutationDenialReason;
      readonly productionRevision: null;
      readonly graphRevision: null;
      readonly productionState: null;
      readonly tokenId: null;
    };

export interface AuthoritativeStateRepository {
  read(scope: AuthoritativeScope): Promise<AuthoritativeSnapshot | null>;
  applyConditionalRevision(command: ConditionalRevisionCommand): Promise<ConditionalRevisionResult>;
}
