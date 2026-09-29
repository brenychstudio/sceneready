import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GROUNDING_ISSUE_CODES,
  GroundedClaimSchema,
  GroundedReasoningResultSchema,
  graphRevisionReferenceId,
  type GroundedClaim,
  type GroundedReasoningResult,
  type GroundingContext,
} from './grounding-schema.js';
import {
  validateGroundedReasoning,
  type GroundingAttempt,
  type GroundingValidationResult,
} from './grounding-validator.js';

const GRAPH_REVISION = 2;
const OPTION_A = 'OPTION-A';
const EVIDENCE_R2 = 'EVIDENCE:R2-READINESS';
const EVIDENCE_GOTHIC = 'EVIDENCE:GOTHIC-RISK';
const SIMULATION_A = 'SIMULATION:SHADOW-A';
const RANKING_REFERENCE = 'RANKING:RECOVERY';
const R2_TEXT = 'R2 readiness is 74.';
const SHADOW_TEXT = 'Shadow A readiness is 89.';
const CREATIVE_TEXT = 'Creative preservation is 95.';
const GOTHIC_TEXT = 'Gothic risk CRITICAL was removed.';
const STUDIO_TEXT = 'Studio risk moved from MEDIUM to LOW.';
const RANKING_TEXT = 'Deterministic ranking recommends the selected recovery option.';
const REVISION_TEXT = 'Current graph revision is 2.';
const CANONICAL_SUMMARY =
  'R2 readiness is 74. Shadow A readiness is 89. Creative preservation is 95. Gothic risk CRITICAL was removed. Studio risk moved from MEDIUM to LOW.';
const TRADEOFF = 'Studio coverage narrows when Gothic risk CRITICAL is removed.';
const CLIENT_PREFERENCE = 'The client will prefer Option A.';
const CURRENT_EVIDENCE = 'EVIDENCE:CURRENT';
const CURRENT_TEXT = 'Current readiness is recorded.';
const CURRENT_SUMMARY = 'Current readiness is explained from recorded evidence.';

function validate(
  output: unknown,
  context: unknown,
  attempt: GroundingAttempt = 'INITIAL_ATTEMPT',
): GroundingValidationResult {
  return validateGroundedReasoning({ output, context, attempt });
}

function rejected(
  issues: readonly { readonly code: string; readonly subject: string }[],
  disposition: 'REGENERATE_ONCE' | 'USE_DETERMINISTIC_EXPLANATION' = 'REGENERATE_ONCE',
) {
  return { ok: false, issues, disposition };
}

function canonicalContext(): GroundingContext {
  const revision = graphRevisionReferenceId(GRAPH_REVISION);
  return {
    graphRevision: GRAPH_REVISION,
    validReferences: [
      { referenceId: revision, kind: 'GRAPH_REVISION' },
      { referenceId: EVIDENCE_R2, kind: 'EVIDENCE' },
      { referenceId: EVIDENCE_GOTHIC, kind: 'EVIDENCE' },
      { referenceId: SIMULATION_A, kind: 'SIMULATION' },
      { referenceId: RANKING_REFERENCE, kind: 'RANKING' },
    ],
    allowedClaims: [
      { statementId: 'readiness-r2', text: R2_TEXT, requiredReferences: [EVIDENCE_R2] },
      { statementId: 'readiness-shadow', text: SHADOW_TEXT, requiredReferences: [SIMULATION_A] },
      {
        statementId: 'creative-preservation',
        text: CREATIVE_TEXT,
        requiredReferences: [SIMULATION_A],
      },
      {
        statementId: 'gothic-risk',
        text: GOTHIC_TEXT,
        requiredReferences: [EVIDENCE_GOTHIC, revision],
      },
      { statementId: 'studio-risk', text: STUDIO_TEXT, requiredReferences: [SIMULATION_A] },
      {
        statementId: 'ranking',
        text: RANKING_TEXT,
        requiredReferences: [RANKING_REFERENCE, revision],
      },
      { statementId: 'graph-revision', text: REVISION_TEXT, requiredReferences: [revision] },
    ],
    allowedSummaries: [CANONICAL_SUMMARY],
    allowedTradeOffs: [TRADEOFF],
    ranking: { decision: 'RECOMMEND', recommendedOptionId: OPTION_A },
  };
}

