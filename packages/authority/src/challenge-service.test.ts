import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AuthorityContractError,
  createApprovalChallenge,
  createProposalFingerprint,
  type ApprovalSigner,
  type AuthorityProposal,
  type BoundApprovalClaims,
} from '@sceneready/mcp-human-authority';
import { describe, expect, it } from 'vitest';

import {
  EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
  ROLE_NAMESPACE_POLICY_VERSION,
  type AuthenticatedAuthoritySession,
  type AuthoritySessionNamespace,
  type AuthoritySessionRole,
  AuthorityBoundaryError,
  confirmApprovalChallenge,
  decideRoleNamespace,
  openApprovalChallenge,
  readAuthenticatedAuthoritySession,
} from './index.js';

const NOW = '2026-09-17T03:45:00.000Z';
const AUTHENTICATED_AT = '2026-09-17T03:00:00.000Z';
const SESSION_EXPIRES_AT = '2026-09-17T05:00:00.000Z';
const LIVE_TOKEN_TTL_SECONDS = 120;
const LIVE_TOKEN_EXPIRES_AT = '2026-09-17T03:47:00.000Z';
const REPLAY_TOKEN_TTL_SECONDS = 30;
const REPLAY_TOKEN_EXPIRES_AT = '2026-09-17T03:45:30.000Z';

function proposal(overrides: Partial<AuthorityProposal> = {}): AuthorityProposal {
  return {
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    proposalId: 'PROP-1',
    baseProductionRevision: 4,
    baseGraphRevision: 9,
    policyVersion: 'SR-POLICY-v1',
    interventions: [{ kind: 'ADD_BUFFER', beforeActivityId: 'ACT-EIXAMPLE-SETUP', minutes: 10 }],
    affectedRecipients: ['PERSON-MODEL'],
    notificationPayloads: [{ channel: 'VOICE', text: 'Hold the current plan.' }],
    predictedEffects: [{ subjectId: 'ACT-STUDIO-LOAD-IN', severity: 'LOW' }],
    ...overrides,
  };
}

function session(
  role: AuthoritySessionRole,
  authorityNamespace: AuthoritySessionNamespace,
  overrides: Partial<AuthenticatedAuthoritySession> = {},
): AuthenticatedAuthoritySession {
  return {
    accountId: 'ACCT-1',
    actorId: role === 'DEMO_PRODUCTION_LEAD' ? 'ACTOR-DEMO' : `ACTOR-${role}`,
    productionId: 'BCN-DEMO-01',
    role,
    authorityNamespace,
    authenticatedAt: AUTHENTICATED_AT,
    expiresAt: SESSION_EXPIRES_AT,
    ...overrides,
  };
}

function challengeFor(
  current: AuthorityProposal,
  authorityNamespace: 'LIVE' | 'REPLAY',
  overrides: Partial<Parameters<typeof createApprovalChallenge>[0]> = {},
) {
  return createApprovalChallenge({
    challengeId: 'CHALLENGE-1',
    proposalFingerprint: createProposalFingerprint(current),
    proposalId: current.proposalId,
    accountId: current.accountId,
    productionId: current.productionId,
    baseProductionRevision: current.baseProductionRevision,
    baseGraphRevision: current.baseGraphRevision,
    policyVersion: current.policyVersion,
    actorId: 'ACTOR-OPENER',
    authorityNamespace,
    now: NOW,
    ttlSeconds: 7200,
    ...overrides,
  });
}

function createSigner(): {
  signer: ApprovalSigner;
  signs: BoundApprovalClaims[];
  verifies: number;
} {
  const signs: BoundApprovalClaims[] = [];
  const seen = { verifies: 0 };
  const signer: ApprovalSigner = {
    sign(claims) {
      signs.push(claims);
      return Promise.resolve(`signed:${claims.tokenId}`);
    },
    verify() {
      seen.verifies += 1;
      return Promise.reject(new Error('verify must not be called'));
    },
  };
  return {
    signer,
    signs,
    get verifies() {
      return seen.verifies;
    },
  };
}

