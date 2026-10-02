import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMMUNICATION_AUDIENCE_POLICY_VERSION,
  SandboxNotificationTracker,
  bindProposalCommunications,
  deriveAffectedAudience,
  renderApprovedText,
  type CommunicationAudienceInput,
} from '@sceneready/communications';
import {
  createProposalFingerprint,
  type ApprovalSigner,
  type AuthorityProposal,
  type BoundApprovalClaims,
} from '@sceneready/mcp-human-authority';
import { format } from 'prettier';

import {
  EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
  InMemoryAuthoritativeState,
  ROLE_NAMESPACE_POLICY_VERSION,
  SEND_CORRECTIVE_NOTIFICATION,
  applyApprovedProductionRevision,
  confirmApprovalChallenge,
  decideRoleNamespace,
  openApprovalChallenge,
  prepareCompensatingProposal,
  type ApprovedRevisionInput,
  type AuthoritativeScope,
  type AuthoritySessionNamespace,
  type AuthoritySessionRole,
  type AuthenticatedAuthoritySession,
  type CompensationBinder,
} from '@sceneready/authority';

export const SR04_REPORT_VERSION = 'SR-04-CERTIFICATION-v1';
export const SR04_EXECUTION_CORE_COMMIT = '963be6d0825713505a3a3144c11faeb9d6e827d3';
export const SR04_CERTIFICATION_BASE_COMMIT = SR04_EXECUTION_CORE_COMMIT;

const NOW = '2026-09-17T03:45:00.000Z';
const AUTHENTICATED_AT = '2026-09-17T03:00:00.000Z';
const SESSION_EXPIRES_AT = '2026-09-17T05:00:00.000Z';
const TOKEN_TTL_SECONDS = 120;

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

const ROLE_PAIRS = [
  ['PRODUCTION_LEAD', 'LIVE'],
  ['PRODUCTION_LEAD', 'REPLAY'],
  ['DEMO_PRODUCTION_LEAD', 'LIVE'],
  ['DEMO_PRODUCTION_LEAD', 'REPLAY'],
  ['ASSISTANT', 'LIVE'],
  ['ASSISTANT', 'REPLAY'],
] as const;

export interface Sr04AttackRecord {
  readonly id: string;
  readonly status: string;
  readonly reason: string | null;
  readonly mutations: number;
  readonly executionReason: string | null;
  readonly pass: boolean;
}

export interface Sr04CertificationReport {
  readonly reportVersion: typeof SR04_REPORT_VERSION;
  readonly identity: {
    readonly executionCoreCommit: typeof SR04_EXECUTION_CORE_COMMIT;
    readonly certificationBaseCommit: typeof SR04_CERTIFICATION_BASE_COMMIT;
  };
  readonly policies: {
    readonly authorityRoleNamespace: typeof ROLE_NAMESPACE_POLICY_VERSION;
    readonly communicationAudience: typeof COMMUNICATION_AUDIENCE_POLICY_VERSION;
  };
  readonly invariants: readonly { readonly id: string; readonly pass: boolean }[];
  readonly invariantCount: number;
  readonly roleNamespace: readonly {
    readonly role: AuthoritySessionRole;
    readonly namespace: AuthoritySessionNamespace;
    readonly decision: 'ALLOW' | 'DENY';
  }[];
  readonly ambiguousSpeech: {
    readonly status: string;
    readonly reason: string | null;
    readonly token: null | string;
    readonly signatures: number;
  };
  readonly attacks: readonly Sr04AttackRecord[];
  readonly attackCount: number;
  readonly successfulBypasses: number;
  readonly atomicTransaction: {
    readonly pass: boolean;
    readonly appliedRevision: number | null;
    readonly ledgerEvents: number;
    readonly consumedTokens: number;
    readonly outboxJobs: number;
    readonly rollbackPass: boolean;
  };
  readonly singleUse: { readonly pass: boolean; readonly reason: string | null };
  readonly staleDrift: {
    readonly pass: boolean;
    readonly graphReason: string | null;
    readonly productionReason: string | null;
  };
  readonly canonical: {
    readonly outboxCount: number;
    readonly criticalCount: number;
    readonly informationalCount: number;
    readonly faultDelivery: string;
    readonly recoveredDelivery: string;
    readonly criticalAcknowledgements: string;
    readonly partialCompletionPass: boolean;
    readonly idempotentRetryPass: boolean;
    readonly deliveredIsNotConfirmed: boolean;
    readonly cannotComplyPass: boolean;
    readonly cannotComplyRequiresRecompute: boolean;
    readonly forwardRecoveryPass: boolean;
    readonly immutableHistoryPass: boolean;
    readonly historyEvents: number;
    readonly compensationBaseProductionRevision: number | null;
    readonly compensationFingerprintBound: boolean;
  };
  readonly evidence: {
    readonly tests: readonly string[];
    readonly documents: readonly string[];
  };
}

