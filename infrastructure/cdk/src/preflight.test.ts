import { describe, expect, it } from 'vitest';

import { CANONICAL_MODEL_ID, competitionConfig, PinnedModelError } from './config.js';
import {
  buildPreflightReport,
  classifyServiceProbe,
  parseProbeLines,
  preflightBlocker,
  redactPreflightText,
  resolvePinnedBedrockTarget,
  type PreflightObservation,
} from './preflight.js';

const ACTIVE_PROFILE: PreflightObservation = {
  identityResolved: true,
  foundationModelIds: [],
  inferenceProfiles: [
    {
      inferenceProfileId: CANONICAL_MODEL_ID,
      type: 'SYSTEM_DEFINED',
      status: 'ACTIVE',
    },
  ],
  probes: {
    agentcore: { exitCode: 254, errorName: 'AccessDeniedException' },
    location: { exitCode: 254, errorName: 'AccessDeniedException' },
    routes: { exitCode: 254, errorName: 'AccessDeniedException' },
    ecr: { exitCode: 254, errorName: 'AccessDeniedException' },
    dynamodb: { exitCode: 254, errorName: 'AccessDeniedException' },
    cognito: { exitCode: 254, errorName: 'AccessDeniedException' },
    lambda: { exitCode: 254, errorName: 'AccessDeniedException' },
    sqs: { exitCode: 254, errorName: 'AccessDenied' },
    s3: { exitCode: 254, errorName: 'AccessDenied' },
    eventbridge: { exitCode: 254, errorName: 'AccessDeniedException' },
    cloudwatch: { exitCode: 254, errorName: 'AccessDenied' },
    logs: { exitCode: 254, errorName: 'AccessDeniedException' },
  },
};

describe('competition model pin', () => {
  it('keeps the canonical model and rejects substitution', () => {
    expect(competitionConfig().canonicalModelId).toBe(CANONICAL_MODEL_ID);
    expect(competitionConfig().region).toBe('eu-west-1');
    expect(() => competitionConfig('anthropic.claude-sonnet-4')).toThrow(PinnedModelError);
  });
});

describe('pinned Bedrock resolution', () => {
  it('records the official system-defined inference profile without switching models', () => {
    const resolved = resolvePinnedBedrockTarget(ACTIVE_PROFILE);
    expect(resolved).toEqual({
      canonicalModelId: CANONICAL_MODEL_ID,
      resolvedTargetType: 'SYSTEM_DEFINED',
      resolvedInvokeIdentifier: CANONICAL_MODEL_ID,
      availability: true,
    });
  });

  it('does not select a nearby model when the canonical target is missing', () => {
    const resolved = resolvePinnedBedrockTarget({
      ...ACTIVE_PROFILE,
      inferenceProfiles: [
        {
          inferenceProfileId: 'eu.anthropic.claude-sonnet-4',
          type: 'SYSTEM_DEFINED',
          status: 'ACTIVE',
        },
      ],
    });
    expect(resolved.availability).toBe(false);
    expect(resolved.resolvedTargetType).toBeNull();
    expect(resolved.resolvedInvokeIdentifier).toBeNull();
  });

  it('treats an inactive canonical profile as unavailable', () => {
    const resolved = resolvePinnedBedrockTarget({
      ...ACTIVE_PROFILE,
      inferenceProfiles: [
        {
          inferenceProfileId: CANONICAL_MODEL_ID,
          type: 'APPLICATION',
          status: 'INACTIVE',
        },
      ],
    });
    expect(resolved.resolvedTargetType).toBe('APPLICATION');
    expect(resolved.availability).toBe(false);
  });
});

describe('service availability', () => {
  it('treats a reached regional endpoint that denies listing as available', () => {
    expect(classifyServiceProbe({ exitCode: 254, errorName: 'AccessDeniedException' })).toBe(
      'AVAILABLE',
    );
    expect(classifyServiceProbe({ exitCode: 255, errorName: 'EndpointUnavailable' })).toBe(
      'UNAVAILABLE',
    );
  });

  it('blocks when AgentCore does not answer in eu-west-1', () => {
    const report = buildPreflightReport({
      ...ACTIVE_PROFILE,
      probes: {
        ...ACTIVE_PROFILE.probes,
        agentcore: { exitCode: 255, errorName: 'EndpointUnavailable' },
      },
    });
    expect(report.agentCoreAvailable).toBe(false);
    expect(preflightBlocker(report)).toBe('AGENTCORE_UNAVAILABLE_IN_EU_WEST_1');
  });
});

describe('redaction', () => {
  it('removes account identifiers, credential shapes, and private endpoints', () => {
    const account = ['0804', '3267', '0468'].join('');
    const accessKey = ['AKIA', '0000000000000000'].join('');
    const arn = `arn:aws:iam::${account}:user/example`;
    const endpoint = ['vpce-', '0123456789abcdef'].join('');
    const dirty = `${account} ${accessKey} ${arn} ${endpoint} session_token=abc`;
    const clean = redactPreflightText(dirty);
    expect(clean).not.toContain(account);
    expect(clean).not.toContain(accessKey);
    expect(clean).not.toContain('vpce-');
    expect(clean).not.toContain('session_token=abc');
  });

  it('writes a report that stays redacted', () => {
    const report = buildPreflightReport(ACTIVE_PROFILE);
    const serialized = JSON.stringify(report);
    expect(serialized).toContain('"resolvedTargetType":"SYSTEM_DEFINED"');
    expect(serialized).not.toMatch(/\b\d{12}\b/);
    expect(preflightBlocker(report)).toBeNull();
  });
});

describe('probe lines', () => {
  it('parses identity, the pinned profile, and service probes', () => {
    const observation = parseProbeLines(
      [
        'identity=resolved',
        'foundation=absent',
        `profile=${CANONICAL_MODEL_ID}|SYSTEM_DEFINED|ACTIVE`,
        'service=agentcore|254|AccessDeniedException',
      ].join('\n'),
    );
    expect(observation.identityResolved).toBe(true);
    expect(observation.inferenceProfiles[0]?.type).toBe('SYSTEM_DEFINED');
    expect(observation.probes.agentcore?.exitCode).toBe(254);
  });
});
