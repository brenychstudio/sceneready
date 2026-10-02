import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bindProposalCommunications,
  deriveAffectedAudience,
  renderApprovedText,
  SandboxNotificationTracker,
  type CommunicationAudienceInput,
} from '@sceneready/communications';
import {
  createProposalFingerprint,
  type ApprovalSigner,
  type AuthorityProposal,
  type BoundApprovalClaims,
} from '@sceneready/mcp-human-authority';
import { describe, expect, it } from 'vitest';

import {
  EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
  InMemoryAuthoritativeState,
  ROLE_NAMESPACE_POLICY_VERSION,
  applyApprovedProductionRevision,
  applyConditionalRevision,
  confirmApprovalChallenge,
  decideRoleNamespace,
  openApprovalChallenge,
  prepareCompensatingProposal,
  type ApprovedRevisionInput,
  type AuthenticatedAuthoritySession,
  type AuthoritativeScope,
  type AuthoritySessionNamespace,
  type AuthoritySessionRole,
  type CompensationBinder,
  type ConditionalRevisionInput,
} from './index.js';

const NOW = '2026-09-17T03:45:00.000Z';
const AUTHENTICATED_AT = '2026-09-17T03:00:00.000Z';
const SESSION_EXPIRES_AT = '2026-09-17T05:00:00.000Z';

