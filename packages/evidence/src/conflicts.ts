export const EVIDENCE_CONFLICT_STATUSES = ['UNRESOLVED', 'RESOLVED'] as const;

export type EvidenceConflictStatus = (typeof EVIDENCE_CONFLICT_STATUSES)[number];

export interface EvidenceConflict {
  readonly conflictId: string;
  readonly productionId: string;
  readonly scope: string;
  readonly evidenceIds: readonly string[];
  readonly status: EvidenceConflictStatus;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function createEvidenceConflict(input: {
  readonly productionId: string;
  readonly scope: string;
  readonly evidenceIds: readonly string[];
}): EvidenceConflict {
  const evidenceIds = Object.freeze([...input.evidenceIds].sort(compareOrdinal));
  const conflictId = `CONFLICT:${input.productionId}:${input.scope}:${evidenceIds.join(',')}`;
  return Object.freeze({
    conflictId,
    productionId: input.productionId,
    scope: input.scope,
    evidenceIds,
    status: 'UNRESOLVED',
  });
}

export function compareConflictOrder(left: EvidenceConflict, right: EvidenceConflict): number {
  return compareOrdinal(left.conflictId, right.conflictId);
}
