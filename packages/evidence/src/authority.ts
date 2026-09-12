import type { EvidenceTrustState } from '@sceneready/domain';

import type { EvidenceAuthorityClass } from './kinds.js';

export interface OperationalScope {
  readonly family: string;
  readonly subjectId: string;
  readonly aspect: string;
}

export function parseOperationalScope(scope: string): OperationalScope | undefined {
  const parts = scope.split(':');
  if (parts.length < 3) {
    return undefined;
  }
  const family = parts[0];
  const aspect = parts[parts.length - 1];
  const subjectId = parts.slice(1, -1).join(':');
  if (
    family === undefined ||
    aspect === undefined ||
    family.length === 0 ||
    aspect.length === 0 ||
    subjectId.length === 0
  ) {
    return undefined;
  }
  return { family, subjectId, aspect };
}

export function isUsableTrustState(state: EvidenceTrustState): boolean {
  return state !== 'MISSING' && state !== 'STALE';
}

export function canAuthoritySupersede(
  scope: string,
  winnerClass: EvidenceAuthorityClass,
  loserClass: EvidenceAuthorityClass,
): boolean {
  if (winnerClass === loserClass) {
    return true;
  }
  if (loserClass === 'FALLBACK') {
    return true;
  }

  const parsed = parseOperationalScope(scope);
  if (parsed !== undefined && parsed.family === 'PERSON' && parsed.aspect === 'AVAILABILITY') {
    return winnerClass === 'SUBJECT_CONFIRMATION' && loserClass === 'RECORDED_INTERNAL';
  }

  return false;
}
