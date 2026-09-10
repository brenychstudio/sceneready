import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EvidenceTrustState } from '@sceneready/domain';
import { SCENEREADY_POLICY_V1 } from '@sceneready/readiness-engine';

import {
  createEvidenceEnvelope,
  evaluateEvidenceTrust,
  type EvidenceEnvelope,
  type EvidenceEnvelopeInput,
  type EvidenceMode,
} from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const DEFAULT_WEATHER_PAYLOAD = { precipitationProbability: 0.25 } as const;

interface WeatherOverrides {
  readonly trustState?: EvidenceTrustState;
  readonly observedAt?: string;
  readonly receivedAt?: string;
  readonly mode?: EvidenceMode;
  readonly adapterVersion?: string;
  readonly algorithmVersion?: string;
}

function makeWeatherInput<Payload>(
  payload: Payload,
  overrides: WeatherOverrides = {},
): EvidenceEnvelopeInput<Payload> {
  return {
    evidenceId: 'E-WEATHER-001',
    productionId: 'BCN-DEMO-01',
    kind: 'WEATHER',
    sourceType: 'EXTERNAL_PROVIDER',
    authorityClass: 'EXTERNAL_AUTHORITATIVE',
    trustState: overrides.trustState ?? 'LIVE',
    observedAt: overrides.observedAt ?? '2026-09-17T04:00:00Z',
    receivedAt: overrides.receivedAt ?? '2026-09-17T04:01:00Z',
    ...(overrides.adapterVersion === undefined ? {} : { adapterVersion: overrides.adapterVersion }),
    ...(overrides.algorithmVersion === undefined
      ? {}
      : { algorithmVersion: overrides.algorithmVersion }),
    ...(overrides.mode === undefined ? {} : { mode: overrides.mode }),
    payload,
  };
}

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
});
