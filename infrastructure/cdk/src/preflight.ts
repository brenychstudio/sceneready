import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  AWS_REGION,
  CANONICAL_MODEL_ID,
  PinnedModelError,
  assertNoModelSubstitution,
} from './config.js';

export const PREFLIGHT_SERVICES = [
  'sts',
  'bedrock',
  'agentcore',
  'location',
  'ecr',
  'dynamodb',
  'cognito',
  'lambda',
  'sqs',
  's3',
  'eventbridge',
  'cloudwatch',
] as const;

export type PreflightService = (typeof PREFLIGHT_SERVICES)[number];

export type ServiceAvailability = 'AVAILABLE' | 'UNAVAILABLE';

export interface ServiceProbe {
  readonly exitCode: number;
  readonly errorName: string | null;
}

export interface InferenceProfileObservation {
  readonly inferenceProfileId: string;
  readonly type: string;
  readonly status: string;
}

export interface PreflightObservation {
  readonly identityResolved: boolean;
  readonly foundationModelIds: readonly string[];
  readonly inferenceProfiles: readonly InferenceProfileObservation[];
  readonly probes: Readonly<Record<string, ServiceProbe>>;
}

export interface PinnedBedrockTarget {
  readonly canonicalModelId: typeof CANONICAL_MODEL_ID;
  readonly resolvedTargetType: string | null;
  readonly resolvedInvokeIdentifier: string | null;
  readonly availability: boolean;
}

export interface PreflightReport {
  readonly region: typeof AWS_REGION;
  readonly identityResolved: boolean;
  readonly canonicalModelId: typeof CANONICAL_MODEL_ID;
  readonly resolvedTargetType: string | null;
  readonly resolvedInvokeIdentifier: string | null;
  readonly availability: boolean;
  readonly agentCoreAvailable: boolean;
  readonly locationAvailable: boolean;
  readonly services: Readonly<Record<PreflightService, ServiceAvailability>>;
  readonly redacted: true;
}

const AVAILABLE_ERROR_NAMES = new Set(['AccessDeniedException', 'AccessDenied']);

