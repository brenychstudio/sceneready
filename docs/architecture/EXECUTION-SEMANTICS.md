# Execution Semantics

This document records the SR-04 execution behavior the repository implements:
one in-memory mutation lane, an append-only ledger, a durable outbox, idempotent
sandbox delivery, and forward-only compensation. It does not send real messages
and it does not claim AWS or BDB.

## One mutation lane

Authoritative production state changes only inside `commitUnlocked`, under the
lock for one account, production, and authority namespace.
`applyConditionalRevision` and `applyApprovedProductionRevision` both authorize
through that lock and then use that commit. There is no second write of
production state.

The approved commit contains all of the following, or none of them:

- the next production state
- the production revision incremented by one
- the consumed approval token
- one append-only `REVISION_APPLIED` ledger event
- every outbox job derived from the approved `notificationPayloads`

An injected failure before the commit write leaves the revision, token, ledger,
and outbox as they were. The state transaction does not deliver messages.

A caller cannot skip verification with a boolean. Identifiers such as
`executionId` and `ledgerEventId` are caller-supplied. The lane does not read a
clock and does not generate a random id.

## Optimistic revision gate

The commit requires the stored production revision and the stored graph revision
to equal the revisions bound in the approval. Either mismatch is
`BASE_REVISION_STALE`. The token is not consumed and production state is not
written.

The in-memory store can record a newer graph revision without an approval,
because that revision is an upstream graph fact rather than a production-state
change. It cannot move backward. Execution of an approval bound to the older
graph revision then fails closed.

## Ledger and outbox

Ledger events are appended. This tranche has no API that rewrites or deletes
applied history. A later revision adds another event. The earlier event stays.

Outbox identity is the execution id, the payload index, and the recipient person
id. Jobs are copied from the approved payloads and start `PENDING`.
`CONFIRM_UPDATED_CALL` becomes `REQUIRED_CRITICAL`. `INFORMATION_ONLY` becomes
`INFORMATIONAL`. Any other required action is rejected and the commit does not
proceed.

Canonical Option A therefore commits four pending jobs: three critical call
confirmations and one informational departure notice.

## Idempotent delivery and acknowledgement

`SandboxNotificationTracker` calls an injected adapter. It does not look up
contacts and it does not send email, SMS, or device messages. A second delivery
of the same idempotency key returns `ALREADY_DELIVERED` and does not call the
adapter again.

`DELIVERED` is not `CONFIRMED`. Acknowledgement starts at `PENDING`. A receipt
is `COMPLETE` only when every job is delivered, every `REQUIRED` and
`REQUIRED_CRITICAL` acknowledgement is `CONFIRMED`, and no acknowledgement is
`CANNOT_COMPLY`. Informational acknowledgements do not block completion.

Three delivered jobs of four is `PARTIALLY_COMPLETED`. Four delivered jobs with
one critical acknowledgement still pending is not `COMPLETE`.

## Cannot comply

`CANNOT_COMPLY` is not treated as `CONFIRMED`. The receipt stays incomplete and
`requiresGraphRecompute` is true. The communications package sets that signal
only. It does not recompute the graph, approve a proposal, or write production
state.

## Forward recovery

Applied history is not erased. `prepareCompensatingProposal` builds a new
proposal whose base production revision and base graph revision are the current
revisions. It does not apply that proposal, consume a token, append the ledger,
or send.

Mechanical inverses are constructed only for the delta kinds the accepted
intervention schema allows in both directions: `SHIFT_ACTIVITY`,
`ADJUST_CALL_TIME`, and `ADJUST_DEPARTURE`. Other kinds keep the intervention
engine's reversibility class (`REVERSIBLE_BY_NEW_REVISION`,
`CORRECTIVE_ACTION_REQUIRED`, or `IRREVERSIBLE`) and do not receive an invented
inverse.

`REVERSIBILITY_DISCLOSURE` and `SEND_CORRECTIVE_NOTIFICATION` are stored in
`predictedEffects`. That field is already inside the proposal fingerprint, so a
relabelled disclosure does not match the approved hash. Corrective notification
payloads go through the same communications binder as any other proposal. A
binder that changes an already communicated fact is rejected.

A compensating proposal still has to pass shadow simulation, an explicit human
challenge, bound approval, and this same mutation lane before it can commit.
Delivered notifications stay delivered. Compensation does not represent them as
unsent.

## Limits

The execution repository in this tranche is in memory. There is no network
client, no real contact, and no AWS adapter on this path. Timestamps and ids in
the proofs are explicit inputs.