function confirmInput(
  overrides: Partial<Parameters<typeof confirmApprovalChallenge>[0]> = {},
): Parameters<typeof confirmApprovalChallenge>[0] {
  const current = proposal();
  const recorder = createSigner();
  return {
    intent: EXPLICIT_APPROVE_ACTIVE_PROPOSAL,
    session: session('PRODUCTION_LEAD', 'LIVE'),
    challenge: challengeFor(current, 'LIVE'),
    currentProposal: current,
    now: NOW,
    tokenId: 'TOKEN-LIVE',
    ttlSeconds: LIVE_TOKEN_TTL_SECONDS,
    signer: recorder.signer,
    ...overrides,
  };
}

function productionSource(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n');
}

describe('role namespace policy', () => {
  it('names the approved policy version', () => {
    expect(ROLE_NAMESPACE_POLICY_VERSION).toBe('SR-AUTHORITY-ROLE-NAMESPACE-v1.0');
  });

  it.each([
    ['PRODUCTION_LEAD', 'LIVE', 'ALLOW'],
    ['PRODUCTION_LEAD', 'REPLAY', 'DENY'],
    ['DEMO_PRODUCTION_LEAD', 'LIVE', 'DENY'],
    ['DEMO_PRODUCTION_LEAD', 'REPLAY', 'ALLOW'],
    ['ASSISTANT', 'LIVE', 'DENY'],
    ['ASSISTANT', 'REPLAY', 'DENY'],
  ] as const)('%s + %s => %s', (role, namespace, decision) => {
    expect(decideRoleNamespace(role, namespace)).toBe(decision);
  });

  it('denies wildcard role and namespace values', () => {
    expect(decideRoleNamespace('*' as 'PRODUCTION_LEAD', 'LIVE')).toBe('DENY');
    expect(decideRoleNamespace('PRODUCTION_LEAD', '*' as 'LIVE')).toBe('DENY');
  });
});

describe('authenticated authority session', () => {
  it('accepts a structurally valid session without reading a clock', () => {
    const value = session('PRODUCTION_LEAD', 'LIVE');
    expect(readAuthenticatedAuthoritySession(value)).toEqual(value);
    expect(Object.isFrozen(value)).toBe(false);
  });

  it.each([
    ['accountId', { accountId: '' }],
    ['actorId', { actorId: '' }],
    ['productionId', { productionId: '' }],
    ['role', { role: 'JUDGE' as 'PRODUCTION_LEAD' }],
    ['namespace', { authorityNamespace: '*' as 'LIVE' }],
    ['authenticatedAt', { authenticatedAt: '2026-09-17T03:00:00Z' }],
    ['expiresAt', { expiresAt: '2026-02-31T00:00:00.000Z' }],
    ['order', { authenticatedAt: SESSION_EXPIRES_AT, expiresAt: AUTHENTICATED_AT }],
    ['equal bounds', { authenticatedAt: NOW, expiresAt: NOW }],
  ] as const)('rejects an invalid %s', (_label, overrides) => {
    expect(() =>
      readAuthenticatedAuthoritySession(session('PRODUCTION_LEAD', 'LIVE', overrides)),
    ).toThrow(AuthorityBoundaryError);
  });
});

