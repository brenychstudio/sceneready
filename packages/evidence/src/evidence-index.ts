import { Temporal } from '@js-temporal/polyfill';
import type { DecisionPolicy } from '@sceneready/readiness-engine';

import { canAuthoritySupersede, isUsableTrustState } from './authority.js';
import {
  compareConflictOrder,
  createEvidenceConflict,
  type EvidenceConflict,
} from './conflicts.js';
import type { EvidenceEnvelope } from './envelope.js';
import { evaluateEvidenceTrust } from './freshness.js';

export interface ScopedEvidence<Payload = unknown> {
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

  const valueWinners: ScopedEvidence[] = [];
  const sameValueSuperseded: ScopedEvidence[] = [];
  for (const group of byValue.values()) {
    const ranked = [...group].sort((left, right) => compareRecency(right, left));
    const winner = ranked[0];
    if (winner === undefined) {
      continue;
    }
    valueWinners.push(winner);
    sameValueSuperseded.push(...ranked.slice(1));
  }

  const firstWinner = valueWinners[0];
  if (valueWinners.length === 1 && firstWinner !== undefined) {
    return {
      active: [firstWinner],
      superseded: sortEvidence(sameValueSuperseded),
      conflicts: [],
    };
  }

  for (let i = 0; i < valueWinners.length; i += 1) {
    const left = valueWinners[i];
    if (left === undefined) {
      continue;
    }
    for (let j = i + 1; j < valueWinners.length; j += 1) {
      const right = valueWinners[j];
      if (right === undefined) {
        continue;
      }
      if (!dominates(left, right) && !dominates(right, left)) {
        const productionId = left.envelope.productionId;
        return {
          active: [],
          superseded: [],
          conflicts: [
            createEvidenceConflict({
              productionId,
              scope: left.scope,
              evidenceIds: usable.map((item) => item.envelope.evidenceId),
            }),
          ],
        };
      }
    }
  }

  const undominated = valueWinners.filter((candidate) =>
    valueWinners.every((other) => other === candidate || dominates(candidate, other)),
  );
  const winner = undominated[0];
  if (winner === undefined || undominated.length !== 1) {
    const representative = valueWinners[0] ?? usable[0];
    if (representative === undefined) {
      return { active: [], superseded: [], conflicts: [] };
    }
    return {
      active: [],
      superseded: [],
      conflicts: [
        createEvidenceConflict({
          productionId: representative.envelope.productionId,
          scope: representative.scope,
          evidenceIds: usable.map((item) => item.envelope.evidenceId),
        }),
      ],
    };
  }

  return {
    active: [winner],
    superseded: sortEvidence(
      usable.filter((item) => item.envelope.evidenceId !== winner.envelope.evidenceId),
    ),
    conflicts: [],
  };
}

export function resolveEvidenceSet(
  evidence: readonly ScopedEvidence[],
  nowInstant: string,
  policy: DecisionPolicy,
): ResolvedEvidenceSet {
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
