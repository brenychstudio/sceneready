# Readiness Mathematics

This document describes the implemented SR-02 readiness, confidence, and
certification mathematics. It is not a scoring-policy change.

## Versions

- Decision policy: `SR-POLICY-v1`
- Scoring model: `SR-SCORE-v1`
- Graph schema: `SR-GRAPH-v1`

Policy floors remain:

- `readiness.readyFloor = 85`
- `readiness.atRiskFloor = 60`
- `confidence.certifiedFloor = 85`
- `confidence.degradedFloor = 60`

## Evaluation flow

`evaluateProductionReadiness()` composes accepted Task-5 and Task-6 facts:

1. `evaluateCriticalGates(input)`
2. `evaluateDomainHealth(input)`
3. `scoreReadiness(canonical DomainHealth + deduplicated deliverable impacts)`
4. `scoreConfidence(required scopes + confidence facts)`
5. operational status and certification from those results and policy floors

Scoring consumes the six canonical `DomainHealth` states. It does not
re-aggregate raw `DomainFact` records and does not apply a second gate
penalty.

## Readiness score

Readiness is an integer in `0..100`:

`readinessScore = clamp(100 - domainPenalties - impactPenalties)`

Domain penalties from `SR_SCORE_V1.domainPenalty`:

| DomainHealth state | Penalty |
| ------------------ | ------- |
| PASSED             | 0       |
| UNRESOLVED         | 10      |
| FAILED             | 22      |

Exactly one score is produced for each domain:

`PEOPLE`, `LOCATION`, `TIME_ENVIRONMENT`, `EQUIPMENT`, `DOCUMENTS_RIGHTS`,
`LOGISTICS`.

Causal impact penalties use Task-6 incident+deliverable deduplication. Duplicate
`(incidentId, deliverableId)` facts are merged before scoring. Separate
incidents remain separate penalty sources.

`penalty = severityWeight[severity] * importanceWeight[importance]`

| Severity | Weight | Importance | Weight |
| -------- | ------ | ---------- | ------ |
| LOW      | 1      | LOW        | 1      |
| MEDIUM   | 2      | MEDIUM     | 1      |
| HIGH     | 4      | HIGH       | 2      |
| CRITICAL | 6      | CRITICAL   | 3      |

Healthy domains with zero causal penalties leave headroom below 100. The model
is not capped at a scenario label.

Confidence facts do not alter `readinessScore`.

## Confidence score

Evidence Confidence is a separate 0..100 integer. It averages required-scope
qualities. Unresolved, missing, conflicted, or stale required scopes are listed
explicitly and cannot be silently treated as proven failure.

## Operational status

Exactly `READY`, `AT_RISK`, or `BLOCKED`.

- Any known failed hard gate => `BLOCKED`
- `READY` requires zero failed gates, zero unresolved gates, readiness at or
  above `readyFloor`, no HIGH or CRITICAL risk, and no unresolved required
  evidence
- otherwise => `AT_RISK`

CRITICAL risk is not BLOCKED by itself.

## Certification

Exactly `CERTIFIED`, `DEGRADED`, or `INSUFFICIENT`.

Certification answers whether the assessment is sufficiently evidenced. A failed
hard gate can still be `CERTIFIED` when required evidence is complete and
confidence meets `certifiedFloor`. Unresolved required evidence cannot be
`CERTIFIED`. Confidence below `degradedFloor` is `INSUFFICIENT`.
