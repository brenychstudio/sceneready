import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTERVENTION_DESCRIPTORS } from '@sceneready/intervention-engine';
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

import type { CompensationAudienceInput, CompensationBindContext } from './compensation.js';
import {
  InMemoryAuthoritativeState,
  SEND_CORRECTIVE_NOTIFICATION,
  applyApprovedProductionRevision,
  prepareCompensatingProposal,
  type AuthoritativeScope,
  type CompensationBinder,
} from './index.js';

const NOW = '2026-09-17T03:45:00.000Z';
const EXPIRES = '2026-09-17T03:47:00.000Z';

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

function communicationsBinder(): CompensationBinder {
  return {
    bind(context: CompensationBindContext, audience: CompensationAudienceInput) {
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
      const bound = bindProposalCommunications(context, audience, payloads);
      if (!bound.ok) {
        return { ok: false, issues: bound.issues };
      }
      return { ok: true, proposal: bound.proposal };
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

function scope(): AuthoritativeScope {
  return {
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    authorityNamespace: 'LIVE',
  };
}

function claimsFor(current: AuthorityProposal): BoundApprovalClaims {
  return {
    tokenId: 'TOKEN-R15',
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
  };
}

function signerFor(claims: BoundApprovalClaims): ApprovalSigner {
  return {
    sign() {
      return Promise.reject(new Error('sign must not be called'));
    },
    verify(token: string) {
      if (token !== `signed:${claims.tokenId}`) {
        return Promise.reject(new Error('rejected token'));
      }
      return Promise.resolve({ ...claims });
    },
  };
}

describe('forward recovery', () => {
  it('prepares a revision-15 compensation without erasing applied history', async () => {
    const applied = optionAProposal();
    const appliedFingerprint = createProposalFingerprint(applied);
    const repository = new InMemoryAuthoritativeState();
    await repository.seed({
      accountId: applied.accountId,
      productionId: applied.productionId,
      authorityNamespace: 'LIVE',
      productionRevision: applied.baseProductionRevision,
      graphRevision: applied.baseGraphRevision,
      productionState: { schedule: 'BASE' },
    });
    const claims = claimsFor(applied);
    const appliedResult = await applyApprovedProductionRevision({
      repository,
      scope: scope(),
      token: `signed:${claims.tokenId}`,
      now: NOW,
      proposal: applied,
      nextProductionState: { schedule: 'APPLIED' },
      signer: signerFor(claims),
      executionId: 'EXEC-R15',
      ledgerEventId: 'LEDGER-R15',
    });
    expect(appliedResult.status).toBe('APPLIED');
    if (appliedResult.status !== 'APPLIED') {
      throw new Error(appliedResult.reason);
    }
    const tracker = new SandboxNotificationTracker(appliedResult.outboxJobs);
    for (const job of appliedResult.outboxJobs) {
      const outcome = await tracker.deliver(
        {
          deliver() {
            return Promise.resolve();
          },
        },
        job.idempotencyKey,
      );
      expect(outcome).toBe('DELIVERED');
    }
    expect(
      tracker.snapshot().every((notification) => notification.deliveryStatus === 'DELIVERED'),
    ).toBe(true);
    expect(
      tracker.snapshot().every((notification) => notification.acknowledgementStatus === 'PENDING'),
    ).toBe(true);

    const beforeLedger = structuredClone(await repository.readLedger(scope()));
    const beforeOutbox = structuredClone(await repository.readOutbox(scope()));
    const beforeTokens = structuredClone(await repository.consumedTokenIds(scope()));
    const beforeSnapshot = structuredClone(await repository.read(scope()));
    const beforeDelivered = structuredClone(tracker.snapshot());
    const beforeApplied = structuredClone(applied);

    const snapshot = await repository.read(scope());
    const prepared = prepareCompensatingProposal({
      appliedProposal: applied,
      currentProductionRevision: snapshot?.productionRevision ?? -1,
      currentGraphRevision: snapshot?.graphRevision ?? -1,
      proposalId: 'PROP-OPTION-A-COMPENSATION',
      crew: OPTION_A.crew,
      callTimes: OPTION_A.callTimes,
      departures: OPTION_A.departures,
      bindCommunications: communicationsBinder(),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.reason);
    }

    const compensation = prepared.compensation;
    expect(compensation.proposal.baseProductionRevision).toBe(15);
    expect(compensation.proposal.baseGraphRevision).toBe(9);
    expect(compensation.proposal.proposalId).toBe('PROP-OPTION-A-COMPENSATION');
    expect(compensation.proposal.interventions).toEqual([
      { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: 25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: 25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-HMU', deltaMinutes: 25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-PHOTO-ASSISTANT', deltaMinutes: 25 },
      { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: 20 },
    ]);
    expect(compensation.reversibility).toHaveLength(5);
    expect(
      compensation.reversibility.every(
        (item) => item.reversibility === 'REVERSIBLE_BY_NEW_REVISION' && item.mechanicalInverse,
      ),
    ).toBe(true);
    expect(compensation.sideEffects.map((effect) => effect.kind)).toEqual([
      SEND_CORRECTIVE_NOTIFICATION,
      SEND_CORRECTIVE_NOTIFICATION,
      SEND_CORRECTIVE_NOTIFICATION,
      SEND_CORRECTIVE_NOTIFICATION,
    ]);
    expect(compensation.sideEffects.map((effect) => effect.previouslyCommunicatedValue)).toEqual([
      '06:20',
      '06:05',
      '06:05',
      '06:05',
    ]);
    expect(compensation.sideEffects.map((effect) => effect.correctiveValue)).toEqual([
      '06:40',
      '06:30',
      '06:30',
      '06:30',
    ]);
    expect(compensation.proposal.predictedEffects).toEqual([
      ...compensation.reversibility,
      ...compensation.sideEffects,
    ]);
    expect(compensation.proposal.notificationPayloads).toHaveLength(4);
    const payloads = compensation.proposal.notificationPayloads;
    expect(payloads[0]).toMatchObject({
      recipientPersonId: 'PERSON-PRODUCTION-LEAD',
      oldValue: '06:20',
      newValue: '06:40',
      requiredAction: 'INFORMATION_ONLY',
    });
    expect(payloads[1]).toMatchObject({
      recipientPersonId: 'PERSON-HMU',
      oldValue: '06:05',
      newValue: '06:30',
      requiredAction: 'CONFIRM_UPDATED_CALL',
    });
    expect(payloads[2]).toMatchObject({
      recipientPersonId: 'PERSON-MODEL',
      oldValue: '06:05',
      newValue: '06:30',
    });
    expect(payloads[3]).toMatchObject({
      recipientPersonId: 'PERSON-PHOTO-ASSISTANT',
      oldValue: '06:05',
      newValue: '06:30',
    });
    expect(JSON.stringify(payloads[0])).toContain('from 06:20 to 06:40');
    expect(JSON.stringify(payloads[1])).toContain('from 06:05 to 06:30');
    expect(compensation.fingerprint).toBe(createProposalFingerprint(compensation.proposal));
    expect(compensation.fingerprint).not.toBe(appliedFingerprint);
    const relabeled: AuthorityProposal = {
      ...compensation.proposal,
      predictedEffects: compensation.proposal.predictedEffects.map((effect, index) =>
        index === 0 && typeof effect === 'object' && effect !== null
          ? { ...effect, reversibility: 'IRREVERSIBLE' }
          : effect,
      ),
    };
    expect(createProposalFingerprint(relabeled)).not.toBe(compensation.fingerprint);

    expect(await repository.readLedger(scope())).toEqual(beforeLedger);
    expect(await repository.readOutbox(scope())).toEqual(beforeOutbox);
    expect(await repository.consumedTokenIds(scope())).toEqual(beforeTokens);
    expect(await repository.read(scope())).toEqual(beforeSnapshot);
    expect((await repository.read(scope()))?.productionRevision).toBe(15);
    expect(await repository.readLedger(scope())).toHaveLength(1);
    expect((await repository.readLedger(scope()))[0]?.productionRevision).toBe(15);
    expect(await repository.readOutbox(scope())).toHaveLength(4);
    expect(tracker.snapshot()).toEqual(beforeDelivered);
    expect(applied).toEqual(beforeApplied);
    expect(applied.notificationPayloads).toHaveLength(4);
  });

  it('keeps a non-invertible kind on its descriptor class', () => {
    const applied: AuthorityProposal = {
      accountId: 'ACCT-1',
      productionId: 'BCN-DEMO-01',
      proposalId: 'PROP-MIXED',
      baseProductionRevision: 3,
      baseGraphRevision: 1,
      policyVersion: 'SR-POLICY-v1',
      interventions: [
        { kind: 'SHORTEN_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', minutes: 10 },
        { kind: 'REQUIRE_REVERIFICATION', equipmentId: 'EQP-CAMERA-01' },
      ],
      affectedRecipients: [],
      notificationPayloads: [],
      predictedEffects: [],
    };
    const prepared = prepareCompensatingProposal({
      appliedProposal: applied,
      currentProductionRevision: 4,
      currentGraphRevision: 1,
      proposalId: 'PROP-MIXED-COMPENSATION',
      crew: [{ personId: 'PERSON-PRODUCTION-LEAD', role: 'PRODUCTION_LEAD' }],
      callTimes: [],
      departures: [],
      bindCommunications: communicationsBinder(),
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.reason);
    }
    expect(prepared.compensation.proposal.interventions).toEqual([]);
    expect(prepared.compensation.proposal.notificationPayloads).toEqual([]);
    expect(prepared.compensation.sideEffects).toEqual([]);
    expect(prepared.compensation.reversibility.map((item) => item.interventionKind)).toEqual([
      'SHORTEN_ACTIVITY',
      'REQUIRE_REVERIFICATION',
    ]);
    expect(prepared.compensation.reversibility.map((item) => item.mechanicalInverse)).toEqual([
      false,
      false,
    ]);
    expect(prepared.compensation.reversibility.map((item) => item.reversibility)).toEqual([
      INTERVENTION_DESCRIPTORS.find((item) => item.kind === 'SHORTEN_ACTIVITY')?.reversibility,
      INTERVENTION_DESCRIPTORS.find((item) => item.kind === 'REQUIRE_REVERIFICATION')
        ?.reversibility,
    ]);
    expect(prepared.compensation.reversibility.map((item) => item.reversibility)).not.toContain(
      'IRREVERSIBLE',
    );
  });

  it('rejects a binder that changes an already communicated fact', () => {
    const applied = optionAProposal();
    const prepared = prepareCompensatingProposal({
      appliedProposal: applied,
      currentProductionRevision: 15,
      currentGraphRevision: 9,
      proposalId: 'PROP-OPTION-A-COMPENSATION',
      crew: OPTION_A.crew,
      callTimes: OPTION_A.callTimes,
      departures: OPTION_A.departures,
      bindCommunications: {
        bind(context, audience) {
          const honest = communicationsBinder().bind(context, audience);
          if (!honest.ok) {
            return honest;
          }
          return {
            ok: true,
            proposal: {
              ...honest.proposal,
              notificationPayloads: honest.proposal.notificationPayloads.map((payload, index) =>
                index === 0 && typeof payload === 'object' && payload !== null
                  ? { ...payload, newValue: '07:00', approvedText: 'from 06:20 to 07:00' }
                  : payload,
              ),
            },
          };
        },
      },
    });
    expect(prepared).toEqual({ ok: false, reason: 'BOUND_PROPOSAL_MISMATCH' });
  });

  it('does not import communications or apply from the recovery module', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    expect(source).not.toContain('@sceneready/communications');
    expect(source).toContain('prepareCompensatingProposal');
    expect(source).toContain(SEND_CORRECTIVE_NOTIFICATION);
    expect(source).not.toMatch(/Date\.now|Math\.random|randomUUID/);
  });
});
