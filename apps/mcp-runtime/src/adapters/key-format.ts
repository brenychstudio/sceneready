import type { AuthoritativeScope } from '@sceneready/authority';

const KEY_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const DYNAMO_RECORD_BYTE_LIMIT = 350_000;

export function operationalPartitionKey(scope: AuthoritativeScope): string {
  if (scope.authorityNamespace !== 'LIVE' && scope.authorityNamespace !== 'REPLAY') {
    throw new Error('authority namespace must be LIVE or REPLAY');
  }
  for (const part of [scope.accountId, scope.productionId, scope.authorityNamespace]) {
    if (!KEY_PART.test(part)) {
      throw new Error('operational key part is empty or contains a separator');
    }
  }
  return `ACCOUNT#${scope.accountId}#PROD#${scope.productionId}#NS#${scope.authorityNamespace}`;
}

export function stateSortKey(): string {
  return 'STATE';
}

export function consumedTokenSortKey(tokenId: string): string {
  assertPart(tokenId);
  return `TOKEN#${tokenId}`;
}

export function ledgerSortKey(ledgerEventId: string): string {
  assertPart(ledgerEventId);
  return `EVENT#${ledgerEventId}`;
}

export function outboxSortKey(executionId: string): string {
  assertPart(executionId);
  return `EXECUTION#${executionId}`;
}

export function evidenceObjectKey(
  scope: AuthoritativeScope,
  revision: number,
  kind: 'state' | 'outbox',
): string {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('evidence revision must be a non-negative safe integer');
  }
  const partition = operationalPartitionKey(scope);
  return `evidence/${partition}/${kind}/${String(revision)}.json`;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertPart(value: string): void {
  if (!KEY_PART.test(value)) {
    throw new Error('operational key part is empty or contains a separator');
  }
}
