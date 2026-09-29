export const GROUNDING_ISSUE_CODES = [
  'INVALID_REASONING_SCHEMA',
  'DUPLICATE_CLAIM_ID',
  'UNKNOWN_REFERENCE',
  'REFERENCE_MISMATCH',
  'UNSUPPORTED_CLAIM',
  'UNSUPPORTED_SUMMARY',
  'UNSUPPORTED_TRADEOFF',
  'RECOMMENDATION_MISMATCH',
  'INVALID_GROUNDING_CONTEXT',
] as const;

export type GroundingIssueCode = (typeof GROUNDING_ISSUE_CODES)[number];

export interface GroundingIssue {
  readonly code: GroundingIssueCode;
  readonly subject: string;
}

export const GROUNDING_REFERENCE_KINDS = [
  'EVIDENCE',
  'GRAPH_REVISION',
  'SIMULATION',
  'RANKING',
] as const;

export type GroundingReferenceKind = (typeof GROUNDING_REFERENCE_KINDS)[number];

export const GROUNDING_RANKING_DECISIONS = ['RECOMMEND', 'PRESENT_TRADE_OFF', 'ESCALATE'] as const;

export type GroundingRankingDecision = (typeof GROUNDING_RANKING_DECISIONS)[number];

export const GROUNDING_LIMITS = Object.freeze({
  claimId: Object.freeze({ minLength: 1, maxLength: 64 }),
  claimText: Object.freeze({ minLength: 1, maxLength: 500 }),
  referencesPerClaim: Object.freeze({ minItems: 1, maxItems: 12 }),
  referenceId: Object.freeze({ minLength: 1, maxLength: 128 }),
  summary: Object.freeze({ minLength: 1, maxLength: 1200 }),
  claims: Object.freeze({ minItems: 0, maxItems: 12 }),
  tradeOffs: Object.freeze({ minItems: 0, maxItems: 6 }),
  tradeOffText: Object.freeze({ minLength: 1, maxLength: 300 }),
  recommendationOptionId: Object.freeze({ minLength: 1, maxLength: 64 }),
});

export interface GroundedClaim {
  readonly claimId: string;
  readonly text: string;
  readonly references: readonly string[];
}

export interface GroundedReasoningResult {
  readonly summary: string;
  readonly claims: readonly GroundedClaim[];
  readonly recommendationOptionId: string | null;
  readonly disclosedTradeOffs: readonly string[];
}

export interface GroundingReference {
  readonly referenceId: string;
  readonly kind: GroundingReferenceKind;
}

export interface GroundingStatementTemplate {
  readonly statementId: string;
  readonly text: string;
  readonly requiredReferences: readonly string[];
}

export interface GroundingRanking {
  readonly decision: GroundingRankingDecision;
  readonly recommendedOptionId: string | null;
}

export interface GroundingContext {
  readonly graphRevision: number;
  readonly validReferences: readonly GroundingReference[];
  readonly allowedClaims: readonly GroundingStatementTemplate[];
  readonly allowedSummaries: readonly string[];
  readonly allowedTradeOffs: readonly string[];
  readonly ranking: GroundingRanking | null;
}

interface SchemaSuccess<T> {
  readonly success: true;
  readonly data: T;
}

interface SchemaFailure {
  readonly success: false;
}

type SchemaParse<T> = SchemaSuccess<T> | SchemaFailure;

const SCHEMA_FAILURE: SchemaFailure = Object.freeze({ success: false });

const CLAIM_KEYS = ['claimId', 'text', 'references'] as const;
const RESULT_KEYS = ['summary', 'claims', 'recommendationOptionId', 'disclosedTradeOffs'] as const;
const CONTEXT_KEYS = [
  'graphRevision',
  'validReferences',
  'allowedClaims',
  'allowedSummaries',
  'allowedTradeOffs',
  'ranking',
] as const;
const REFERENCE_KEYS = ['referenceId', 'kind'] as const;
const TEMPLATE_KEYS = ['statementId', 'text', 'requiredReferences'] as const;
const RANKING_KEYS = ['decision', 'recommendedOptionId'] as const;

export function graphRevisionReferenceId(graphRevision: number): string {
  return `GRAPH-REVISION:${String(graphRevision)}`;
}

function schemaFailure<T>(): SchemaParse<T> {
  return SCHEMA_FAILURE;
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

function isDenseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const names = Object.getOwnPropertyNames(value);
  const expected = new Set<string>(['length']);
  for (let index = 0; index < value.length; index += 1) {
    expected.add(String(index));
  }
  if (names.length !== expected.size) {
    return false;
  }
  for (const name of names) {
    if (!expected.has(name)) {
      return false;
    }
  }
  return true;
}

function boundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function readStringArray(
  value: unknown,
  minItems: number,
  maxItems: number,
  minLength: number,
  maxLength: number,
): readonly string[] | null {
  if (!isDenseArray(value) || value.length < minItems || value.length > maxItems) {
    return null;
  }
  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!boundedString(item, minLength, maxLength)) {
      return null;
    }
    items.push(item);
  }
  return Object.freeze(items);
}

