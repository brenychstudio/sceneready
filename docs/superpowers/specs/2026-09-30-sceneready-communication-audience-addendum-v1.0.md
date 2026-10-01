# SceneReady Communication Audience Policy

TITLE=SceneReady Communication Audience Policy
STATUS=APPROVED_VERSIONED_AMENDMENT
DATE=30 September 2026
POLICY_VERSION=SR-COMMUNICATION-AUDIENCE-v1.0
BASE_CANONICAL_DESIGN=SceneReady Canonical Design v1.0

This addendum is an approved versioned amendment. It does not edit Canonical
Design v1.0 or Implementation Interpretations v1.0. Those files stay
checksum-frozen. It does not replace either document.

Policy version: `SR-COMMUNICATION-AUDIENCE-v1.0`.

Canonical Design v1.0 states the communications principle as impact-derived
audience, bounded message draft, and exact payload approval. It does not state
the generic rule that turns interventions into direct notification obligations.
SR-03 separately certifies crew disruption. That metric is not this audience.
This amendment records the human decision and binds Task 3 to it.

## 1. Reason for amendment

Certified demo data expects notification delivery of 4/4 and critical
acknowledgements of 3/3. The accepted sources did not define a generic selector
that produces that four-person direct audience while leaving the eight-person
crew-disruption set unchanged.

No person id, option id, or fixture display title is the rule. The rule below
is the only Task 3 audience rule.

## 2. Difference between crew disruption and notification obligation

Crew disruption and direct notification are different facts.

A person can be operationally affected without receiving a direct notification.
Assignment to an activity, a departure, a deliverable, or a crew-disruption set
does not create a notification obligation.

SR-03 `crewDisruption` for canonical Option A remains an eight-person affected
set under `SR-CREW-DISRUPTION-v1`. This policy does not read, write, or narrow
that set. The direct Task 3 audience is derived only from the rules in sections
3 through 7.

## 3. ADJUST_CALL_TIME rule

For every accepted `ADJUST_CALL_TIME` intervention:

- the named person receives one direct notification obligation;
- `changeType` is `CALL_TIME_UPDATED`;
- `requiredAction` is `CONFIRM_UPDATED_CALL`;
- `reasonCode` is `ADJUST_CALL_TIME`;
- `oldValue` is the caller-supplied call baseline for that person;
- `newValue` is that baseline shifted by the intervention's `deltaMinutes`.

The named person must already be present in the supplied crew. An unknown
person fails closed. A missing or ambiguous call baseline fails closed. A
second call-time obligation for the same person fails closed. A shift that
leaves the local production day fails closed. This policy does not invent a
clock.

## 4. ADJUST_DEPARTURE coordination-owner rule

For every accepted `ADJUST_DEPARTURE` intervention, the one crew member whose
canonical role token is exactly `PRODUCTION_LEAD` receives one coordination
notification obligation.

- `changeType` is `LOAD_OUT_UPDATED`;
- `requiredAction` is `INFORMATION_ONLY`;
- `reasonCode` is `ADJUST_DEPARTURE`;
- `oldValue` is the caller-supplied departure baseline for that transfer
  activity;
- `newValue` is that baseline shifted by the intervention's `deltaMinutes`.

`PRODUCTION_LEAD` is an exact role token supplied on the crew record. Fixture
display titles are not parsed. Person ids are not inspected to discover the
lead.

Fail closed when a departure change exists and the crew contains zero
`PRODUCTION_LEAD` members. Fail closed when the crew contains more than one
`PRODUCTION_LEAD` member. Fail closed when the departure baseline is missing,
duplicated, or outside the local production day. Other people assigned to the
same departure do not receive this obligation.

## 5. SHIFT_ACTIVITY non-expansion rule

`SHIFT_ACTIVITY` alone does not create a direct Task 3 notification obligation.

Its broader operational effect can still contribute to crew disruption. It does
not add the activity's assignees to the direct audience, including when those
assignees are supplied beside the intervention.

## 6. ADD_BUFFER non-expansion rule

`ADD_BUFFER` alone creates no direct notification obligation.

No buffer assignee, predecessor, or successor is added to the audience.

## 7. Deduplication and stable ordering

Audience identity is deduplicated by `personId`.

A person who is both the coordination owner and the subject of a personal call
change appears once in the audience and keeps both obligations.

