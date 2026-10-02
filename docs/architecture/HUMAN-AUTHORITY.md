# Human Authority

This document records the SR-04 human-authority behavior the repository implements.
It does not add a capability. Real identity providers, KMS, live notification
channels, AWS, and BDB verification are outside this document.

## Read, analyze, simulate, and propose

Reading evidence, analyzing a graph, running shadow simulation, and drafting a
proposal do not create an approval token and do not change authoritative
production state.

`createProposalFingerprint` hashes one proposal. The hash covers the account,
production, proposal id, production revision, graph revision, policy version,
interventions, affected recipients, notification payloads, and predicted
effects. A fingerprint is not an approval. Unknown proposal fields are rejected
rather than omitted.

`openApprovalChallenge` records an active challenge for that fingerprint. A
challenge is not approval. It does not sign.

## Explicit human approval

`confirmApprovalChallenge` signs only when `intent` is
`EXPLICIT_APPROVE_ACTIVE_PROPOSAL`. Any other intent, including ambiguous or
confident speech such as `SOUNDS_GOOD`, returns `NOT_APPROVED` with reason
`NO_EXPLICIT_APPROVAL`, a null token, and no call to the signer.

The signer is an injected `ApprovalSigner`. This repository does not contain a
production private key, KMS client, or secret.

## Bound approval

A signed approval fixes all of the following:

- account id
- production id
- `LIVE` or `REPLAY` namespace
- proposal id
- proposal fingerprint
- base production revision
- base graph revision
- policy version
- actor id and role
- caller-supplied issuance and expiry instants
- `singleUse: true`

Recipients and message payloads are inside the fingerprint. Changing either one
after approval changes the hash.

## One use, scope, and namespace

The mutation lane calls `ApprovalSigner.verify` inside the per-scope lock. A
caller-supplied verified flag is not an input and is not consulted. The token
must be unexpired at the caller-supplied `now`. The same token cannot commit
twice. Account, production, and namespace on the token must match the execution
scope. A token bound to one production or one namespace cannot execute in
another.

Expiry, replay, scope mismatch, namespace mismatch, and fingerprint mismatch
each deny before any production write and before the token is consumed.

## Role and namespace

Policy `SR-AUTHORITY-ROLE-NAMESPACE-v1.0`:

- `PRODUCTION_LEAD` approves only `LIVE`
- `DEMO_PRODUCTION_LEAD` approves only `REPLAY`
- `ASSISTANT` approves neither namespace
- there is no wildcard and no fallback

An assistant session can be shown a challenge. Confirmation returns `DENIED` /
`ROLE_NOT_AUTHORIZED` and does not sign. A claim whose role is not one of the
two approval roles is rejected at execution as `TOKEN_REJECTED` because it is
not a bound approval claim.

## Package boundary

`@sceneready/mcp-human-authority` is the reusable fingerprint, challenge, and
claims contract. It does not authenticate a person, choose a role, store a
token, or execute.

`@sceneready/authority` is the SceneReady caller. It owns the authenticated
session, the role policy, explicit confirmation, and the mutation lane.
`@sceneready/communications` binds the audience and the approved text that the
fingerprint covers. Those responsibilities stay in the callers.
