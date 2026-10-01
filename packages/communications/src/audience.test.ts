import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProposalFingerprint, type AuthorityProposal } from '@sceneready/mcp-human-authority';
import { describe, expect, it } from 'vitest';

import {
  bindProposalCommunications,
  CANONICAL_COORDINATION_ROLE,
  COMMUNICATION_AUDIENCE_POLICY_VERSION,
  deriveAffectedAudience,
  draftBoundCommunications,
  renderApprovedText,
  type AffectedAudience,
  type BoundedNotificationPayload,
  type CommunicationAudienceInput,
  type ProposalCommunicationContext,
} from './index.js';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(dirname(SOURCE_DIRECTORY)));

const CANONICAL_CREW = [
  { personId: 'PERSON-PRODUCTION-LEAD', role: 'PRODUCTION_LEAD' },
  { personId: 'PERSON-MODEL', role: 'MODEL' },
  { personId: 'PERSON-STYLIST', role: 'STYLIST' },
  { personId: 'PERSON-HMU', role: 'HMU' },
  { personId: 'PERSON-PHOTO-ASSISTANT', role: 'PHOTO_ASSISTANT' },
  { personId: 'PERSON-DIGITAL-TECH', role: 'DIGITAL_TECH' },
  { personId: 'PERSON-MOTION-OPERATOR', role: 'MOTION_OPERATOR' },
  { personId: 'PERSON-PRODUCTION-ASSISTANT', role: 'PRODUCTION_ASSISTANT' },
] as const;

const SETUP_ASSIGNEES = [
  'PERSON-PRODUCTION-LEAD',
  'PERSON-PHOTO-ASSISTANT',
  'PERSON-DIGITAL-TECH',
  'PERSON-PRODUCTION-ASSISTANT',
];

const DEPARTURE_ASSIGNEES = [
  'PERSON-PRODUCTION-LEAD',
  'PERSON-MODEL',
  'PERSON-STYLIST',
  'PERSON-HMU',
  'PERSON-PHOTO-ASSISTANT',
  'PERSON-DIGITAL-TECH',
  'PERSON-MOTION-OPERATOR',
  'PERSON-PRODUCTION-ASSISTANT',
];

const CREW_DISRUPTION_EIGHT = [
  'PERSON-DIGITAL-TECH',
  'PERSON-HMU',
  'PERSON-MODEL',
  'PERSON-MOTION-OPERATOR',
  'PERSON-PHOTO-ASSISTANT',
  'PERSON-PRODUCTION-ASSISTANT',
  'PERSON-PRODUCTION-LEAD',
  'PERSON-STYLIST',
];

const CONTEXT: ProposalCommunicationContext = {
  accountId: 'ACCT-1',
  productionId: 'BCN-DEMO-01',
  proposalId: 'PROP-1',
  baseProductionRevision: 4,
  baseGraphRevision: 9,
  policyVersion: 'SR-POLICY-v1',
  predictedEffects: [{ subjectId: 'ACT-GOTHIC-LOOK-03', severity: 'LOW' }],
};

