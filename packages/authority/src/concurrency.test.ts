import {
  createProposalFingerprint,
  type ApprovalSigner,
  type AuthorityProposal,
  type BoundApprovalClaims,
} from '@sceneready/mcp-human-authority';
import { describe, expect, it } from 'vitest';

import {
  InMemoryAuthoritativeState,
  applyConditionalRevision,
  type AuthoritativeScope,
  type ConditionalRevisionInput,
} from './index.js';

const NOW = '2026-09-17T03:45:00.000Z';
const EXPIRES = '2026-09-17T03:47:00.000Z';
const BASE_STATE = { schedule: 'BASE' };
const NEXT_STATE = { schedule: 'NEXT' };

function proposal(overrides: Partial<AuthorityProposal> = {}): AuthorityProposal {
  return {
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    proposalId: 'PROP-1',
    baseProductionRevision: 14,
    baseGraphRevision: 9,
    policyVersion: 'SR-POLICY-v1',
    interventions: [{ kind: 'ADD_BUFFER', beforeActivityId: 'ACT-EIXAMPLE-SETUP', minutes: 10 }],
    affectedRecipients: [],
    notificationPayloads: [],
    predictedEffects: [],
    ...overrides,
  };
}

function scope(overrides: Partial<AuthoritativeScope> = {}): AuthoritativeScope {
  return {
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    authorityNamespace: 'LIVE',
    ...overrides,
  };
}

function claimsFor(
  current: AuthorityProposal,
  overrides: Partial<BoundApprovalClaims> = {},
): BoundApprovalClaims {
  return {
    tokenId: 'TOKEN-1',
    accountId: current.accountId,
    productionId: current.productionId,
    authorityNamespace: 'LIVE',
    proposalId: current.proposalId,
    proposalFingerprint: createProposalFingerprint(current),
    baseProductionRevision: current.baseProductionRevision,
    baseGraphRevision: current.baseGraphRevision,
    policyVersion: current.policyVersion,
    actorId: 'ACTOR-PRODUCTION_LEAD',
    role: 'PRODUCTION_LEAD',
    issuedAt: NOW,
    expiresAt: EXPIRES,
    singleUse: true,
    ...overrides,
  };
}

function signerFor(claims: BoundApprovalClaims): ApprovalSigner & { readonly verifies: number } {
  const seen = { verifies: 0 };
  return {
    get verifies() {
      return seen.verifies;
    },
    sign() {
      return Promise.reject(new Error('sign must not be called'));
    },
    verify(token: string) {
      seen.verifies += 1;
      if (token !== `signed:${claims.tokenId}`) {
        return Promise.reject(new Error('rejected token'));
      }
      return Promise.resolve({ ...claims });
    },
  };
}

async function seededLane(
  claims: BoundApprovalClaims,
  current: AuthorityProposal = proposal(),
  target: AuthoritativeScope = scope(),
): Promise<{
  repository: InMemoryAuthoritativeState;
  input: ConditionalRevisionInput;
  signer: ApprovalSigner & { readonly verifies: number };
}> {
  const repository = new InMemoryAuthoritativeState();
  await repository.seed({
    accountId: target.accountId,
    productionId: target.productionId,
    authorityNamespace: target.authorityNamespace,
    productionRevision: current.baseProductionRevision,
    graphRevision: current.baseGraphRevision,
    productionState: structuredClone(BASE_STATE),
  });
  const signer = signerFor(claims);
  return {
    repository,
    signer,
    input: {
      repository,
      scope: target,
      token: `signed:${claims.tokenId}`,
      now: NOW,
      proposal: current,
      nextProductionState: structuredClone(NEXT_STATE),
      signer,
    },
  };
}