const ACCOUNT_ID_PATTERN = /\b\d{12}\b/g;
const ACCESS_KEY_PATTERN = /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g;
const ARN_PATTERN = /arn:aws[a-z-]*:[^\s"'\\]+/g;
const PRIVATE_ENDPOINT_PATTERN = /\b(?:vpce-[0-9a-f]+|[a-z0-9-]+\.vpce\.amazonaws\.com)\b/gi;
const SESSION_TOKEN_PATTERN = /(?:session[_-]?token|secret[_-]?access[_-]?key)\s*[:=]\s*\S+/gi;

export function redactPreflightText(value: string): string {
  return value
    .replace(SESSION_TOKEN_PATTERN, 'REDACTED')
    .replace(ACCESS_KEY_PATTERN, 'REDACTED')
    .replace(ARN_PATTERN, 'arn:aws:REDACTED')
    .replace(PRIVATE_ENDPOINT_PATTERN, 'REDACTED')
    .replace(ACCOUNT_ID_PATTERN, 'REDACTED');
}

export function assertRedacted(value: string): void {
  const redacted = redactPreflightText(value);
  if (redacted !== value) {
    throw new Error('preflight text contained account, credential, or private endpoint material');
  }
}

export function classifyServiceProbe(probe: ServiceProbe): ServiceAvailability {
  if (probe.exitCode === 0) {
    return 'AVAILABLE';
  }
  if (probe.errorName !== null && AVAILABLE_ERROR_NAMES.has(probe.errorName)) {
    return 'AVAILABLE';
  }
  return 'UNAVAILABLE';
}

function safeInvokeIdentifier(identifier: string): string | null {
  if (identifier !== CANONICAL_MODEL_ID) {
    return null;
  }
  const redacted = redactPreflightText(identifier);
  return redacted === identifier ? identifier : null;
}

export function resolvePinnedBedrockTarget(observation: PreflightObservation): PinnedBedrockTarget {
  assertNoModelSubstitution(CANONICAL_MODEL_ID);
  const profile = observation.inferenceProfiles.find(
    (candidate) => candidate.inferenceProfileId === CANONICAL_MODEL_ID,
  );
  if (profile !== undefined) {
    const active = profile.status === 'ACTIVE';
    return Object.freeze({
      canonicalModelId: CANONICAL_MODEL_ID,
      resolvedTargetType: profile.type,
      resolvedInvokeIdentifier: active ? safeInvokeIdentifier(profile.inferenceProfileId) : null,
      availability: active && safeInvokeIdentifier(profile.inferenceProfileId) !== null,
    });
  }

  const foundation = observation.foundationModelIds.find(
    (modelId) => modelId === CANONICAL_MODEL_ID,
  );
  if (foundation !== undefined) {
    const identifier = safeInvokeIdentifier(foundation);
    return Object.freeze({
      canonicalModelId: CANONICAL_MODEL_ID,
      resolvedTargetType: 'FOUNDATION_MODEL',
      resolvedInvokeIdentifier: identifier,
      availability: identifier !== null,
    });
  }

  return Object.freeze({
    canonicalModelId: CANONICAL_MODEL_ID,
    resolvedTargetType: null,
    resolvedInvokeIdentifier: null,
    availability: false,
  });
}

function probeOf(observation: PreflightObservation, name: string): ServiceProbe {
  return observation.probes[name] ?? { exitCode: 1, errorName: 'MissingProbe' };
}

function combineAvailability(
  left: ServiceAvailability,
  right: ServiceAvailability,
): ServiceAvailability {
  return left === 'AVAILABLE' && right === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE';
}

export function buildPreflightReport(observation: PreflightObservation): PreflightReport {
  const target = resolvePinnedBedrockTarget(observation);
  const location = combineAvailability(
    classifyServiceProbe(probeOf(observation, 'location')),
    classifyServiceProbe(probeOf(observation, 'routes')),
  );
  const cloudwatch = combineAvailability(
    classifyServiceProbe(probeOf(observation, 'cloudwatch')),
    classifyServiceProbe(probeOf(observation, 'logs')),
  );
  const services = Object.freeze({
    sts: observation.identityResolved ? 'AVAILABLE' : 'UNAVAILABLE',
    bedrock: target.availability ? 'AVAILABLE' : 'UNAVAILABLE',
    agentcore: classifyServiceProbe(probeOf(observation, 'agentcore')),
    location,
    ecr: classifyServiceProbe(probeOf(observation, 'ecr')),
    dynamodb: classifyServiceProbe(probeOf(observation, 'dynamodb')),
    cognito: classifyServiceProbe(probeOf(observation, 'cognito')),
    lambda: classifyServiceProbe(probeOf(observation, 'lambda')),
    sqs: classifyServiceProbe(probeOf(observation, 'sqs')),
    s3: classifyServiceProbe(probeOf(observation, 's3')),
    eventbridge: classifyServiceProbe(probeOf(observation, 'eventbridge')),
    cloudwatch,
  }) satisfies Record<PreflightService, ServiceAvailability>;

  const report: PreflightReport = Object.freeze({
    region: AWS_REGION,
    identityResolved: observation.identityResolved,
    canonicalModelId: CANONICAL_MODEL_ID,
    resolvedTargetType: target.resolvedTargetType,
    resolvedInvokeIdentifier: target.resolvedInvokeIdentifier,
    availability: target.availability,
    agentCoreAvailable: services.agentcore === 'AVAILABLE',
    locationAvailable: services.location === 'AVAILABLE',
    services,
    redacted: true,
  });
  assertRedacted(JSON.stringify(report));
  return report;
}

export function parseProbeLines(text: string): PreflightObservation {
  let identityResolved = false;
  const foundationModelIds: string[] = [];
  const inferenceProfiles: InferenceProfileObservation[] = [];
  const probes: Record<string, ServiceProbe> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error('invalid preflight probe line');
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'identity') {
      identityResolved = value === 'resolved';
      continue;
    }
    if (key === 'foundation') {
      if (value !== 'absent') {
        foundationModelIds.push(value);
      }
      continue;
    }
    if (key === 'profile') {
      if (value === 'absent') {
        continue;
      }
      const [inferenceProfileId, type, status] = value.split('|');
      if (
        inferenceProfileId === undefined ||
        type === undefined ||
        status === undefined ||
        inferenceProfileId.length === 0 ||
        type.length === 0 ||
        status.length === 0
      ) {
        throw new Error('invalid inference profile probe');
      }
      inferenceProfiles.push({ inferenceProfileId, type, status });
      continue;
    }
    if (key === 'service') {
      const [name, exitText, errorName] = value.split('|');
      if (name === undefined || exitText === undefined || errorName === undefined) {
        throw new Error('invalid service probe');
      }
      const exitCode = Number(exitText);
      if (!Number.isInteger(exitCode)) {
        throw new Error('invalid service probe exit code');
      }
      probes[name] = {
        exitCode,
        errorName: errorName === 'none' ? null : errorName,
      };
      continue;
    }
    throw new Error(`unknown preflight probe key: ${key}`);
  }

  return {
    identityResolved,
    foundationModelIds,
    inferenceProfiles,
    probes,
  };
}