function optionA(): CommunicationAudienceInput {
  return {
    interventions: [
      { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: -25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-HMU', deltaMinutes: -25 },
      { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-PHOTO-ASSISTANT', deltaMinutes: -25 },
      { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
    ],
    crew: CANONICAL_CREW.map((member) => ({ personId: member.personId, role: member.role })),
    callTimes: [
      { personId: 'PERSON-MODEL', callLocal: '06:30' },
      { personId: 'PERSON-HMU', callLocal: '06:30' },
      { personId: 'PERSON-PHOTO-ASSISTANT', callLocal: '06:30' },
    ],
    departures: [{ transferActivityId: 'ACT-DEPART-GOTHIC', departureLocal: '06:40' }],
    activityAssignments: [{ activityId: 'ACT-GOTHIC-SETUP', assignedPersonIds: SETUP_ASSIGNEES }],
    departureAssignments: [
      { activityId: 'ACT-DEPART-GOTHIC', assignedPersonIds: DEPARTURE_ASSIGNEES },
    ],
  };
}

function optionB(): CommunicationAudienceInput {
  return {
    ...optionA(),
    interventions: [{ kind: 'ADD_BUFFER', beforeActivityId: 'ACT-EIXAMPLE-SETUP', minutes: 10 }],
  };
}

function optionC(): CommunicationAudienceInput {
  return {
    ...optionA(),
    interventions: [],
  };
}

function requireAudience(input: CommunicationAudienceInput): AffectedAudience {
  const result = deriveAffectedAudience(input);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.issues.join(','));
  }
  return result.audience;
}

function crewIds(input: CommunicationAudienceInput): readonly string[] {
  return input.crew.map((member) => member.personId);
}

function approvedPayloads(audience: AffectedAudience): BoundedNotificationPayload[] {
  return audience.obligations.map((obligation) => ({
    recipientPersonId: obligation.recipientPersonId,
    recipientRole: obligation.recipientRole,
    changeType: obligation.changeType,
    oldValue: obligation.oldValue,
    newValue: obligation.newValue,
    reasonCode: obligation.reasonCode,
    requiredAction: obligation.requiredAction,
    approvedText: renderApprovedText(obligation),
  }));
}

function implementationSource(): string {
  return readdirSync(SOURCE_DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(join(SOURCE_DIRECTORY, name), 'utf8'))
    .join('\n');
}

function packageSource(packageName: string): string {
  const directory = join(REPO_ROOT, 'packages', packageName, 'src');
  return readdirSync(directory, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => readFileSync(join(directory, entry), 'utf8'))
    .join('\n');
}

describe('communication audience policy', () => {
  it('derives the canonical Option A audience in stable order', () => {
    const input = optionA();
    const audience = requireAudience(input);
    expect(audience.policyVersion).toBe(COMMUNICATION_AUDIENCE_POLICY_VERSION);
    expect(audience.policyVersion).toBe('SR-COMMUNICATION-AUDIENCE-v1.0');
    expect(CANONICAL_COORDINATION_ROLE).toBe('PRODUCTION_LEAD');
    expect(audience.affectedRecipients).toEqual([
      'PERSON-PRODUCTION-LEAD',
      'PERSON-HMU',
      'PERSON-MODEL',
      'PERSON-PHOTO-ASSISTANT',
    ]);
    expect(audience.obligations).toEqual([
      {
        recipientPersonId: 'PERSON-PRODUCTION-LEAD',
        recipientRole: 'PRODUCTION_LEAD',
        changeType: 'LOAD_OUT_UPDATED',
        oldValue: '06:40',
        newValue: '06:20',
        reasonCode: 'ADJUST_DEPARTURE',
        requiredAction: 'INFORMATION_ONLY',
      },
      {
        recipientPersonId: 'PERSON-HMU',
        recipientRole: 'HMU',
        changeType: 'CALL_TIME_UPDATED',
        oldValue: '06:30',
        newValue: '06:05',
        reasonCode: 'ADJUST_CALL_TIME',
        requiredAction: 'CONFIRM_UPDATED_CALL',
      },
      {
        recipientPersonId: 'PERSON-MODEL',
        recipientRole: 'MODEL',
        changeType: 'CALL_TIME_UPDATED',
        oldValue: '06:30',
        newValue: '06:05',
        reasonCode: 'ADJUST_CALL_TIME',
        requiredAction: 'CONFIRM_UPDATED_CALL',
      },
      {
        recipientPersonId: 'PERSON-PHOTO-ASSISTANT',
        recipientRole: 'PHOTO_ASSISTANT',
        changeType: 'CALL_TIME_UPDATED',
        oldValue: '06:30',
        newValue: '06:05',
        reasonCode: 'ADJUST_CALL_TIME',
        requiredAction: 'CONFIRM_UPDATED_CALL',
      },
    ]);
    const payloads = approvedPayloads(audience);
    expect(payloads).toHaveLength(4);
    expect(
      payloads.filter((payload) => payload.requiredAction === 'CONFIRM_UPDATED_CALL'),
    ).toHaveLength(3);
    expect(
      payloads.filter((payload) => payload.requiredAction === 'INFORMATION_ONLY'),
    ).toHaveLength(1);
    expect(CREW_DISRUPTION_EIGHT).toHaveLength(8);
    expect(audience.affectedRecipients).not.toEqual(CREW_DISRUPTION_EIGHT);
    expect(
      CREW_DISRUPTION_EIGHT.filter((personId) => !audience.affectedRecipients.includes(personId)),
    ).toEqual([
      'PERSON-DIGITAL-TECH',
      'PERSON-MOTION-OPERATOR',
      'PERSON-PRODUCTION-ASSISTANT',
      'PERSON-STYLIST',
    ]);
  });

  it('keeps the same audience when intervention and crew order change', () => {
    const shuffled: CommunicationAudienceInput = {
      ...optionA(),
      interventions: [
        { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-PHOTO-ASSISTANT', deltaMinutes: -25 },
        { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
        { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 },
        { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: -25 },
        { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-HMU', deltaMinutes: -25 },
      ],
      crew: [...optionA().crew].reverse(),
    };
    expect(requireAudience(shuffled).affectedRecipients).toEqual(
      requireAudience(optionA()).affectedRecipients,
    );
  });

  it('does not notify shared setup assignees for SHIFT_ACTIVITY alone', () => {
    const input: CommunicationAudienceInput = {
      ...optionA(),
      interventions: [
        { kind: 'SHIFT_ACTIVITY', activityId: 'ACT-GOTHIC-SETUP', deltaMinutes: -25 },
      ],
    };
    expect(requireAudience(input).affectedRecipients).toEqual([]);
    expect(requireAudience(input).obligations).toEqual([]);
  });

  it('does not notify shared departure assignees who are not the production lead', () => {
    const input: CommunicationAudienceInput = {
      ...optionA(),
      interventions: [
        { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
      ],
    };
    const audience = requireAudience(input);
    expect(audience.affectedRecipients).toEqual(['PERSON-PRODUCTION-LEAD']);
    expect(audience.obligations.map((obligation) => obligation.changeType)).toEqual([
      'LOAD_OUT_UPDATED',
    ]);
    expect(audience.affectedRecipients).not.toContain('PERSON-STYLIST');
    expect(audience.affectedRecipients).not.toContain('PERSON-DIGITAL-TECH');
  });

  it('returns an empty audience for buffer-only Option B and empty Option C', () => {
    expect(requireAudience(optionB())).toEqual({
      policyVersion: 'SR-COMMUNICATION-AUDIENCE-v1.0',
      affectedRecipients: [],
      obligations: [],
    });
    expect(requireAudience(optionC())).toEqual(requireAudience(optionB()));
    const buffer = bindProposalCommunications(CONTEXT, optionB(), []);
    const empty = bindProposalCommunications(CONTEXT, optionC(), []);
    expect(buffer.ok).toBe(true);
    expect(empty.ok).toBe(true);
    if (!buffer.ok || !empty.ok) {
      throw new Error('expected empty communication bindings');
    }
    expect(buffer.affectedRecipients).toEqual([]);
    expect(buffer.notificationPayloads).toEqual([]);
    expect(empty.affectedRecipients).toEqual([]);
    expect(empty.notificationPayloads).toEqual([]);
    expect(buffer.fingerprint).toBe(createProposalFingerprint(buffer.proposal));
    expect(empty.fingerprint).toBe(createProposalFingerprint(empty.proposal));
    expect(buffer.fingerprint).not.toBe(empty.fingerprint);
  });

  it('selects the production lead by role token, not by person id', () => {
    const input: CommunicationAudienceInput = {
      interventions: [
        { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-COORDINATOR', deltaMinutes: -15 },
        { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-MOVE-01', deltaMinutes: -10 },
      ],
      crew: [
        { personId: 'PERSON-WALKER', role: 'WALKER' },
        { personId: 'PERSON-COORDINATOR', role: 'PRODUCTION_LEAD' },
      ],
      callTimes: [{ personId: 'PERSON-COORDINATOR', callLocal: '07:00' }],
      departures: [{ transferActivityId: 'ACT-MOVE-01', departureLocal: '07:30' }],
      departureAssignments: [
        {
          activityId: 'ACT-MOVE-01',
          assignedPersonIds: ['PERSON-COORDINATOR', 'PERSON-WALKER'],
        },
      ],
    };
    const audience = requireAudience(input);
    expect(audience.affectedRecipients).toEqual(['PERSON-COORDINATOR']);
    expect(audience.obligations.map((obligation) => obligation.requiredAction)).toEqual([
      'INFORMATION_ONLY',
      'CONFIRM_UPDATED_CALL',
    ]);
    expect(audience.obligations[0]?.newValue).toBe('07:20');
    expect(audience.obligations[1]?.newValue).toBe('06:45');
    expect(audience.affectedRecipients).not.toContain('PERSON-WALKER');
  });
});

describe('audience fail closed', () => {
  it('rejects an unknown call-time person', () => {
    const input: CommunicationAudienceInput = {
      ...optionC(),
      interventions: [{ kind: 'ADJUST_CALL_TIME', personId: 'PERSON-UNKNOWN', deltaMinutes: -25 }],
      callTimes: [{ personId: 'PERSON-UNKNOWN', callLocal: '06:30' }],
    };
    expect(deriveAffectedAudience(input)).toEqual({
      ok: false,
      issues: ['UNKNOWN_CALL_PERSON'],
    });
  });

  it('rejects a departure change with no production lead', () => {
    const input: CommunicationAudienceInput = {
      interventions: [
        { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
      ],
      crew: [{ personId: 'PERSON-MODEL', role: 'MODEL' }],
      callTimes: [],
      departures: [{ transferActivityId: 'ACT-DEPART-GOTHIC', departureLocal: '06:40' }],
    };
    expect(deriveAffectedAudience(input)).toEqual({
      ok: false,
      issues: ['MISSING_PRODUCTION_LEAD'],
    });
  });

  it('rejects more than one production lead when a departure changes', () => {
    const input: CommunicationAudienceInput = {
      interventions: [
        { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
      ],
      crew: [
        { personId: 'PERSON-LEAD-ONE', role: 'PRODUCTION_LEAD' },
        { personId: 'PERSON-LEAD-TWO', role: 'PRODUCTION_LEAD' },
      ],
      callTimes: [],
      departures: [{ transferActivityId: 'ACT-DEPART-GOTHIC', departureLocal: '06:40' }],
    };
    const result = deriveAffectedAudience(input);
    expect(result).toEqual({ ok: false, issues: ['MULTIPLE_PRODUCTION_LEADS'] });
    expect(result).not.toHaveProperty('audience');
  });

  it('does not parse a fixture display title as the canonical lead role', () => {
    const input: CommunicationAudienceInput = {
      interventions: [
        { kind: 'ADJUST_DEPARTURE', transferActivityId: 'ACT-DEPART-GOTHIC', deltaMinutes: -20 },
      ],
      crew: [{ personId: 'PERSON-PRODUCTION-LEAD', role: 'Production Lead / Photographer' }],
      callTimes: [],
      departures: [{ transferActivityId: 'ACT-DEPART-GOTHIC', departureLocal: '06:40' }],
    };
    expect(deriveAffectedAudience(input)).toEqual({
      ok: false,
      issues: ['INVALID_CREW_ROLE', 'MISSING_PRODUCTION_LEAD'],
    });
  });

  it('rejects a call shift that leaves the local day', () => {
    const input: CommunicationAudienceInput = {
      interventions: [{ kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 }],
      crew: [{ personId: 'PERSON-MODEL', role: 'MODEL' }],
      callTimes: [{ personId: 'PERSON-MODEL', callLocal: '00:10' }],
      departures: [],
    };
    expect(deriveAffectedAudience(input)).toEqual({
      ok: false,
      issues: ['TIME_OUT_OF_RANGE'],
    });
  });

  it('rejects a second call obligation for the same person', () => {
    const input: CommunicationAudienceInput = {
      interventions: [
        { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 },
        { kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 },
      ],
      crew: [{ personId: 'PERSON-MODEL', role: 'MODEL' }],
      callTimes: [{ personId: 'PERSON-MODEL', callLocal: '06:30' }],
      departures: [],
    };
    expect(deriveAffectedAudience(input)).toEqual({
      ok: false,
      issues: ['DUPLICATE_CALL_OBLIGATION'],
    });
  });

  it('rejects a malformed intervention without producing an audience', () => {
    const input = {
      ...optionA(),
      interventions: [{ kind: 'SHIFT_ACTIVITY' }],
    } as unknown as CommunicationAudienceInput;
    expect(deriveAffectedAudience(input)).toEqual({
      ok: false,
      issues: ['INVALID_INTERVENTION'],
    });
  });
});

describe('bounded payload draft', () => {
  it('binds the canonical four payloads and rejects the whole set when one contradicts', () => {
    const input = optionA();
    const audience = requireAudience(input);
    const payloads = approvedPayloads(audience);
    const draft = draftBoundCommunications(audience, [...payloads].reverse(), crewIds(input));
    expect(draft.ok).toBe(true);
    if (!draft.ok) {
      throw new Error(draft.issues.join(','));
    }
    expect(draft.affectedRecipients).toEqual(audience.affectedRecipients);
    expect(draft.notificationPayloads.map((payload) => payload.recipientPersonId)).toEqual(
      audience.affectedRecipients,
    );
    expect(Object.keys(draft.notificationPayloads[0] ?? {})).toEqual([
      'recipientPersonId',
      'recipientRole',
      'changeType',
      'oldValue',
      'newValue',
      'reasonCode',
      'requiredAction',
      'approvedText',
    ]);
    expect(draft.notificationPayloads[1]?.approvedText).toBe(
      'PERSON-HMU role HMU: call time updated from 06:30 to 06:05. Reason ADJUST_CALL_TIME. Required action CONFIRM_UPDATED_CALL.',
    );

    const contradicted = payloads.map((payload, index) =>
      index === 2
        ? { ...payload, approvedText: payload.approvedText.replace('06:05', '06:15') }
        : payload,
    );
    const rejected = draftBoundCommunications(audience, contradicted, crewIds(input));
    expect(rejected).toEqual({ ok: false, issues: ['MESSAGE_PAYLOAD_CONTRADICTION'] });
    expect(rejected).not.toHaveProperty('notificationPayloads');
  });

  it('rejects text that states 06:15 when the structured new call is 05:55', () => {
    const input: CommunicationAudienceInput = {
      interventions: [{ kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 }],
      crew: [
        { personId: 'PERSON-MODEL', role: 'MODEL' },
        { personId: 'PERSON-PRODUCTION-LEAD', role: 'PRODUCTION_LEAD' },
      ],
      callTimes: [{ personId: 'PERSON-MODEL', callLocal: '06:20' }],
      departures: [],
    };
    const audience = requireAudience(input);
    const [payload] = approvedPayloads(audience);
    if (payload === undefined) {
      throw new Error('missing payload');
    }
    expect(payload.newValue).toBe('05:55');
    expect(payload.oldValue).toBe('06:20');
    const rejected = draftBoundCommunications(
      audience,
      [{ ...payload, approvedText: payload.approvedText.replace('05:55', '06:15') }],
      crewIds(input),
    );
    expect(rejected).toEqual({ ok: false, issues: ['MESSAGE_PAYLOAD_CONTRADICTION'] });
  });

  it('rejects a stated old time, recipient, or action that disagrees with the structured facts', () => {
    const input: CommunicationAudienceInput = {
      interventions: [{ kind: 'ADJUST_CALL_TIME', personId: 'PERSON-MODEL', deltaMinutes: -25 }],
      crew: [{ personId: 'PERSON-MODEL', role: 'MODEL' }],
      callTimes: [{ personId: 'PERSON-MODEL', callLocal: '06:20' }],
      departures: [],
    };
    const audience = requireAudience(input);
    const [payload] = approvedPayloads(audience);
    if (payload === undefined) {
      throw new Error('missing payload');
    }
    expect(
      draftBoundCommunications(
        audience,
        [{ ...payload, approvedText: payload.approvedText.replace('06:20', '06:00') }],
        crewIds(input),
      ),
    ).toEqual({ ok: false, issues: ['MESSAGE_PAYLOAD_CONTRADICTION'] });
    expect(
      draftBoundCommunications(
        audience,
        [
          {
            ...payload,
            approvedText: payload.approvedText.replace('PERSON-MODEL', 'PERSON-OTHER'),
          },
        ],
        crewIds(input),
      ),
    ).toEqual({ ok: false, issues: ['MESSAGE_PAYLOAD_CONTRADICTION'] });
    expect(
      draftBoundCommunications(
        audience,
        [
          {
            ...payload,
            approvedText: payload.approvedText.replace('CONFIRM_UPDATED_CALL', 'INFORMATION_ONLY'),
          },
        ],
        crewIds(input),
      ),
    ).toEqual({ ok: false, issues: ['MESSAGE_PAYLOAD_CONTRADICTION'] });
  });

  it('rejects missing text, unrelated recipients, unknown recipients, and duplicates', () => {
    const input = optionA();
    const audience = requireAudience(input);
    const payloads = approvedPayloads(audience);
    const first = payloads[0];
    if (first === undefined) {
      throw new Error('missing payload');
    }
    expect(
      draftBoundCommunications(
        audience,
        payloads.map((payload, index) =>
          index === 0 ? { ...payload, approvedText: '' } : payload,
        ),
        crewIds(input),
      ),
    ).toEqual({ ok: false, issues: ['MISSING_TEXT'] });

    const unrelatedFacts = {
      recipientPersonId: 'PERSON-STYLIST',
      recipientRole: 'STYLIST',
      changeType: 'CALL_TIME_UPDATED' as const,
      oldValue: '06:30',
      newValue: '06:05',
      reasonCode: 'ADJUST_CALL_TIME',
      requiredAction: 'CONFIRM_UPDATED_CALL' as const,
    };
    expect(
      draftBoundCommunications(
        audience,
        [...payloads, { ...unrelatedFacts, approvedText: renderApprovedText(unrelatedFacts) }],
        crewIds(input),
      ),
    ).toEqual({ ok: false, issues: ['UNRELATED_RECIPIENT'] });

    const unknownFacts = {
      recipientPersonId: 'PERSON-OUTSIDER',
      recipientRole: 'VISITOR',
      changeType: 'CALL_TIME_UPDATED' as const,
      oldValue: '06:30',
      newValue: '06:05',
      reasonCode: 'ADJUST_CALL_TIME',
      requiredAction: 'CONFIRM_UPDATED_CALL' as const,
    };
    expect(
      draftBoundCommunications(
        audience,
        [...payloads, { ...unknownFacts, approvedText: renderApprovedText(unknownFacts) }],
        crewIds(input),
      ),
    ).toEqual({ ok: false, issues: ['UNKNOWN_RECIPIENT', 'UNRELATED_RECIPIENT'] });

    expect(draftBoundCommunications(audience, [...payloads, first], crewIds(input))).toEqual({
      ok: false,
      issues: ['DUPLICATE_PAYLOAD'],
    });
  });
});

describe('proposal communication adapter', () => {
  it('uses the authority fingerprint and changes it when bound facts change', () => {
    const input = optionA();
    const audience = requireAudience(input);
    const bound = bindProposalCommunications(CONTEXT, input, approvedPayloads(audience));
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      throw new Error(bound.issues.join(','));
    }
    expect(bound.fingerprint).toBe(createProposalFingerprint(bound.proposal));
    expect(bound.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const repeated = bindProposalCommunications(CONTEXT, input, approvedPayloads(audience));
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) {
      throw new Error(repeated.issues.join(','));
    }
    expect(repeated.fingerprint).toBe(bound.fingerprint);

    const recipientChanged: AuthorityProposal = {
      ...bound.proposal,
      affectedRecipients: bound.affectedRecipients.map((personId, index) =>
        index === 0 ? 'PERSON-OTHER-LEAD' : personId,
      ),
    };
    expect(createProposalFingerprint(recipientChanged)).not.toBe(bound.fingerprint);

    const original = bound.notificationPayloads[1];
    if (original === undefined) {
      throw new Error('missing payload');
    }
    const textChanged: AuthorityProposal = {
      ...bound.proposal,
      notificationPayloads: bound.notificationPayloads.map((payload, index) =>
        index === 1 ? { ...original, approvedText: `${original.approvedText} extra` } : payload,
      ),
    };
    const valueChanged: AuthorityProposal = {
      ...bound.proposal,
      notificationPayloads: bound.notificationPayloads.map((payload, index) =>
        index === 1 ? { ...original, newValue: '05:55' } : payload,
      ),
    };
    const actionChanged: AuthorityProposal = {
      ...bound.proposal,
      notificationPayloads: bound.notificationPayloads.map((payload, index) =>
        index === 1 ? { ...original, requiredAction: 'INFORMATION_ONLY' } : payload,
      ),
    };
    expect(createProposalFingerprint(textChanged)).not.toBe(bound.fingerprint);
    expect(createProposalFingerprint(valueChanged)).not.toBe(bound.fingerprint);
    expect(createProposalFingerprint(actionChanged)).not.toBe(bound.fingerprint);

    const reorderedPayloads = bound.notificationPayloads.map((payload) => {
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(payload).reverse()) {
        copy[key] = payload[key as keyof BoundedNotificationPayload];
      }
      return copy;
    });
    const keyOrderChanged: AuthorityProposal = {
      predictedEffects: bound.proposal.predictedEffects,
      notificationPayloads: reorderedPayloads,
      affectedRecipients: bound.proposal.affectedRecipients,
      interventions: bound.proposal.interventions,
      policyVersion: bound.proposal.policyVersion,
      baseGraphRevision: bound.proposal.baseGraphRevision,
      baseProductionRevision: bound.proposal.baseProductionRevision,
      proposalId: bound.proposal.proposalId,
      productionId: bound.proposal.productionId,
      accountId: bound.proposal.accountId,
    };
    expect(createProposalFingerprint(keyOrderChanged)).toBe(bound.fingerprint);
  });

  it('does not send, store an acknowledgement, or resolve a destination', () => {
    const input = optionA();
    const bound = bindProposalCommunications(
      CONTEXT,
      input,
      approvedPayloads(requireAudience(input)),
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      throw new Error(bound.issues.join(','));
    }
    expect(bound.proposal).not.toHaveProperty('destination');
    expect(bound.notificationPayloads[0]).not.toHaveProperty('channel');
    expect(bound.notificationPayloads[0]).not.toHaveProperty('status');
    expect(JSON.stringify(bound)).not.toContain('BEDROCK');
  });
});

describe('determinism and boundaries', () => {
  it('does not mutate inputs and repeats the same audience', () => {
    const input = optionA();
    const payloads = approvedPayloads(requireAudience(input));
    const before = JSON.stringify({ input, payloads, CONTEXT });
    const interventions = input.interventions;
    const crew = input.crew;
    const first = deriveAffectedAudience(input);
    const second = deriveAffectedAudience(input);
    bindProposalCommunications(CONTEXT, input, payloads);
    expect(JSON.stringify({ input, payloads, CONTEXT })).toBe(before);
    expect(input.interventions).toBe(interventions);
    expect(input.crew).toBe(crew);
    expect(second).toEqual(first);
    expect(Object.isFrozen(input.interventions)).toBe(false);
  });

  it('keeps audience selection generic and dependency direction one-way', () => {
    const source = implementationSource();
    expect(source).not.toMatch(/PERSON-[A-Z0-9-]+/);
    expect(source).not.toMatch(/OPTION-[A-Z]/);
    expect(source).not.toMatch(/bedrock/i);
    expect(source).not.toContain('@aws-sdk');
    expect(source).not.toContain('createHash');
    expect(source).not.toContain('sha256');
    expect(source).not.toContain('@sceneready/agent');
    expect(source).not.toContain('@sceneready/authority');
    expect(source).not.toContain('@sceneready/recovery-outcomes');
    expect(source).not.toContain('@sceneready/shadow-simulation');
    expect(source).not.toContain('evaluateCrewDisruption');
    expect(source).toContain('createProposalFingerprint');
    expect(source).toContain('PRODUCTION_LEAD');
    const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(specifiers.every((specifier) => specifier !== undefined)).toBe(true);
    for (const specifier of specifiers) {
      expect(
        specifier === '@sceneready/intervention-engine' ||
          specifier === '@sceneready/mcp-human-authority' ||
          specifier?.startsWith('.'),
      ).toBe(true);
    }
    const manifest = JSON.parse(
      readFileSync(join(SOURCE_DIRECTORY, '../package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@sceneready/intervention-engine',
      '@sceneready/mcp-human-authority',
    ]);
    for (const packageName of [
      'intervention-engine',
      'mcp-human-authority',
      'authority',
      'recovery-outcomes',
      'shadow-simulation',
    ]) {
      const dependencyManifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', packageName, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      expect(dependencyManifest.dependencies?.['@sceneready/communications']).toBeUndefined();
      expect(dependencyManifest.devDependencies?.['@sceneready/communications']).toBeUndefined();
    }
    expect(packageSource('intervention-engine')).not.toContain('@sceneready/communications');
    expect(packageSource('mcp-human-authority')).not.toContain('@sceneready/communications');
  });
});
