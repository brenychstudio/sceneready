import {
  AuthorityContractError,
  createProposalFingerprint,
  type AuthorityProposal,
} from '@sceneready/mcp-human-authority';

import {
  planCompensation,
  type CompensationAudienceInput,
  type CompensationBindContext,
  type CompensationCallTime,
  type CompensationCrewMember,
  type CompensationDenialReason,
  type CompensationDeparture,
  type ExpectedCorrectivePayload,
} from './compensation.js';
import {
  REVERSIBILITY_DISCLOSURE_KIND,
  SEND_CORRECTIVE_NOTIFICATION,
  type CorrectiveNotificationEffect,
  type ReversibilityDisclosure,
} from './reversibility.js';

export interface CompensationBinder {
  bind(
    context: CompensationBindContext,
    audience: CompensationAudienceInput,
  ): CompensationBindResult;
}

export type CompensationBindResult =
  | { readonly ok: true; readonly proposal: AuthorityProposal }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface PrepareCompensatingProposalInput {
  readonly appliedProposal: AuthorityProposal;
  readonly currentProductionRevision: number;
  readonly currentGraphRevision: number;
  readonly proposalId: string;
  readonly crew: readonly CompensationCrewMember[];
  readonly callTimes: readonly CompensationCallTime[];
  readonly departures: readonly CompensationDeparture[];
  readonly bindCommunications: CompensationBinder;
}

export interface CompensatingProposal {
  readonly proposal: AuthorityProposal;
  readonly fingerprint: string;
  readonly reversibility: readonly ReversibilityDisclosure[];
  readonly sideEffects: readonly CorrectiveNotificationEffect[];
}

export type PrepareCompensatingProposalResult =
  | { readonly ok: true; readonly compensation: CompensatingProposal }
  | { readonly ok: false; readonly reason: CompensationDenialReason };

const PROPOSAL_KEYS = [
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

const PAYLOAD_KEYS = [
  'approvedText',
  'changeType',
  'newValue',
  'oldValue',
  'reasonCode',
  'recipientPersonId',
  'recipientRole',
  'requiredAction',
] as const;

function deny(reason: CompensationDenialReason): PrepareCompensatingProposalResult {
  return Object.freeze({ ok: false, reason });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isSafeRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function fingerprintOf(proposal: AuthorityProposal): string | null {
  try {
    return createProposalFingerprint(proposal);
  } catch (error) {
    if (error instanceof AuthorityContractError) {
      return null;
    }
    throw error;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (!isPlainRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalize(value[key]);
  }
  return sorted;
}

function payloadMatches(value: unknown, expected: ExpectedCorrectivePayload): boolean {
  if (!isPlainRecord(value) || !exactKeys(value, PAYLOAD_KEYS)) {
    return false;
  }
  const approvedText = value.approvedText;
  return (
    value.recipientPersonId === expected.recipientPersonId &&
    value.recipientRole === expected.recipientRole &&
    value.changeType === expected.changeType &&
    value.oldValue === expected.oldValue &&
    value.newValue === expected.newValue &&
    value.reasonCode === expected.reasonCode &&
    value.requiredAction === expected.requiredAction &&
    typeof approvedText === 'string' &&
    approvedText.includes(`from ${expected.oldValue} to ${expected.newValue}`)
  );
}

function isDisclosure(value: unknown): value is ReversibilityDisclosure {
  return isPlainRecord(value) && value.kind === REVERSIBILITY_DISCLOSURE_KIND;
}

function isSideEffect(value: unknown): value is CorrectiveNotificationEffect {
  return isPlainRecord(value) && value.kind === SEND_CORRECTIVE_NOTIFICATION;
}

/**
 * Prepares the next forward proposal from an applied revision.
 * It does not apply, consume a token, append history, or send.
 * Disclosure and SEND_CORRECTIVE_NOTIFICATION stay inside predictedEffects,
 * which the existing proposal fingerprint already binds.
 */
export function prepareCompensatingProposal(
  input: PrepareCompensatingProposalInput,
): PrepareCompensatingProposalResult {
  if (typeof input.proposalId !== 'string' || input.proposalId.length === 0) {
    return deny('INVALID_PROPOSAL_ID');
  }
  if (
    !isSafeRevision(input.currentProductionRevision) ||
    !isSafeRevision(input.currentGraphRevision) ||
    input.currentProductionRevision <= input.appliedProposal.baseProductionRevision
  ) {
    return deny('INVALID_REVISION');
  }
  if (input.proposalId === input.appliedProposal.proposalId) {
    return deny('INVALID_PROPOSAL_ID');
  }
  if (fingerprintOf(input.appliedProposal) === null) {
    return deny('INVALID_APPLIED_PROPOSAL');
  }

  const planned = planCompensation({
    accountId: input.appliedProposal.accountId,
    productionId: input.appliedProposal.productionId,
    policyVersion: input.appliedProposal.policyVersion,
    proposalId: input.proposalId,
    currentProductionRevision: input.currentProductionRevision,
    currentGraphRevision: input.currentGraphRevision,
    interventions: input.appliedProposal.interventions,
    notificationPayloads: input.appliedProposal.notificationPayloads,
    crew: input.crew,
    callTimes: input.callTimes,
    departures: input.departures,
  });
  if (!planned.ok) {
    return planned;
  }

  const bound = input.bindCommunications.bind(planned.plan.context, planned.plan.audience);
  if (!bound.ok) {
    return deny('COMMUNICATIONS_BINDING_REJECTED');
  }
  const proposal = bound.proposal;
  if (!isPlainRecord(proposal) || !exactKeys(proposal, PROPOSAL_KEYS)) {
    return deny('BOUND_PROPOSAL_MISMATCH');
  }
  const fingerprint = fingerprintOf(proposal);
  if (fingerprint === null) {
    return deny('BOUND_PROPOSAL_MISMATCH');
  }
  const payloads = proposal.notificationPayloads;
  const matchedPayloads =
    Array.isArray(payloads) &&
    payloads.length === planned.plan.expectedPayloads.length &&
    planned.plan.expectedPayloads.every((expected, index) =>
      payloadMatches(payloads[index], expected),
    );
  if (
    proposal.accountId !== planned.plan.context.accountId ||
    proposal.productionId !== planned.plan.context.productionId ||
    proposal.proposalId !== planned.plan.context.proposalId ||
    proposal.baseProductionRevision !== planned.plan.context.baseProductionRevision ||
    proposal.baseGraphRevision !== planned.plan.context.baseGraphRevision ||
    proposal.policyVersion !== planned.plan.context.policyVersion ||
    !sameJson(proposal.interventions, planned.plan.inverses) ||
    !sameJson(proposal.predictedEffects, planned.plan.context.predictedEffects) ||
    !sameJson(proposal.affectedRecipients, planned.plan.affectedRecipients) ||
    !matchedPayloads
  ) {
    return deny('BOUND_PROPOSAL_MISMATCH');
  }

  const reversibility = proposal.predictedEffects.filter(isDisclosure);
  const sideEffects = proposal.predictedEffects.filter(isSideEffect);
  if (
    reversibility.length !== planned.plan.disclosures.length ||
    sideEffects.length !== planned.plan.sideEffects.length
  ) {
    return deny('BOUND_PROPOSAL_MISMATCH');
  }

  return Object.freeze({
    ok: true,
    compensation: Object.freeze({
      proposal,
      fingerprint,
      reversibility: Object.freeze(reversibility),
      sideEffects: Object.freeze(sideEffects),
    }),
  });
}
