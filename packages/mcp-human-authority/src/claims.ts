export const AUTHORITY_NAMESPACES = ['LIVE', 'REPLAY'] as const;

export type AuthorityNamespace = (typeof AUTHORITY_NAMESPACES)[number];

export const AUTHORITY_ROLES = ['PRODUCTION_LEAD', 'DEMO_PRODUCTION_LEAD'] as const;

export type AuthorityRole = (typeof AUTHORITY_ROLES)[number];

export interface BoundApprovalClaims {
  readonly tokenId: string;
  readonly accountId: string;
  readonly productionId: string;
  readonly authorityNamespace: 'LIVE' | 'REPLAY';
  readonly proposalId: string;
  readonly proposalFingerprint: string;
  readonly baseProductionRevision: number;
  readonly baseGraphRevision: number;
  readonly policyVersion: string;
  readonly actorId: string;
  readonly role: 'PRODUCTION_LEAD' | 'DEMO_PRODUCTION_LEAD';
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly singleUse: true;
}
