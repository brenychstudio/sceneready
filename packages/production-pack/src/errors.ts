import type { ProductionPack } from './schema.js';

export const PRODUCTION_PACK_ISSUE_CODES = [
  'SCHEMA_INVALID',
  'UNKNOWN_ACTIVITY_REFERENCE',
  'UNKNOWN_PERSON_REFERENCE',
  'UNKNOWN_LOCATION_REFERENCE',
  'UNKNOWN_EQUIPMENT_REFERENCE',
  'UNKNOWN_DOCUMENT_REFERENCE',
  'TEMPORAL_AMBIGUITY',
  'INVALID_ACTIVITY_ORDER',
  'DUPLICATE_ID',
  'UNSUPPORTED_POLICY_VERSION',
] as const;

export type ProductionPackValidationIssueCode = (typeof PRODUCTION_PACK_ISSUE_CODES)[number];

export interface ProductionPackValidationIssue {
  readonly code: ProductionPackValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export type ProductionPackValidationResult =
  | { readonly ok: true; readonly pack: ProductionPack }
  | { readonly ok: false; readonly issues: readonly ProductionPackValidationIssue[] };

const ISSUE_CODE_RANK: Record<ProductionPackValidationIssueCode, number> = {
  SCHEMA_INVALID: 0,
  UNKNOWN_ACTIVITY_REFERENCE: 1,
  UNKNOWN_PERSON_REFERENCE: 2,
  UNKNOWN_LOCATION_REFERENCE: 3,
  UNKNOWN_EQUIPMENT_REFERENCE: 4,
  UNKNOWN_DOCUMENT_REFERENCE: 5,
  TEMPORAL_AMBIGUITY: 6,
  INVALID_ACTIVITY_ORDER: 7,
  DUPLICATE_ID: 8,
  UNSUPPORTED_POLICY_VERSION: 9,
};

export function sortProductionPackIssues(
  issues: readonly ProductionPackValidationIssue[],
): ProductionPackValidationIssue[] {
  return [...issues].sort((left, right) => {
    const codeDelta = ISSUE_CODE_RANK[left.code] - ISSUE_CODE_RANK[right.code];
    if (codeDelta !== 0) {
      return codeDelta;
    }
    if (left.path !== right.path) {
      return left.path < right.path ? -1 : 1;
    }
    if (left.message !== right.message) {
      return left.message < right.message ? -1 : 1;
    }
    return 0;
  });
}
