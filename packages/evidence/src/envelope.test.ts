import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EvidenceTrustState } from '@sceneready/domain';
import { SCENEREADY_POLICY_V1 } from '@sceneready/readiness-engine';

import {
  createEvidenceEnvelope,
  evaluateEvidenceTrust,
  EVIDENCE_AUTHORITY_CLASSES,
  type EvidenceAuthorityClass,
  type EvidenceEnvelope,
  type EvidenceEnvelopeInput,
  type EvidenceKind,
  type EvidenceMode,
} from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const DEFAULT_WEATHER_PAYLOAD = { precipitationProbability: 0.25 } as const;

interface WeatherOverrides {
  readonly evidenceId?: string;
  readonly kind?: EvidenceKind;
  readonly authorityClass?: EvidenceAuthorityClass;
  readonly trustState?: EvidenceTrustState;
  readonly observedAt?: string;
  readonly receivedAt?: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly mode?: EvidenceMode;
  readonly adapterVersion?: string;
  readonly algorithmVersion?: string;
}

function makeWeatherInput<Payload>(
  payload: Payload,
  overrides: WeatherOverrides = {},
): EvidenceEnvelopeInput<Payload> {
  return {
    evidenceId: overrides.evidenceId ?? 'E-WEATHER-001',
    productionId: 'BCN-DEMO-01',
    kind: overrides.kind ?? 'WEATHER',
    sourceType: 'EXTERNAL_PROVIDER',
    authorityClass: overrides.authorityClass ?? 'EXTERNAL_AUTHORITATIVE',
    trustState: overrides.trustState ?? 'LIVE',
    observedAt: overrides.observedAt ?? '2026-09-17T04:00:00Z',
    receivedAt: overrides.receivedAt ?? '2026-09-17T04:01:00Z',
    ...(overrides.validFrom === undefined ? {} : { validFrom: overrides.validFrom }),
    ...(overrides.validUntil === undefined ? {} : { validUntil: overrides.validUntil }),
    ...(overrides.adapterVersion === undefined ? {} : { adapterVersion: overrides.adapterVersion }),
    ...(overrides.algorithmVersion === undefined
      ? {}
      : { algorithmVersion: overrides.algorithmVersion }),
    ...(overrides.mode === undefined ? {} : { mode: overrides.mode }),
    payload,
  };
}

const CANONICAL_AUTHORITY_CLASSES = [
  'SYSTEM_DERIVED',
  'EXTERNAL_AUTHORITATIVE',
  'DOCUMENT_AUTHORITY',
  'SUBJECT_CONFIRMATION',
  'PRODUCTION_LEAD_ASSERTION',
  'RECORDED_INTERNAL',
  'FALLBACK',
] as const;

