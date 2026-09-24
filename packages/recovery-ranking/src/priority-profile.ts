import { RECOVERY_METRIC_IDS, type RecoveryMetricId } from './metrics.js';

export interface PriorityTier {
  readonly metricIds: readonly RecoveryMetricId[];
}

export interface ProductionPriorityProfile {
  readonly profileId: string;
  readonly tiers: readonly PriorityTier[];
}

function isMetricId(value: unknown): value is RecoveryMetricId {
  return typeof value === 'string' && (RECOVERY_METRIC_IDS as readonly string[]).includes(value);
}

export function priorityProfileIsValid(profile: ProductionPriorityProfile): boolean {
  if (profile === null || typeof profile !== 'object') {
    return false;
  }
  if (typeof profile.profileId !== 'string' || profile.profileId.length === 0) {
    return false;
  }
  if (!Array.isArray(profile.tiers) || profile.tiers.length === 0) {
    return false;
  }
  const seen = new Set<RecoveryMetricId>();
  for (const tier of profile.tiers) {
    if (tier === null || typeof tier !== 'object' || !Array.isArray(tier.metricIds)) {
      return false;
    }
    if (tier.metricIds.length === 0) {
      return false;
    }
    for (const metricId of tier.metricIds) {
      if (!isMetricId(metricId) || seen.has(metricId)) {
        return false;
      }
      seen.add(metricId);
    }
  }
  return seen.size === RECOVERY_METRIC_IDS.length;
}
