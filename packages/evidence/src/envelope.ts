import { Temporal } from '@js-temporal/polyfill';
import { EvidenceTrustStateSchema, type EvidenceTrustState } from '@sceneready/domain';

import { canonicalizeEvidenceJson, fingerprintEvidenceContent } from './fingerprint.js';
import {
  isEvidenceAuthorityClass,
  isEvidenceKind,
  isEvidenceMode,
  isEvidenceSourceType,
  type EvidenceAuthorityClass,
  type EvidenceKind,
  type EvidenceMode,
  type EvidenceSourceType,
} from './kinds.js';

export interface EvidenceEnvelope<Payload> {
  readonly evidenceId: string;
  readonly productionId: string;
  readonly kind: EvidenceKind;
  readonly sourceType: EvidenceSourceType;
  readonly authorityClass: EvidenceAuthorityClass;
  readonly trustState: EvidenceTrustState;
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly adapterVersion?: string;
  readonly algorithmVersion?: string;
  readonly mode: EvidenceMode;
  readonly contentFingerprint: string;
  readonly payload: Readonly<Payload>;
}

export type EvidenceEnvelopeInput<Payload> = Omit<
  EvidenceEnvelope<Payload>,
  'contentFingerprint' | 'mode'
> & {
  readonly mode?: EvidenceMode;
};

function assertInstant(value: string, path: string): string {
  try {
    return Temporal.Instant.from(value).toString();
  } catch {
    throw new Error(`canonical JSON rejected: invalid instant at ${path}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        deepFreeze(item);
      }
    } else {
      for (const key of Object.keys(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
  }
  return value;
}

function cloneJsonPayload<Payload>(payload: Payload): Payload {
  return JSON.parse(canonicalizeEvidenceJson(payload)) as Payload;
}

function optionalString(value: string | undefined, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`canonical JSON rejected: invalid string at ${path}`);
  }
  return value;
}

export function createEvidenceEnvelope<Payload>(
  input: EvidenceEnvelopeInput<Payload>,
): EvidenceEnvelope<Payload> {
  if (!isEvidenceKind(input.kind)) {
    throw new Error('canonical JSON rejected: unsupported evidence kind');
  }
  if (!isEvidenceSourceType(input.sourceType)) {
    throw new Error('canonical JSON rejected: unsupported sourceType');
  }
  if (!isEvidenceAuthorityClass(input.authorityClass)) {
    throw new Error('canonical JSON rejected: unsupported authorityClass');
  }
  const trustParsed = EvidenceTrustStateSchema.safeParse(input.trustState);
  if (!trustParsed.success) {
    throw new Error('canonical JSON rejected: unsupported trustState');
  }
  const mode = input.mode ?? 'LIVE';
  if (!isEvidenceMode(mode)) {
    throw new Error('canonical JSON rejected: unsupported mode');
  }

  const observedAt = assertInstant(input.observedAt, 'observedAt');
  const receivedAt = assertInstant(input.receivedAt, 'receivedAt');
  const validFrom =
    input.validFrom === undefined ? undefined : assertInstant(input.validFrom, 'validFrom');
  const validUntil =
    input.validUntil === undefined ? undefined : assertInstant(input.validUntil, 'validUntil');
  const adapterVersion = optionalString(input.adapterVersion, 'adapterVersion');
  const algorithmVersion = optionalString(input.algorithmVersion, 'algorithmVersion');
  const payload = deepFreeze(cloneJsonPayload(input.payload));

  const fingerprintSubject: Record<string, unknown> = {
    algorithmVersion,
    adapterVersion,
    authorityClass: input.authorityClass,
    kind: input.kind,
    mode,
    observedAt,
    payload,
    receivedAt,
    sourceType: input.sourceType,
    trustState: trustParsed.data,
    validFrom,
    validUntil,
  };
  for (const key of Object.keys(fingerprintSubject)) {
    if (fingerprintSubject[key] === undefined) {
      delete fingerprintSubject[key];
    }
  }

  const envelope = {
    evidenceId: input.evidenceId,
    productionId: input.productionId,
    kind: input.kind,
    sourceType: input.sourceType,
    authorityClass: input.authorityClass,
    trustState: trustParsed.data,
    observedAt,
    receivedAt,
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(adapterVersion === undefined ? {} : { adapterVersion }),
    ...(algorithmVersion === undefined ? {} : { algorithmVersion }),
    mode,
    contentFingerprint: fingerprintEvidenceContent(fingerprintSubject),
    payload,
  };

  return Object.freeze(envelope);
}
