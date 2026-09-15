export const EVIDENCE_KINDS = [
  'WEATHER',
  'TRAVEL',
  'SOLAR',
  'CREW_CONFIRMATION',
  'EQUIPMENT_VERIFICATION',
  'DOCUMENT',
  'LOCATION_ACCESS',
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_SOURCE_TYPES = ['EXTERNAL_PROVIDER', 'SYSTEM_DERIVED'] as const;

export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const EVIDENCE_AUTHORITY_CLASSES = [
  'SYSTEM_DERIVED',
  'EXTERNAL_AUTHORITATIVE',
  'DOCUMENT_AUTHORITY',
  'SUBJECT_CONFIRMATION',
  'PRODUCTION_LEAD_ASSERTION',
  'RECORDED_INTERNAL',
  'FALLBACK',
] as const;

export type EvidenceAuthorityClass = (typeof EVIDENCE_AUTHORITY_CLASSES)[number];

export const EVIDENCE_MODES = ['LIVE', 'REPLAY'] as const;

export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

export function isEvidenceSourceType(value: unknown): value is EvidenceSourceType {
  return typeof value === 'string' && (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isEvidenceAuthorityClass(value: unknown): value is EvidenceAuthorityClass {
  return (
    typeof value === 'string' && (EVIDENCE_AUTHORITY_CLASSES as readonly string[]).includes(value)
  );
}

export function isEvidenceMode(value: unknown): value is EvidenceMode {
  return typeof value === 'string' && (EVIDENCE_MODES as readonly string[]).includes(value);
}