interface MemorySigner extends ApprovalSigner {
  readonly verifies: number;
  readonly signs: number;
}

interface Lane {
  readonly proposal: AuthorityProposal;
  readonly repository: InMemoryAuthoritativeState;
  readonly scope: AuthoritativeScope;
  readonly signer: MemorySigner;
  readonly token: string;
  readonly claims: BoundApprovalClaims;
}

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

function productionSource(relativeDirectory: string): string {
  const directory = join(repositoryRoot(), relativeDirectory);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n');
}

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

function memorySigner(): MemorySigner {
  const tokens = new Map<string, BoundApprovalClaims>();
  const seen = { verifies: 0, signs: 0 };
  return {
    get verifies() {
      return seen.verifies;
    },
    get signs() {
      return seen.signs;
    },
    sign(claims) {
      seen.signs += 1;
      const token = `signed:${claims.tokenId}`;
      tokens.set(token, { ...claims });
      return Promise.resolve(token);
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
  if (!bound.ok) {
    throw new Error(bound.issues.join(','));
  }
  return bound.proposal;
}

function communicationsBinder(): CompensationBinder {
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
      const bound = bindProposalCommunications(context, audience, payloads);
      if (!bound.ok) {
        return { ok: false, issues: bound.issues };
      }
      return { ok: true, proposal: bound.proposal };
    },
  };
}

function liveScope(): AuthoritativeScope {
  return {
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    authorityNamespace: 'LIVE',
  };
}

async function revisionOf(
  repository: InMemoryAuthoritativeState,
  scope: AuthoritativeScope,
): Promise<number> {
  const snapshot = await repository.read(scope);
  return snapshot?.productionRevision ?? -1;
}

async function freshApproved(tokenId = 'TOKEN-R15', challengeId = 'CHALLENGE-R15'): Promise<Lane> {
  const proposal = optionAProposal();
  const repository = new InMemoryAuthoritativeState();
  const scope = liveScope();
  await repository.seed({
    accountId: scope.accountId,
    productionId: scope.productionId,
    authorityNamespace: 'LIVE',
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
    ttlSeconds: TOKEN_TTL_SECONDS,
    signer,
  });
  if (confirmed.status !== 'APPROVED') {
    throw new Error(confirmed.reason ?? 'approval was not granted');
  }
  return {
    proposal,
    repository,
    scope,
    signer,
    token: confirmed.token,
    claims: confirmed.claims,
  };
}

function applyInput(
  lane: Lane,
  overrides: Partial<ApprovedRevisionInput> = {},
): ApprovedRevisionInput {
  return {
    repository: lane.repository,
    scope: lane.scope,
    token: lane.token,
    now: NOW,
    proposal: lane.proposal,
    nextProductionState: { schedule: 'APPLIED' },
    signer: lane.signer,
    executionId: 'EXEC-R15',
    ledgerEventId: 'LEDGER-R15',
    ...overrides,
  };
}

async function measureDenial(
  id: string,
  lane: Lane,
  overrides: Partial<ApprovedRevisionInput>,
  executionReason: string | null = null,
): Promise<Sr04AttackRecord> {
  const before = await revisionOf(lane.repository, lane.scope);
  const tokensBefore = await lane.repository.consumedTokenIds(lane.scope);
  const result = await applyApprovedProductionRevision(applyInput(lane, overrides));
  const after = await revisionOf(lane.repository, lane.scope);
  const tokensAfter = await lane.repository.consumedTokenIds(lane.scope);
  const mutations = after - before;
  return {
    id,
    status: result.status,
    reason: result.reason,
    mutations,
    executionReason,
    pass:
      result.status === 'DENIED' && mutations === 0 && tokensAfter.length === tokensBefore.length,
  };
}

function invariant(id: string, pass: boolean): { readonly id: string; readonly pass: boolean } {
  return { id, pass };
}

