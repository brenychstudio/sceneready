import { createHash } from 'node:crypto';

import { canonicalizeProductionPack } from './canonicalize.js';

export function fingerprintProductionPack(value: unknown): string {
  const canonicalJson = canonicalizeProductionPack(value);
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