function readOptionId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    boundedString(
      value,
      GROUNDING_LIMITS.recommendationOptionId.minLength,
      GROUNDING_LIMITS.recommendationOptionId.maxLength,
    )
  ) {
    return value;
  }
  return undefined;
}

function parseGroundedClaim(value: unknown): SchemaParse<GroundedClaim> {
  if (!isRecord(value) || !hasExactKeys(value, CLAIM_KEYS)) {
    return schemaFailure();
  }
  if (
    !boundedString(
      value.claimId,
      GROUNDING_LIMITS.claimId.minLength,
      GROUNDING_LIMITS.claimId.maxLength,
    )
  ) {
    return schemaFailure();
  }
  if (
    !boundedString(
      value.text,
      GROUNDING_LIMITS.claimText.minLength,
      GROUNDING_LIMITS.claimText.maxLength,
    )
  ) {
    return schemaFailure();
  }
  const references = readStringArray(
    value.references,
    GROUNDING_LIMITS.referencesPerClaim.minItems,
    GROUNDING_LIMITS.referencesPerClaim.maxItems,
    GROUNDING_LIMITS.referenceId.minLength,
    GROUNDING_LIMITS.referenceId.maxLength,
  );
  if (references === null) {
    return schemaFailure();
  }
  return {
    success: true,
    data: Object.freeze({
      claimId: value.claimId,
      text: value.text,
      references,
    }),
  };
}

function parseGroundedReasoningResult(value: unknown): SchemaParse<GroundedReasoningResult> {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) {
    return schemaFailure();
  }
  if (
    !boundedString(
      value.summary,
      GROUNDING_LIMITS.summary.minLength,
      GROUNDING_LIMITS.summary.maxLength,
    )
  ) {
    return schemaFailure();
  }
  if (
    !isDenseArray(value.claims) ||
    value.claims.length < GROUNDING_LIMITS.claims.minItems ||
    value.claims.length > GROUNDING_LIMITS.claims.maxItems
  ) {
    return schemaFailure();
  }
  const claims: GroundedClaim[] = [];
  for (let index = 0; index < value.claims.length; index += 1) {
    const parsed = parseGroundedClaim(value.claims[index]);
    if (!parsed.success) {
      return schemaFailure();
    }
    claims.push(parsed.data);
  }
  const recommendationOptionId = readOptionId(value.recommendationOptionId);
  if (recommendationOptionId === undefined) {
    return schemaFailure();
  }
  const disclosedTradeOffs = readStringArray(
    value.disclosedTradeOffs,
    GROUNDING_LIMITS.tradeOffs.minItems,
    GROUNDING_LIMITS.tradeOffs.maxItems,
    GROUNDING_LIMITS.tradeOffText.minLength,
    GROUNDING_LIMITS.tradeOffText.maxLength,
  );
  if (disclosedTradeOffs === null) {
    return schemaFailure();
  }
  return {
    success: true,
    data: Object.freeze({
      summary: value.summary,
      claims: Object.freeze(claims),
      recommendationOptionId,
      disclosedTradeOffs,
    }),
  };
}

export const GroundedClaimSchema = Object.freeze({
  strict: true as const,
  safeParse: parseGroundedClaim,
});

export const GroundedReasoningResultSchema = Object.freeze({
  strict: true as const,
  safeParse: parseGroundedReasoningResult,
});

