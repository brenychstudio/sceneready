import { Temporal } from '@js-temporal/polyfill';
import type { DecisionPolicy } from '@sceneready/readiness-engine';

import { canAuthoritySupersede, isUsableTrustState } from './authority.js';
import {
  compareConflictOrder,
  createEvidenceConflict,
  type EvidenceConflict,
} from './conflicts.js';
import type { EvidenceEnvelope } from './envelope.js';
import { fingerprintEvidenceContent } from './fingerprint.js';
import { evaluateEvidenceTrust } from './freshness.js';

export interface ScopedEvidence<Payload = unknown> {
  readonly scope: string;
  readonly value: string;
  readonly envelope: EvidenceEnvelope<Payload>;
  readonly scopedFingerprint: string;
}

export interface ScopedEvidenceInput<Payload = unknown> {
  readonly scope: string;
  readonly value: string;
  readonly envelope: EvidenceEnvelope<Payload>;
}

export interface ResolvedEvidenceSet {
  readonly active: readonly ScopedEvidence[];
  readonly superseded: readonly ScopedEvidence[];
  readonly conflicts: readonly EvidenceConflict[];
}

export interface EvidenceIndex {
  readonly activeByScope: ReadonlyMap<string, ScopedEvidence>;
  readonly conflictsByScope: ReadonlyMap<string, EvidenceConflict>;
}

