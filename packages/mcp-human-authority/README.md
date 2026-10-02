# MCP Human Authority

Reusable, standalone contract for binding a human approval to one exact proposal.
This package does not approve, execute, store secrets, or mutate a production.

Read, analyze, simulate, propose, and explain are non-authoritative capabilities.
Approve and execute require explicit human authority outside this package.

## What this package does

`createProposalFingerprint` hashes the canonical execution-significant proposal with SHA-256.
The fingerprint covers the account, production, proposal id, production revision, graph
revision, policy version, interventions, affected recipients, notification payloads, and
predicted effects. Object key order does not change the fingerprint. Array order does.
Unknown proposal fields are rejected rather than dropped, so an execution-significant field
cannot disappear from the hash by accident.

`createApprovalChallenge` records an active challenge for that fingerprint. A challenge is
not approval. It does not create approval claims and it does not sign anything. `LIVE` and
`REPLAY` are distinct namespaces. The caller injects `now`, `ttlSeconds`, and the challenge
id. This package does not read a clock and does not generate identifiers.

`BoundApprovalClaims` is data. `singleUse` is always `true`. The only claim roles are
`PRODUCTION_LEAD` and `DEMO_PRODUCTION_LEAD`. This package does not decide who may receive
those claims.

`ApprovalSigner` is a port. There is no production signer, private key, KMS client, or
secret in this package. Signing only packages claims that a caller has already authorized.

## What the caller owns

The caller owns identity, authentication, authorization, challenge storage, token storage,
and any later check that the fingerprint still matches the proposal presented for execution.
Approval is meaningful only when that exact fingerprint matches.

## SceneReady consumption

SceneReady calls this package from `@sceneready/authority` and `@sceneready/communications`.
The authority package opens a challenge, accepts only the explicit approval intent, and later
verifies the signed token inside the production mutation lane. The communications package binds
recipient payloads before that fingerprint is hashed. Those callers own sessions, role policy,
token consumption, and execution.

This package still does not authenticate a person, choose a role, store a token, approve, or
apply a production revision. There is no production signer here. See
`docs/architecture/HUMAN-AUTHORITY.md`.