describe('open approval challenge', () => {
  it('delegates fingerprinting and stays unapproved and unsigned', () => {
    const current = proposal();
    const actor = session('ASSISTANT', 'LIVE');
    const before = JSON.stringify({ current, actor });
    const opened = openApprovalChallenge({
      session: actor,
      proposal: current,
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-OPEN',
      now: NOW,
      ttlSeconds: 60,
    });
    expect(opened.status).toBe('OPENED');
    if (opened.status !== 'OPENED') {
      return;
    }
    expect(opened.challenge.status).toBe('ACTIVE');
    expect(opened.challenge.proposalFingerprint).toBe(createProposalFingerprint(current));
    expect(opened.challenge.actorId).toBe('ACTOR-ASSISTANT');
    expect(opened.challenge).not.toHaveProperty('token');
    expect(opened.challenge).not.toHaveProperty('singleUse');
    expect(opened).not.toHaveProperty('token');
    expect(JSON.stringify({ current, actor })).toBe(before);
  });

  it('keeps the same fingerprint when proposal key order changes', () => {
    const current = proposal();
    const reordered: AuthorityProposal = {
      predictedEffects: current.predictedEffects,
      policyVersion: current.policyVersion,
      notificationPayloads: current.notificationPayloads,
      interventions: current.interventions,
      baseProductionRevision: current.baseProductionRevision,
      baseGraphRevision: current.baseGraphRevision,
      affectedRecipients: current.affectedRecipients,
      accountId: current.accountId,
      productionId: current.productionId,
      proposalId: current.proposalId,
    };
    const opened = openApprovalChallenge({
      session: session('PRODUCTION_LEAD', 'LIVE'),
      proposal: reordered,
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-ORDER',
      now: NOW,
      ttlSeconds: 60,
    });
    expect(opened.status).toBe('OPENED');
    if (opened.status !== 'OPENED') {
      return;
    }
    expect(opened.challenge.proposalFingerprint).toBe(createProposalFingerprint(current));
  });

  it.each([
    ['account', { accountId: 'ACCT-OTHER' }, 'ACCOUNT_SCOPE_MISMATCH'],
    ['production', { productionId: 'OTHER-PROD' }, 'PRODUCTION_SCOPE_MISMATCH'],
  ] as const)('denies a wrong session %s without opening', (_label, overrides, reason) => {
    const opened = openApprovalChallenge({
      session: session('PRODUCTION_LEAD', 'LIVE', overrides),
      proposal: proposal(),
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-SCOPE',
      now: NOW,
      ttlSeconds: 60,
    });
    expect(opened).toEqual({ status: 'DENIED', challenge: null, reason });
  });

  it('denies a namespace that does not match the session', () => {
    const opened = openApprovalChallenge({
      session: session('DEMO_PRODUCTION_LEAD', 'REPLAY'),
      proposal: proposal(),
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-NS',
      now: NOW,
      ttlSeconds: 60,
    });
    expect(opened).toEqual({
      status: 'DENIED',
      challenge: null,
      reason: 'AUTHORITY_NAMESPACE_MISMATCH',
    });
  });

  it('does not sign or implement fingerprinting itself', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'challenge-service.ts'),
      'utf8',
    );
    expect(source).toContain('createProposalFingerprint');
    expect(source).toContain('createApprovalChallenge');
    expect(source).not.toContain('createHash');
    expect(source).not.toContain('canonicalize');
    expect(source.match(/\.sign\s*\(/g)).toHaveLength(1);
  });
});

