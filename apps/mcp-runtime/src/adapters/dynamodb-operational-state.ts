import { createHash } from 'node:crypto';

import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  InMemoryAuthoritativeState,
  type ApprovedRevisionCommand,
  type ApprovedRevisionResult,
  type AuthoritativeScope,
  type AuthoritativeSnapshot,
  type AuthoritativeStateRepository,
  type ConditionalRevisionCommand,
  type ConditionalRevisionResult,
  type MutationDenialReason,
} from '@sceneready/authority';

import { buildLedgerPut, type ConditionalPut } from './dynamodb-ledger.js';
import { buildOutboxPut, outboxJobsJson, type BoundedOutboxRecord } from './dynamodb-outbox.js';
import {
  DYNAMO_RECORD_BYTE_LIMIT,
  consumedTokenSortKey,
  evidenceObjectKey,
  operationalPartitionKey,
  stateSortKey,
  utf8Bytes,
} from './key-format.js';
import { S3EvidenceStore } from './s3-evidence.js';

export interface DynamoTableNames {
  readonly operational: string;
  readonly ledger: string;
  readonly outbox: string;
}

interface StoredStateItem {
  readonly accountId: string;
  readonly productionId: string;
  readonly authorityNamespace: 'LIVE' | 'REPLAY';
  readonly productionRevision: number;
  readonly graphRevision: number;
  readonly stateLocation: 'INLINE' | 'S3';
  readonly productionStateJson: string;
  readonly evidenceKey: string;
}

interface BoundedDocument {
  readonly location: 'INLINE' | 'S3';
  readonly json: string;
  readonly evidenceKey: string;
}

interface PlannedCommit {
  readonly expectedProductionRevision: number;
  readonly expectedGraphRevision: number;
  readonly tokenId: string;
  readonly nextProductionState: BoundedDocument;
  readonly ledger: ConditionalPut | null;
  readonly outbox: ConditionalPut | null;
}

const encoder = new TextEncoder();
const NO_OUTBOX: readonly [] = Object.freeze([]);

function denyApproved(reason: MutationDenialReason): ApprovedRevisionResult {
  return Object.freeze({
    status: 'DENIED',
    reason,
    productionRevision: null,
    graphRevision: null,
    productionState: null,
    tokenId: null,
    ledgerEvent: null,
    outboxJobs: NO_OUTBOX,
  });
}

