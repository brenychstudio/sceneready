import type { BoundApprovalClaims } from './claims.js';

/**
 * Port only. Task 1 does not ship a signer, key, or secret.
 * Signing packages claims that a caller has already authorized.
 */
export interface ApprovalSigner {
  sign(claims: BoundApprovalClaims): Promise<string>;
  verify(token: string): Promise<BoundApprovalClaims>;
}
