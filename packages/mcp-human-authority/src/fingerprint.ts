import { createHash } from 'node:crypto';

import { AuthorityContractError, canonicalize } from './canonicalize.js';

export interface AuthorityProposal {
  readonly accountId: string;
  readonly productionId: string;
  readonly proposalId: string;
  readonly baseProductionRevision: number;
  readonly baseGraphRevision: number;
  readonly policyVersion: string;
  readonly interventions: readonly unknown[];
  readonly affectedRecipients: readonly unknown[];
  readonly notificationPayloads: readonly unknown[];
  readonly predictedEffects: readonly unknown[];
}

const PROPOSAL_FIELDS = [
  'accountId',
  'affectedRecipients',
  'baseGraphRevision',
  'baseProductionRevision',
  'interventions',
  'notificationPayloads',
  'policyVersion',
  'predictedEffects',
  'productionId',
  'proposalId',
] as const;

type ProposalField = (typeof PROPOSAL_FIELDS)[number];

const PROPOSAL_FIELD_SET = new Set<string>(PROPOSAL_FIELDS);

function fail(code: string, message: string): never {
  throw new AuthorityContractError(code, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(value: unknown, field: ProposalField): string {
  if (typeof value !== 'string') {
    fail('INVALID_PROPOSAL', `${field} must be a string`);
  }
  return value;
}

function requireRevision(value: unknown, field: ProposalField): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail('INVALID_PROPOSAL', `${field} must be a safe integer`);
  }
  return value;
}

function requireArray(value: unknown, field: ProposalField): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail('INVALID_PROPOSAL', `${field} must be an array`);
  }
  return value;
}

function readProposal(value: unknown): AuthorityProposal {
  if (!isPlainRecord(value)) {
    fail('INVALID_PROPOSAL', 'proposal must be a plain object');
  }
  for (const key of Object.keys(value)) {
    if (!PROPOSAL_FIELD_SET.has(key)) {
      fail('UNEXPECTED_FIELD', `${key} is not part of the authority proposal`);
    }
  }
  for (const field of PROPOSAL_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      fail('MISSING_FIELD', `${field} is required`);
    }
  }
  return {
    accountId: requireString(value.accountId, 'accountId'),
    productionId: requireString(value.productionId, 'productionId'),
    proposalId: requireString(value.proposalId, 'proposalId'),
    baseProductionRevision: requireRevision(value.baseProductionRevision, 'baseProductionRevision'),
    baseGraphRevision: requireRevision(value.baseGraphRevision, 'baseGraphRevision'),
    policyVersion: requireString(value.policyVersion, 'policyVersion'),
    interventions: requireArray(value.interventions, 'interventions'),
    affectedRecipients: requireArray(value.affectedRecipients, 'affectedRecipients'),
    notificationPayloads: requireArray(value.notificationPayloads, 'notificationPayloads'),
    predictedEffects: requireArray(value.predictedEffects, 'predictedEffects'),
  };
}

/** SHA-256 over the canonical execution-significant proposal. Does not approve it. */
export function createProposalFingerprint(proposal: AuthorityProposal): string {
  const material = readProposal(proposal);
  return createHash('sha256').update(canonicalize(material), 'utf8').digest('hex');
}
