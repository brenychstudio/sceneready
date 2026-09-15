import { clampScore } from './scoring.js';

export const CONFIDENCE_COVERAGES = [
  'RESOLVED',
  'MISSING',
  'CONFLICTED',
  'STALE',
  'UNRESOLVED',
] as const;

export type ConfidenceCoverage = (typeof CONFIDENCE_COVERAGES)[number];

export const CONFIDENCE_POLARITIES = ['CONFIRMED', 'DENIED'] as const;

export type ConfidencePolarity = (typeof CONFIDENCE_POLARITIES)[number];

export const SR_CONFIDENCE_V1 = Object.freeze({
  completeDefault: 96,
  resolvedConfirmed: 96,
  resolvedDenied: 94,
  missing: 50,
  conflicted: 40,
  stale: 50,
  unresolved: 40,
});

export interface EvidenceConfidenceFact {
  readonly scope: string;
  readonly coverage: ConfidenceCoverage;
  readonly polarity?: ConfidencePolarity;
  readonly quality?: number;
  readonly evidenceId?: string;
  readonly fingerprint?: string;
  readonly trustState?: string;
}

export interface EvidenceReference {
  readonly evidenceId: string;
  readonly fingerprint: string;
  readonly scope: string;
}

export interface ConfidenceScoreResult {
  readonly confidenceScore: number;
  readonly unresolvedRequiredEvidenceScopes: readonly string[];
  readonly evidenceReferences: readonly EvidenceReference[];
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

function isUnresolvedCoverage(coverage: ConfidenceCoverage): boolean {
  return (
    coverage === 'MISSING' ||
    coverage === 'CONFLICTED' ||
    coverage === 'STALE' ||
    coverage === 'UNRESOLVED'
  );
}

function defaultQuality(fact: EvidenceConfidenceFact): number {
  if (isUnresolvedCoverage(fact.coverage)) {
    if (fact.coverage === 'CONFLICTED') {
      return SR_CONFIDENCE_V1.conflicted;
    }
    if (fact.coverage === 'MISSING') {
      return SR_CONFIDENCE_V1.missing;
    }
    if (fact.coverage === 'STALE') {
      return SR_CONFIDENCE_V1.stale;
    }
    return SR_CONFIDENCE_V1.unresolved;
  }
  if (fact.polarity === 'DENIED') {
    return SR_CONFIDENCE_V1.resolvedDenied;
  }
  return SR_CONFIDENCE_V1.resolvedConfirmed;
}

function factQuality(fact: EvidenceConfidenceFact): number {
  if (typeof fact.quality === 'number') {
    return clampScore(fact.quality);
  }
  return defaultQuality(fact);
}

function factsForScope(
  facts: readonly EvidenceConfidenceFact[],
  scope: string,
): readonly EvidenceConfidenceFact[] {
  return facts.filter((fact) => fact.scope === scope);
}

function scopeIsUnresolved(facts: readonly EvidenceConfidenceFact[]): boolean {
  if (facts.length === 0) {
    return true;
  }
  return facts.some((fact) => isUnresolvedCoverage(fact.coverage));
}

function scopeQuality(facts: readonly EvidenceConfidenceFact[]): number {
  if (facts.length === 0) {
    return SR_CONFIDENCE_V1.unresolved;
  }
  let lowest = 100;
  for (const fact of facts) {
    const quality = factQuality(fact);
    if (quality < lowest) {
      lowest = quality;
    }
  }
  return lowest;
}

function averageInt(values: readonly number[]): number {
  if (values.length === 0) {
    return SR_CONFIDENCE_V1.completeDefault;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return clampScore(Math.floor(sum / values.length));
}

export function scoreConfidence(input: {
  readonly requiredEvidenceScopes: readonly string[];
  readonly confidenceFacts: readonly EvidenceConfidenceFact[];
}): ConfidenceScoreResult {
  const required = uniqueSortedScopes(input.requiredEvidenceScopes);
  const unresolved: string[] = [];
  const qualities: number[] = [];

  for (const scope of required) {
    const facts = factsForScope(input.confidenceFacts, scope);
    qualities.push(scopeQuality(facts));
    if (scopeIsUnresolved(facts)) {
      unresolved.push(scope);
    }
  }

  const references: EvidenceReference[] = [];
  const seen = new Set<string>();
  for (const fact of input.confidenceFacts) {
    if (fact.evidenceId === undefined) {
      continue;
    }
    const fingerprint = fact.fingerprint ?? '';
    const key = `${fact.evidenceId}\u0000${fingerprint}\u0000${fact.scope}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push(
      Object.freeze({
        evidenceId: fact.evidenceId,
        fingerprint,
        scope: fact.scope,
      }),
    );
  }

  return Object.freeze({
    confidenceScore: averageInt(qualities),
    unresolvedRequiredEvidenceScopes: Object.freeze(unresolved),
    evidenceReferences: Object.freeze(
      references.sort((left, right) => {
        const idOrder = compareOrdinal(left.evidenceId, right.evidenceId);
        if (idOrder !== 0) {
          return idOrder;
        }
        const fingerprintOrder = compareOrdinal(left.fingerprint, right.fingerprint);
        if (fingerprintOrder !== 0) {
          return fingerprintOrder;
        }
        return compareOrdinal(left.scope, right.scope);
      }),
    ),
  });
}

function uniqueSortedScopes(scopes: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(scopes)].sort(compareOrdinal));
}
