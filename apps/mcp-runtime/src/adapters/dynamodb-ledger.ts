import type { RevisionAppliedEvent } from '@sceneready/authority';

import { ledgerSortKey } from './key-format.js';

export interface ConditionalPut {
  readonly TableName: string;
  readonly Item: Readonly<Record<string, string | number>>;
  readonly ConditionExpression: string;
}

const APPEND_ONLY = 'attribute_not_exists(pk) AND attribute_not_exists(sk)';

export function buildLedgerPut(
  tableName: string,
  partitionKey: string,
  event: RevisionAppliedEvent,
): ConditionalPut {
  return {
    TableName: tableName,
    ConditionExpression: APPEND_ONLY,
    Item: {
      pk: partitionKey,
      sk: ledgerSortKey(event.ledgerEventId),
      ledgerEventId: event.ledgerEventId,
      kind: event.kind,
      executionId: event.executionId,
      accountId: event.accountId,
      productionId: event.productionId,
      authorityNamespace: event.authorityNamespace,
      proposalId: event.proposalId,
      proposalFingerprint: event.proposalFingerprint,
      tokenId: event.tokenId,
      previousProductionRevision: event.previousProductionRevision,
      productionRevision: event.productionRevision,
      graphRevision: event.graphRevision,
      appliedAt: event.appliedAt,
    },
  };
}