describe('confirm approval challenge', () => {
  it.each([
    'AMBIGUOUS_POSITIVE',
    'OK',
    'SOUNDS_GOOD',
    'GO_AHEAD_WITH_WHAT_YOU_THINK',
    'YES_BUT_CHANGE_THE_TIME',
    'CONFIDENT_YES',
  ])('does not approve ambiguous intent %s', async (intent) => {
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({ intent, signer: recorder.signer }),
    );
    expect(result).toEqual({
      status: 'NOT_APPROVED',
      token: null,
      claims: null,
      reason: 'NO_EXPLICIT_APPROVAL',
    });
    expect(recorder.signs).toHaveLength(0);
    expect(recorder.verifies).toBe(0);
  });

  it.each([
    ['PRODUCTION_LEAD', 'REPLAY'],
    ['DEMO_PRODUCTION_LEAD', 'LIVE'],
    ['ASSISTANT', 'LIVE'],
    ['ASSISTANT', 'REPLAY'],
  ] as const)('denies %s in %s', async (role, namespace) => {
    const current = proposal();
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        session: session(role, namespace),
        challenge: challengeFor(current, namespace),
        currentProposal: current,
        signer: recorder.signer,
      }),
    );
    expect(result).toMatchObject({ status: 'DENIED', token: null, reason: 'ROLE_NOT_AUTHORIZED' });
    expect(recorder.signs).toHaveLength(0);
  });

  it('denies a LIVE session against a REPLAY challenge', async () => {
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        session: session('PRODUCTION_LEAD', 'LIVE'),
        challenge: challengeFor(proposal(), 'REPLAY'),
        signer: recorder.signer,
      }),
    );
    expect(result).toMatchObject({
      status: 'DENIED',
      reason: 'AUTHORITY_NAMESPACE_MISMATCH',
    });
    expect(recorder.signs).toHaveLength(0);
  });

  it('denies a REPLAY session against a LIVE challenge', async () => {
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        session: session('DEMO_PRODUCTION_LEAD', 'REPLAY'),
        challenge: challengeFor(proposal(), 'LIVE'),
        signer: recorder.signer,
      }),
    );
    expect(result).toMatchObject({
      status: 'DENIED',
      reason: 'AUTHORITY_NAMESPACE_MISMATCH',
    });
    expect(recorder.signs).toHaveLength(0);
  });

  it('denies an expired session before signing', async () => {
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        now: SESSION_EXPIRES_AT,
        signer: recorder.signer,
      }),
    );
    expect(result).toMatchObject({ status: 'DENIED', reason: 'SESSION_EXPIRED' });
    expect(recorder.signs).toHaveLength(0);
  });

  it('denies an expired challenge before signing', async () => {
    const recorder = createSigner();
    const current = proposal();
    const result = await confirmApprovalChallenge(
      confirmInput({
        challenge: challengeFor(current, 'LIVE', {
          now: '2026-09-17T03:40:00.000Z',
          ttlSeconds: 60,
        }),
        signer: recorder.signer,
      }),
    );
    expect(result).toMatchObject({ status: 'DENIED', reason: 'CHALLENGE_EXPIRED' });
    expect(recorder.signs).toHaveLength(0);
  });

  it('denies an inactive challenge before signing', async () => {
    const recorder = createSigner();
    const challenge = { ...challengeFor(proposal(), 'LIVE'), status: 'CLOSED' };
    const result = await confirmApprovalChallenge(
      confirmInput({ challenge, signer: recorder.signer }),
    );
    expect(result).toMatchObject({ status: 'DENIED', reason: 'CHALLENGE_NOT_ACTIVE' });
    expect(recorder.signs).toHaveLength(0);
  });

  it.each([
    ['account', { accountId: 'ACCT-OTHER' }, 'ACCOUNT_SCOPE_MISMATCH'],
    ['production', { productionId: 'OTHER-PROD' }, 'PRODUCTION_SCOPE_MISMATCH'],
  ] as const)('denies a %s scope mismatch', async (_label, overrides, reason) => {
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        session: session('PRODUCTION_LEAD', 'LIVE', overrides),
        signer: recorder.signer,
      }),
    );
    expect(result).toMatchObject({ status: 'DENIED', reason });
    expect(recorder.signs).toHaveLength(0);
  });

  it.each([
    [
      'intervention',
      { interventions: [{ kind: 'MOVE_CALL', minutes: 30 }] },
      'PROPOSAL_FINGERPRINT_MISMATCH',
    ],
    ['recipient', { affectedRecipients: ['PERSON-OTHER'] }, 'PROPOSAL_FINGERPRINT_MISMATCH'],
    [
      'notification payload',
      { notificationPayloads: [{ channel: 'VOICE', text: 'Leave now.' }] },
      'PROPOSAL_FINGERPRINT_MISMATCH',
    ],
    [
      'predicted effect',
      { predictedEffects: [{ subjectId: 'ACT-OTHER', severity: 'HIGH' }] },
      'PROPOSAL_FINGERPRINT_MISMATCH',
    ],
    ['production revision', { baseProductionRevision: 5 }, 'BASE_PRODUCTION_REVISION_MISMATCH'],
    ['graph revision', { baseGraphRevision: 10 }, 'BASE_GRAPH_REVISION_MISMATCH'],
    ['policy version', { policyVersion: 'SR-POLICY-v2' }, 'POLICY_VERSION_MISMATCH'],
    ['proposal id', { proposalId: 'PROP-2' }, 'PROPOSAL_ID_MISMATCH'],
  ] as const)('denies a changed %s', async (_label, overrides, reason) => {
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        currentProposal: proposal(overrides),
        signer: recorder.signer,
      }),
    );
    expect(result).toMatchObject({ status: 'DENIED', token: null, reason });
    expect(recorder.signs).toHaveLength(0);
  });

  it('fails closed when current proposal material is not authority-valid', async () => {
    const recorder = createSigner();
    const { predictedEffects, ...invalid } = proposal();
    void predictedEffects;
    await expect(
      confirmApprovalChallenge(
        confirmInput({
          currentProposal: invalid as AuthorityProposal,
          signer: recorder.signer,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorityContractError);
    expect(recorder.signs).toHaveLength(0);
  });

  it('does not mutate session, challenge, or proposal inputs', async () => {
    const current = proposal();
    const actor = session('PRODUCTION_LEAD', 'LIVE');
    const challenge = challengeFor(current, 'LIVE');
    const before = {
      current: JSON.stringify(current),
      actor: JSON.stringify(actor),
      challenge: JSON.stringify(challenge),
    };
    const interventions = current.interventions;
    await confirmApprovalChallenge(
      confirmInput({
        session: actor,
        challenge,
        currentProposal: current,
      }),
    );
    expect(JSON.stringify(current)).toBe(before.current);
    expect(JSON.stringify(actor)).toBe(before.actor);
    expect(JSON.stringify(challenge)).toBe(before.challenge);
    expect(current.interventions).toBe(interventions);
    expect(Object.isFrozen(actor)).toBe(false);
    expect(Object.isFrozen(current)).toBe(false);
  });

  it('approves an exact LIVE production lead and signs once', async () => {
    const current = proposal();
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        currentProposal: current,
        signer: recorder.signer,
        tokenId: 'TOKEN-LIVE',
        ttlSeconds: LIVE_TOKEN_TTL_SECONDS,
      }),
    );
    expect(result.status).toBe('APPROVED');
    if (result.status !== 'APPROVED') {
      return;
    }
    expect(result.token).toBe('signed:TOKEN-LIVE');
    expect(result.reason).toBeNull();
    expect(result.claims).toEqual({
      tokenId: 'TOKEN-LIVE',
      accountId: 'ACCT-1',
      productionId: 'BCN-DEMO-01',
      authorityNamespace: 'LIVE',
      proposalId: 'PROP-1',
      proposalFingerprint: createProposalFingerprint(current),
      baseProductionRevision: 4,
      baseGraphRevision: 9,
      policyVersion: 'SR-POLICY-v1',
      actorId: 'ACTOR-PRODUCTION_LEAD',
      role: 'PRODUCTION_LEAD',
      issuedAt: NOW,
      expiresAt: LIVE_TOKEN_EXPIRES_AT,
      singleUse: true,
    });
    expect(recorder.signs).toEqual([result.claims]);
    expect(recorder.verifies).toBe(0);
    expect(Object.isFrozen(result.claims)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('approves an exact REPLAY demo lead and signs once', async () => {
    const current = proposal();
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        session: session('DEMO_PRODUCTION_LEAD', 'REPLAY'),
        challenge: challengeFor(current, 'REPLAY'),
        currentProposal: current,
        signer: recorder.signer,
        tokenId: 'TOKEN-REPLAY',
        ttlSeconds: REPLAY_TOKEN_TTL_SECONDS,
      }),
    );
    expect(result.status).toBe('APPROVED');
    if (result.status !== 'APPROVED') {
      return;
    }
    expect(result.claims.authorityNamespace).toBe('REPLAY');
    expect(result.claims.role).toBe('DEMO_PRODUCTION_LEAD');
    expect(result.claims.actorId).toBe('ACTOR-DEMO');
    expect(result.claims.issuedAt).toBe(NOW);
    expect(result.claims.expiresAt).toBe(REPLAY_TOKEN_EXPIRES_AT);
    expect(result.claims.singleUse).toBe(true);
    expect(result.claims.proposalFingerprint).toBe(createProposalFingerprint(current));
    expect(recorder.signs).toHaveLength(1);
    expect(result.token).toBe('signed:TOKEN-REPLAY');
  });

  it('accepts proposal key-order variation on confirmation', async () => {
    const current = proposal();
    const reordered: AuthorityProposal = {
      proposalId: current.proposalId,
      productionId: current.productionId,
      accountId: current.accountId,
      policyVersion: current.policyVersion,
      baseGraphRevision: current.baseGraphRevision,
      baseProductionRevision: current.baseProductionRevision,
      predictedEffects: current.predictedEffects,
      notificationPayloads: current.notificationPayloads,
      affectedRecipients: current.affectedRecipients,
      interventions: current.interventions,
    };
    const recorder = createSigner();
    const result = await confirmApprovalChallenge(
      confirmInput({
        currentProposal: reordered,
        signer: recorder.signer,
      }),
    );
    expect(result.status).toBe('APPROVED');
    expect(recorder.signs).toHaveLength(1);
  });

  it('lets an assistant open a challenge that only a live lead can confirm', async () => {
    const current = proposal();
    const opened = openApprovalChallenge({
      session: session('ASSISTANT', 'LIVE'),
      proposal: current,
      authorityNamespace: 'LIVE',
      challengeId: 'CHALLENGE-PRESENTED',
      now: NOW,
      ttlSeconds: 600,
    });
    expect(opened.status).toBe('OPENED');
    if (opened.status !== 'OPENED') {
      return;
    }
    const assistant = createSigner();
    const denied = await confirmApprovalChallenge(
      confirmInput({
        session: session('ASSISTANT', 'LIVE'),
        challenge: opened.challenge,
        currentProposal: current,
        signer: assistant.signer,
      }),
    );
    expect(denied).toMatchObject({ status: 'DENIED', reason: 'ROLE_NOT_AUTHORIZED' });
    expect(assistant.signs).toHaveLength(0);

    const lead = createSigner();
    const approved = await confirmApprovalChallenge(
      confirmInput({
        session: session('PRODUCTION_LEAD', 'LIVE'),
        challenge: opened.challenge,
        currentProposal: current,
        signer: lead.signer,
      }),
    );
    expect(approved.status).toBe('APPROVED');
    if (approved.status !== 'APPROVED') {
      return;
    }
    expect(approved.claims.actorId).toBe('ACTOR-PRODUCTION_LEAD');
    expect(approved.claims.role).toBe('PRODUCTION_LEAD');
    expect(lead.signs).toHaveLength(1);
  });
});

