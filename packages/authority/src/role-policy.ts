import type { AuthoritySessionNamespace, AuthoritySessionRole } from './session.js';

/**
 * SR-AUTHORITY-ROLE-NAMESPACE-v1.0
 * PRODUCTION_LEAD approves only LIVE.
 * DEMO_PRODUCTION_LEAD approves only REPLAY.
 * ASSISTANT and every other pair are denied. No wildcard and no fallback.
 */
export const ROLE_NAMESPACE_POLICY_VERSION = 'SR-AUTHORITY-ROLE-NAMESPACE-v1.0';

export type RoleNamespaceDecision = 'ALLOW' | 'DENY';

export type ApprovalAuthorityRole = 'PRODUCTION_LEAD' | 'DEMO_PRODUCTION_LEAD';

export function authorizedApprovalRole(
  role: AuthoritySessionRole,
  authorityNamespace: AuthoritySessionNamespace,
): ApprovalAuthorityRole | null {
  if (role === 'PRODUCTION_LEAD' && authorityNamespace === 'LIVE') {
    return 'PRODUCTION_LEAD';
  }
  if (role === 'DEMO_PRODUCTION_LEAD' && authorityNamespace === 'REPLAY') {
    return 'DEMO_PRODUCTION_LEAD';
  }
  return null;
}

export function decideRoleNamespace(
  role: AuthoritySessionRole,
  authorityNamespace: AuthoritySessionNamespace,
): RoleNamespaceDecision {
  return authorizedApprovalRole(role, authorityNamespace) === null ? 'DENY' : 'ALLOW';
}
