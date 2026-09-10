import { resolveZonedProductionTime } from '@sceneready/domain';

import { fingerprintProductionPack } from './fingerprint.js';
import type { ProductionPack } from './schema.js';

export const GRAPH_SCHEMA_VERSION = 'SR-GRAPH-v1';

export interface ProductionActivationManifest {
  readonly productionId: string;
  readonly fixtureVersion: string;
  readonly packFingerprint: string;
  readonly policyVersion: string;
  readonly graphSchemaVersion: string;
  readonly activatedAt: string;
}

export function packOwnedActivationInstant(pack: ProductionPack): string {
  const firstActivity = pack.schedule[0];
  if (firstActivity === undefined) {
    throw new Error('production pack schedule is empty');
  }
  return resolveZonedProductionTime({
    date: pack.production.date,
    time: firstActivity.startLocal,
    timeZone: pack.production.timeZone,
  }).instant;
}

export function activateProductionPack(
  pack: ProductionPack,
  activatedAt: string,
): ProductionActivationManifest {
  return {
    productionId: pack.production.id,
    fixtureVersion: pack.fixtureVersion,
    packFingerprint: fingerprintProductionPack(pack),
    policyVersion: pack.policyVersion,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    activatedAt,
  };
}
