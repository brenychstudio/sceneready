import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  GetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  createProposalFingerprint,
  type ApprovalSigner,
  type AuthorityProposal,
  type BoundApprovalClaims,
} from '@sceneready/mcp-human-authority';
import { describe, expect, it } from 'vitest';

import { DynamoAuthoritativeState, type DynamoTableNames } from './dynamodb-operational-state.js';
import { DYNAMO_RECORD_BYTE_LIMIT, operationalPartitionKey } from './key-format.js';
import { S3EvidenceStore } from './s3-evidence.js';

const NOW = '2026-09-17T03:45:00.000Z';
const EXPIRES = '2026-09-17T03:47:00.000Z';
const TABLES: DynamoTableNames = {
  operational: 'operational',
  ledger: 'ledger',
  outbox: 'outbox',
};

function proposal(): AuthorityProposal {
  return {
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    proposalId: 'PROP-1',
    baseProductionRevision: 4,
    baseGraphRevision: 2,
    policyVersion: 'SR-POLICY-v1',
    interventions: [],
    affectedRecipients: [],
    notificationPayloads: [{ recipientPersonId: 'PERSON-1', requiredAction: 'INFORMATION_ONLY' }],
    predictedEffects: [],
  };
}

function claims(current: AuthorityProposal): BoundApprovalClaims {
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

function signer(currentClaims: BoundApprovalClaims): ApprovalSigner {
  return {
    sign() {
      return Promise.reject(new Error('sign must not be called'));
    },
    verify(token: string) {
      if (token !== `signed:${currentClaims.tokenId}`) {
        return Promise.reject(new Error('rejected token'));
      }
      return Promise.resolve({ ...currentClaims });
    },
  };
}

function stateItem(): Record<string, unknown> {
  return {
    pk: 'ACCOUNT#ACCT-1#PROD#BCN-DEMO-01#NS#LIVE',
    sk: 'STATE',
    accountId: 'ACCT-1',
    productionId: 'BCN-DEMO-01',
    authorityNamespace: 'LIVE',
    productionRevision: 4,
    graphRevision: 2,
    stateLocation: 'INLINE',
    productionStateJson: JSON.stringify({ schedule: 'BASE' }),
    evidenceKey: '',
  };
}

class FakeDocuments {
  readonly commands: unknown[] = [];
  item: Record<string, unknown> | undefined = stateItem();
  failure: TransactionCanceledException | null = null;

  async send(
    command: GetCommand | TransactWriteCommand,
  ): Promise<{ Item?: Record<string, unknown> }> {
    this.commands.push(command);
    if (command instanceof GetCommand) {
      return this.item === undefined ? {} : { Item: this.item };
    }
    if (command instanceof TransactWriteCommand) {
      if (this.failure !== null) {
        throw this.failure;
      }
      return {};
    }
    throw new Error('unexpected command');
  }
}

class FakeS3 {
  readonly puts: string[] = [];
  readonly objects = new Map<string, Uint8Array>();

  async send(command: PutObjectCommand | GetObjectCommand): Promise<{
    Body?: { transformToByteArray: () => Promise<Uint8Array> };
  }> {
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key ?? '';
      const body = command.input.Body;
      if (!(body instanceof Uint8Array)) {
        throw new Error('evidence body must be bytes');
      }
      this.objects.set(key, body);
      this.puts.push(key);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const key = command.input.Key ?? '';
      const body = this.objects.get(key);
      if (body === undefined) {
        throw new Error('missing evidence');
      }
      return { Body: { transformToByteArray: () => Promise.resolve(body) } };
    }
    throw new Error('unexpected command');
  }
}

function harness(): {
  documents: FakeDocuments;
  evidence: FakeS3;
  repository: DynamoAuthoritativeState;
} {
  const documents = new FakeDocuments();
  const evidence = new FakeS3();
  const repository = new DynamoAuthoritativeState(
    documents as unknown as DynamoDBDocumentClient,
    TABLES,
    new S3EvidenceStore(evidence as unknown as S3Client, 'evidence'),
  );
  return { documents, evidence, repository };
}

function command(current: AuthorityProposal, next: unknown = { schedule: 'APPLIED' }) {
  const currentClaims = claims(current);
  return {
    scope: {
      accountId: current.accountId,
      productionId: current.productionId,
      authorityNamespace: 'LIVE' as const,
    },
    token: `signed:${currentClaims.tokenId}`,
    now: NOW,
    proposal: current,
    nextProductionState: next,
    signer: signer(currentClaims),
    executionId: 'EXEC-R15',
    ledgerEventId: 'LEDGER-R15',
  };
}