function canonicalOutput(): GroundedReasoningResult {
  const revision = graphRevisionReferenceId(GRAPH_REVISION);
  return {
    summary: CANONICAL_SUMMARY,
    claims: [
      { claimId: 'readiness-r2', text: R2_TEXT, references: [EVIDENCE_R2] },
      { claimId: 'readiness-shadow', text: SHADOW_TEXT, references: [SIMULATION_A] },
      { claimId: 'creative-preservation', text: CREATIVE_TEXT, references: [SIMULATION_A] },
      { claimId: 'gothic-risk', text: GOTHIC_TEXT, references: [EVIDENCE_GOTHIC, revision] },
      { claimId: 'studio-risk', text: STUDIO_TEXT, references: [SIMULATION_A] },
      { claimId: 'ranking', text: RANKING_TEXT, references: [RANKING_REFERENCE, revision] },
      { claimId: 'graph-revision', text: REVISION_TEXT, references: [revision] },
    ],
    recommendationOptionId: OPTION_A,
    disclosedTradeOffs: [TRADEOFF],
  };
}

function currentContext(): GroundingContext {
  const revision = graphRevisionReferenceId(4);
  return {
    graphRevision: 4,
    validReferences: [
      { referenceId: revision, kind: 'GRAPH_REVISION' },
      { referenceId: CURRENT_EVIDENCE, kind: 'EVIDENCE' },
    ],
    allowedClaims: [
      {
        statementId: 'current-readiness',
        text: CURRENT_TEXT,
        requiredReferences: [CURRENT_EVIDENCE, revision],
      },
    ],
    allowedSummaries: [CURRENT_SUMMARY],
    allowedTradeOffs: [],
    ranking: null,
  };
}

function currentOutput(): GroundedReasoningResult {
  const revision = graphRevisionReferenceId(4);
  return {
    summary: CURRENT_SUMMARY,
    claims: [
      {
        claimId: 'current-readiness',
        text: CURRENT_TEXT,
        references: [CURRENT_EVIDENCE, revision],
      },
    ],
    recommendationOptionId: null,
    disclosedTradeOffs: [],
  };
}

function withClaim(
  output: GroundedReasoningResult,
  claimId: string,
  patch: { readonly text?: string; readonly references?: readonly string[] },
): GroundedReasoningResult {
  return {
    ...output,
    claims: output.claims.map((claim) =>
      claim.claimId === claimId ? { ...claim, ...patch } : claim,
    ),
  };
}

function structuredResult(patch: Partial<GroundedReasoningResult> = {}): GroundedReasoningResult {
  return { ...currentOutput(), ...patch };
}

