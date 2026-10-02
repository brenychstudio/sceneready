import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bindProposalCommunications,
  deriveAffectedAudience,
  deriveOutboxJobs,
  renderApprovedText,
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
  InMemoryAuthoritativeState,
  applyApprovedProductionRevision,
  type AuthoritativeScope,
} from './index.js';

const NOW = '2026-09-17T03:45:00.000Z';
const EXPIRES = '2026-09-17T03:47:00.000Z';
const EXECUTION_ID = 'EXEC-R15';
const LEDGER_EVENT_ID = 'LEDGER-R15';

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

function claimsFor(
  current: AuthorityProposal,
  overrides: Partial<BoundApprovalClaims> = {},
): BoundApprovalClaims {
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
    ...overrides,
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

async function seeded(current: AuthorityProposal, claims: BoundApprovalClaims) {
  const repository = new InMemoryAuthoritativeState();
  await repository.seed({
    accountId: current.accountId,
    productionId: current.productionId,
    authorityNamespace: 'LIVE',
    productionRevision: current.baseProductionRevision,
    graphRevision: current.baseGraphRevision,
    productionState: { schedule: 'BASE' },
  });
  return {
    repository,
    input: {
      repository,
      scope: scope(),
      token: `signed:${claims.tokenId}`,
      now: NOW,
      proposal: current,
      nextProductionState: { schedule: 'APPLIED' },
      signer: signerFor(claims),
      executionId: EXECUTION_ID,
      ledgerEventId: LEDGER_EVENT_ID,
    },
  };
}

describe('atomic approved revision', () => {
  it('commits revision 15 with one ledger event, one token, and four pending jobs', async () => {
    const current = optionAProposal();
    const lane = await seeded(current, claimsFor(current));
    const planned = deriveOutboxJobs(EXECUTION_ID, current.notificationPayloads);
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      throw new Error(planned.reason);
    }
    const result = await applyApprovedProductionRevision(lane.input);
    expect(result.status).toBe('APPLIED');
    if (result.status !== 'APPLIED') {
      throw new Error(result.reason);
    }
    expect(result.productionRevision).toBe(15);
    expect(result.graphRevision).toBe(9);
    expect(result.ledgerEvent.kind).toBe('REVISION_APPLIED');
    expect(result.ledgerEvent.previousProductionRevision).toBe(14);
    expect(result.ledgerEvent.productionRevision).toBe(15);
    expect(result.ledgerEvent.proposalFingerprint).toBe(createProposalFingerprint(current));
    expect(result.outboxJobs).toHaveLength(4);
    expect(result.outboxJobs.every((job) => job.deliveryStatus === 'PENDING')).toBe(true);
    expect(
      result.outboxJobs.filter((job) => job.acknowledgementRequirement === 'REQUIRED_CRITICAL'),
    ).toHaveLength(3);
    expect(
      result.outboxJobs.filter((job) => job.acknowledgementRequirement === 'INFORMATIONAL'),
    ).toHaveLength(1);
    expect(result.outboxJobs).toEqual(planned.jobs);
    expect(await lane.repository.readLedger(scope())).toEqual([result.ledgerEvent]);
    expect(await lane.repository.readOutbox(scope())).toEqual(planned.jobs);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual(['TOKEN-R15']);
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(15);
  });

  it('rolls back revision, token, ledger, and outbox when commit fails', async () => {
    const current = optionAProposal();
    const lane = await seeded(current, claimsFor(current));
    lane.repository.failBeforeNextCommit(new Error('injected commit failure'));
    await expect(applyApprovedProductionRevision(lane.input)).rejects.toThrow(
      'injected commit failure',
    );
    expect((await lane.repository.read(scope()))?.productionRevision).toBe(14);
    expect((await lane.repository.read(scope()))?.productionState).toEqual({ schedule: 'BASE' });
    expect(await lane.repository.consumedTokenIds(scope())).toEqual([]);
    expect(await lane.repository.readLedger(scope())).toEqual([]);
    expect(await lane.repository.readOutbox(scope())).toEqual([]);
  });

  it('keeps stale revisions and consumed tokens fail-closed on the same lane', async () => {
    const current = optionAProposal();
    const lane = await seeded(current, claimsFor(current));
    await lane.repository.noteGraphRevision(scope(), 10);
    const stale = await applyApprovedProductionRevision(lane.input);
    expect(stale).toMatchObject({ status: 'DENIED', reason: 'BASE_REVISION_STALE' });
    expect(await lane.repository.readLedger(scope())).toEqual([]);
    expect(await lane.repository.readOutbox(scope())).toEqual([]);
    expect(await lane.repository.consumedTokenIds(scope())).toEqual([]);

    const fresh = new InMemoryAuthoritativeState();
    await fresh.seed({
      accountId: 'ACCT-1',
      productionId: 'BCN-DEMO-01',
      authorityNamespace: 'LIVE',
      productionRevision: 14,
      graphRevision: 9,
      productionState: { schedule: 'BASE' },
    });
    const first = await applyApprovedProductionRevision({
      ...lane.input,
      repository: fresh,
    });
    expect(first.status).toBe('APPLIED');
    const second = await applyApprovedProductionRevision({
      ...lane.input,
      repository: fresh,
      ledgerEventId: 'LEDGER-R15-AGAIN',
      executionId: 'EXEC-R15-AGAIN',
    });
    expect(second).toMatchObject({ status: 'DENIED', reason: 'APPROVAL_ALREADY_CONSUMED' });
    expect(await fresh.readLedger(scope())).toHaveLength(1);
    expect(await fresh.readOutbox(scope())).toHaveLength(4);
    expect((await fresh.read(scope()))?.productionRevision).toBe(15);
  });

  it('appends a later revision without rewriting the applied history', async () => {
    const current = optionAProposal();
    const lane = await seeded(current, claimsFor(current));
    const first = await applyApprovedProductionRevision(lane.input);
    expect(first.status).toBe('APPLIED');
    if (first.status !== 'APPLIED') {
      throw new Error(first.reason);
    }
    const history = await lane.repository.readLedger(scope());
    const nextProposal: AuthorityProposal = {
      ...current,
      proposalId: 'PROP-R16',
      baseProductionRevision: 15,
    };
    const nextClaims = claimsFor(nextProposal, { tokenId: 'TOKEN-R16' });
    const second = await applyApprovedProductionRevision({
      ...lane.input,
      token: 'signed:TOKEN-R16',
      signer: signerFor(nextClaims),
      proposal: nextProposal,
      executionId: 'EXEC-R16',
      ledgerEventId: 'LEDGER-R16',
      nextProductionState: { schedule: 'R16' },
    });
    expect(second.status).toBe('APPLIED');
    const ledger = await lane.repository.readLedger(scope());
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toEqual(history[0]);
    expect(ledger[0]?.productionRevision).toBe(15);
    expect(ledger[1]?.productionRevision).toBe(16);
    expect(await lane.repository.readOutbox(scope())).toHaveLength(8);
    expect(Object.isFrozen(ledger)).toBe(true);
  });

  it('does not send from the revision transaction', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/Date\.now|Math\.random|randomUUID|\bfetch\s*\(/);
    expect(source).not.toMatch(/deliver\(|smtp|twilio|nodemailer/i);
    expect(source).toContain('applyApprovedProductionRevision');
    expect(source).toContain('REVISION_APPLIED');
  });
});