function readGraphRevision(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function readReferenceKind(value: unknown): GroundingReferenceKind | null {
  if (
    value === 'EVIDENCE' ||
    value === 'GRAPH_REVISION' ||
    value === 'SIMULATION' ||
    value === 'RANKING'
  ) {
    return value;
  }
  return null;
}

function parseReference(value: unknown): GroundingReference | null {
  if (!isRecord(value) || !hasExactKeys(value, REFERENCE_KEYS)) {
    return null;
  }
  if (
    !boundedString(
      value.referenceId,
      GROUNDING_LIMITS.referenceId.minLength,
      GROUNDING_LIMITS.referenceId.maxLength,
    )
  ) {
    return null;
  }
  const kind = readReferenceKind(value.kind);
  if (kind === null) {
    return null;
  }
  return Object.freeze({ referenceId: value.referenceId, kind });
}

function parseReferences(value: unknown): readonly GroundingReference[] | null {
  if (!isDenseArray(value)) {
    return null;
  }
  const references: GroundingReference[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseReference(value[index]);
    if (parsed === null || seen.has(parsed.referenceId)) {
      return null;
    }
    seen.add(parsed.referenceId);
    references.push(parsed);
  }
  return Object.freeze(references);
}

function revisionReferencesMatch(
  graphRevision: number,
  references: readonly GroundingReference[],
): boolean {
  const expected = graphRevisionReferenceId(graphRevision);
  let found = false;
  for (const reference of references) {
    if (reference.kind !== 'GRAPH_REVISION') {
      continue;
    }
    if (reference.referenceId !== expected) {
      return false;
    }
    found = true;
  }
  return found;
}

function parseRequiredReferences(
  value: unknown,
  knownReferences: ReadonlySet<string>,
): readonly string[] | null {
  const references = readStringArray(
    value,
    GROUNDING_LIMITS.referencesPerClaim.minItems,
    GROUNDING_LIMITS.referencesPerClaim.maxItems,
    GROUNDING_LIMITS.referenceId.minLength,
    GROUNDING_LIMITS.referenceId.maxLength,
  );
  if (references === null) {
    return null;
  }
  const seen = new Set<string>();
  for (const referenceId of references) {
    if (!knownReferences.has(referenceId) || seen.has(referenceId)) {
      return null;
    }
    seen.add(referenceId);
  }
  return references;
}

function parseTemplate(
  value: unknown,
  knownReferences: ReadonlySet<string>,
): GroundingStatementTemplate | null {
  if (!isRecord(value) || !hasExactKeys(value, TEMPLATE_KEYS)) {
    return null;
  }
  if (
    !boundedString(
      value.statementId,
      GROUNDING_LIMITS.claimId.minLength,
      GROUNDING_LIMITS.claimId.maxLength,
    ) ||
    !boundedString(
      value.text,
      GROUNDING_LIMITS.claimText.minLength,
      GROUNDING_LIMITS.claimText.maxLength,
    )
  ) {
    return null;
  }
  const requiredReferences = parseRequiredReferences(value.requiredReferences, knownReferences);
  if (requiredReferences === null) {
    return null;
  }
  return Object.freeze({
    statementId: value.statementId,
    text: value.text,
    requiredReferences,
  });
}

function parseTemplates(
  value: unknown,
  knownReferences: ReadonlySet<string>,
): readonly GroundingStatementTemplate[] | null {
  if (!isDenseArray(value)) {
    return null;
  }
  const templates: GroundingStatementTemplate[] = [];
  const statementIds = new Set<string>();
  const texts = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseTemplate(value[index], knownReferences);
    if (parsed === null || statementIds.has(parsed.statementId) || texts.has(parsed.text)) {
      return null;
    }
    statementIds.add(parsed.statementId);
    texts.add(parsed.text);
    templates.push(parsed);
  }
  return Object.freeze(templates);
}

function parseUniqueStrings(
  value: unknown,
  minLength: number,
  maxLength: number,
): readonly string[] | null {
  const items = readStringArray(value, 0, Number.MAX_SAFE_INTEGER, minLength, maxLength);
  if (items === null) {
    return null;
  }
  if (new Set(items).size !== items.length) {
    return null;
  }
  return items;
}

function parseRanking(value: unknown): GroundingRanking | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(value, RANKING_KEYS)) {
    return undefined;
  }
  if (value.decision === 'RECOMMEND') {
    if (
      !boundedString(
        value.recommendedOptionId,
        GROUNDING_LIMITS.recommendationOptionId.minLength,
        GROUNDING_LIMITS.recommendationOptionId.maxLength,
      )
    ) {
      return undefined;
    }
    return Object.freeze({
      decision: 'RECOMMEND',
      recommendedOptionId: value.recommendedOptionId,
    });
  }
  if (value.decision === 'PRESENT_TRADE_OFF' || value.decision === 'ESCALATE') {
    if (value.recommendedOptionId !== null) {
      return undefined;
    }
    return Object.freeze({
      decision: value.decision,
      recommendedOptionId: null,
    });
  }
  return undefined;
}

export function parseGroundingContext(value: unknown): SchemaParse<GroundingContext> {
  if (!isRecord(value) || !hasExactKeys(value, CONTEXT_KEYS)) {
    return schemaFailure();
  }
  const graphRevision = readGraphRevision(value.graphRevision);
  const validReferences = parseReferences(value.validReferences);
  if (graphRevision === null || validReferences === null) {
    return schemaFailure();
  }
  if (!revisionReferencesMatch(graphRevision, validReferences)) {
    return schemaFailure();
  }
  const knownReferences = new Set(validReferences.map((reference) => reference.referenceId));
  const allowedClaims = parseTemplates(value.allowedClaims, knownReferences);
  const allowedSummaries = parseUniqueStrings(
    value.allowedSummaries,
    GROUNDING_LIMITS.summary.minLength,
    GROUNDING_LIMITS.summary.maxLength,
  );
  const allowedTradeOffs = parseUniqueStrings(
    value.allowedTradeOffs,
    GROUNDING_LIMITS.tradeOffText.minLength,
    GROUNDING_LIMITS.tradeOffText.maxLength,
  );
  const ranking = parseRanking(value.ranking);
  if (allowedClaims === null || allowedSummaries === null || allowedTradeOffs === null) {
    return schemaFailure();
  }
  if (ranking === undefined) {
    return schemaFailure();
  }
  return {
    success: true,
    data: Object.freeze({
      graphRevision,
      validReferences,
      allowedClaims,
      allowedSummaries,
      allowedTradeOffs,
      ranking,
    }),
  };
}
