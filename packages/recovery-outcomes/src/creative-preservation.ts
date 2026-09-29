export const CREATIVE_PRESERVATION_ALGORITHM_VERSION = 'SR-CREATIVE-PRESERVATION-v1' as const;

export const BOUND_SOURCE_SCORING_VERSION = 'SR-SCORE-v1' as const;

export const ENVELOPE_IMPORTANCES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type EnvelopeImportance = (typeof ENVELOPE_IMPORTANCES)[number];

export const RISK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const BOUND_IMPORTANCE_WEIGHT: Readonly<Record<EnvelopeImportance, number>> = Object.freeze({
  LOW: 1,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
});

export const BOUND_SEVERITY_WEIGHT: Readonly<Record<RiskSeverity, number>> = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 4,
  CRITICAL: 6,
});

const SURVIVAL_SCALE = 6;

export const CREATIVE_PRESERVATION_ISSUES = [
  'CONFLICTING_ENVELOPE_ID',
  'CONFLICTING_ENVELOPE_IMPORTANCE',
  'CONFLICTING_RISK',
  'DUPLICATE_ACTIVITY_ID',
  'EMPTY_LOOK_SET',
  'INVALID_IMPORTANCE',
  'INVALID_RISK_SEVERITY',
  'MALFORMED_ACTIVITY_ID',
  'MALFORMED_ENVELOPE_ID',
  'MALFORMED_INPUT',
  'MALFORMED_RISK_ID',
  'MALFORMED_RISK_SUBJECT_ID',
  'MISSING_SCORE',
  'NON_INTEGER_SCORE',
  'SCORE_OUT_OF_RANGE',
] as const;

export type CreativePreservationIssue = (typeof CREATIVE_PRESERVATION_ISSUES)[number];

export interface CreativeLookOutcome {
  readonly activityId: string;
  readonly envelopeId: string;
  readonly envelopeImportance: EnvelopeImportance;
  readonly startScore: number;
  readonly endScore: number;
}

export interface CreativeRiskView {
  readonly riskId: string;
  readonly subjectId: string;
  readonly severity: RiskSeverity;
}

export interface CreativePreservationInput {
  readonly looks: readonly CreativeLookOutcome[];
  readonly risks: readonly CreativeRiskView[];
}

export interface Rational {
  readonly numerator: number;
  readonly denominator: number;
}

export interface LookPreservationDetail {
  readonly activityId: string;
  readonly envelopeId: string;
  readonly lookFloor: number;
  readonly directRiskSeverity: RiskSeverity | null;
  readonly survivalNumerator: number;
  readonly survivalDenominator: number;
  readonly operationalLookValue: Rational;
}

export interface EnvelopePreservationDetail {
  readonly envelopeId: string;
  readonly envelopeImportance: EnvelopeImportance;
  readonly envelopeScore: Rational;
}

export interface CreativePreservationAvailable {
  readonly status: 'AVAILABLE';
  readonly algorithmVersion: typeof CREATIVE_PRESERVATION_ALGORITHM_VERSION;
  readonly boundSourceScoringVersion: typeof BOUND_SOURCE_SCORING_VERSION;
  readonly creativePreservation: number;
  readonly staticEnvelopeQuality: number;
  readonly finalQuotient: Rational;
  readonly staticQuotient: Rational;
  readonly looks: readonly LookPreservationDetail[];
  readonly envelopes: readonly EnvelopePreservationDetail[];
}

export interface CreativePreservationWithheld {
  readonly status: 'WITHHELD';
  readonly algorithmVersion: typeof CREATIVE_PRESERVATION_ALGORITHM_VERSION;
  readonly issues: readonly CreativePreservationIssue[];
}

export type CreativePreservationResult =
  CreativePreservationAvailable | CreativePreservationWithheld;

interface LookDraft {
  readonly activityId: string;
  readonly envelopeId: string;
  readonly envelopeImportance: EnvelopeImportance;
  readonly startScore: number;
  readonly endScore: number;
}