function transactInputs(documents: FakeDocuments): TransactWriteCommand[] {
  return documents.commands.filter(
    (entry): entry is TransactWriteCommand => entry instanceof TransactWriteCommand,
  );
}

describe('AWS state adapters', () => {
  it('scopes keys by account, production, and namespace', () => {
    expect(
      operationalPartitionKey({
        accountId: 'ACCT-1',
        productionId: 'BCN-DEMO-01',
        authorityNamespace: 'LIVE',
      }),
    ).toBe('ACCOUNT#ACCT-1#PROD#BCN-DEMO-01#NS#LIVE');
    expect(
      operationalPartitionKey({
        accountId: 'ACCT-1',
        productionId: 'BCN-DEMO-01',
        authorityNamespace: 'REPLAY',
      }),
    ).toBe('ACCOUNT#ACCT-1#PROD#BCN-DEMO-01#NS#REPLAY');
    expect(() =>
      operationalPartitionKey({
        accountId: 'ACCT#1',
        productionId: 'BCN-DEMO-01',
        authorityNamespace: 'LIVE',
      }),
    ).toThrow(/separator/);
  });

  it('commits state, token consumption, ledger, and outbox in one transaction', async () => {
    const { documents, repository } = harness();
    const result = await repository.applyApprovedProductionRevision(command(proposal()));
    expect(result.status).toBe('APPLIED');
    const writes = transactInputs(documents);
    expect(writes).toHaveLength(1);
    const items = writes[0]?.input.TransactItems ?? [];
    expect(items).toHaveLength(4);
    const json = JSON.stringify(items);
    expect(json).toContain('ACCOUNT#ACCT-1#PROD#BCN-DEMO-01#NS#LIVE');
    expect(json).toContain('attribute_not_exists(pk) AND attribute_not_exists(sk)');
    expect(json).toContain('"kind":"REVISION_APPLIED"');
    expect(json).toContain('EXEC-R15');
    expect(json).not.toContain('ttl');
    expect(json).not.toContain('signed:');
    expect(documents.commands.filter((entry) => entry instanceof GetCommand)).toHaveLength(1);
  });

  it('does not write when approval is rejected', async () => {
    const { documents, repository } = harness();
    const input = command(proposal());
    const result = await repository.applyApprovedProductionRevision({
      ...input,
      token: 'signed:OTHER',
    });
    expect(result).toMatchObject({ status: 'DENIED', reason: 'TOKEN_REJECTED', outboxJobs: [] });
    expect(transactInputs(documents)).toHaveLength(0);
  });

  it('maps a cancelled transaction to one denial and does not write again', async () => {
    const { documents, repository } = harness();
    documents.failure = new TransactionCanceledException({
      message: 'cancelled',
      $metadata: {},
      CancellationReasons: [
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
        { Code: 'None' },
      ],
    });
    const result = await repository.applyApprovedProductionRevision(command(proposal()));
    expect(result).toMatchObject({ status: 'DENIED', reason: 'APPROVAL_ALREADY_CONSUMED' });
    expect(transactInputs(documents)).toHaveLength(1);
  });

  it('stores an oversized production state in S3 and keeps one transaction', async () => {
    const { documents, evidence, repository } = harness();
    const result = await repository.applyApprovedProductionRevision(
      command(proposal(), { schedule: 'x'.repeat(DYNAMO_RECORD_BYTE_LIMIT + 1) }),
    );
    expect(result.status).toBe('APPLIED');
    expect(evidence.puts).toHaveLength(1);
    const items = transactInputs(documents)[0]?.input.TransactItems ?? [];
    const update = items[0]?.Update?.ExpressionAttributeValues;
    expect(update?.[':location']).toBe('S3');
    expect(update?.[':stateJson']).toBe('');
    expect(update?.[':evidenceKey']).toBe(evidence.puts[0]);
    expect(transactInputs(documents)).toHaveLength(1);
  });

  it('returns unknown production without a write', async () => {
    const { documents, repository } = harness();
    documents.item = undefined;
    const result = await repository.applyApprovedProductionRevision(command(proposal()));
    expect(result).toMatchObject({ status: 'DENIED', reason: 'UNKNOWN_PRODUCTION' });
    expect(transactInputs(documents)).toHaveLength(0);
  });
});