describe('authority boundary', () => {
  it('exposes no silent approval API, clock, random id, model call, or persistence', () => {
    const source = productionSource();
    for (const name of [
      'autoApprove',
      'approveRecommendedOption',
      'approveIfConfidenceHigh',
      'approveFromModelOutput',
    ]) {
      expect(source).not.toContain(name);
    }
    expect(source).not.toMatch(/Date\.now|Math\.random|randomUUID|\bfetch\s*\(|process\.env/);
    expect(source).not.toMatch(/Bedrock|Anthropic|openai|writeFile|DynamoDB/i);
    expect(source).toContain('EXPLICIT_APPROVE_ACTIVE_PROPOSAL');
    expect(source).toContain('ApprovalSigner');
    expect(source).toContain('AuthenticatedAuthoritySession');
  });

  it('depends on mcp-human-authority and is not imported back', () => {
    const authorityPackage = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
      'utf8',
    );
    const humanAuthorityRoot = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'mcp-human-authority',
    );
    const humanPackage = readFileSync(join(humanAuthorityRoot, 'package.json'), 'utf8');
    const humanSource = readdirSync(join(humanAuthorityRoot, 'src'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => readFileSync(join(humanAuthorityRoot, 'src', name), 'utf8'))
      .join('\n');
    expect(authorityPackage).toContain('@sceneready/mcp-human-authority');
    expect(humanPackage).not.toContain('@sceneready/authority');
    expect(humanSource).not.toContain('@sceneready/authority');
    expect(productionSource()).toContain("from '@sceneready/mcp-human-authority'");
  });
});
