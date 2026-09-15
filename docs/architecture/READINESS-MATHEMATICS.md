# Readiness Mathematics

This document describes the implemented SR-02 readiness, confidence, and
certification mathematics. Constants are taken from `SR_SCORE_V1` and
`SCENEREADY_POLICY_V1`. It is not a scoring-policy change and does not
implement SR-03 Shadow Simulation.

## Versions

- Decision policy: `SR-POLICY-v1`
- Scoring model: `SR-SCORE-v1`
- Graph schema: `SR-GRAPH-v1`

Policy floors from source:

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

## Baseline and clamp

Baseline is `100`.

`readinessScore = clamp(100 - domainPenalties - impactPenalties)`

Clamp is inclusive `0..100`.

## Six canonical domain states

Exactly one score is produced for each domain:

`PEOPLE`, `LOCATION`, `TIME_ENVIRONMENT`, `EQUIPMENT`, `DOCUMENTS_RIGHTS`,
`LOGISTICS`.

Domain penalties from `SR_SCORE_V1.domainPenalty`:

| DomainHealth state | Penalty |
| ------------------ | ------- |
| PASSED             | 0       |
| UNRESOLVED         | 10      |
| FAILED             | 22      |

## Deliverable-weighted causal impact penalties

Causal impact penalties use Task-6 incident + final-deliverable
deduplication. Duplicate `(incidentId, deliverableId)` facts are merged
before scoring. Intermediate graph nodes are not penalized. Separate
incidents remain separate penalty sources.

`penalty = severityWeight[severity] * importanceWeight[importance]`

Severity weights from `SR_SCORE_V1.severityWeight`:

| Severity | Weight |
| -------- | ------ |
| LOW      | 1      |
| MEDIUM   | 2      |
| HIGH     | 4      |
| CRITICAL | 6      |

Deliverable importance weights from `SR_SCORE_V1.importanceWeight`:

| Importance | Weight |
| ---------- | ------ |
| LOW        | 1      |
| MEDIUM     | 1      |
| HIGH       | 2      |
| CRITICAL   | 3      |

Healthy domains with zero causal penalties leave headroom below 100. The
model is not capped at a scenario label.

## Confidence is independent from readiness

Evidence Confidence is a separate 0..100 integer. Changing confidence facts
while holding domains, gates, and causal impacts constant does not change
`readinessScore`.

## Operational status

Exactly `READY`, `AT_RISK`, or `BLOCKED`.

- Any known failed hard gate => `BLOCKED` (hard-gate override is absolute)
- `READY` requires zero failed gates, zero unresolved gates, readiness at or
  above `readyFloor`, no HIGH or CRITICAL risk, and no unresolved required
  evidence
- otherwise => `AT_RISK`

CRITICAL risk alone is not BLOCKED.

## Certification

Exactly `CERTIFIED`, `DEGRADED`, or `INSUFFICIENT`.

Certification answers whether the assessment is sufficiently evidenced, not
whether production is operationally ready. A failed hard gate can still be
`CERTIFIED` when required evidence is complete and confidence meets
`certifiedFloor`. Unresolved required evidence cannot be `CERTIFIED`.
Confidence below `degradedFloor` is `INSUFFICIENT`.

## Protected canonical outputs

Computed by the same `evaluateProductionReadiness()` function:

- R0: readiness 78 / confidence 94 / `BLOCKED` / `CERTIFIED`; only `RIGHTS`
  failed
- R1: readiness 86 / confidence 96 / `READY` / `CERTIFIED`
- R2: readiness 74 / confidence 96 / `AT_RISK` / `CERTIFIED`

The same deterministic scoring function is intended for later live and
shadow evaluation. Shadow Simulation itself is not implemented in SR-02.
