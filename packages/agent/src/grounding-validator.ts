import {
  GroundedReasoningResultSchema,
  parseGroundingContext,
  type GroundedClaim,
  type GroundedReasoningResult,
  type GroundingContext,
  type GroundingIssue,
  type GroundingIssueCode,
  type GroundingStatementTemplate,
} from './grounding-schema.js';

export const GROUNDING_ATTEMPTS = ['INITIAL_ATTEMPT', 'RETRY_ATTEMPT'] as const;

export type GroundingAttempt = (typeof GROUNDING_ATTEMPTS)[number];

export const GROUNDING_DISPOSITIONS = ['REGENERATE_ONCE', 'USE_DETERMINISTIC_EXPLANATION'] as const;

export type GroundingDisposition = (typeof GROUNDING_DISPOSITIONS)[number];

export interface GroundingValidationRequest {
  readonly output: unknown;
  readonly context: unknown;
  readonly attempt: GroundingAttempt;
}

export type GroundingValidationResult =
  | {
      readonly ok: true;
      readonly data: GroundedReasoningResult;
    }
  | {
      readonly ok: false;
      readonly issues: readonly GroundingIssue[];
      readonly disposition: GroundingDisposition;
    };

const REQUEST_KEYS = ['output', 'context', 'attempt'] as const;

interface IssueCollector {
  add(code: GroundingIssueCode, subject: string): void;
  toArray(): readonly GroundingIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length) {
    return false;
  }
  const expected = new Set(keys);
  for (const name of names) {
    if (!expected.has(name)) {
      return false;
    }
  }
  return true;
}

function compareString(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareIssue(left: GroundingIssue, right: GroundingIssue): number {
  const byCode = compareString(left.code, right.code);
  if (byCode !== 0) {
    return byCode;
  }
  return compareString(left.subject, right.subject);
}

function collectIssues(): IssueCollector {
  const seen = new Set<string>();
  const items: GroundingIssue[] = [];
  return {
    add(code, subject) {
      const key = `${code}\u0000${subject}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      items.push(Object.freeze({ code, subject }));
    },
    toArray() {
      return Object.freeze([...items].sort(compareIssue));
    },
  };
}

function readAttempt(value: unknown): GroundingAttempt | null {
  if (value === 'INITIAL_ATTEMPT' || value === 'RETRY_ATTEMPT') {
    return value;
  }
  return null;
}

function dispositionFor(attempt: GroundingAttempt | null): GroundingDisposition {
  if (attempt === 'INITIAL_ATTEMPT') {
    return 'REGENERATE_ONCE';
  }
  return 'USE_DETERMINISTIC_EXPLANATION';
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareString);
}

function sameReferenceSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = uniqueSorted(left);
  const rightSet = uniqueSorted(right);
  if (leftSet.length !== rightSet.length) {
    return false;
  }
  for (let index = 0; index < leftSet.length; index += 1) {
    if (leftSet[index] !== rightSet[index]) {
      return false;
    }
  }
  return true;
}

function collectDuplicateClaimIds(issues: IssueCollector, claims: readonly GroundedClaim[]): void {
  const seen = new Set<string>();
  for (const claim of claims) {
    if (seen.has(claim.claimId)) {
      issues.add('DUPLICATE_CLAIM_ID', claim.claimId);
      continue;
    }
    seen.add(claim.claimId);
  }
}

function collectClaimIssues(
  issues: IssueCollector,
  claims: readonly GroundedClaim[],
  context: GroundingContext,
): void {
  const known = new Set(context.validReferences.map((reference) => reference.referenceId));
  const templates = new Map<string, GroundingStatementTemplate>();
  for (const template of context.allowedClaims) {
    templates.set(template.text, template);
  }
  for (const claim of claims) {
    for (const referenceId of claim.references) {
      if (!known.has(referenceId)) {
        issues.add('UNKNOWN_REFERENCE', referenceId);
      }
    }
    const template = templates.get(claim.text);
    if (template === undefined) {
      issues.add('UNSUPPORTED_CLAIM', claim.claimId);
      continue;
    }
    if (!sameReferenceSet(claim.references, template.requiredReferences)) {
      issues.add('REFERENCE_MISMATCH', claim.claimId);
    }
  }
}

function collectTradeOffIssues(
  issues: IssueCollector,
  tradeOffs: readonly string[],
  context: GroundingContext,
): void {
  const allowed = new Set(context.allowedTradeOffs);
  for (const tradeOff of tradeOffs) {
    if (!allowed.has(tradeOff)) {
      issues.add('UNSUPPORTED_TRADEOFF', tradeOff);
    }
  }
}

function collectRecommendationIssue(
  issues: IssueCollector,
  recommendationOptionId: string | null,
  context: GroundingContext,
): void {
  if (recommendationOptionId === null) {
    return;
  }
  const ranking = context.ranking;
  if (
    ranking === null ||
    ranking.decision !== 'RECOMMEND' ||
    ranking.recommendedOptionId !== recommendationOptionId
  ) {
    issues.add('RECOMMENDATION_MISMATCH', 'recommendationOptionId');
  }
}

function collectOutputIssues(
  issues: IssueCollector,
  output: GroundedReasoningResult,
  context: GroundingContext | null,
): void {
  collectDuplicateClaimIds(issues, output.claims);
  if (context === null) {
    return;
  }
  collectClaimIssues(issues, output.claims, context);
  if (!context.allowedSummaries.includes(output.summary)) {
    issues.add('UNSUPPORTED_SUMMARY', 'summary');
  }
  collectTradeOffIssues(issues, output.disclosedTradeOffs, context);
  collectRecommendationIssue(issues, output.recommendationOptionId, context);
}

function invalidResult(
  issues: readonly GroundingIssue[],
  attempt: GroundingAttempt | null,
): GroundingValidationResult {
  return Object.freeze({
    ok: false,
    issues,
    disposition: dispositionFor(attempt),
  });
}

export function validateGroundedReasoning(request: unknown): GroundingValidationResult {
  const issues = collectIssues();
  if (!isRecord(request) || !hasExactKeys(request, REQUEST_KEYS)) {
    issues.add('INVALID_REASONING_SCHEMA', 'request');
    return invalidResult(issues.toArray(), null);
  }
  const attempt = readAttempt(request.attempt);
  if (attempt === null) {
    issues.add('INVALID_REASONING_SCHEMA', 'attempt');
  }
  const parsedContext = parseGroundingContext(request.context);
  if (!parsedContext.success) {
    issues.add('INVALID_GROUNDING_CONTEXT', 'context');
  }
  const parsedOutput = GroundedReasoningResultSchema.safeParse(request.output);
  if (!parsedOutput.success) {
    issues.add('INVALID_REASONING_SCHEMA', 'output');
  } else {
    collectOutputIssues(
      issues,
      parsedOutput.data,
      parsedContext.success ? parsedContext.data : null,
    );
  }
  const list = issues.toArray();
  if (list.length === 0 && parsedOutput.success) {
    return Object.freeze({
      ok: true,
      data: parsedOutput.data,
    });
  }
  return invalidResult(list, attempt);
}