export function preflightBlocker(report: PreflightReport): string | null {
  if (!report.identityResolved) {
    return 'AWS_CREDENTIALS_REQUIRED';
  }
  if (!report.availability) {
    return 'PINNED_BEDROCK_MODEL_UNAVAILABLE_OR_CHANGED';
  }
  if (!report.agentCoreAvailable) {
    return 'AGENTCORE_UNAVAILABLE_IN_EU_WEST_1';
  }
  const failed = PREFLIGHT_SERVICES.filter((service) => report.services[service] !== 'AVAILABLE');
  if (failed.length > 0) {
    return `AWS_PREFLIGHT_UNAVAILABLE:${failed.join(',')}`;
  }
  return null;
}

export function formatPreflightSummary(report: PreflightReport): string {
  const blocker = preflightBlocker(report);
  const lines = [
    `AWS_REGION=${report.region}`,
    `AWS_IDENTITY_RESOLVED=${report.identityResolved ? 'YES' : 'NO'}`,
    `CANONICAL_MODEL_ID=${report.canonicalModelId}`,
    `BEDROCK_TARGET_TYPE=${report.resolvedTargetType ?? 'UNRESOLVED'}`,
    `BEDROCK_TARGET_AVAILABLE=${report.availability ? 'PASS' : 'FAIL'}`,
    `AGENTCORE_REGION_AVAILABLE=${report.agentCoreAvailable ? 'PASS' : 'FAIL'}`,
    `AMAZON_LOCATION_AVAILABLE=${report.locationAvailable ? 'PASS' : 'FAIL'}`,
    `AWS_PREFLIGHT=${blocker === null ? 'PASS' : 'FAIL'}`,
  ];
  if (blocker !== null) {
    lines.push(`BLOCKER=${blocker}`);
  }
  const summary = `${lines.join('\n')}\n`;
  assertRedacted(summary);
  return summary;
}

export function writePreflightReport(report: PreflightReport, reportPath: string): void {
  const body = `${JSON.stringify(report, null, 2)}\n`;
  assertRedacted(body);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, body, 'utf8');
}

function writeReportFromProbeFile(probePath: string | undefined, reportPath: string): void {
  if (probePath === undefined || probePath.length === 0) {
    throw new PinnedModelError(CANONICAL_MODEL_ID);
  }
  const observation = parseProbeLines(readFileSync(probePath, 'utf8'));
  const report = buildPreflightReport(observation);
  writePreflightReport(report, reportPath);
  process.stdout.write(formatPreflightSummary(report));
  if (preflightBlocker(report) !== null) {
    process.exitCode = 1;
  }
}

const reportFlag = process.argv.indexOf('--write-report');
if (reportFlag !== -1) {
  const reportPathFlag = process.argv.indexOf('--report-path');
  const reportPath =
    reportPathFlag === -1 ? 'artifacts/local/aws-preflight.json' : process.argv[reportPathFlag + 1];
  writeReportFromProbeFile(
    process.argv[reportFlag + 1],
    reportPath ?? 'artifacts/local/aws-preflight.json',
  );
}