const OPTION_A: CommunicationAudienceInput = {
  interventions: [
    { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: -25 },
    { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 },
    { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-HMU', deltaMinutes: -25 },
    { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-PHOTO-ASSISTANT', deltaMinutes: -25 },
    { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
  ],
  crew: [
    { personId: 'PERSON-PRODUCTION-LEAD', role: 'PRODUCTION_LEAD' },
    { personId: 'PERSON-MODEL', role: 'MODEL' },
    { personId: 'PERSON-HMU', role: 'HMU' },
    { personId: 'PERSON-PHOTO-ASSISTANT', role: 'PHOTO_ASSISTANT' },
  ],
  callTimes: [
    { personId: 'PERSON-MODEL', callLocal: '06:30' },
    { personId: 'PERSON-HMU', callLocal: '06:30' },
    { personId: 'PERSON-PHOTO-ASSISTANT', callLocal: '06:30' },
  ],
  departures: [{ transferActivityId: 'ACT-DEPART-GOTHIC', departureLocal: '06:40' }],
};

function session(
  role: AuthoritySessionRole,
  authorityNamespace: AuthoritySessionNamespace,
): AuthenticatedAuthoritySession {
  return {
    accountId: 'ACCT-1',
    actorId: role === 'DEMO_PRODUCTION_LEAD' ? 'ACTOR-DEMO' : `ACTOR-${role}`,
    productionId: 'BCN-DEMO-01',
    role,
    authorityNamespace,
    authenticatedAt: AUTHENTICATED_AT,
    expiresAt: SESSION_EXPIRES_AT,
  };
}

function memorySigner(): ApprovalSigner & { readonly signs: number; readonly verifies: number } {
  const tokens = new Map<string, BoundApprovalClaims>();
  const seen = { signs: 0, verifies: 0 };
  return {
    get signs() {
      return seen.signs;
    },
    get verifies() {
      return seen.verifies;
    },
    sign(claims) {
      seen.signs += 1;
      tokens.set(`signed:${claims.tokenId}`, { ...claims });
      return Promise.resolve(`signed:${claims.tokenId}`);
    },
    verify(token) {
      seen.verifies += 1;
      const claims = tokens.get(token);
      if (claims === undefined) {
        return Promise.reject(new Error('rejected token'));
      }
      return Promise.resolve({ ...claims });
    },
  };
}

function optionAProposal(): AuthorityProposal {
  const audience = deriveAffectedAudience(OPTION_A);
  expect(audience.ok).toBe(true);
  if (!audience.ok) {
    throw new Error(audience.issues.join(','));
  }
  const payloads = audience.audience.obligations.map((obligation) => ({
    recipientPersonId: obligation.recipientPersonId,
    recipientRole: obligation.recipientRole,
    changeType: obligation.changeType,
    oldValue: obligation.oldValue,
    newValue: obligation.newValue,
    reasonCode: obligation.reasonCode,
    requiredAction: obligation.requiredAction,
    approvedText: renderApprovedText(obligation),
  }));
  const bound = bindProposalCommunications(
    {
      accountId: 'ACCT-1',
      productionId: 'BCN-DEMO-01',
      proposalId: 'PROP-OPTION-A',
      baseProductionRevision: 14,
      baseGraphRevision: 9,
      policyVersion: 'SR-POLICY-v1',
      predictedEffects: [{ subjectId: 'ACT-GOTHIC-LOOK-03', severity: 'LOW' }],
    },
    OPTION_A,
    payloads,
  );
  expect(bound.ok).toBe(true);
  if (!bound.ok) {
    throw new Error(bound.issues.join(','));
  }
  return bound.proposal;
}

function binder(): CompensationBinder {
  return {
    bind(context, audience) {
      const derived = deriveAffectedAudience(audience);
      if (!derived.ok) {
        return { ok: false, issues: derived.issues };
      }
      const payloads = derived.audience.obligations.map((obligation) => ({
        recipientPersonId: obligation.recipientPersonId,
        recipientRole: obligation.recipientRole,
        changeType: obligation.changeType,
        oldValue: obligation.oldValue,
        newValue: obligation.newValue,
        reasonCode: obligation.reasonCode,
        requiredAction: obligation.requiredAction,
        approvedText: renderApprovedText(obligation),
      }));
      return bindProposalCommunications(context, audience, payloads);
    },
  };
}

function scope(): AuthoritativeScope {
  return { accountId: 'ACCT-1', productionId: 'BCN-DEMO-01', authorityNamespace: 'LIVE' };
}

async function approvedLane(tokenId = 'TOKEN-R15', challengeId = 'CHALLENGE-R15') {
  const proposal = optionAProposal();
  const repository = new InMemoryAuthoritativeState();
  await repository.seed({
    ...scope(),
    productionRevision: proposal.baseProductionRevision,
    graphRevision: proposal.baseGraphRevision,
    productionState: { schedule: 'BASE' },
  });
  const opened = openApprovalChallenge({
    session: session('PRODUCTION_LEAD', 'LIVE'),
    proposal,
    authorityNamespace: 'LIVE',
    challengeId,
    now: NOW,
    ttlSeconds: 7200,
  });
  expect(opened.status).toBe('OPENED');
  if (opened.status !== 'OPENED') {
    throw new Error(opened.reason);
  }
  const signer = memorySigner();
  const confirmed = await confirmApprovalChallenge({
    intent: EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
    session: session('PRODUCTION_LEAD', 'LIVE'),
    challenge: opened.challenge,
    currentProposal: proposal,
    now: NOW,
    tokenId,
    ttlSeconds: 120,
    signer,
  });
  expect(confirmed.status).toBe('APPROVED');
  if (confirmed.status !== 'APPROVED') {
    throw new Error(confirmed.reason ?? 'not approved');
  }
  const input: ApprovedRevisionInput = {
    repository,
    scope: scope(),
    token: confirmed.token,
    now: NOW,
    proposal,
    nextProductionState: { schedule: 'APPLIED' },
    signer,
    executionId: 'EXEC-R15',
    ledgerEventId: 'LEDGER-R15',
  };
  return { proposal, repository, signer, confirmed, input };
}

describe('SR-04 authority invariants', () => {
  it('allows only the production lead on LIVE and the demo lead on REPLAY', () => {
    expect(ROLE_NAMESPACE_POLICY_VERSION).toBe('SR-AUTHORITY-ROLE-NAMESPACE-v1.0');
    expect(decideRoleNamespace('PRODUCTION_LEAD', 'LIVE')).toBe('ALLOW');
    expect(decideRoleNamespace('PRODUCTION_LEAD', 'REPLAY')).toBe('DENY');
    expect(decideRoleNamespace('DEMO_PRODUCTION_LEAD', 'LIVE')).toBe('DENY');
    expect(decideRoleNamespace('DEMO_PRODUCTION_LEAD', 'REPLAY')).toBe('ALLOW');
    expect(decideRoleNamespace('ASSISTANT', 'LIVE')).toBe('DENY');
    expect(decideRoleNamespace('ASSISTANT', 'REPLAY')).toBe('DENY');
  });

  it('creates no authority from ambiguous speech', async () => {
    const proposal = optionAProposal();
    const opened = openApprovalChallenge({
      session: session('PRODUCTION_LEAD', 'LIVE'),
      proposal,
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-AMBIGUOUS',
      now: NOW,
      ttlSeconds: 7200,
    });
    expect(opened.status).toBe('OPENED');
    if (opened.status !== 'OPENED') {
      throw new Error(opened.reason);
    }
    const signer = memorySigner();
    const result = await confirmApprovalChallenge({
      intent: 'SOUNDS_GOOD',
      session: session('PRODUCTION_LEAD', 'LIVE'),
      challenge: opened.challenge,
      currentProposal: proposal,
      now: NOW,
      tokenId: 'TOKEN-AMBIGUOUS',
      ttlSeconds: 120,
      signer,
    });
    expect(result).toEqual({
      status: 'NOT_APPROVED',
      token: null,
      claims: null,
      reason: 'NO_EXPLICIT_APPROVAL',
    });
    expect(signer.signs).toBe(0);
  });

  it('denies assistant, scope, namespace, fingerprint, expiry, replay, and drift with zero mutations', async () => {
    const assistantProposal = optionAProposal();
    const assistantRepository = new InMemoryAuthoritativeState();
    await assistantRepository.seed({
      ...scope(),
      productionRevision: 14,
      graphRevision: 9,
      productionState: { schedule: 'BASE' },
    });
    const assistantOpened = openApprovalChallenge({
      session: session('ASSISTANT', 'LIVE'),
      proposal: assistantProposal,
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-ASSISTANT',
      now: NOW,
      ttlSeconds: 7200,
    });
    expect(assistantOpened.status).toBe('OPENED');
    if (assistantOpened.status !== 'OPENED') {
      throw new Error(assistantOpened.reason);
    }
    const assistantSigner = memorySigner();
    const assistant = await confirmApprovalChallenge({
      intent: EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
      session: session('ASSISTANT', 'LIVE'),
      challenge: assistantOpened.challenge,
      currentProposal: assistantProposal,
      now: NOW,
      tokenId: 'TOKEN-ASSISTANT',
      ttlSeconds: 120,
      signer: assistantSigner,
    });
    expect(assistant).toMatchObject({
      status: 'DENIED',
      token: null,
      reason: 'ROLE_NOT_AUTHORIZED',
    });
    expect(assistantSigner.signs).toBe(0);
    expect((await assistantRepository.read(scope()))?.productionRevision).toBe(14);

    const forged = await approvedLane('TOKEN-FORGED', 'CHALLENGE-FORGED');
    const forgedResult = await applyApprovedProductionRevision({
      ...forged.input,
      token: 'forged-assistant',
      signer: {
        sign() {
          return Promise.reject(new Error('sign must not be called'));
        },
        verify() {
          const invalid: unknown = { ...forged.confirmed.claims, role: 'ASSISTANT' };
          return Promise.resolve(invalid as BoundApprovalClaims);
        },
      },
    });
    expect(forgedResult).toMatchObject({ status: 'DENIED', reason: 'TOKEN_REJECTED' });
    expect((await forged.repository.read(scope()))?.productionRevision).toBe(14);

    const crossProduction = await approvedLane('TOKEN-PROD', 'CHALLENGE-PROD');
    expect(
      await applyApprovedProductionRevision({
        ...crossProduction.input,
        scope: { ...scope(), productionId: 'OTHER-PROD' },
      }),
    ).toMatchObject({ status: 'DENIED', reason: 'PRODUCTION_SCOPE_MISMATCH' });
    expect((await crossProduction.repository.read(scope()))?.productionRevision).toBe(14);

    const crossNamespace = await approvedLane('TOKEN-NS', 'CHALLENGE-NS');
    expect(
      await applyApprovedProductionRevision({
        ...crossNamespace.input,
        scope: { ...scope(), authorityNamespace: 'REPLAY' },
      }),
    ).toMatchObject({ status: 'DENIED', reason: 'AUTHORITY_NAMESPACE_MISMATCH' });
    expect((await crossNamespace.repository.read(scope()))?.productionRevision).toBe(14);

    const tampered = await approvedLane('TOKEN-TAMPER', 'CHALLENGE-TAMPER');
    expect(
      await applyApprovedProductionRevision({
        ...tampered.input,
        proposal: {
          ...tampered.proposal,
          predictedEffects: [
            ...tampered.proposal.predictedEffects,
            { subjectId: 'ACT-UNAPPROVED', severity: 'HIGH' },
          ],
        },
      }),
    ).toMatchObject({ status: 'DENIED', reason: 'PROPOSAL_FINGERPRINT_MISMATCH' });
    expect(await tampered.repository.consumedTokenIds(scope())).toEqual([]);

    const drifted = await approvedLane('TOKEN-PAYLOAD', 'CHALLENGE-PAYLOAD');
    expect(
      await applyApprovedProductionRevision({
        ...drifted.input,
        proposal: {
          ...drifted.proposal,
          notificationPayloads: drifted.proposal.notificationPayloads.map((item, index) =>
            index === 0 && typeof item === 'object' && item !== null
              ? { ...item, newValue: '07:00' }
              : item,
          ),
        },
      }),
    ).toMatchObject({ status: 'DENIED', reason: 'PROPOSAL_FINGERPRINT_MISMATCH' });
    expect((await drifted.repository.read(scope()))?.productionState).toEqual({ schedule: 'BASE' });

    const expired = await approvedLane('TOKEN-EXPIRED', 'CHALLENGE-EXPIRED');
    expect(
      await applyApprovedProductionRevision({
        ...expired.input,
        now: expired.confirmed.claims.expiresAt,
      }),
    ).toMatchObject({ status: 'DENIED', reason: 'APPROVAL_EXPIRED' });
    expect(await expired.repository.consumedTokenIds(scope())).toEqual([]);

    const replay = await approvedLane('TOKEN-REPLAY', 'CHALLENGE-REPLAY');
    expect((await applyApprovedProductionRevision(replay.input)).status).toBe('APPLIED');
    expect(
      await applyApprovedProductionRevision({
        ...replay.input,
        executionId: 'EXEC-R15-REPLAY',
        ledgerEventId: 'LEDGER-R15-REPLAY',
      }),
    ).toMatchObject({ status: 'DENIED', reason: 'APPROVAL_ALREADY_CONSUMED' });
    expect((await replay.repository.read(scope()))?.productionRevision).toBe(15);
    expect(await replay.repository.readLedger(scope())).toHaveLength(1);

    const graph = await approvedLane('TOKEN-GRAPH', 'CHALLENGE-GRAPH');
    await graph.repository.noteGraphRevision(scope(), 10);
    expect(await applyApprovedProductionRevision(graph.input)).toMatchObject({
      status: 'DENIED',
      reason: 'BASE_REVISION_STALE',
    });
    expect((await graph.repository.read(scope()))?.productionRevision).toBe(14);
    expect(await graph.repository.consumedTokenIds(scope())).toEqual([]);

    const stale = await approvedLane('TOKEN-STALE-A', 'CHALLENGE-STALE-A');
    const secondOpened = openApprovalChallenge({
      session: session('PRODUCTION_LEAD', 'LIVE'),
      proposal: stale.proposal,
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-STALE-B',
      now: NOW,
      ttlSeconds: 7200,
    });
    expect(secondOpened.status).toBe('OPENED');
    if (secondOpened.status !== 'OPENED') {
      throw new Error(secondOpened.reason);
    }
    const secondSigner = memorySigner();
    const second = await confirmApprovalChallenge({
      intent: EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
      session: session('PRODUCTION_LEAD', 'LIVE'),
      challenge: secondOpened.challenge,
      currentProposal: stale.proposal,
      now: NOW,
      tokenId: 'TOKEN-STALE-B',
      ttlSeconds: 120,
      signer: secondSigner,
    });
    expect(second.status).toBe('APPROVED');
    if (second.status !== 'APPROVED') {
      throw new Error(second.reason ?? 'not approved');
    }
    expect((await applyApprovedProductionRevision(stale.input)).status).toBe('APPLIED');
    expect(
      await applyApprovedProductionRevision({
        ...stale.input,
        token: second.token,
        signer: secondSigner,
        executionId: 'EXEC-R15-B',
        ledgerEventId: 'LEDGER-R15-B',
      }),
    ).toMatchObject({ status: 'DENIED', reason: 'BASE_REVISION_STALE' });
    expect((await stale.repository.read(scope()))?.productionRevision).toBe(15);
  });

  it('commits option A atomically, rolls back a failed commit, and keeps one lane', async () => {
    const lane = await approvedLane();
    const applied = await applyApprovedProductionRevision(lane.input);
    expect(applied.status).toBe('APPLIED');
    if (applied.status !== 'APPLIED') {
      throw new Error(applied.reason);
    }
    expect(applied.productionRevision).toBe(15);
    expect(applied.outboxJobs).toHaveLength(4);
    expect(
      applied.outboxJobs.filter((job) => job.acknowledgementRequirement === 'REQUIRED_CRITICAL'),
    ).toHaveLength(3);
    expect(await lane.repository.readLedger(scope())).toHaveLength(1);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual(['TOKEN-R15']);
    expect(lane.signer.verifies).toBe(1);

    const booleanLane = await approvedLane('TOKEN-BOOL', 'CHALLENGE-BOOL');
    const ignored = await applyConditionalRevision({
      ...booleanLane.input,
      verified: true,
    } as ConditionalRevisionInput);
    expect(ignored.status).toBe('APPLIED');
    expect(booleanLane.signer.verifies).toBe(1);

    const rollback = await approvedLane('TOKEN-ROLLBACK', 'CHALLENGE-ROLLBACK');
    rollback.repository.failBeforeNextCommit(new Error('injected commit failure'));
    await expect(applyApprovedProductionRevision(rollback.input)).rejects.toThrow(
      'injected commit failure',
    );
    expect((await rollback.repository.read(scope()))?.productionRevision).toBe(14);
    expect(await rollback.repository.consumedTokenIds(scope())).toEqual([]);
    expect(await rollback.repository.readLedger(scope())).toEqual([]);
    expect(await rollback.repository.readOutbox(scope())).toEqual([]);

    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'in-memory-state.ts'),
      'utf8',
    );
    expect(source.match(/private commitUnlocked\(/g)).toHaveLength(1);
  });

  it('recovers forward without erasing revision 15 or its delivered notifications', async () => {
    const lane = await approvedLane();
    const applied = await applyApprovedProductionRevision(lane.input);
    expect(applied.status).toBe('APPLIED');
    if (applied.status !== 'APPLIED') {
      throw new Error(applied.reason);
    }
    const tracker = new SandboxNotificationTracker(applied.outboxJobs);
    for (const job of applied.outboxJobs) {
      expect(
        await tracker.deliver(
          {
            deliver() {
              return Promise.resolve();
            },
          },
          job.idempotencyKey,
        ),
      ).toBe('DELIVERED');
    }
    const beforeLedger = await lane.repository.readLedger(scope());
    const beforeDelivered = tracker.snapshot();
    const snapshot = await lane.repository.read(scope());
    const prepared = prepareCompensatingProposal({
      appliedProposal: lane.proposal,
      currentProductionRevision: snapshot?.productionRevision ?? -1,
      currentGraphRevision: snapshot?.graphRevision ?? -1,
      proposalId: 'PROP-OPTION-A-COMPENSATION',
      crew: OPTION_A.crew,
      callTimes: OPTION_A.callTimes,
      departures: OPTION_A.departures,
      bindCommunications: binder(),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.reason);
    }
    expect(prepared.compensation.proposal.baseProductionRevision).toBe(15);
    expect(prepared.compensation.fingerprint).not.toBe(createProposalFingerprint(lane.proposal));
    const relabeled: AuthorityProposal = {
      ...prepared.compensation.proposal,
      predictedEffects: prepared.compensation.proposal.predictedEffects.map((effect, index) =>
        index === 0 && typeof effect === 'object' && effect !== null
          ? { ...effect, reversibility: 'IRREVERSIBLE' }
          : effect,
      ),
    };
    expect(createProposalFingerprint(relabeled)).not.toBe(prepared.compensation.fingerprint);
    expect(await lane.repository.readLedger(scope())).toEqual(beforeLedger);
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(15);
    expect(tracker.snapshot()).toEqual(beforeDelivered);
  });
});
