import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_ROLES,
  type ApprovalSigner,
  type AuthorityProposal,
  type BoundApprovalClaims,
  AuthorityContractError,
  canonicalize,
  createApprovalChallenge,
  createProposalFingerprint,
} from './index.js';

const NOW = '2026-09-17T03:45:00.000Z';

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

function challengeInput(overrides: Partial<Parameters<typeof createApprovalChallenge>[0]> = {}) {
  return {
    challengeId: 'CHALLENGE-1',
    proposalFingerprint: createProposalFingerprint(proposal()),
    proposalId: 'PROP-1',
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    baseProductionRevision: 4,
    baseGraphRevision: 9,
    policyVersion: 'SR-POLICY-v1',
    actorId: 'ACTOR-LEAD',
    authorityNamespace: 'LIVE' as const,
    now: NOW,
    ttlSeconds: 60,
    ...overrides,
  };
}

function packageSource(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(join(directory, name), 'utf8'))
    .join('\n');
}

describe('canonicalization', () => {
  it('emits the same canonical output when object key order differs', () => {
    const left = { b: 1, a: { d: true, c: 'text' } };
    const right = { a: { c: 'text', d: true }, b: 1 };
    expect(canonicalize(left)).toBe(canonicalize(right));
  });

  it('treats array order as authoritative', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('keeps nested object key order invariant', () => {
    expect(canonicalize({ outer: { z: 1, a: { m: 2, b: 3 } } })).toBe(
      canonicalize({ outer: { a: { b: 3, m: 2 }, z: 1 } }),
    );
  });

  it('rejects undefined', () => {
    expect(() => canonicalize({ present: undefined })).toThrow(AuthorityContractError);
    expect(() => canonicalize([undefined])).toThrow(AuthorityContractError);
  });

  it('rejects NaN', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(AuthorityContractError);
  });

  it('rejects Infinity', () => {
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(AuthorityContractError);
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(AuthorityContractError);
  });

  it('rejects cyclic input', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => canonicalize(value)).toThrow(AuthorityContractError);
  });

  it('repeats the same canonical bytes', () => {
    const value = { b: ['x', { z: 1, a: 2 }], a: null };
    expect(canonicalize(value)).toBe(canonicalize(value));
  });
});

