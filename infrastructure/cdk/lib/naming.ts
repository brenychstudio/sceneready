const KEY_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const PARTITION_KEY = 'pk';
export const SORT_KEY = 'sk';
export const TTL_ATTRIBUTE = 'ttl';

export function operationalPartitionKey(
  accountId: string,
  productionId: string,
  namespace: string,
): string {
  for (const part of [accountId, productionId, namespace]) {
    if (!KEY_PART.test(part)) {
      throw new Error('operational key part is empty or contains a separator');
    }
  }
  return `ACCOUNT#${accountId}#PROD#${productionId}#NS#${namespace}`;
}