export function sr04EvidencePath(): string {
  return resolve(repositoryRoot(), 'docs/evidence/SR-04-CERTIFICATION.json');
}

export async function generateSr04EvidenceReport(): Promise<Sr04CertificationReport> {
  const roleNamespace = ROLE_PAIRS.map(([role, namespace]) => ({
    role,
    namespace,
    decision: decideRoleNamespace(role, namespace),
  }));
  const rolePass =
    roleNamespace.filter((item) => item.decision === 'ALLOW').length === 2 &&
    roleNamespace.some(
      (item) =>
        item.role === 'PRODUCTION_LEAD' && item.namespace === 'LIVE' && item.decision === 'ALLOW',
    ) &&
    roleNamespace.some(
      (item) =>
        item.role === 'DEMO_PRODUCTION_LEAD' &&
        item.namespace === 'REPLAY' &&
        item.decision === 'ALLOW',
    );

  const ambiguousProposal = optionAProposal();
  const ambiguousOpened = openApprovalChallenge({
    session: session('PRODUCTION_LEAD', 'LIVE'),
    proposal: ambiguousProposal,
    authorityNamespace: 'LIVE',
    challengeId: 'CHALLENGE-AMBIGUOUS',
    now: NOW,
    ttlSeconds: 7200,
  });
  if (ambiguousOpened.status !== 'OPENED') {
    throw new Error(ambiguousOpened.reason);
  }
  const ambiguousSigner = memorySigner();
  const ambiguous = await confirmApprovalChallenge({
    intent: 'SOUNDS_GOOD',
    session: session('PRODUCTION_LEAD', 'LIVE'),
    challenge: ambiguousOpened.challenge,
    currentProposal: ambiguousProposal,
    now: NOW,
    tokenId: 'TOKEN-AMBIGUOUS',
    ttlSeconds: TOKEN_TTL_SECONDS,
    signer: ambiguousSigner,
  });

  const assistantRepository = new InMemoryAuthoritativeState();
  const assistantScope = liveScope();
  const assistantProposal = optionAProposal();
  await assistantRepository.seed({
    accountId: assistantScope.accountId,
    productionId: assistantScope.productionId,
    authorityNamespace: 'LIVE',
    productionRevision: assistantProposal.baseProductionRevision,
    graphRevision: assistantProposal.baseGraphRevision,
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
  if (assistantOpened.status !== 'OPENED') {
    throw new Error(assistantOpened.reason);
  }
  const assistantSigner = memorySigner();
  const assistantBefore = await revisionOf(assistantRepository, assistantScope);
  const assistantConfirm = await confirmApprovalChallenge({
    intent: EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
    session: session('ASSISTANT', 'LIVE'),
    challenge: assistantOpened.challenge,
    currentProposal: assistantProposal,
    now: NOW,
    tokenId: 'TOKEN-ASSISTANT',
    ttlSeconds: TOKEN_TTL_SECONDS,
    signer: assistantSigner,
  });
  const assistantAfter = await revisionOf(assistantRepository, assistantScope);
  const forgedLane = await freshApproved('TOKEN-FORGED-BASE', 'CHALLENGE-FORGED-BASE');
  const forged = await measureDenial('ASSISTANT_ROLE_EXECUTION', forgedLane, {
    token: 'forged-assistant',
    signer: {
      sign() {
        return Promise.reject(new Error('sign must not be called'));
      },
      verify() {
        const invalid: unknown = { ...forgedLane.claims, role: 'ASSISTANT' };
        return Promise.resolve(invalid as BoundApprovalClaims);
      },
    },
  });

  const crossProduction = await measureDenial('CROSS_PRODUCTION', await freshApproved(), {
    scope: { ...liveScope(), productionId: 'OTHER-PROD' },
  });
  const crossNamespace = await measureDenial('CROSS_NAMESPACE', await freshApproved(), {
    scope: { ...liveScope(), authorityNamespace: 'REPLAY' },
  });
  const tamperedLane = await freshApproved();
  const tampered = await measureDenial('TAMPERED_FINGERPRINT', tamperedLane, {
    proposal: {
      ...tamperedLane.proposal,
      predictedEffects: [
        ...tamperedLane.proposal.predictedEffects,
        { subjectId: 'ACT-UNAPPROVED', severity: 'HIGH' },
      ],
    },
  });
  const payloadLane = await freshApproved();
  const payload = await measureDenial('PAYLOAD_DRIFT', payloadLane, {
    proposal: {
      ...payloadLane.proposal,
      notificationPayloads: payloadLane.proposal.notificationPayloads.map((item, index) => {
        if (index !== 0 || typeof item !== 'object' || item === null) {
          return item;
        }
        return { ...item, newValue: '07:00' };
      }),
    },
  });
  const expiredLane = await freshApproved();
  const expired = await measureDenial('EXPIRED_TOKEN', expiredLane, {
    now: expiredLane.claims.expiresAt,
  });
  const replayLane = await freshApproved();
  const replayFirst = await applyApprovedProductionRevision(applyInput(replayLane));
  if (replayFirst.status !== 'APPLIED') {
    throw new Error(replayFirst.reason ?? 'canonical replay baseline did not apply');
  }
  const replayed = await measureDenial('REPLAYED_TOKEN', replayLane, {
    executionId: 'EXEC-R15-REPLAY',
    ledgerEventId: 'LEDGER-R15-REPLAY',
  });
  const graphLane = await freshApproved();
  await graphLane.repository.noteGraphRevision(
    graphLane.scope,
    graphLane.proposal.baseGraphRevision + 1,
  );
  const graphDrift = await measureDenial('GRAPH_DRIFT', graphLane, {});
  const productionLane = await freshApproved('TOKEN-R15-A', 'CHALLENGE-R15-A');
  const productionSecond = await confirmApprovalChallenge({
    intent: EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
    session: session('PRODUCTION_LEAD', 'LIVE'),
    challenge: openOrThrow(
      openApprovalChallenge({
        session: session('PRODUCTION_LEAD', 'LIVE'),
        proposal: productionLane.proposal,
        authorityNamespace: 'LIVE',
        challengeId: 'CHALLENGE-R15-B',
        now: NOW,
        ttlSeconds: 7200,
      }),
    ),
    currentProposal: productionLane.proposal,
    now: NOW,
    tokenId: 'TOKEN-R15-B',
    ttlSeconds: TOKEN_TTL_SECONDS,
    signer: memorySigner(),
  });
  if (productionSecond.status !== 'APPROVED') {
    throw new Error(productionSecond.reason ?? 'second approval was not granted');
  }
  const productionFirst = await applyApprovedProductionRevision(applyInput(productionLane));
  if (productionFirst.status !== 'APPLIED') {
    throw new Error(productionFirst.reason ?? 'production baseline did not apply');
  }
  const productionBefore = await revisionOf(productionLane.repository, productionLane.scope);
  const productionStale = await applyApprovedProductionRevision(
    applyInput(productionLane, {
      token: productionSecond.token,
      signer: {
        sign() {
          return Promise.reject(new Error('sign must not be called'));
        },
        verify(token) {
          if (token !== productionSecond.token) {
            return Promise.reject(new Error('rejected token'));
          }
          return Promise.resolve({ ...productionSecond.claims });
        },
      },
      executionId: 'EXEC-R15-B',
      ledgerEventId: 'LEDGER-R15-B',
    }),
  );
  const productionAfter = await revisionOf(productionLane.repository, productionLane.scope);

  const canonical = await freshApproved();
  const applied = await applyApprovedProductionRevision(applyInput(canonical));
  if (applied.status !== 'APPLIED') {
    throw new Error(applied.reason ?? 'canonical revision did not apply');
  }
  const jobs = applied.outboxJobs;
  const criticalJobs = jobs.filter((job) => job.acknowledgementRequirement === 'REQUIRED_CRITICAL');
  const informationalJobs = jobs.filter(
    (job) => job.acknowledgementRequirement === 'INFORMATIONAL',
  );
  const calls: string[] = [];
  const adapter = {
    deliver(notification: { readonly idempotencyKey: string }) {
      calls.push(notification.idempotencyKey);
      return Promise.resolve();
    },
  };
  const tracker = new SandboxNotificationTracker(jobs);
  const firstKey = requiredKey(jobs, 0);
  const fourthKey = requiredKey(jobs, 3);
  await tracker.deliver(adapter, firstKey);
  const deliveredOnce = tracker.snapshot().find((item) => item.idempotencyKey === firstKey);
  await tracker.deliver(adapter, requiredKey(jobs, 1));
  await tracker.deliver(adapter, requiredKey(jobs, 2));
  const fault = tracker.receipt();
  const retry = await tracker.deliver(adapter, firstKey);
  await tracker.deliver(adapter, fourthKey);
  const recovered = tracker.receipt();
  for (const job of criticalJobs) {
    tracker.acknowledge(job.idempotencyKey, 'CONFIRMED');
  }
  const complete = tracker.receipt();

  const cannotTracker = new SandboxNotificationTracker(jobs);
  for (const job of jobs) {
    await cannotTracker.deliver(
      {
        deliver() {
          return Promise.resolve();
        },
      },
      job.idempotencyKey,
    );
  }
  const criticalKey = criticalJobs[0]?.idempotencyKey;
  if (criticalKey === undefined) {
    throw new Error('canonical critical job is missing');
  }
  const cannot = cannotTracker.acknowledge(criticalKey, 'CANNOT_COMPLY');
  const cannotReceipt = cannotTracker.receipt();
  const revisionAfterReceipt = await revisionOf(canonical.repository, canonical.scope);

  const prepared = prepareCompensatingProposal({
    appliedProposal: canonical.proposal,
    currentProductionRevision: revisionAfterReceipt,
    currentGraphRevision: (await canonical.repository.read(canonical.scope))?.graphRevision ?? -1,
    proposalId: 'PROP-OPTION-A-COMPENSATION',
    crew: OPTION_A.crew,
    callTimes: OPTION_A.callTimes,
    departures: OPTION_A.departures,
    bindCommunications: communicationsBinder(),
  });
  const history = await canonical.repository.readLedger(canonical.scope);
  const compensationFingerprintBound =
    prepared.ok &&
    createProposalFingerprint({
      ...prepared.compensation.proposal,
      predictedEffects: prepared.compensation.proposal.predictedEffects.map((effect, index) =>
        index === 0 && typeof effect === 'object' && effect !== null
          ? { ...effect, reversibility: 'IRREVERSIBLE' }
          : effect,
      ),
    }) !== prepared.compensation.fingerprint;

  const rollbackLane = await freshApproved('TOKEN-ROLLBACK', 'CHALLENGE-ROLLBACK');
  rollbackLane.repository.failBeforeNextCommit(new Error('injected commit failure'));
  let rollbackThrew = false;
  try {
    await applyApprovedProductionRevision(applyInput(rollbackLane));
  } catch (error) {
    rollbackThrew = error instanceof Error && error.message === 'injected commit failure';
  }
  const rollbackSnapshot = await rollbackLane.repository.read(rollbackLane.scope);
  const rollbackLedger = await rollbackLane.repository.readLedger(rollbackLane.scope);
  const rollbackOutbox = await rollbackLane.repository.readOutbox(rollbackLane.scope);
  const rollbackTokens = await rollbackLane.repository.consumedTokenIds(rollbackLane.scope);

  const authoritySource = productionSource('packages/authority/src');
  const communicationsSource = productionSource('packages/communications/src');
  const oneLane =
    authoritySource.match(/private commitUnlocked\(/g)?.length === 1 &&
    authoritySource.includes('repository.applyConditionalRevision') &&
    authoritySource.includes('repository.applyApprovedProductionRevision');
  const noHiddenClock = !/Date\.now|Math\.random|randomUUID|\bfetch\s*\(/.test(
    `${authoritySource}\n${communicationsSource}`,
  );
  const communicationsIsolated = !communicationsSource.includes('@sceneready/authority');

  const assistantPass =
    assistantConfirm.status === 'DENIED' &&
    assistantConfirm.reason === 'ROLE_NOT_AUTHORIZED' &&
    assistantConfirm.token === null &&
    assistantSigner.signs === 0 &&
    assistantAfter === assistantBefore &&
    forged.pass &&
    forged.reason === 'TOKEN_REJECTED';
  const attacks: readonly Sr04AttackRecord[] = [
    {
      id: 'ASSISTANT_ROLE',
      status: assistantConfirm.status,
      reason: assistantConfirm.reason,
      mutations: assistantAfter - assistantBefore,
      executionReason: forged.reason,
      pass: assistantPass,
    },
    crossProduction,
    crossNamespace,
    tampered,
    expired,
    replayed,
    graphDrift,
    payload,
  ];
  const rollbackPass =
    rollbackThrew &&
    rollbackSnapshot?.productionRevision === 14 &&
    rollbackSnapshot.productionState !== null &&
    JSON.stringify(rollbackSnapshot.productionState) === JSON.stringify({ schedule: 'BASE' }) &&
    rollbackLedger.length === 0 &&
    rollbackOutbox.length === 0 &&
    rollbackTokens.length === 0;
  const atomicPass =
    applied.productionRevision === canonical.proposal.baseProductionRevision + 1 &&
    applied.ledgerEvent.kind === 'REVISION_APPLIED' &&
    (await canonical.repository.readLedger(canonical.scope)).length === 1 &&
    (await canonical.repository.consumedTokenIds(canonical.scope)).length === 1 &&
    jobs.length === 4 &&
    criticalJobs.length === 3 &&
    informationalJobs.length === 1;
  const partialPass = fault.status === 'PARTIALLY_COMPLETED' && fault.deliveredCount === 3;
  const retryPass =
    retry === 'ALREADY_DELIVERED' && calls.filter((key) => key === firstKey).length === 1;
  const recoveredPass = recovered.deliveredCount === jobs.length && recovered.status !== 'COMPLETE';
  const acknowledgementPass =
    complete.status === 'COMPLETE' &&
    complete.criticalConfirmedCount === criticalJobs.length &&
    complete.requiresGraphRecompute === false;
  const deliveredIsNotConfirmed =
    deliveredOnce?.deliveryStatus === 'DELIVERED' &&
    deliveredOnce.acknowledgementStatus === 'PENDING';
  const cannotPass =
    cannot.ok === true &&
    cannotReceipt.status !== 'COMPLETE' &&
    cannotReceipt.requiresGraphRecompute === true &&
    revisionAfterReceipt === applied.productionRevision;
  const forwardPass =
    prepared.ok &&
    prepared.compensation.proposal.baseProductionRevision === applied.productionRevision &&
    prepared.compensation.fingerprint !== createProposalFingerprint(canonical.proposal) &&
    prepared.compensation.sideEffects.every(
      (effect) => effect.kind === SEND_CORRECTIVE_NOTIFICATION,
    ) &&
    compensationFingerprintBound;
  const historyPass =
    history.length === 1 &&
    history[0]?.productionRevision === applied.productionRevision &&
    (await canonical.repository.readOutbox(canonical.scope)).length === jobs.length;
  const stalePass =
    graphDrift.pass &&
    graphDrift.reason === 'BASE_REVISION_STALE' &&
    productionStale.status === 'DENIED' &&
    productionStale.reason === 'BASE_REVISION_STALE' &&
    productionAfter === productionBefore;

  const invariants = [
    invariant(
      'EXPLICIT_APPROVAL_REQUIRED',
      ambiguous.status === 'NOT_APPROVED' &&
        ambiguous.token === null &&
        ambiguousSigner.signs === 0,
    ),
    invariant('AMBIGUOUS_SPEECH_CREATES_NO_AUTHORITY', ambiguous.reason === 'NO_EXPLICIT_APPROVAL'),
    invariant(
      'APPROVAL_BINDS_FINGERPRINT',
      tampered.pass && tampered.reason === 'PROPOSAL_FINGERPRINT_MISMATCH',
    ),
    invariant(
      'APPROVAL_BINDS_PAYLOADS',
      payload.pass && payload.reason === 'PROPOSAL_FINGERPRINT_MISMATCH',
    ),
    invariant('APPROVAL_BINDS_REVISIONS', stalePass),
    invariant('SINGLE_USE', replayed.pass && replayed.reason === 'APPROVAL_ALREADY_CONSUMED'),
    invariant(
      'PRODUCTION_SCOPED',
      crossProduction.pass && crossProduction.reason === 'PRODUCTION_SCOPE_MISMATCH',
    ),
    invariant(
      'NAMESPACE_SCOPED',
      crossNamespace.pass && crossNamespace.reason === 'AUTHORITY_NAMESPACE_MISMATCH',
    ),
    invariant('ROLE_NAMESPACE_MATRIX', rolePass && assistantPass),
    invariant('ONE_MUTATION_LANE', oneLane),
    invariant('ATOMIC_COMMIT', atomicPass && rollbackPass),
    invariant('IDEMPOTENT_DELIVERY', retryPass),
    invariant('DELIVERED_IS_NOT_CONFIRMED', deliveredIsNotConfirmed),
    invariant('PARTIAL_COMPLETION_TRUTHFUL', partialPass && recoveredPass && acknowledgementPass),
    invariant('CANNOT_COMPLY_BLOCKS_AND_SIGNALS', cannotPass),
    invariant('FORWARD_RECOVERY_ONLY', forwardPass),
    invariant('HISTORY_IMMUTABLE', historyPass),
    invariant('COMMUNICATIONS_DO_NOT_MUTATE_PRODUCTION', communicationsIsolated && cannotPass),
    invariant('NO_HIDDEN_CLOCK_OR_NETWORK', noHiddenClock),
  ];

  return {
    reportVersion: SR04_REPORT_VERSION,
    identity: {
      executionCoreCommit: SR04_EXECUTION_CORE_COMMIT,
      certificationBaseCommit: SR04_CERTIFICATION_BASE_COMMIT,
    },
    policies: {
      authorityRoleNamespace: ROLE_NAMESPACE_POLICY_VERSION,
      communicationAudience: COMMUNICATION_AUDIENCE_POLICY_VERSION,
    },
    invariants,
    invariantCount: invariants.length,
    roleNamespace,
    ambiguousSpeech: {
      status: ambiguous.status,
      reason: ambiguous.reason,
      token: ambiguous.token,
      signatures: ambiguousSigner.signs,
    },
    attacks,
    attackCount: attacks.length,
    successfulBypasses: attacks.filter((attack) => !attack.pass).length,
    atomicTransaction: {
      pass: atomicPass && rollbackPass,
      appliedRevision: applied.productionRevision,
      ledgerEvents: history.length,
      consumedTokens: (await canonical.repository.consumedTokenIds(canonical.scope)).length,
      outboxJobs: jobs.length,
      rollbackPass,
    },
    singleUse: { pass: replayed.pass, reason: replayed.reason },
    staleDrift: {
      pass: stalePass,
      graphReason: graphDrift.reason,
      productionReason: productionStale.reason,
    },
    canonical: {
      outboxCount: jobs.length,
      criticalCount: criticalJobs.length,
      informationalCount: informationalJobs.length,
      faultDelivery: `${fault.deliveredCount}/${jobs.length}`,
      recoveredDelivery: `${recovered.deliveredCount}/${jobs.length}`,
      criticalAcknowledgements: `${complete.criticalConfirmedCount}/${complete.criticalRequiredCount}`,
      partialCompletionPass: partialPass,
      idempotentRetryPass: retryPass,
      deliveredIsNotConfirmed,
      cannotComplyPass: cannotPass,
      cannotComplyRequiresRecompute: cannotReceipt.requiresGraphRecompute,
      forwardRecoveryPass: forwardPass,
      immutableHistoryPass: historyPass,
      historyEvents: history.length,
      compensationBaseProductionRevision: prepared.ok
        ? prepared.compensation.proposal.baseProductionRevision
        : null,
      compensationFingerprintBound,
    },
    evidence: {
      tests: [
        'packages/authority/src/security-invariants.test.ts',
        'packages/communications/src/failure-recovery.test.ts',
        'tools/evidence-report/src/sr04-report.test.ts',
      ],
      documents: [
        'docs/architecture/HUMAN-AUTHORITY.md',
        'docs/architecture/EXECUTION-SEMANTICS.md',
        'docs/submission/CLAIM-TO-EVIDENCE.md',
      ],
    },
  };
}

function openOrThrow(
  opened: ReturnType<typeof openApprovalChallenge>,
): Extract<ReturnType<typeof openApprovalChallenge>, { status: 'OPENED' }>['challenge'] {
  if (opened.status !== 'OPENED') {
    throw new Error(opened.reason);
  }
  return opened.challenge;
}

function requiredKey(jobs: readonly { readonly idempotencyKey: string }[], index: number): string {
  const key = jobs[index]?.idempotencyKey;
  if (key === undefined) {
    throw new Error(`missing outbox job ${index}`);
  }
  return key;
}

export async function serializeSr04EvidenceReport(
  report: Sr04CertificationReport,
): Promise<string> {
  return format(JSON.stringify(report), { filepath: sr04EvidencePath() });
}

export function sha256Sr04EvidenceReport(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

function isDirectCliInvocation(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(invoked);
}

async function runCli(): Promise<number> {
  try {
    const serialized = await serializeSr04EvidenceReport(await generateSr04EvidenceReport());
    const path = sr04EvidencePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialized, 'utf8');
    process.stdout.write(serialized);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sr04 evidence report failed';
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

if (isDirectCliInvocation()) {
  process.exitCode = await runCli();
}