interface RiskDraft {
  readonly subjectId: string;
  readonly severity: RiskSeverity;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isImportance(value: unknown): value is EnvelopeImportance {
  return typeof value === 'string' && (ENVELOPE_IMPORTANCES as readonly string[]).includes(value);
}

function isSeverity(value: unknown): value is RiskSeverity {
  return typeof value === 'string' && (RISK_SEVERITIES as readonly string[]).includes(value);
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function simplify(numerator: number, denominator: number): Rational {
  if (denominator < 0) {
    return simplify(-numerator, -denominator);
  }
  if (numerator === 0) {
    return { numerator: 0, denominator: 1 };
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(left: Rational, right: Rational): Rational {
  return simplify(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function scale(value: Rational, factor: number): Rational {
  return simplify(value.numerator * factor, value.denominator);
}

function divideBy(value: Rational, divisor: number): Rational {
  return simplify(value.numerator, value.denominator * divisor);
}

function roundHalfAwayFromZero(value: Rational): number {
  const negative = value.numerator < 0;
  const numerator = negative ? -value.numerator : value.numerator;
  const scaled = 2 * numerator + value.denominator;
  const divisor = 2 * value.denominator;
  const rounded = (scaled - (scaled % divisor)) / divisor;
  return negative ? -rounded : rounded;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested !== null && typeof nested === 'object') {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}

function readScore(value: unknown, issues: Set<CreativePreservationIssue>): number | null {
  if (value === undefined || value === null) {
    issues.add('MISSING_SCORE');
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    issues.add('NON_INTEGER_SCORE');
    if (typeof value === 'number' && Number.isFinite(value) && (value < 0 || value > 100)) {
      issues.add('SCORE_OUT_OF_RANGE');
    }
    return null;
  }
  if (value < 0 || value > 100) {
    issues.add('SCORE_OUT_OF_RANGE');
    return null;
  }
  return value;
}

function validateLooks(
  looks: readonly unknown[],
  issues: Set<CreativePreservationIssue>,
): LookDraft[] {
  const drafts: LookDraft[] = [];
  const activityCounts = new Map<string, number>();
  const activityEnvelopes = new Map<string, Set<string>>();
  const envelopeImportances = new Map<string, Set<EnvelopeImportance>>();

  for (const entry of looks) {
    if (!isRecord(entry)) {
      issues.add('MALFORMED_INPUT');
      continue;
    }

    const activityId = entry.activityId;
    const envelopeId = entry.envelopeId;
    const envelopeImportance = entry.envelopeImportance;
    const activityOk = nonEmptyString(activityId);
    const envelopeOk = nonEmptyString(envelopeId);
    const importanceOk = isImportance(envelopeImportance);
    if (!activityOk) {
      issues.add('MALFORMED_ACTIVITY_ID');
    }
    if (!envelopeOk) {
      issues.add('MALFORMED_ENVELOPE_ID');
    }
    if (!importanceOk) {
      issues.add('INVALID_IMPORTANCE');
    }

    const startScore = readScore(entry.startScore, issues);
    const endScore = readScore(entry.endScore, issues);

    if (activityOk) {
      activityCounts.set(activityId, (activityCounts.get(activityId) ?? 0) + 1);
      if (envelopeOk) {
        const envelopes = activityEnvelopes.get(activityId) ?? new Set<string>();
        envelopes.add(envelopeId);
        activityEnvelopes.set(activityId, envelopes);
      }
    }

    if (envelopeOk && importanceOk) {
      const importances = envelopeImportances.get(envelopeId) ?? new Set<EnvelopeImportance>();
      importances.add(envelopeImportance);
      envelopeImportances.set(envelopeId, importances);
    }

    if (activityOk && envelopeOk && importanceOk && startScore !== null && endScore !== null) {
      drafts.push({
        activityId,
        envelopeId,
        envelopeImportance,
        startScore,
        endScore,
      });
    }
  }

  for (const count of activityCounts.values()) {
    if (count > 1) {
      issues.add('DUPLICATE_ACTIVITY_ID');
    }
  }
  for (const envelopes of activityEnvelopes.values()) {
    if (envelopes.size > 1) {
      issues.add('CONFLICTING_ENVELOPE_ID');
    }
  }
  for (const importances of envelopeImportances.values()) {
    if (importances.size > 1) {
      issues.add('CONFLICTING_ENVELOPE_IMPORTANCE');
    }
  }

  return drafts;
}

function validateRisks(
  risks: readonly unknown[],
  issues: Set<CreativePreservationIssue>,
): RiskDraft[] {
  const drafts: RiskDraft[] = [];
  const signatures = new Map<string, string>();

  for (const entry of risks) {
    if (!isRecord(entry)) {
      issues.add('MALFORMED_INPUT');
      continue;
    }

    const riskId = entry.riskId;
    const subjectId = entry.subjectId;
    const severity = entry.severity;
    const riskOk = nonEmptyString(riskId);
    const subjectOk = nonEmptyString(subjectId);
    const severityOk = isSeverity(severity);
    if (!riskOk) {
      issues.add('MALFORMED_RISK_ID');
    }
    if (!subjectOk) {
      issues.add('MALFORMED_RISK_SUBJECT_ID');
    }
    if (!severityOk) {
      issues.add('INVALID_RISK_SEVERITY');
    }
    if (!riskOk || !subjectOk || !severityOk) {
      continue;
    }

    const signature = JSON.stringify([subjectId, severity]);
    const previous = signatures.get(riskId);
    if (previous === undefined) {
      signatures.set(riskId, signature);
      drafts.push({ subjectId, severity });
    } else if (previous !== signature) {
      issues.add('CONFLICTING_RISK');
    }
  }

  return drafts;
}

function directSeverities(risks: readonly RiskDraft[]): ReadonlyMap<string, RiskSeverity> {
  const bySubject = new Map<string, RiskSeverity>();
  for (const risk of risks) {
    const current = bySubject.get(risk.subjectId);
    if (
      current === undefined ||
      BOUND_SEVERITY_WEIGHT[risk.severity] > BOUND_SEVERITY_WEIGHT[current]
    ) {
      bySubject.set(risk.subjectId, risk.severity);
    }
  }
  return bySubject;
}

function survivalFor(severity: RiskSeverity | null): {
  readonly survivalNumerator: number;
  readonly survivalDenominator: number;
} {
  if (severity === null) {
    return { survivalNumerator: 1, survivalDenominator: 1 };
  }
  return {
    survivalNumerator: SURVIVAL_SCALE - BOUND_SEVERITY_WEIGHT[severity],
    survivalDenominator: SURVIVAL_SCALE,
  };
}

function sortedIssues(
  issues: ReadonlySet<CreativePreservationIssue>,
): readonly CreativePreservationIssue[] {
  return [...issues].sort(compareOrdinal);
}

function withheld(issues: ReadonlySet<CreativePreservationIssue>): CreativePreservationWithheld {
  const result: CreativePreservationWithheld = {
    status: 'WITHHELD',
    algorithmVersion: CREATIVE_PRESERVATION_ALGORITHM_VERSION,
    issues: sortedIssues(issues),
  };
  return deepFreeze(result);
}

export function evaluateCreativePreservation(input: unknown): CreativePreservationResult {
  const issues = new Set<CreativePreservationIssue>();
  if (!isRecord(input) || !Array.isArray(input.looks) || !Array.isArray(input.risks)) {
    issues.add('MALFORMED_INPUT');
    if (isRecord(input) && Array.isArray(input.looks)) {
      if (input.looks.length === 0) {
        issues.add('EMPTY_LOOK_SET');
      }
      validateLooks(input.looks, issues);
    }
    if (isRecord(input) && Array.isArray(input.risks)) {
      validateRisks(input.risks, issues);
    }
    return withheld(issues);
  }

  if (input.looks.length === 0) {
    issues.add('EMPTY_LOOK_SET');
  }

  const looks = validateLooks(input.looks, issues);
  const risks = validateRisks(input.risks, issues);
  if (issues.size > 0) {
    return withheld(issues);
  }

  const severityBySubject = directSeverities(risks);
  const scoredLooks = looks
    .map((look) => {
      const lookFloor = Math.min(look.startScore, look.endScore);
      const directRiskSeverity = severityBySubject.get(look.activityId) ?? null;
      const survival = survivalFor(directRiskSeverity);
      return {
        activityId: look.activityId,
        envelopeId: look.envelopeId,
        envelopeImportance: look.envelopeImportance,
        lookFloor,
        directRiskSeverity,
        survivalNumerator: survival.survivalNumerator,
        survivalDenominator: survival.survivalDenominator,
        operationalLookValue: simplify(
          lookFloor * survival.survivalNumerator,
          survival.survivalDenominator,
        ),
      };
    })
    .sort((left, right) => compareOrdinal(left.activityId, right.activityId));

  const lookDetails: LookPreservationDetail[] = scoredLooks.map((look) => ({
    activityId: look.activityId,
    envelopeId: look.envelopeId,
    lookFloor: look.lookFloor,
    directRiskSeverity: look.directRiskSeverity,
    survivalNumerator: look.survivalNumerator,
    survivalDenominator: look.survivalDenominator,
    operationalLookValue: look.operationalLookValue,
  }));

  interface EnvelopeAccumulator {
    envelopeId: string;
    envelopeImportance: EnvelopeImportance;
    operationalSum: Rational;
    staticSum: Rational;
    count: number;
  }

  const groups = new Map<string, EnvelopeAccumulator>();
  for (const look of scoredLooks) {
    const current = groups.get(look.envelopeId) ?? {
      envelopeId: look.envelopeId,
      envelopeImportance: look.envelopeImportance,
      operationalSum: { numerator: 0, denominator: 1 },
      staticSum: { numerator: 0, denominator: 1 },
      count: 0,
    };
    current.operationalSum = add(current.operationalSum, look.operationalLookValue);
    current.staticSum = add(current.staticSum, simplify(look.lookFloor, 1));
    current.count += 1;
    groups.set(look.envelopeId, current);
  }

  const orderedGroups = [...groups.values()].sort((left, right) =>
    compareOrdinal(left.envelopeId, right.envelopeId),
  );

  let operationalWeighted: Rational = { numerator: 0, denominator: 1 };
  let staticWeighted: Rational = { numerator: 0, denominator: 1 };
  let weightTotal = 0;
  const envelopes: EnvelopePreservationDetail[] = orderedGroups.map((group) => {
    const weight = BOUND_IMPORTANCE_WEIGHT[group.envelopeImportance];
    const envelopeScore = divideBy(group.operationalSum, group.count);
    const staticScore = divideBy(group.staticSum, group.count);
    operationalWeighted = add(operationalWeighted, scale(envelopeScore, weight));
    staticWeighted = add(staticWeighted, scale(staticScore, weight));
    weightTotal += weight;
    return {
      envelopeId: group.envelopeId,
      envelopeImportance: group.envelopeImportance,
      envelopeScore,
    };
  });

  if (weightTotal <= 0) {
    issues.add('MALFORMED_INPUT');
    return withheld(issues);
  }

  const finalQuotient = divideBy(operationalWeighted, weightTotal);
  const staticQuotient = divideBy(staticWeighted, weightTotal);
  const result: CreativePreservationAvailable = {
    status: 'AVAILABLE',
    algorithmVersion: CREATIVE_PRESERVATION_ALGORITHM_VERSION,
    boundSourceScoringVersion: BOUND_SOURCE_SCORING_VERSION,
    creativePreservation: roundHalfAwayFromZero(finalQuotient),
    staticEnvelopeQuality: roundHalfAwayFromZero(staticQuotient),
    finalQuotient,
    staticQuotient,
    looks: lookDetails,
    envelopes,
  };
  return deepFreeze(result);
}
