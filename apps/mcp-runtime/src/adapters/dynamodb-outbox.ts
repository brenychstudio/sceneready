import type { DurableOutboxJob } from '@sceneready/authority';

import { outboxSortKey } from './key-format.js';
import type { ConditionalPut } from './dynamodb-ledger.js';

export interface BoundedOutboxRecord {
  readonly jobsJson: string;
  readonly stateLocation: 'INLINE' | 'S3';
  readonly evidenceKey: string;
}

export function buildOutboxPut(
  tableName: string,
  partitionKey: string,
  executionId: string,
  record: BoundedOutboxRecord,
): ConditionalPut {
  return {
    TableName: tableName,
    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    Item: {
      pk: partitionKey,
      sk: outboxSortKey(executionId),
      executionId,
      jobsJson: record.jobsJson,
      stateLocation: record.stateLocation,
      evidenceKey: record.evidenceKey,
    },
  };
}

export function outboxJobsJson(jobs: readonly DurableOutboxJob[]): string {
  return JSON.stringify(jobs);
}