describe('revision-bound mutation lane', () => {
  it('applies an exact approval and advances production revision once', async () => {
    const current = proposal();
    const lane = await seededLane(claimsFor(current), current);
    const result = await applyConditionalRevision(lane.input);
    expect(result).toMatchObject({
      status: 'APPLIED',
      reason: null,
      productionRevision: 15,
      graphRevision: 9,
      tokenId: 'TOKEN-1',
    });
    expect(result.productionState).toEqual(NEXT_STATE);
    const stored = await lane.repository.read(scope());
    expect(stored?.productionRevision).toBe(15);
    expect(stored?.graphRevision).toBe(9);
    expect(stored?.productionState).toEqual(NEXT_STATE);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual(['TOKEN-1']);
    expect(lane.signer.verifies).toBe(1);
  });

  it('denies a graph revision that advanced after approval without mutating', async () => {
    const current = proposal();
    const lane = await seededLane(claimsFor(current), current);
    await lane.repository.noteGraphRevision(scope(), 10);
    const result = await applyConditionalRevision(lane.input);
    expect(result).toMatchObject({ status: 'DENIED', reason: 'BASE_REVISION_STALE' });
    const stored = await lane.repository.read(scope());
    expect(stored?.productionRevision).toBe(14);
    expect(stored?.graphRevision).toBe(10);
    expect(stored?.productionState).toEqual(BASE_STATE);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual([]);
  });

  it('denies a production revision that advanced after approval without a second mutation', async () => {
    const current = proposal();
    const first = claimsFor(current, { tokenId: 'TOKEN-FIRST' });
    const second = claimsFor(current, { tokenId: 'TOKEN-SECOND' });
    const lane = await seededLane(first, current);
    const applied = await applyConditionalRevision(lane.input);
    expect(applied.status).toBe('APPLIED');
    const rival = await applyConditionalRevision({
      ...lane.input,
      token: 'signed:TOKEN-SECOND',
      signer: signerFor(second),
      nextProductionState: { schedule: 'RIVAL' },
    });
    expect(rival).toMatchObject({ status: 'DENIED', reason: 'BASE_REVISION_STALE' });
    const stored = await lane.repository.read(scope());
    expect(stored?.productionRevision).toBe(15);
    expect(stored?.productionState).toEqual(NEXT_STATE);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual(['TOKEN-FIRST']);
  });

  it('denies a second use of the same token', async () => {
    const current = proposal();
    const lane = await seededLane(claimsFor(current), current);
    expect((await applyConditionalRevision(lane.input)).status).toBe('APPLIED');
    const reused = await applyConditionalRevision(lane.input);
    expect(reused).toMatchObject({ status: 'DENIED', reason: 'APPROVAL_ALREADY_CONSUMED' });
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(15);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual(['TOKEN-1']);
  });

  it('denies a tampered proposal', async () => {
    const current = proposal();
    const tampered = proposal({
      notificationPayloads: [{ approvedText: 'changed after approval' }],
    });
    const lane = await seededLane(claimsFor(current), tampered);
    const result = await applyConditionalRevision(lane.input);
    expect(result).toMatchObject({ status: 'DENIED', reason: 'PROPOSAL_FINGERPRINT_MISMATCH' });
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(14);
    expect((await lane.repository.read(scope()))?.productionState).toEqual(BASE_STATE);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual([]);
  });

  it('denies a cross-production scope', async () => {
    const current = proposal();
    const lane = await seededLane(claimsFor(current), current);
    const result = await applyConditionalRevision({
      ...lane.input,
      scope: scope({ productionId: 'OTHER-PROD' }),
    });
    expect(result).toMatchObject({ status: 'DENIED', reason: 'PRODUCTION_SCOPE_MISMATCH' });
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(14);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual([]);
  });

  it('denies a cross LIVE/REPLAY scope', async () => {
    const current = proposal();
    const lane = await seededLane(claimsFor(current), current);
    const result = await applyConditionalRevision({
      ...lane.input,
      scope: scope({ authorityNamespace: 'REPLAY' }),
    });
    expect(result).toMatchObject({ status: 'DENIED', reason: 'AUTHORITY_NAMESPACE_MISMATCH' });
    expect((await lane.repository.read(scope()))?.productionState).toEqual(BASE_STATE);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual([]);
  });

  it('denies an expired token', async () => {
    const current = proposal();
    const lane = await seededLane(claimsFor(current), current);
    const result = await applyConditionalRevision({ ...lane.input, now: EXPIRES });
    expect(result).toMatchObject({ status: 'DENIED', reason: 'APPROVAL_EXPIRED' });
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(14);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual([]);
  });

  it('lets at most one concurrent apply commit', async () => {
    const current = proposal();
    const lane = await seededLane(claimsFor(current), current);
    const [first, second] = await Promise.all([
      applyConditionalRevision(lane.input),
      applyConditionalRevision(lane.input),
    ]);
    const applied = [first, second].filter((result) => result.status === 'APPLIED');
    expect(applied).toHaveLength(1);
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(15);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual(['TOKEN-1']);
  });

  it('does not mutate caller inputs or trust a verified boolean', async () => {
    const current = proposal();
    const interventions = current.interventions;
    const nextProductionState = { schedule: 'NEXT', nested: { keep: true } };
    const lane = await seededLane(claimsFor(current), current);
    const before = structuredClone({
      proposal: current,
      nextProductionState,
      scope: lane.input.scope,
    });
    const result = await applyConditionalRevision({
      ...lane.input,
      proposal: current,
      nextProductionState,
      verified: true,
    } as ConditionalRevisionInput);
    expect(result.status).toBe('APPLIED');
    expect(current.interventions).toBe(interventions);
    expect({ proposal: current, nextProductionState, scope: lane.input.scope }).toEqual(before);
    nextProductionState.nested.keep = false;
    expect((await lane.repository.read(scope()))?.productionState).toEqual({
      schedule: 'NEXT',
      nested: { keep: true },
    });
    expect(lane.signer.verifies).toBe(1);
  });

  it('denies a role that the namespace policy does not allow', async () => {
    const current = proposal();
    const replayScope = scope({ authorityNamespace: 'REPLAY' });
    const lane = await seededLane(
      claimsFor(current, { authorityNamespace: 'REPLAY', role: 'PRODUCTION_LEAD' }),
      current,
      replayScope,
    );
    const result = await applyConditionalRevision(lane.input);
    expect(result).toMatchObject({ status: 'DENIED', reason: 'ROLE_NOT_AUTHORIZED' });
    expect((await lane.repository.read(replayScope))?.productionRevision).toBe(14);
    expect(await lane.repository.consumedTokenIds(replayScope)).toEqual([]);
  });
});
