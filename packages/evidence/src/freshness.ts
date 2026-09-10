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

  if (envelope.trustState !== 'LIVE') {
    return {
      envelope,
      effectiveTrustState: envelope.trustState,
    };
  }

  const windowMinutes = policy.evidenceFreshnessMinutes[envelope.kind];
  const now = instantFrom(nowInstant, 'nowInstant');
  const observed = instantFrom(envelope.observedAt, 'observedAt');
  const elapsedMinutes = now.since(observed).total({ unit: 'minutes' });

  return {
    envelope,
    effectiveTrustState: elapsedMinutes > windowMinutes ? 'STALE' : 'LIVE',
  };
}
