import { fingerprintEvidenceContent } from './fingerprint.js';

export const EVIDENCE_CONFLICT_STATUSES = ['UNRESOLVED', 'RESOLVED'] as const;

export type EvidenceConflictStatus = (typeof EVIDENCE_CONFLICT_STATUSES)[number];

export interface EvidenceConflict {
  readonly conflictId: string;
  readonly productionId: string;
  readonly scope: string;
  readonly evidenceIds: readonly string[];
  readonly status: EvidenceConflictStatus;
}

export interface EvidenceConflictContender {
  readonly evidenceId: string;
  readonly scopedFingerprint: string;
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

function compareContender(
  left: EvidenceConflictContender,
  right: EvidenceConflictContender,
): number {
  const idOrder = compareOrdinal(left.evidenceId, right.evidenceId);
  if (idOrder !== 0) {
    return idOrder;
  }
  return compareOrdinal(left.scopedFingerprint, right.scopedFingerprint);
}

export function createEvidenceConflict(input: {
  readonly productionId: string;
  readonly scope: string;
  readonly contenders: readonly EvidenceConflictContender[];
}): EvidenceConflict {
  const contenders = [...input.contenders].sort(compareContender);
  const evidenceIds = Object.freeze(
    [...input.contenders.map((item) => item.evidenceId)].sort(compareOrdinal),
  );
  const conflictId = `CONFLICT:${fingerprintEvidenceContent({
    contenders: contenders.map((item) => ({
      evidenceId: item.evidenceId,
      scopedFingerprint: item.scopedFingerprint,
    })),
    productionId: input.productionId,
    scope: input.scope,
  })}`;
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