describe('evidence envelopes', () => {
  it('downgrades expired live weather to stale without mutating payload', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const evidence = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T04:20:00Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('STALE');
    expect(result.envelope.trustState).toBe('LIVE');
    expect(result.envelope.payload.precipitationProbability).toBe(0.25);
    expect(result.envelope.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('keeps live weather live before the policy window expires', () => {
    const evidence = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T04:10:00Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('LIVE');
    expect(result.envelope.trustState).toBe('LIVE');
  });

  it('never upgrades MISSING', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, {
        trustState: 'MISSING',
        observedAt: '2026-09-17T04:19:00Z',
      }),
    );
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T04:20:00Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('MISSING');
    expect(result.envelope.trustState).toBe('MISSING');
  });

  it('never upgrades STALE', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, {
        trustState: 'STALE',
        observedAt: '2026-09-17T04:19:00Z',
      }),
    );
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T04:20:00Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('STALE');
    expect(result.envelope.trustState).toBe('STALE');
  });

  it('does not mutate the envelope during trust evaluation', () => {
    const evidence = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const before = JSON.stringify(evidence);

    evaluateEvidenceTrust(evidence, '2026-09-17T04:20:00Z', SCENEREADY_POLICY_V1);

    expect(JSON.stringify(evidence)).toBe(before);
    expect(evidence.trustState).toBe('LIVE');
  });

  it('does not mutate payload during trust evaluation', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput({ precipitationProbability: 0.25, notes: ['stable'] }),
    );
    const payloadBefore = evidence.payload;

    evaluateEvidenceTrust(evidence, '2026-09-17T04:20:00Z', SCENEREADY_POLICY_V1);

    expect(evidence.payload).toBe(payloadBefore);
    expect(evidence.payload).toEqual({ precipitationProbability: 0.25, notes: ['stable'] });
  });

  it('assigns a 64-character lowercase hex content fingerprint', () => {
    const evidence = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    expect(evidence.contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fingerprints the same normalized content identically', () => {
    const first = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const second = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    expect(first.contentFingerprint).toBe(second.contentFingerprint);
  });

  it('does not change fingerprint when object keys are reordered', () => {
    const first = createEvidenceEnvelope(
      makeWeatherInput({ b: 2, a: 1, nested: { z: true, m: 0 } }),
    );
    const second = createEvidenceEnvelope(
      makeWeatherInput({ nested: { m: 0, z: true }, a: 1, b: 2 }),
    );
    expect(first.contentFingerprint).toBe(second.contentFingerprint);
  });

  it('changes fingerprint when array order or material payload changes', () => {
    const baseline = createEvidenceEnvelope(
      makeWeatherInput({ tags: ['rain', 'wind'], precipitationProbability: 0.25 }),
    );
    const reordered = createEvidenceEnvelope(
      makeWeatherInput({ tags: ['wind', 'rain'], precipitationProbability: 0.25 }),
    );
    const material = createEvidenceEnvelope(
      makeWeatherInput({ tags: ['rain', 'wind'], precipitationProbability: 0.4 }),
    );

    expect(reordered.contentFingerprint).not.toBe(baseline.contentFingerprint);
    expect(material.contentFingerprint).not.toBe(baseline.contentFingerprint);
  });

  it('changes fingerprint when mode, version, time, or source changes', () => {
    const baseline = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const modeChanged = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { mode: 'REPLAY' }),
    );
    const versionChanged = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { adapterVersion: 'weather-adapter-v1' }),
    );
    const timeChanged = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { observedAt: '2026-09-17T04:00:01Z' }),
    );
    const sourceChanged = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { algorithmVersion: 'wx-norm-v1' }),
    );

    expect(modeChanged.contentFingerprint).not.toBe(baseline.contentFingerprint);
    expect(versionChanged.contentFingerprint).not.toBe(baseline.contentFingerprint);
    expect(timeChanged.contentFingerprint).not.toBe(baseline.contentFingerprint);
    expect(sourceChanged.contentFingerprint).not.toBe(baseline.contentFingerprint);
  });

  it('does not retain a mutable caller-owned payload reference', () => {
    const payload = {
      precipitationProbability: 0.25,
      nested: { gusts: ['calm'] },
    };
    const evidence = createEvidenceEnvelope(makeWeatherInput(payload));

    payload.precipitationProbability = 0.99;
    payload.nested.gusts.push('altered');

    expect(evidence.payload).toEqual({
      precipitationProbability: 0.25,
      nested: { gusts: ['calm'] },
    });
    expect(evidence.payload).not.toBe(payload);
  });

  it('rejects non-finite, undefined, bigint, function, and symbol input', () => {
    expect(typeof createEvidenceEnvelope).toBe('function');
    expect(() => createEvidenceEnvelope(makeWeatherInput({ n: Number.NaN }))).toThrow(
      /canonical|non-finite|non-JSON|undefined|bigint|symbol|function/i,
    );
    expect(() => createEvidenceEnvelope(makeWeatherInput({ n: Number.POSITIVE_INFINITY }))).toThrow(
      /canonical|non-finite|non-JSON|undefined|bigint|symbol|function/i,
    );
    expect(() => createEvidenceEnvelope(makeWeatherInput({ dropped: undefined }))).toThrow(
      /canonical|non-finite|non-JSON|undefined|bigint|symbol|function/i,
    );
    expect(() => createEvidenceEnvelope(makeWeatherInput({ n: 1n }))).toThrow(
      /canonical|non-finite|non-JSON|undefined|bigint|symbol|function/i,
    );
    expect(() => createEvidenceEnvelope(makeWeatherInput({ fn: () => 'nope' }))).toThrow(
      /canonical|non-finite|non-JSON|undefined|bigint|symbol|function/i,
    );
    expect(() => createEvidenceEnvelope(makeWeatherInput({ s: Symbol('nope') }))).toThrow(
      /canonical|non-finite|non-JSON|undefined|bigint|symbol|function/i,
    );
  });

  it('treats REPLAY mode as explicit and deterministic', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const live = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const replay = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { mode: 'REPLAY' }),
    );
    const replayAgain = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { mode: 'REPLAY' }),
    );

    expect(live.mode).toBe('LIVE');
    expect(replay.mode).toBe('REPLAY');
    expect(replay.contentFingerprint).toBe(replayAgain.contentFingerprint);
    expect(replay.contentFingerprint).not.toBe(live.contentFingerprint);
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('returns the same envelope object from trust evaluation', () => {
    const evidence: EvidenceEnvelope<{ precipitationProbability: number }> = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD),
    );
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T04:20:00Z', SCENEREADY_POLICY_V1);
    expect(result.envelope).toBe(evidence);
  });

  it('downgrades stale CONFIRMED crew evidence to STALE without upgrading later', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(
        { confirmed: true },
        {
          evidenceId: 'E-CREW-001',
          kind: 'CREW_CONFIRMATION',
          authorityClass: 'SUBJECT_CONFIRMATION',
          trustState: 'CONFIRMED',
        },
      ),
    );
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T16:01:00Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('STALE');
    expect(result.envelope.trustState).toBe('CONFIRMED');
  });

  it('downgrades stale RECORDED document evidence to STALE', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(
        { documentId: 'DOC-001' },
        {
          evidenceId: 'E-DOC-001',
          kind: 'DOCUMENT',
          authorityClass: 'DOCUMENT_AUTHORITY',
          trustState: 'RECORDED',
        },
      ),
    );
    const result = evaluateEvidenceTrust(evidence, '2026-09-24T04:01:00Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('STALE');
    expect(result.envelope.trustState).toBe('RECORDED');
  });

  it('downgrades stale FALLBACK weather evidence to STALE', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { trustState: 'FALLBACK' }),
    );
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T04:16:00Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('STALE');
    expect(result.envelope.trustState).toBe('FALLBACK');
  });

  it('preserves fresh CONFIRMED, RECORDED, and FALLBACK trust states', () => {
    const confirmed = evaluateEvidenceTrust(
      createEvidenceEnvelope(
        makeWeatherInput(
          { confirmed: true },
          {
            evidenceId: 'E-CREW-001',
            kind: 'CREW_CONFIRMATION',
            authorityClass: 'SUBJECT_CONFIRMATION',
            trustState: 'CONFIRMED',
          },
        ),
      ),
      '2026-09-17T04:10:00Z',
      SCENEREADY_POLICY_V1,
    );
    const recorded = evaluateEvidenceTrust(
      createEvidenceEnvelope(
        makeWeatherInput(
          { documentId: 'DOC-001' },
          {
            evidenceId: 'E-DOC-001',
            kind: 'DOCUMENT',
            authorityClass: 'DOCUMENT_AUTHORITY',
            trustState: 'RECORDED',
          },
        ),
      ),
      '2026-09-17T04:10:00Z',
      SCENEREADY_POLICY_V1,
    );
    const fallback = evaluateEvidenceTrust(
      createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { trustState: 'FALLBACK' })),
      '2026-09-17T04:10:00Z',
      SCENEREADY_POLICY_V1,
    );

    expect(confirmed.effectiveTrustState).toBe('CONFIRMED');
    expect(recorded.effectiveTrustState).toBe('RECORDED');
    expect(fallback.effectiveTrustState).toBe('FALLBACK');
  });

  it('downgrades evidence after an inclusive validUntil endpoint', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, {
        validFrom: '2026-09-17T04:00:00Z',
        validUntil: '2026-09-17T04:05:00Z',
      }),
    );
    const expired = evaluateEvidenceTrust(evidence, '2026-09-17T04:05:01Z', SCENEREADY_POLICY_V1);
    const inclusive = evaluateEvidenceTrust(evidence, '2026-09-17T04:05:00Z', SCENEREADY_POLICY_V1);

    expect(expired.effectiveTrustState).toBe('STALE');
    expect(inclusive.effectiveTrustState).toBe('LIVE');
  });

  it('downgrades evidence before an inclusive validFrom endpoint', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, {
        validFrom: '2026-09-17T04:10:00Z',
        validUntil: '2026-09-17T04:20:00Z',
      }),
    );
    const tooEarly = evaluateEvidenceTrust(evidence, '2026-09-17T04:09:59Z', SCENEREADY_POLICY_V1);
    const inclusive = evaluateEvidenceTrust(evidence, '2026-09-17T04:10:00Z', SCENEREADY_POLICY_V1);

    expect(tooEarly.effectiveTrustState).toBe('STALE');
    expect(inclusive.effectiveTrustState).toBe('LIVE');
  });

  it('fails closed when now is before observedAt', () => {
    const evidence = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T03:59:59Z', SCENEREADY_POLICY_V1);

    expect(result.effectiveTrustState).toBe('STALE');
    expect(result.envelope.trustState).toBe('LIVE');
  });

  it('rejects envelopes whose validUntil precedes validFrom', () => {
    expect(() =>
      createEvidenceEnvelope(
        makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, {
          validFrom: '2026-09-17T04:10:00Z',
          validUntil: '2026-09-17T04:09:59Z',
        }),
      ),
    ).toThrow(/canonical JSON rejected:.*validUntil/i);
  });

  it('accepts equal inclusive validFrom and validUntil', () => {
    const evidence = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, {
        validFrom: '2026-09-17T04:10:00Z',
        validUntil: '2026-09-17T04:10:00Z',
      }),
    );
    const result = evaluateEvidenceTrust(evidence, '2026-09-17T04:10:00Z', SCENEREADY_POLICY_V1);

    expect(evidence.validFrom).toBeDefined();
    expect(evidence.validUntil).toBeDefined();
    expect(result.effectiveTrustState).toBe('LIVE');
  });

  it('accepts all seven canonical authority classes', () => {
    expect(EVIDENCE_AUTHORITY_CLASSES).toEqual([...CANONICAL_AUTHORITY_CLASSES]);

    for (const authorityClass of CANONICAL_AUTHORITY_CLASSES) {
      const evidence = createEvidenceEnvelope(
        makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { authorityClass }),
      );
      expect(evidence.authorityClass).toBe(authorityClass);
    }
  });

  it('changes fingerprint when authorityClass changes', () => {
    const baseline = createEvidenceEnvelope(makeWeatherInput(DEFAULT_WEATHER_PAYLOAD));
    const changed = createEvidenceEnvelope(
      makeWeatherInput(DEFAULT_WEATHER_PAYLOAD, { authorityClass: 'SYSTEM_DERIVED' }),
    );

    expect(changed.authorityClass).toBe('SYSTEM_DERIVED');
    expect(changed.contentFingerprint).not.toBe(baseline.contentFingerprint);
  });
});