function denyConditional(reason: MutationDenialReason): ConditionalRevisionResult {
  return Object.freeze({
    status: 'DENIED',
    reason,
    productionRevision: null,
    graphRevision: null,
    productionState: null,
    tokenId: null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStoredItem(value: unknown): StoredStateItem {
  if (!isRecord(value)) {
    throw new Error('operational state item is malformed');
  }
  const namespace = value.authorityNamespace;
  const location = value.stateLocation;
  if (
    (namespace !== 'LIVE' && namespace !== 'REPLAY') ||
    (location !== 'INLINE' && location !== 'S3') ||
    typeof value.accountId !== 'string' ||
    typeof value.productionId !== 'string' ||
    typeof value.productionRevision !== 'number' ||
    typeof value.graphRevision !== 'number' ||
    typeof value.productionStateJson !== 'string' ||
    typeof value.evidenceKey !== 'string'
  ) {
    throw new Error('operational state item is malformed');
  }
  return {
    accountId: value.accountId,
    productionId: value.productionId,
    authorityNamespace: namespace,
    productionRevision: value.productionRevision,
    graphRevision: value.graphRevision,
    stateLocation: location,
    productionStateJson: value.productionStateJson,
    evidenceKey: value.evidenceKey,
  };
}

function requestToken(seed: string): string {
  if (/^[A-Za-z0-9-]{1,36}$/.test(seed)) {
    return seed;
  }
  return createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32);
}

export class DynamoAuthoritativeState implements AuthoritativeStateRepository {
  constructor(
    private readonly documents: DynamoDBDocumentClient,
    private readonly tables: DynamoTableNames,
    private readonly evidence: S3EvidenceStore,
  ) {}

  async read(scope: AuthoritativeScope): Promise<AuthoritativeSnapshot | null> {
    const partition = operationalPartitionKey(scope);
    const result = await this.documents.send(
      new GetCommand({
        TableName: this.tables.operational,
        Key: { pk: partition, sk: stateSortKey() },
        ConsistentRead: true,
      }),
    );
    if (result.Item === undefined) {
      return null;
    }
    const stored = readStoredItem(result.Item);
    if (
      stored.accountId !== scope.accountId ||
      stored.productionId !== scope.productionId ||
      stored.authorityNamespace !== scope.authorityNamespace
    ) {
      throw new Error('stored production scope does not match the requested scope');
    }
    const productionState = await this.readState(stored);
    return Object.freeze({
      accountId: stored.accountId,
      productionId: stored.productionId,
      authorityNamespace: stored.authorityNamespace,
      productionRevision: stored.productionRevision,
      graphRevision: stored.graphRevision,
      productionState,
    });
  }

  async applyApprovedProductionRevision(
    command: ApprovedRevisionCommand,
  ): Promise<ApprovedRevisionResult> {
    const current = await this.read(command.scope);
    if (current === null) {
      return denyApproved('UNKNOWN_PRODUCTION');
    }
    const memory = new InMemoryAuthoritativeState();
    await memory.seed(current);
    const planned = await memory.applyApprovedProductionRevision(command);
    if (planned.status !== 'APPLIED' || planned.ledgerEvent === null) {
      return planned.status === 'DENIED' ? planned : denyApproved('INVALID_EXECUTION_IDENTITY');
    }
    const partition = operationalPartitionKey(command.scope);
    const state = await this.boundValue(
      command.scope,
      planned.productionRevision,
      'state',
      JSON.stringify(planned.productionState),
    );
    const jobsJson = outboxJobsJson(planned.outboxJobs);
    const outbox =
      planned.outboxJobs.length === 0
        ? null
        : buildOutboxPut(
            this.tables.outbox,
            partition,
            command.executionId,
            await this.boundOutbox(command.scope, planned.productionRevision, jobsJson),
          );
    const denied = await this.commit(
      {
        expectedProductionRevision: planned.ledgerEvent.previousProductionRevision,
        expectedGraphRevision: planned.graphRevision,
        tokenId: planned.tokenId,
        nextProductionState: state,
        ledger: buildLedgerPut(this.tables.ledger, partition, planned.ledgerEvent),
        outbox,
      },
      requestToken(planned.ledgerEvent.ledgerEventId),
      partition,
    );
    return denied === null ? planned : denyApproved(denied);
  }

  async applyConditionalRevision(
    command: ConditionalRevisionCommand,
  ): Promise<ConditionalRevisionResult> {
    const current = await this.read(command.scope);
    if (current === null) {
      return denyConditional('UNKNOWN_PRODUCTION');
    }
    const memory = new InMemoryAuthoritativeState();
    await memory.seed(current);
    const planned = await memory.applyConditionalRevision(command);
    if (planned.status !== 'APPLIED') {
      return planned;
    }
    const partition = operationalPartitionKey(command.scope);
    const state = await this.boundValue(
      command.scope,
      planned.productionRevision,
      'state',
      JSON.stringify(planned.productionState),
    );
    const denied = await this.commit(
      {
        expectedProductionRevision: current.productionRevision,
        expectedGraphRevision: current.graphRevision,
        tokenId: planned.tokenId,
        nextProductionState: state,
        ledger: null,
        outbox: null,
      },
      requestToken(planned.tokenId),
      partition,
    );
    return denied === null ? planned : denyConditional(denied);
  }

  private async commit(
    planned: PlannedCommit,
    clientRequestToken: string,
    partition: string,
  ): Promise<MutationDenialReason | null> {
    const reasons: MutationDenialReason[] = ['BASE_REVISION_STALE', 'APPROVAL_ALREADY_CONSUMED'];
    const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Update: {
          TableName: this.tables.operational,
          Key: { pk: partition, sk: stateSortKey() },
          ConditionExpression:
            'productionRevision = :expectedProduction AND graphRevision = :expectedGraph AND attribute_exists(pk)',
          UpdateExpression:
            'SET productionRevision = :nextProduction, stateLocation = :location, productionStateJson = :stateJson, evidenceKey = :evidenceKey',
          ExpressionAttributeValues: {
            ':expectedProduction': planned.expectedProductionRevision,
            ':expectedGraph': planned.expectedGraphRevision,
            ':nextProduction': planned.expectedProductionRevision + 1,
            ':location': planned.nextProductionState.location,
            ':stateJson': planned.nextProductionState.json,
            ':evidenceKey': planned.nextProductionState.evidenceKey,
          },
        },
      },
      {
        Put: {
          TableName: this.tables.operational,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
          Item: {
            pk: partition,
            sk: consumedTokenSortKey(planned.tokenId),
            tokenId: planned.tokenId,
          },
        },
      },
    ];
    if (planned.ledger !== null) {
      reasons.push('LEDGER_EVENT_ID_REUSED');
      transactItems.push({ Put: planned.ledger });
    }
    if (planned.outbox !== null) {
      reasons.push('OUTBOX_IDENTITY_REUSED');
      transactItems.push({ Put: planned.outbox });
    }
    try {
      await this.documents.send(
        new TransactWriteCommand({
          ClientRequestToken: clientRequestToken,
          TransactItems: transactItems,
        }),
      );
      return null;
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        return cancellationReason(error, reasons);
      }
      throw error;
    }
  }

  private async boundValue(
    scope: AuthoritativeScope,
    revision: number,
    kind: 'state' | 'outbox',
    json: string,
  ): Promise<BoundedDocument> {
    if (utf8Bytes(json) <= DYNAMO_RECORD_BYTE_LIMIT) {
      return { location: 'INLINE', json, evidenceKey: '' };
    }
    const key = evidenceObjectKey(scope, revision, kind);
    await this.evidence.putBytes(key, encoder.encode(json));
    return { location: 'S3', json: '', evidenceKey: key };
  }

  private async boundOutbox(
    scope: AuthoritativeScope,
    revision: number,
    jobsJson: string,
  ): Promise<BoundedOutboxRecord> {
    const bounded = await this.boundValue(scope, revision, 'outbox', jobsJson);
    return {
      jobsJson: bounded.json,
      stateLocation: bounded.location,
      evidenceKey: bounded.evidenceKey,
    };
  }

  private async readState(stored: StoredStateItem): Promise<unknown> {
    const json =
      stored.stateLocation === 'S3'
        ? new TextDecoder().decode(await this.evidence.getBytes(stored.evidenceKey))
        : stored.productionStateJson;
    return JSON.parse(json) as unknown;
  }
}

function cancellationReason(
  error: TransactionCanceledException,
  reasons: readonly MutationDenialReason[],
): MutationDenialReason {
  const cancelled = error.CancellationReasons ?? [];
  for (let index = 0; index < reasons.length; index += 1) {
    if (cancelled[index]?.Code === 'ConditionalCheckFailed') {
      const reason = reasons[index];
      if (reason !== undefined) {
        return reason;
      }
    }
  }
  throw error;
}