interface ScopeResolution {
  readonly active: readonly ScopedEvidence[];
  readonly superseded: readonly ScopedEvidence[];
  readonly conflicts: readonly EvidenceConflict[];
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

function scopedFingerprintSubject(item: ScopedEvidenceInput): Record<string, unknown> {
  return {
    contentFingerprint: item.envelope.contentFingerprint,
    evidenceId: item.envelope.evidenceId,
    productionId: item.envelope.productionId,
    scope: item.scope,
    value: item.value,
  };
}

export function createScopedEvidence<Payload>(
  input: ScopedEvidenceInput<Payload>,
): ScopedEvidence<Payload> {
  return Object.freeze({
    envelope: input.envelope,
    scope: input.scope,
    value: input.value,
    scopedFingerprint: fingerprintEvidenceContent(scopedFingerprintSubject(input)),
  });
}

function assertScopedBinding(item: ScopedEvidence): void {
  const expected = fingerprintEvidenceContent(scopedFingerprintSubject(item));
  if (item.scopedFingerprint !== expected) {
    throw new Error('canonical JSON rejected: scoped fingerprint mismatch');
  }
}

function assertSingleProduction(evidence: readonly ScopedEvidence[]): void {
  if (evidence.length === 0) {
    return;
  }
  const productionId = evidence[0]?.envelope.productionId;
  for (const item of evidence) {
    if (item.envelope.productionId !== productionId) {
      throw new Error('canonical JSON rejected: mixed productionIds');
    }
  }
}

function scopeGroupKey(item: ScopedEvidence): string {
  return `${item.envelope.productionId}\u0000${item.scope}`;
}

function compareRecency(left: ScopedEvidence, right: ScopedEvidence): number {
  const time = Temporal.Instant.compare(
    Temporal.Instant.from(left.envelope.observedAt),
    Temporal.Instant.from(right.envelope.observedAt),
  );
  if (time !== 0) {
    return time;
  }
  return compareOrdinal(left.envelope.evidenceId, right.envelope.evidenceId);
}

function sortEvidence(items: readonly ScopedEvidence[]): ScopedEvidence[] {
  return [...items].sort((left, right) => {
    const productionOrder = compareOrdinal(left.envelope.productionId, right.envelope.productionId);
    if (productionOrder !== 0) {
      return productionOrder;
    }
    const scopeOrder = compareOrdinal(left.scope, right.scope);
    if (scopeOrder !== 0) {
      return scopeOrder;
    }
    return compareOrdinal(left.envelope.evidenceId, right.envelope.evidenceId);
  });
}

export function groupScopedEvidence(
  evidence: readonly ScopedEvidence[],
): ReadonlyMap<string, readonly ScopedEvidence[]> {
  const groups = new Map<string, ScopedEvidence[]>();
  for (const item of evidence) {
    const key = scopeGroupKey(item);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  return groups;
}

function dominates(winner: ScopedEvidence, loser: ScopedEvidence): boolean {
  if (compareRecency(winner, loser) <= 0) {
    return false;
  }
  if (winner.value === loser.value) {
    return true;
  }
  return canAuthoritySupersede(
    winner.scope,
    winner.envelope.authorityClass,
    loser.envelope.authorityClass,
  );
}

function resolveScope(
  items: readonly ScopedEvidence[],
  nowInstant: string,
  policy: DecisionPolicy,
): ScopeResolution {
  const usable: ScopedEvidence[] = [];
  for (const item of items) {
    const evaluation = evaluateEvidenceTrust(item.envelope, nowInstant, policy);
    if (isUsableTrustState(evaluation.effectiveTrustState)) {
      usable.push(item);
    }
  }

  if (usable.length === 0) {
    return { active: [], superseded: [], conflicts: [] };
  }

  const byValue = new Map<string, ScopedEvidence[]>();
  for (const item of usable) {
    const group = byValue.get(item.value);
    if (group === undefined) {
      byValue.set(item.value, [item]);
    } else {
      group.push(item);
    }
  }

  const currentContenders: ScopedEvidence[] = [];
  const historicalSuperseded: ScopedEvidence[] = [];
  for (const group of byValue.values()) {
    const ranked = [...group].sort((left, right) => compareRecency(right, left));
    const winner = ranked[0];
    if (winner === undefined) {
      continue;
    }
    currentContenders.push(winner);
    historicalSuperseded.push(...ranked.slice(1));
  }

  const firstContender = currentContenders[0];
  if (currentContenders.length === 1 && firstContender !== undefined) {
    return {
      active: [firstContender],
      superseded: sortEvidence(historicalSuperseded),
      conflicts: [],
    };
  }

  const undominated = currentContenders.filter((candidate) =>
    currentContenders.every((other) => other === candidate || !dominates(other, candidate)),
  );

  if (undominated.length === 1) {
    const winner = undominated[0];
    if (winner === undefined) {
      return { active: [], superseded: [], conflicts: [] };
    }
    return {
      active: [winner],
      superseded: sortEvidence(usable.filter((item) => item !== winner)),
      conflicts: [],
    };
  }

  const unresolved = undominated.length > 0 ? undominated : currentContenders;
  const unresolvedSet = new Set(unresolved);
  const dominatedCurrent = currentContenders.filter((item) => !unresolvedSet.has(item));
  const representative = unresolved[0];
  if (representative === undefined) {
    return { active: [], superseded: [], conflicts: [] };
  }

  return {
    active: [],
    superseded: sortEvidence([...historicalSuperseded, ...dominatedCurrent]),
    conflicts: [
      createEvidenceConflict({
        productionId: representative.envelope.productionId,
        scope: representative.scope,
        contenders: unresolved.map((item) => ({
          evidenceId: item.envelope.evidenceId,
          scopedFingerprint: item.scopedFingerprint,
        })),
      }),
    ],
  };
}

export function resolveEvidenceSet(
  evidence: readonly ScopedEvidence[],
  nowInstant: string,
  policy: DecisionPolicy,
): ResolvedEvidenceSet {
  for (const item of evidence) {
    assertScopedBinding(item);
  }
  assertSingleProduction(evidence);
  const grouped = groupScopedEvidence(evidence);
  const resolved: ScopeResolution[] = [];
  for (const group of grouped.values()) {
    resolved.push(resolveScope(group, nowInstant, policy));
  }

  return Object.freeze({
    active: Object.freeze(sortEvidence(resolved.flatMap((item) => [...item.active]))),
    superseded: Object.freeze(sortEvidence(resolved.flatMap((item) => [...item.superseded]))),
    conflicts: Object.freeze(
      [...resolved.flatMap((item) => [...item.conflicts])].sort(compareConflictOrder),
    ),
  });
}

export function indexResolvedEvidence(resolved: ResolvedEvidenceSet): EvidenceIndex {
  const activeByScope = new Map<string, ScopedEvidence>();
  for (const item of resolved.active) {
    activeByScope.set(scopeGroupKey(item), item);
  }
  const conflictsByScope = new Map<string, EvidenceConflict>();
  for (const conflict of resolved.conflicts) {
    conflictsByScope.set(`${conflict.productionId}\u0000${conflict.scope}`, conflict);
  }
  return Object.freeze({
    activeByScope,
    conflictsByScope,
  });
}