describe('evidence-grounded reasoning validator', () => {
  it('accepts a supported current claim', () => {
    expect(validate(currentOutput(), currentContext())).toEqual({
      ok: true,
      data: currentOutput(),
    });
  });

  it('accepts the canonical grounded explanation', () => {
    const result = validate(canonicalOutput(), canonicalContext());
    expect(result).toEqual({ ok: true, data: canonicalOutput() });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.claims.map((claim) => claim.text)).toEqual([
      R2_TEXT,
      SHADOW_TEXT,
      CREATIVE_TEXT,
      GOTHIC_TEXT,
      STUDIO_TEXT,
      RANKING_TEXT,
      REVISION_TEXT,
    ]);
    expect(result.data.summary).toContain('74');
    expect(result.data.summary).toContain('89');
    expect(result.data.summary).toContain('95');
    expect(result.data.disclosedTradeOffs).toEqual([TRADEOFF]);
  });

  it('rejects an unsupported client-preference claim and summary', () => {
    const output = {
      ...canonicalOutput(),
      summary: CLIENT_PREFERENCE,
      claims: [
        { claimId: 'client-preference', text: CLIENT_PREFERENCE, references: [SIMULATION_A] },
      ],
      recommendationOptionId: null,
      disclosedTradeOffs: [],
    };
    expect(validate(output, canonicalContext())).toEqual(
      rejected([
        { code: 'UNSUPPORTED_CLAIM', subject: 'client-preference' },
        { code: 'UNSUPPORTED_SUMMARY', subject: 'summary' },
      ]),
    );
  });

  it('does not let a valid reference legitimize an unsupported claim', () => {
    const context = canonicalContext();
    expect(context.validReferences.map((reference) => reference.referenceId)).toContain(
      SIMULATION_A,
    );
    const output = withClaim(canonicalOutput(), 'readiness-shadow', { text: CLIENT_PREFERENCE });
    const result = validate(output, context);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toEqual([{ code: 'UNSUPPORTED_CLAIM', subject: 'readiness-shadow' }]);
    expect(result.issues.some((issue) => issue.code === 'UNKNOWN_REFERENCE')).toBe(false);
  });

  it('rejects an unknown evidence reference', () => {
    const output = withClaim(canonicalOutput(), 'readiness-r2', {
      references: ['EVIDENCE:UNKNOWN'],
    });
    expect(validate(output, canonicalContext())).toEqual(
      rejected([
        { code: 'REFERENCE_MISMATCH', subject: 'readiness-r2' },
        { code: 'UNKNOWN_REFERENCE', subject: 'EVIDENCE:UNKNOWN' },
      ]),
    );
  });

  it('rejects an unknown simulation reference', () => {
    const output = withClaim(canonicalOutput(), 'readiness-shadow', {
      references: ['SIMULATION:UNKNOWN'],
    });
    expect(validate(output, canonicalContext())).toEqual(
      rejected([
        { code: 'REFERENCE_MISMATCH', subject: 'readiness-shadow' },
        { code: 'UNKNOWN_REFERENCE', subject: 'SIMULATION:UNKNOWN' },
      ]),
    );
  });

  it('rejects a stale graph revision reference', () => {
    const stale = graphRevisionReferenceId(1);
    const output = withClaim(canonicalOutput(), 'graph-revision', { references: [stale] });
    expect(validate(output, canonicalContext())).toEqual(
      rejected([
        { code: 'REFERENCE_MISMATCH', subject: 'graph-revision' },
        { code: 'UNKNOWN_REFERENCE', subject: stale },
      ]),
    );
  });

  it('rejects an unknown ranking reference', () => {
    const revision = graphRevisionReferenceId(GRAPH_REVISION);
    const output = withClaim(canonicalOutput(), 'ranking', {
      references: ['RANKING:UNKNOWN', revision],
    });
    expect(validate(output, canonicalContext())).toEqual(
      rejected([
        { code: 'REFERENCE_MISMATCH', subject: 'ranking' },
        { code: 'UNKNOWN_REFERENCE', subject: 'RANKING:UNKNOWN' },
      ]),
    );
  });

  it('rejects a missing required claim reference', () => {
    const output = withClaim(canonicalOutput(), 'gothic-risk', {
      references: [EVIDENCE_GOTHIC],
    });
    expect(validate(output, canonicalContext())).toEqual(
      rejected([{ code: 'REFERENCE_MISMATCH', subject: 'gothic-risk' }]),
    );
  });

  it('handles extra and reordered claim references deterministically', () => {
    const revision = graphRevisionReferenceId(GRAPH_REVISION);
    const extra = withClaim(canonicalOutput(), 'gothic-risk', {
      references: [EVIDENCE_GOTHIC, revision, SIMULATION_A],
    });
    const first = validate(extra, canonicalContext());
    const second = validate(extra, canonicalContext());
    const expected = rejected([{ code: 'REFERENCE_MISMATCH', subject: 'gothic-risk' }]);
    expect(first).toEqual(expected);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const reordered = withClaim(canonicalOutput(), 'gothic-risk', {
      references: [revision, EVIDENCE_GOTHIC],
    });
    const reorderedResult = validate(reordered, canonicalContext());
    expect(reorderedResult).toEqual({ ok: true, data: reordered });
    expect(reorderedResult.ok).toBe(true);
    if (reorderedResult.ok) {
      const gothic = reorderedResult.data.claims.find((claim) => claim.claimId === 'gothic-risk');
      expect(gothic?.references).toEqual([revision, EVIDENCE_GOTHIC]);
    }

    const repeated = withClaim(canonicalOutput(), 'readiness-r2', {
      references: [EVIDENCE_R2, EVIDENCE_R2],
    });
    expect(validate(repeated, canonicalContext())).toEqual({ ok: true, data: repeated });
  });

  it('rejects a duplicate claimId', () => {
    const output = canonicalOutput();
    const duplicate: GroundedClaim = {
      claimId: 'readiness-r2',
      text: SHADOW_TEXT,
      references: [SIMULATION_A],
    };
    const parsed = GroundedReasoningResultSchema.safeParse({
      ...output,
      claims: [...output.claims, duplicate],
    });
    expect(parsed.success).toBe(true);
    expect(
      validate({ ...output, claims: [...output.claims, duplicate] }, canonicalContext()),
    ).toEqual(rejected([{ code: 'DUPLICATE_CLAIM_ID', subject: 'readiness-r2' }]));
  });

  it('rejects an unsupported summary', () => {
    const output = { ...canonicalOutput(), summary: CLIENT_PREFERENCE };
    expect(validate(output, canonicalContext())).toEqual(
      rejected([{ code: 'UNSUPPORTED_SUMMARY', subject: 'summary' }]),
    );
  });

  it('rejects an unsupported trade-off', () => {
    const tradeoff = 'Crew morale improves if the selected option is chosen.';
    const output = { ...canonicalOutput(), disclosedTradeOffs: [tradeoff] };
    expect(validate(output, canonicalContext())).toEqual(
      rejected([{ code: 'UNSUPPORTED_TRADEOFF', subject: tradeoff }]),
    );
  });

  it('accepts a recommendation that exactly matches RECOMMEND', () => {
    const context = canonicalContext();
    const result = validate(canonicalOutput(), context);
    expect(context.ranking).toEqual({ decision: 'RECOMMEND', recommendedOptionId: OPTION_A });
    expect(result).toEqual({ ok: true, data: canonicalOutput() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.recommendationOptionId).toBe(OPTION_A);
    }
  });

  it('rejects a recommendation that differs from deterministic ranking', () => {
    const output = { ...canonicalOutput(), recommendationOptionId: 'OPTION-B' };
    expect(validate(output, canonicalContext())).toEqual(
      rejected([{ code: 'RECOMMENDATION_MISMATCH', subject: 'recommendationOptionId' }]),
    );
  });

  it('rejects a recommendation when ranking presents a trade-off', () => {
    const context: GroundingContext = {
      ...canonicalContext(),
      ranking: { decision: 'PRESENT_TRADE_OFF', recommendedOptionId: null },
    };
    expect(validate({ ...canonicalOutput(), recommendationOptionId: OPTION_A }, context)).toEqual(
      rejected([{ code: 'RECOMMENDATION_MISMATCH', subject: 'recommendationOptionId' }]),
    );
    const withheld = { ...canonicalOutput(), recommendationOptionId: null };
    expect(validate(withheld, context)).toEqual({ ok: true, data: withheld });
  });

  it('rejects a recommendation when ranking escalates', () => {
    const context: GroundingContext = {
      ...canonicalContext(),
      ranking: { decision: 'ESCALATE', recommendedOptionId: null },
    };
    expect(validate({ ...canonicalOutput(), recommendationOptionId: 'OPTION-B' }, context)).toEqual(
      rejected([{ code: 'RECOMMENDATION_MISMATCH', subject: 'recommendationOptionId' }]),
    );
    const withheld = { ...canonicalOutput(), recommendationOptionId: null };
    expect(validate(withheld, context)).toEqual({ ok: true, data: withheld });
  });

  it('rejects malformed reasoning output', () => {
    expect(GROUNDING_ISSUE_CODES).toEqual([
      'INVALID_REASONING_SCHEMA',
      'DUPLICATE_CLAIM_ID',
      'UNKNOWN_REFERENCE',
      'REFERENCE_MISMATCH',
      'UNSUPPORTED_CLAIM',
      'UNSUPPORTED_SUMMARY',
      'UNSUPPORTED_TRADEOFF',
      'RECOMMENDATION_MISMATCH',
      'INVALID_GROUNDING_CONTEXT',
    ]);
    expect(GroundedClaimSchema.strict).toBe(true);
    expect(GroundedReasoningResultSchema.strict).toBe(true);

    const valid = structuredResult();
    expect(GroundedReasoningResultSchema.safeParse(valid).success).toBe(true);
    expect(
      GroundedReasoningResultSchema.safeParse({
        ...valid,
        summary: 'a'.repeat(1200),
        claims: [
          {
            claimId: 'a'.repeat(64),
            text: 'a'.repeat(500),
            references: ['b'.repeat(128)],
          },
        ],
        recommendationOptionId: 'c'.repeat(64),
        disclosedTradeOffs: ['d'.repeat(300)],
      }).success,
    ).toBe(true);

    const malformed = [
      null,
      [],
      'explanation',
      { ...valid, summary: '' },
      { ...valid, summary: 'a'.repeat(1201) },
      {
        ...valid,
        claims: Array.from({ length: 13 }, () => ({
          claimId: 'claim-1',
          text: CURRENT_TEXT,
          references: [CURRENT_EVIDENCE],
        })),
      },
      {
        ...valid,
        claims: [{ claimId: '', text: CURRENT_TEXT, references: [CURRENT_EVIDENCE] }],
      },
      {
        ...valid,
        claims: [{ claimId: 'a'.repeat(65), text: CURRENT_TEXT, references: [CURRENT_EVIDENCE] }],
      },
      {
        ...valid,
        claims: [{ claimId: 'claim-1', text: '', references: [CURRENT_EVIDENCE] }],
      },
      {
        ...valid,
        claims: [{ claimId: 'claim-1', text: 'a'.repeat(501), references: [CURRENT_EVIDENCE] }],
      },
      { ...valid, claims: [{ claimId: 'claim-1', text: CURRENT_TEXT, references: [] }] },
      {
        ...valid,
        claims: [
          {
            claimId: 'claim-1',
            text: CURRENT_TEXT,
            references: Array.from({ length: 13 }, (_, index) => `EVIDENCE:${index}`),
          },
        ],
      },
      {
        ...valid,
        claims: [{ claimId: 'claim-1', text: CURRENT_TEXT, references: [''] }],
      },
      {
        ...valid,
        claims: [{ claimId: 'claim-1', text: CURRENT_TEXT, references: ['a'.repeat(129)] }],
      },
      { ...valid, recommendationOptionId: '' },
      { ...valid, recommendationOptionId: 'a'.repeat(65) },
      { ...valid, disclosedTradeOffs: [''] },
      { ...valid, disclosedTradeOffs: ['a'.repeat(301)] },
      { ...valid, disclosedTradeOffs: Array.from({ length: 7 }, () => 'trade') },
      { summary: valid.summary, claims: valid.claims, recommendationOptionId: null },
      { ...valid, unexpected: true },
      { ...valid, claims: [{ ...valid.claims[0], note: 'free text' }] },
    ];
    for (const output of malformed) {
      expect(GroundedReasoningResultSchema.safeParse(output).success).toBe(false);
      expect(validate(output, currentContext())).toEqual(
        rejected([{ code: 'INVALID_REASONING_SCHEMA', subject: 'output' }]),
      );
    }

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validate(circular, currentContext())).not.toThrow();
    expect(validate(circular, currentContext())).toEqual(
      rejected([{ code: 'INVALID_REASONING_SCHEMA', subject: 'output' }]),
    );
  });

  it('rejects hidden reasoning fields', () => {
    const valid = structuredResult();
    const hiddenNames = [
      'chainOfThought',
      'reasoningTrace',
      'internalReasoning',
      'hiddenReasoning',
      'scratchpad',
    ];
    for (const name of hiddenNames) {
      const output = { ...valid, [name]: 'not evidence' };
      expect(GroundedReasoningResultSchema.safeParse(output).success).toBe(false);
      expect(validate(output, currentContext())).toEqual(
        rejected([{ code: 'INVALID_REASONING_SCHEMA', subject: 'output' }]),
      );
    }
    const claim = valid.claims[0];
    expect(claim).toBeDefined();
    const hiddenClaim = {
      ...valid,
      claims: [{ ...claim, chainOfThought: 'not evidence' }],
    };
    expect(GroundedClaimSchema.safeParse(hiddenClaim.claims[0]).success).toBe(false);
    expect(validate(hiddenClaim, currentContext())).toEqual(
      rejected([{ code: 'INVALID_REASONING_SCHEMA', subject: 'output' }]),
    );
    const symbolOutput = { ...valid, [Symbol('scratchpad')]: 'not evidence' };
    expect(GroundedReasoningResultSchema.safeParse(symbolOutput).success).toBe(false);
  });

  it('fails closed on a malformed grounding context', () => {
    const output = canonicalOutput();
    const revision = graphRevisionReferenceId(GRAPH_REVISION);
    const base = canonicalContext();
    const malformed = [
      null,
      [],
      { ...base, graphRevision: '2' },
      { ...base, graphRevision: -1 },
      { ...base, graphRevision: 2.5 },
      {
        ...base,
        validReferences: base.validReferences.filter(
          (reference) => reference.kind !== 'GRAPH_REVISION',
        ),
      },
      {
        ...base,
        validReferences: base.validReferences.map((reference) =>
          reference.kind === 'GRAPH_REVISION'
            ? { ...reference, referenceId: graphRevisionReferenceId(1) }
            : reference,
        ),
      },
      {
        ...base,
        validReferences: [
          ...base.validReferences,
          { referenceId: EVIDENCE_R2, kind: 'SIMULATION' },
        ],
      },
      {
        ...base,
        allowedClaims: [
          {
            statementId: 'missing-evidence',
            text: 'This statement cites missing evidence.',
            requiredReferences: ['EVIDENCE:MISSING'],
          },
        ],
      },
      {
        ...base,
        allowedClaims: [
          ...base.allowedClaims,
          { statementId: 'duplicate-text', text: R2_TEXT, requiredReferences: [EVIDENCE_R2] },
        ],
      },
      { ...base, ranking: { decision: 'RECOMMEND', recommendedOptionId: null } },
      { ...base, ranking: { decision: 'PRESENT_TRADE_OFF', recommendedOptionId: OPTION_A } },
      { ...base, ranking: { decision: 'ESCALATE', recommendedOptionId: 'OPTION-B' } },
      { ...base, ranking: { decision: 'APPROVE', recommendedOptionId: null } },
      { ...base, chainOfThought: 'hidden' },
      { ...base, allowedSummaries: [() => 'callback'] },
      {
        ...base,
        validReferences: [{ referenceId: revision, kind: 'AUTHORITY' }],
      },
      {
        ...base,
        allowedClaims: [{ statementId: 'empty-refs', text: R2_TEXT, requiredReferences: [] }],
      },
    ];
    for (const context of malformed) {
      expect(validate(output, context)).toEqual(
        rejected([{ code: 'INVALID_GROUNDING_CONTEXT', subject: 'context' }]),
      );
    }
  });

  it('regenerates an invalid initial attempt once', () => {
    const output = { ...canonicalOutput(), summary: CLIENT_PREFERENCE };
    const result = validate(output, canonicalContext(), 'INITIAL_ATTEMPT');
    expect(result).toEqual(
      rejected([{ code: 'UNSUPPORTED_SUMMARY', subject: 'summary' }], 'REGENERATE_ONCE'),
    );
  });

  it('falls back to deterministic explanation after a failed retry', () => {
    const output = { ...canonicalOutput(), summary: CLIENT_PREFERENCE };
    const context = canonicalContext();
    const initial = validate(output, context, 'INITIAL_ATTEMPT');
    const retry = validate(output, context, 'RETRY_ATTEMPT');
    expect(initial.ok).toBe(false);
    expect(retry.ok).toBe(false);
    if (initial.ok || retry.ok) {
      return;
    }
    expect(initial.disposition).toBe('REGENERATE_ONCE');
    expect(retry.disposition).toBe('USE_DETERMINISTIC_EXPLANATION');
    expect(retry.issues).toEqual(initial.issues);
    expect(retry).toEqual(
      rejected(
        [{ code: 'UNSUPPORTED_SUMMARY', subject: 'summary' }],
        'USE_DETERMINISTIC_EXPLANATION',
      ),
    );
  });

  it('returns a byte-equivalent result for the same input', () => {
    const successInput = {
      output: canonicalOutput(),
      context: canonicalContext(),
      attempt: 'INITIAL_ATTEMPT' as const,
    };
    const first = validateGroundedReasoning(successInput);
    const second = validateGroundedReasoning({
      output: canonicalOutput(),
      context: canonicalContext(),
      attempt: 'INITIAL_ATTEMPT',
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toEqual(second);
    expect(first).not.toBe(second);

    const failureOutput = { ...canonicalOutput(), summary: CLIENT_PREFERENCE };
    const failureContext = canonicalContext();
    expect(JSON.stringify(validate(failureOutput, failureContext))).toBe(
      JSON.stringify(validate(failureOutput, failureContext)),
    );
  });

  it('does not mutate the validation input', () => {
    const output = canonicalOutput();
    const context = canonicalContext();
    const request = { output, context, attempt: 'INITIAL_ATTEMPT' as const };
    const outputJson = JSON.stringify(output);
    const contextJson = JSON.stringify(context);
    const requestJson = JSON.stringify(request);
    const claims = output.claims;
    const references = context.validReferences;
    const templates = context.allowedClaims;
    const result = validateGroundedReasoning(request);
    expect(JSON.stringify(output)).toBe(outputJson);
    expect(JSON.stringify(context)).toBe(contextJson);
    expect(JSON.stringify(request)).toBe(requestJson);
    expect(output.claims).toBe(claims);
    expect(context.validReferences).toBe(references);
    expect(context.allowedClaims).toBe(templates);
    expect(Object.isFrozen(output)).toBe(false);
    expect(Object.isFrozen(context)).toBe(false);
    expect(Object.isFrozen(request)).toBe(false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toBe(output);
      expect(result.data.claims).not.toBe(output.claims);
      expect(result.data.claims[0]).not.toBe(output.claims[0]);
    }
  });

  it('returns an immutable validation result', () => {
    const result = validate(canonicalOutput(), canonicalContext());
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.data)).toBe(true);
      expect(Object.isFrozen(result.data.claims)).toBe(true);
      expect(Object.isFrozen(result.data.claims[0])).toBe(true);
      expect(Object.isFrozen(result.data.claims[0]?.references)).toBe(true);
      expect(Object.isFrozen(result.data.disclosedTradeOffs)).toBe(true);
    }
    const failure = validate(
      { ...canonicalOutput(), summary: CLIENT_PREFERENCE },
      canonicalContext(),
    );
    expect(Object.isFrozen(failure)).toBe(true);
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(Object.isFrozen(failure.issues)).toBe(true);
      expect(Object.isFrozen(failure.issues[0])).toBe(true);
    }
    const snapshot = JSON.stringify(result);
    expect(() => {
      (result as { ok: boolean }).ok = false;
    }).toThrow(TypeError);
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it('keeps grounding runtime free of evidence, authority, model, and scenario surfaces', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const schemaSource = readFileSync(join(directory, 'grounding-schema.ts'), 'utf8');
    const validatorSource = readFileSync(join(directory, 'grounding-validator.ts'), 'utf8');
    const source = `${schemaSource}\n${validatorSource}`;
    const forbidden = [
      'appendEvidence',
      'writeEvidence',
      'createEvidence',
      'evidenceLedger.put',
      'evidenceIndex.add',
      'approve',
      'issueToken',
      'executeProduction',
      'mutateProduction',
      'sendNotification',
      'Bedrock',
      'bedrock',
      'Strands',
      'strands',
      'fetch(',
      'Date.now',
      'Math.random',
      'randomUUID',
      'node:fs',
      'node:http',
      'node:net',
      'node:crypto',
      'process.env',
      'OPTION-A',
      'BCN-DEMO',
      'GOTHIC',
      "from 'zod'",
      'chainOfThought',
      'reasoningTrace',
      'internalReasoning',
      'hiddenReasoning',
      'scratchpad',
      'import(',
    ];
    for (const pattern of forbidden) {
      expect(source).not.toContain(pattern);
    }
    expect(schemaSource).not.toContain(' from ');
    expect(validatorSource).toContain("from './grounding-schema.js'");
    const specifiers = [...validatorSource.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(specifiers).toEqual(['./grounding-schema.js']);
  });
});