describe('proposal fingerprint', () => {
  it('returns 64 lowercase hex characters', () => {
    expect(createProposalFingerprint(proposal())).toMatch(/^[a-f0-9]{64}$/);
  });

  it('repeats the same fingerprint', () => {
    expect(createProposalFingerprint(proposal())).toBe(createProposalFingerprint(proposal()));
  });

  it('changes when an intervention changes', () => {
    const changed = proposal({
      interventions: [{ kind: 'ADD_BUFFER', beforeActivityId: 'ACT-EIXAMPLE-SETUP', minutes: 15 }],
    });
    expect(createProposalFingerprint(changed)).not.toBe(createProposalFingerprint(proposal()));
  });

  it('changes when a recipient changes', () => {
    expect(createProposalFingerprint(proposal({ affectedRecipients: ['PERSON-HMU'] }))).not.toBe(
      createProposalFingerprint(proposal()),
    );
  });

  it('changes when a notification payload changes', () => {
    expect(
      createProposalFingerprint(
        proposal({ notificationPayloads: [{ channel: 'VOICE', text: 'Move now.' }] }),
      ),
    ).not.toBe(createProposalFingerprint(proposal()));
  });

  it('changes when a predicted effect changes', () => {
    expect(
      createProposalFingerprint(
        proposal({ predictedEffects: [{ subjectId: 'ACT-STUDIO-LOAD-IN', severity: 'HIGH' }] }),
      ),
    ).not.toBe(createProposalFingerprint(proposal()));
  });

  it('changes when the production revision changes', () => {
    expect(createProposalFingerprint(proposal({ baseProductionRevision: 5 }))).not.toBe(
      createProposalFingerprint(proposal()),
    );
  });

  it('changes when the graph revision changes', () => {
    expect(createProposalFingerprint(proposal({ baseGraphRevision: 10 }))).not.toBe(
      createProposalFingerprint(proposal()),
    );
  });

  it('changes when the policy version changes', () => {
    expect(createProposalFingerprint(proposal({ policyVersion: 'SR-POLICY-v2' }))).not.toBe(
      createProposalFingerprint(proposal()),
    );
  });

  it('changes when the account changes', () => {
    expect(createProposalFingerprint(proposal({ accountId: 'ACCT-2' }))).not.toBe(
      createProposalFingerprint(proposal()),
    );
  });

  it('changes when the production changes', () => {
    expect(createProposalFingerprint(proposal({ productionId: 'BCN-DEMO-02' }))).not.toBe(
      createProposalFingerprint(proposal()),
    );
  });

  it('changes when the proposal id changes', () => {
    expect(createProposalFingerprint(proposal({ proposalId: 'PROP-2' }))).not.toBe(
      createProposalFingerprint(proposal()),
    );
  });

  it('ignores object key insertion order', () => {
    const first = proposal();
    const second: AuthorityProposal = {
      predictedEffects: first.predictedEffects,
      notificationPayloads: first.notificationPayloads,
      affectedRecipients: first.affectedRecipients,
      interventions: first.interventions,
      policyVersion: first.policyVersion,
      baseGraphRevision: first.baseGraphRevision,
      baseProductionRevision: first.baseProductionRevision,
      proposalId: first.proposalId,
      productionId: first.productionId,
      accountId: first.accountId,
    };
    expect(createProposalFingerprint(second)).toBe(createProposalFingerprint(first));
  });

  it('does not mutate the proposal input', () => {
    const input = proposal();
    const nested = input.interventions[0];
    const before = JSON.stringify(input);
    createProposalFingerprint(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(input.interventions[0]).toBe(nested);
  });
});

describe('approval challenge', () => {
  it('is active and binds the proposal fingerprint', () => {
    const input = challengeInput();
    const challenge = createApprovalChallenge(input);
    expect(challenge.status).toBe('ACTIVE');
    expect(challenge.proposalFingerprint).toBe(input.proposalFingerprint);
  });

  it('preserves LIVE and REPLAY as distinct namespaces', () => {
    const live = createApprovalChallenge(challengeInput());
    const replay = createApprovalChallenge(
      challengeInput({ authorityNamespace: 'REPLAY', challengeId: 'CHALLENGE-REPLAY' }),
    );
    expect(live.authorityNamespace).toBe('LIVE');
    expect(replay.authorityNamespace).toBe('REPLAY');
    expect(live.proposalFingerprint).toBe(replay.proposalFingerprint);
    expect(live).not.toEqual(replay);
  });

  it('rejects a namespace outside LIVE and REPLAY', () => {
    const input = challengeInput({
      authorityNamespace: 'DEMO' as 'LIVE',
    });
    expect(() => createApprovalChallenge(input)).toThrow(AuthorityContractError);
  });

  it('uses the injected instant and ttl', () => {
    const challenge = createApprovalChallenge(challengeInput({ ttlSeconds: 90 }));
    expect(challenge.createdAt).toBe(NOW);
    expect(challenge.expiresAt).toBe('2026-09-17T03:46:30.000Z');
  });

  it('rejects zero and negative ttl', () => {
    expect(() => createApprovalChallenge(challengeInput({ ttlSeconds: 0 }))).toThrow(
      AuthorityContractError,
    );
    expect(() => createApprovalChallenge(challengeInput({ ttlSeconds: -5 }))).toThrow(
      AuthorityContractError,
    );
  });

  it('rejects an invalid timestamp', () => {
    expect(() => createApprovalChallenge(challengeInput({ now: 'yesterday' }))).toThrow(
      AuthorityContractError,
    );
    expect(() =>
      createApprovalChallenge(challengeInput({ now: '2026-02-31T00:00:00.000Z' })),
    ).toThrow(AuthorityContractError);
  });

  it('does not create approval claims or call a signer', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'challenge.ts'),
      'utf8',
    );
    const challenge = createApprovalChallenge(challengeInput());
    expect(challenge).not.toHaveProperty('tokenId');
    expect(challenge).not.toHaveProperty('role');
    expect(challenge).not.toHaveProperty('singleUse');
    expect(source).not.toContain('BoundApprovalClaims');
    expect(source).not.toContain('ApprovalSigner');
    expect(source).not.toMatch(/\.sign\s*\(/);
  });

  it('does not mutate the challenge input', () => {
    const input = challengeInput();
    const before = JSON.stringify(input);
    createApprovalChallenge(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('repeats the same deterministic challenge for the same injected input', () => {
    expect(createApprovalChallenge(challengeInput())).toEqual(
      createApprovalChallenge(challengeInput()),
    );
  });
});

describe('claims and signer port', () => {
  it('requires single-use claims and only the two lead roles', () => {
    const claims = {
      tokenId: 'TOKEN-1',
      accountId: 'ACCT-1',
      productionId: 'BCN-DEMO-01',
      authorityNamespace: 'LIVE',
      proposalId: 'PROP-1',
      proposalFingerprint: 'a'.repeat(64),
      baseProductionRevision: 4,
      baseGraphRevision: 9,
      policyVersion: 'SR-POLICY-v1',
      actorId: 'ACTOR-LEAD',
      role: 'PRODUCTION_LEAD',
      issuedAt: NOW,
      expiresAt: '2026-09-17T03:46:00.000Z',
      singleUse: true,
    } satisfies BoundApprovalClaims;
    const demo = { ...claims, role: 'DEMO_PRODUCTION_LEAD' } satisfies BoundApprovalClaims;
    expect(claims.singleUse).toBe(true);
    expect(demo.singleUse).toBe(true);
    expect(AUTHORITY_ROLES).toEqual(['PRODUCTION_LEAD', 'DEMO_PRODUCTION_LEAD']);
  });

  it('keeps the signer as a port with no secret implementation', () => {
    const signerSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'signer.ts'),
      'utf8',
    );
    const signer: ApprovalSigner = {
      sign(claims) {
        return Promise.resolve(claims.tokenId);
      },
      verify(token) {
        return Promise.resolve({
          tokenId: token,
          accountId: 'ACCT-1',
          productionId: 'BCN-DEMO-01',
          authorityNamespace: 'REPLAY',
          proposalId: 'PROP-1',
          proposalFingerprint: 'b'.repeat(64),
          baseProductionRevision: 4,
          baseGraphRevision: 9,
          policyVersion: 'SR-POLICY-v1',
          actorId: 'ACTOR-LEAD',
          role: 'DEMO_PRODUCTION_LEAD',
          issuedAt: NOW,
          expiresAt: '2026-09-17T03:46:00.000Z',
          singleUse: true,
        });
      },
    };
    expect(signerSource).toContain('sign(claims: BoundApprovalClaims): Promise<string>');
    expect(signerSource).toContain('verify(token: string): Promise<BoundApprovalClaims>');
    expect(signerSource).not.toMatch(/process\.env|@aws-sdk|jose|createHash|readFile|PRIVATE KEY/i);
    return expect(
      signer.sign({
        tokenId: 'TOKEN-1',
        accountId: 'ACCT-1',
        productionId: 'BCN-DEMO-01',
        authorityNamespace: 'LIVE',
        proposalId: 'PROP-1',
        proposalFingerprint: 'c'.repeat(64),
        baseProductionRevision: 4,
        baseGraphRevision: 9,
        policyVersion: 'SR-POLICY-v1',
        actorId: 'ACTOR-LEAD',
        role: 'PRODUCTION_LEAD',
        issuedAt: NOW,
        expiresAt: '2026-09-17T03:46:00.000Z',
        singleUse: true,
      }),
    ).resolves.toBe('TOKEN-1');
  });

  it('preserves LIVE and REPLAY on claims and does not export assistant authority', () => {
    const source = packageSource();
    expect(source).toContain("'LIVE'");
    expect(source).toContain("'REPLAY'");
    expect(source).not.toContain('ASSISTANT');
    expect(source).not.toMatch(
      /approveProduction|executeProduction|sendNotification|mutateProduction/,
    );
  });
});

describe('package boundary', () => {
  it('imports no SceneReady, cloud, assistant, clock, random, or network dependency', () => {
    const source = packageSource();
    expect(source).not.toContain('@sceneready/');
    for (const pattern of [
      /@aws-sdk/,
      /aws-sdk/,
      /Alexa/i,
      /Bedrock/i,
      /Strands/i,
      /from 'react'/,
      /@modelcontextprotocol/,
      /Date\.now/,
      /Math\.random/,
      /randomUUID/,
      /\bfetch\s*\(/,
      /process\.env/,
    ]) {
      expect(source).not.toMatch(pattern);
    }
  });
});
