# SceneReady Authority Role and Namespace Policy

TITLE=SceneReady Authority Role and Namespace Policy
STATUS=APPROVED_VERSIONED_AMENDMENT
DATE=30 September 2026
BASE_CANONICAL_DESIGN=SceneReady Canonical Design v1.0
BASE_IMPLEMENTATION_INTERPRETATIONS=SceneReady Implementation Interpretations v1.0

This addendum is an approved versioned amendment. It does not edit Canonical
Design v1.0 or Implementation Interpretations v1.0. Those files stay
checksum-frozen. It does not replace either document. It decides one
authorization question that those sources left unspecified: which session role
may approve in which authority namespace.

Policy version: `SR-AUTHORITY-ROLE-NAMESPACE-v1.0`.

## 1. Reason for amendment

Canonical Design v1.0 says only `PRODUCTION_LEAD` approves, and that judge
authority is replay-scoped. Implementation Interpretations v1.0 say the human
confirmation route verifies authenticated `PRODUCTION_LEAD` authority. Neither
document names `DEMO_PRODUCTION_LEAD`, and neither states whether that role may
authorize `LIVE`.

`packages/mcp-human-authority` can carry `DEMO_PRODUCTION_LEAD` on bound
approval claims for either namespace. That package stores the role as data. It
does not decide who may receive the claims.

SR-04 Task 2 cannot invent that mapping. This amendment records the human
decision and binds the authority service to it.

## 2. Exact role × namespace matrix

| Role                   | LIVE  | REPLAY |
| ---------------------- | ----- | ------ |
| `PRODUCTION_LEAD`      | ALLOW | DENY   |
| `DEMO_PRODUCTION_LEAD` | DENY  | ALLOW  |
| `ASSISTANT`            | DENY  | DENY   |

Normative statements:

```text
DEMO_PRODUCTION_LEAD MUST NOT approve LIVE.

PRODUCTION_LEAD MUST NOT approve REPLAY.

DEMO_PRODUCTION_LEAD MAY approve only REPLAY.

PRODUCTION_LEAD MAY approve only LIVE.
```

`ASSISTANT` MUST NOT approve `LIVE`. `ASSISTANT` MUST NOT approve `REPLAY`.

No approval role is valid in both namespaces. There is no wildcard role and no
wildcard namespace. There is no fallback.

## 3. LIVE semantics

`LIVE` is real production authority.

`PRODUCTION_LEAD` is live-production authority only. A `PRODUCTION_LEAD` session
may approve only when the session namespace and the challenge namespace are
both `LIVE`, and every other Task 2 check passes.

`DEMO_PRODUCTION_LEAD` MUST NOT approve `LIVE`. A demo identity cannot authorize
a live production.

## 4. REPLAY semantics

`REPLAY` is the isolated disposable replay/demo namespace. It is the judge/demo
authority namespace for this policy.

`DEMO_PRODUCTION_LEAD` is isolated replay/demo authority only. A
`DEMO_PRODUCTION_LEAD` session may approve only when the session namespace and
the challenge namespace are both `REPLAY`, and every other Task 2 check passes.

`PRODUCTION_LEAD` MUST NOT approve `REPLAY`. A live production identity cannot
authorize replay/judge authority.

## 5. ASSISTANT prohibition

`ASSISTANT` never has approval authority.

An assistant session cannot receive bound approval claims. An assistant session
cannot produce an approval token. Explicit approval intent does not change
that. Natural-language positivity does not change that. Model confidence does
not change that.

## 6. No cross-namespace authority

`LIVE` and `REPLAY` authority are intentionally non-interchangeable.

A `LIVE` session MUST NOT confirm a `REPLAY` challenge. A `REPLAY` session MUST
NOT confirm a `LIVE` challenge. A token, role, or session from one namespace
MUST NOT be reused as authority for the other. No approval role is valid in
both namespaces.

## 7. `mcp-human-authority` remains policy-neutral

`packages/mcp-human-authority` remains reusable data and fingerprint
infrastructure. It does not own this SceneReady authorization policy. It does
not gain an approval-confirmation API. It does not import `packages/authority`.
This addendum does not change its accepted contract.

The claims type may still name `DEMO_PRODUCTION_LEAD` and either namespace.
That is a data contract. Issuing those claims is allowed only when this matrix
returns ALLOW. The matrix is stricter than the claims type on purpose.

## 8. Task 2 implementation binding

`packages/authority` enforces this matrix in `confirmApprovalChallenge()`.

Task 2 implements only:

```text
authenticated authority session validation
role/namespace policy
explicit approval confirmation
bound claim signing through an injected port
```

The only approving intent is `EXPLICIT_APPROVE_ACTIVE_PROPOSAL`. Any other
intent is not approval. This package does not classify approval with a model.

A structurally valid session, including `ASSISTANT`, may open a challenge when
the session account, production, and namespace match the proposal and the
requested namespace. Opening a challenge is not approval. Opening does not
sign, does not create claims, and does not issue a token. Confirmation remains
role-gated by the matrix above.

Issued claims set `singleUse` to true. Task 2 does not persist tokens and does
not consume them. Replay prevention is not implemented here. Consumed-token
enforcement belongs to later authoritative mutation-lane work.

`tokenId`, `now`, and approval-token TTL are caller input. This policy does
not define a hidden clock, a hidden identifier, or a hidden TTL.

Task 2 does not implement production execution, the mutation lane,
communications, an outbox, or AWS runtime.

## 9. No effect on SR-03 scoring/recovery contracts

This amendment does not change readiness scoring, evidence, shadow simulation,
intervention feasibility, recovery ranking, recovery outcomes, or the certified
SR-03 behavior. Those contracts stay as already accepted.

## 10. No AWS/Cognito implementation in this task

This amendment does not implement Cognito, OAuth, JWT parsing, AWS, session
persistence, or a production signer. An authenticated authority session is a
value that an upstream authentication layer has already resolved. Task 2
validates that value. It does not create it.