Payload order, which the proposal fingerprint treats as significant, is:

1. coordination-owner notifications, sorted by transfer activity id;
2. direct personal-call notifications, sorted by `personId`.

Recipient order uses the same two buckets. A person already emitted as the
coordination owner is not emitted again in the personal-call bucket.

No other ordering is allowed.

## 8. Canonical Option A four-person proof

Canonical Option A contains:

- `SHIFT_ACTIVITY` for Gothic setup;
- `ADJUST_CALL_TIME` for the model;
- `ADJUST_CALL_TIME` for hair and makeup;
- `ADJUST_CALL_TIME` for the photo assistant;
- `ADJUST_DEPARTURE` for the Gothic departure.

Applied to crew whose canonical roles include one `PRODUCTION_LEAD`, the rules
above produce exactly these recipients, in this order:

```text
PERSON-PRODUCTION-LEAD
PERSON-HMU
PERSON-MODEL
PERSON-PHOTO-ASSISTANT
```

The production lead is present because that member's role is `PRODUCTION_LEAD`
and a departure change exists. The model, hair and makeup, and photo assistant
are present because each is the named subject of an `ADJUST_CALL_TIME`. They
are ordered by person id.

The Gothic setup shift does not add the digital tech or the production
assistant. The shared departure assignment does not add the stylist, the
motion operator, or any other departure assignee.

The same rules produce an empty audience for Option B, which is only
`ADD_BUFFER`, and for Option C, which has no interventions.

## 9. Compatibility with 4/4 notifications and 3/3 required acknowledgements

Those four obligations are:

```text
3 x CALL_TIME_UPDATED / CONFIRM_UPDATED_CALL
1 x LOAD_OUT_UPDATED / INFORMATION_ONLY
```

That shape is compatible with later canonical execution evidence of notification
delivery 4/4 and critical acknowledgements 3/3. The three call obligations are
the critical acknowledgement set. The load-out obligation is information only.

Task 3 does not implement delivery, acknowledgement, retry, or receipt state.
It only creates the exact obligations and payloads those later counts can
describe.

## 10. No delivery destination resolution

A payload names a person, a canonical role, a change type, the old value, the
new value, a reason code, a required action, and approved text.

It does not name a channel, address, phone number, mailbox, provider, or
destination. Task 3 does not send, queue, or resolve a route.

## 11. No Bedrock authority over structured facts

Structured fields own the truth:

```text
recipient
role
changeType
oldValue
newValue
reasonCode
requiredAction
```

`approvedText` must equal one of these templates, with those fields
interpolated and with no other wording:

```text
{recipientPersonId} role {recipientRole}: call time updated from {oldValue} to {newValue}. Reason {reasonCode}. Required action {requiredAction}.
```

```text
{recipientPersonId} role {recipientRole}: load-out updated from {oldValue} to {newValue}. Reason {reasonCode}. Required action {requiredAction}.
```

The call template is valid only for `CALL_TIME_UPDATED`, reason
`ADJUST_CALL_TIME`, and action `CONFIRM_UPDATED_CALL`. The load-out template is
valid only for `LOAD_OUT_UPDATED`, reason `ADJUST_DEPARTURE`, and action
`INFORMATION_ONLY`.

Anything else, including a stated clock that disagrees with `oldValue` or
`newValue`, is `MESSAGE_PAYLOAD_CONTRADICTION`. Blank text is `MISSING_TEXT`.
Task 3 does not call Bedrock and does not use a model to judge prose. A later
wording layer may supply text only when this deterministic check accepts it.

A payload for a person outside the derived audience is `UNRELATED_RECIPIENT`.
A payload for a person who is not crew is also `UNKNOWN_RECIPIENT`. Neither
case drops the payload quietly or widens the audience. One invalid payload
rejects the whole draft set.

## 12. No change to SR-03 recovery-outcome metrics

This amendment does not change creative preservation, crew disruption, schedule
stability, logistics impact, readiness, ranking, shadow simulation, or the
Barcelona fixture.

`crewDisruption` stays `SR-CREW-DISRUPTION-v1`. Canonical Option A still affects
eight people under that metric. Those eight are not redefined as the
notification audience. Recovery-outcome packages, shadow simulation, and
fixtures are outside Task 3.
