import { Temporal } from '@js-temporal/polyfill';
import type { EvidenceTrustState } from '@sceneready/domain';
import type { DecisionPolicy } from '@sceneready/readiness-engine';

import type { EvidenceEnvelope } from './envelope.js';

export interface EvidenceTrustEvaluation<Payload> {
  readonly envelope: EvidenceEnvelope<Payload>;
  readonly effectiveTrustState: EvidenceTrustState;
}

function instantFrom(value: string, path: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new Error(`canonical JSON rejected: invalid instant at ${path}`);
  }
}

export function evaluateEvidenceTrust<Payload>(
  envelope: EvidenceEnvelope<Payload>,
  nowInstant: string,
  policy: DecisionPolicy,
): EvidenceTrustEvaluation<Payload> {
  if (envelope.trustState === 'MISSING' || envelope.trustState === 'STALE') {
    return {
      envelope,
      effectiveTrustState: envelope.trustState,
    };
  }

  const now = instantFrom(nowInstant, 'nowInstant');
  const observed = instantFrom(envelope.observedAt, 'observedAt');

  if (Temporal.Instant.compare(now, observed) < 0) {
    return {
      envelope,
      effectiveTrustState: 'STALE',
    };
  }

  if (envelope.validFrom !== undefined) {
    const validFrom = instantFrom(envelope.validFrom, 'validFrom');
    if (Temporal.Instant.compare(now, validFrom) < 0) {
      return {
        envelope,
        effectiveTrustState: 'STALE',
      };
    }
  }

  if (envelope.validUntil !== undefined) {
    const validUntil = instantFrom(envelope.validUntil, 'validUntil');
    if (Temporal.Instant.compare(now, validUntil) > 0) {
      return {
        envelope,
        effectiveTrustState: 'STALE',
      };
    }
  }

  const windowMinutes = policy.evidenceFreshnessMinutes[envelope.kind];
  const elapsedMinutes = now.since(observed).total({ unit: 'minutes' });

  return {
    envelope,
    effectiveTrustState: elapsedMinutes > windowMinutes ? 'STALE' : envelope.trustState,
  };
}
