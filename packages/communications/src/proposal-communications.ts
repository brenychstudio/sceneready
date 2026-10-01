import { parseIntervention } from '@sceneready/intervention-engine';
import { createProposalFingerprint, type AuthorityProposal } from '@sceneready/mcp-human-authority';

import {
  deriveAffectedAudience,
  type AffectedAudience,
  type AudienceIssueCode,
  type CommunicationAudienceInput,
} from './audience.js';
import { draftBoundCommunications, type DraftIssueCode } from './draft.js';
import type { BoundedNotificationPayload } from './message-schema.js';

export const PROPOSAL_COMMUNICATION_ISSUE_CODES = ['MALFORMED_PROPOSAL'] as const;

export type ProposalCommunicationIssueCode = (typeof PROPOSAL_COMMUNICATION_ISSUE_CODES)[number];

export type BindIssueCode = AudienceIssueCode | DraftIssueCode | ProposalCommunicationIssueCode;

export interface ProposalCommunicationContext {
  readonly accountId: string;
  readonly productionId: string;
  readonly proposalId: string;
  readonly baseProductionRevision: number;
  readonly baseGraphRevision: number;
  readonly policyVersion: string;
  readonly predictedEffects: readonly unknown[];
}

export type BindProposalCommunicationsResult =
  | {
      readonly ok: true;
      readonly audience: AffectedAudience;
      readonly affectedRecipients: readonly string[];
      readonly notificationPayloads: readonly BoundedNotificationPayload[];
      readonly proposal: AuthorityProposal;
      readonly fingerprint: string;
    }
  | { readonly ok: false; readonly issues: readonly BindIssueCode[] };

const CONTEXT_KEYS = [
  'accountId',
  'baseGraphRevision',
  'baseProductionRevision',
  'policyVersion',
  'predictedEffects',
  'productionId',
  'proposalId',
] as const;

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function fail(issues: ReadonlySet<BindIssueCode>): BindProposalCommunicationsResult {
  return Object.freeze({
    ok: false,
    issues: Object.freeze([...issues].sort(compareOrdinal)),
  });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function readContext(value: ProposalCommunicationContext): ProposalCommunicationContext | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isPlainObject(value)
  ) {
    return null;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== CONTEXT_KEYS.length ||
    CONTEXT_KEYS.some((key) => !Object.hasOwn(value, key))
  ) {
    return null;
  }
  if (
    !nonEmptyString(value.accountId) ||
    !nonEmptyString(value.productionId) ||
    !nonEmptyString(value.proposalId) ||
    !nonEmptyString(value.policyVersion) ||
    !Array.isArray(value.predictedEffects) ||
    typeof value.baseProductionRevision !== 'number' ||
    typeof value.baseGraphRevision !== 'number' ||
    !Number.isSafeInteger(value.baseProductionRevision) ||
    !Number.isSafeInteger(value.baseGraphRevision)
  ) {
    return null;
  }
  return {
    accountId: value.accountId,
    productionId: value.productionId,
    proposalId: value.proposalId,
    baseProductionRevision: value.baseProductionRevision,
    baseGraphRevision: value.baseGraphRevision,
    policyVersion: value.policyVersion,
    predictedEffects: value.predictedEffects,
  };
}

export function bindProposalCommunications(
  context: ProposalCommunicationContext,
  input: CommunicationAudienceInput,
  proposedPayloads: readonly unknown[],
): BindProposalCommunicationsResult {
  const issues = new Set<BindIssueCode>();
  const acceptedContext = readContext(context);
  if (acceptedContext === null) {
    issues.add('MALFORMED_PROPOSAL');
  }
  const audienceResult = deriveAffectedAudience(input);
  if (!audienceResult.ok) {
    for (const issue of audienceResult.issues) {
      issues.add(issue);
    }
    return fail(issues);
  }
  const crewPersonIds = input.crew.map((member) => member.personId);
  const draft = draftBoundCommunications(audienceResult.audience, proposedPayloads, crewPersonIds);
  if (!draft.ok) {
    for (const issue of draft.issues) {
      issues.add(issue);
    }
  }
  if (acceptedContext === null || !draft.ok) {
    return fail(issues);
  }

  const interventions = [];
  for (const value of input.interventions) {
    const parsed = parseIntervention(value);
    if (!parsed.ok) {
      issues.add('INVALID_INTERVENTION');
      return fail(issues);
    }
    interventions.push(parsed.intervention);
  }

  const proposal: AuthorityProposal = Object.freeze({
    accountId: acceptedContext.accountId,
    productionId: acceptedContext.productionId,
    proposalId: acceptedContext.proposalId,
    baseProductionRevision: acceptedContext.baseProductionRevision,
    baseGraphRevision: acceptedContext.baseGraphRevision,
    policyVersion: acceptedContext.policyVersion,
    interventions: Object.freeze(interventions),
    affectedRecipients: draft.affectedRecipients,
    notificationPayloads: draft.notificationPayloads,
    predictedEffects: Object.freeze([...acceptedContext.predictedEffects]),
  });

  return Object.freeze({
    ok: true,
    audience: audienceResult.audience,
    affectedRecipients: draft.affectedRecipients,
    notificationPayloads: draft.notificationPayloads,
    proposal,
    fingerprint: createProposalFingerprint(proposal),
  });
}
