# Recovery Planning

This document records the SR-03 recovery-intelligence boundary that Task 7
certifies. It does not rewrite the frozen canonical design. The active
recovery-outcome amendments are:

- [Recovery outcomes addendum v1.0](../superpowers/specs/2026-09-29-sceneready-recovery-outcomes-addendum-v1.0.md)
- [Recovery outcomes addendum v1.1](../superpowers/specs/2026-09-29-sceneready-recovery-outcomes-addendum-v1.1.md)

## 1. Recovery intelligence boundary

Recovery planning proposes bounded, reversible interventions and explains their
deterministic consequences. It does not approve, execute, notify, or mutate the
authoritative production. The agent orchestrates accepted engines. It is not a
second implementation of parsing, policy, shadow application, readiness,
confidence, outcome metrics, ranking, or grounding validation.

## 2. Bounded intervention catalog

Every canonical intervention is one primitive from the intervention catalog:
`SHIFT_ACTIVITY`, `ADJUST_CALL_TIME`, `ADJUST_DEPARTURE`, and `ADD_BUFFER`.
Option C uses an empty list. No free-form schedule edit is accepted.

## 3. Parser, policy, shadow, feasibility, outcomes, ranking

The certification path is:

1. `parseIntervention`
2. `validateInterventionPolicy`
3. `simulateShadowProduction`
4. `evaluateInterventionFeasibility` using `SR-POLICY-v1` recovery limits
5. the recovery-outcome producers
6. `rankRecoveryOptions`
7. `validateGroundedReasoning`

A candidate that fails schema, policy, or feasibility is not ranked.

## 4. Seven deterministic recovery metrics

Each viable option receives all seven metrics:

| Metric                | Producer                              |
| --------------------- | ------------------------------------- |
| Readiness improvement | shadow readiness minus live readiness |
| Creative preservation | `SR-CREATIVE-PRESERVATION-v1`         |
| Schedule stability    | `SR-SCHEDULE-STABILITY-v1`            |
| Logistics impact      | `SR-LOGISTICS-IMPACT-v1`              |
| Crew disruption       | `SR-CREW-DISRUPTION-v1`               |
| Evidence confidence   | shadow confidence                     |
| New risk introduced   | `SR-NEW-RISK-INTRODUCED-v1`           |

No metric is filled with a placeholder merely to neutralize ranking. An empty
intervention list is passed to the producers, which classify that empty set.

## 5. Versioned recovery-outcome algorithms

The certified algorithms are `SR-CREATIVE-PRESERVATION-v1`,
`SR-SCHEDULE-STABILITY-v1`, `SR-LOGISTICS-IMPACT-v1`, `SR-CREW-DISRUPTION-v1`,
and `SR-NEW-RISK-INTRODUCED-v1`. Fixture, graph, policy, and scoring versions
stay `BCN-DEMO-v1`, `SR-GRAPH-v1`, `SR-POLICY-v1`, and `SR-SCORE-v1`.

## 6. Creative-first priority profile

The accepted profile id is `CREATIVE-FIRST`. Its tiers, one metric each, are
creative preservation, readiness improvement, schedule stability, evidence
confidence, logistics impact, crew disruption, and new risk introduced. The
ranker decides. Option identity is not a ranking input beyond the option's
measured metrics.

## 7. Canonical Option A

Option A protects creative intent by shifting Gothic setup `-25` minutes,
moving the model, HMU, and photo-assistant calls `-25` minutes, and moving the
Gothic departure `-20` minutes. On the accepted shadow projection this removes
the Gothic Look 03 critical risk, lowers studio load-in from medium to low, and
leaves Eixample Look 05 high. The derived metrics are readiness `74 -> 89`,
creative preservation `71`, static envelope quality `82` as a diagnostic only,
schedule stability `72`, logistics `LOW`, crew disruption `HIGH`, evidence
confidence `96`, and new risk `NONE`.

## 8. Resolved Option B

Resolved Option B is only `ADD_BUFFER` of `10` minutes before Eixample setup.
It does not shorten a look. It stays at readiness `74`, creative preservation
`59`, schedule stability `78`, and introduces no logistics event, crew event,
risk transition, or new risk.

## 9. Option C no-change

Option C has no interventions. Readiness stays `74`, creative preservation stays
`59`, and schedule stability is `100` because the schedule producer scores an
empty change set at the top of its scale. There is no operational activity
mutation, risk transition, crew event, or logistics event. The shadow engine
still assigns a shadow revision to the simulation snapshot. That technical
identity is not an operational change.

## 10. Superseded invalid Option B example

The literal sample that shortened Gothic Look 03 by `20` minutes, then added the
Eixample buffer, remains evidence of rejection. Gothic Look 03 is `15` minutes,
so current policy returns `DURATION_NOT_POSITIVE` before ranking. The candidate
is not among the ranked options. Policy is not weakened to admit it.

## 11. Deterministic recommendation semantics

With all three options feasible, Creative-first ranking recommends Option A
because creative preservation `71` beats `59` and `59`. Schedule stability then
places Option C (`100`) ahead of Option B (`78`). That B/C order is a measured
difference, not an option-id tie break.

## 12. Trade-off and escalation

The same ranker, exercised with labeled non-canonical fixtures, escalates
`NO_VIABLE_PLAN` and `INSUFFICIENT_EVIDENCE` with no recommended option. A
split tier that is not materially dominated returns `PRESENT_TRADE_OFF` with
`PRIORITY_CONFLICT`. An exact metric tie does not fabricate a recommendation.

## 13. Grounding contract

Grounding uses the accepted schema and `validateGroundedReasoning`. The
positive explanation states only claims bound to the deterministic result:
R2 readiness, Option A shadow readiness, creative preservation `59 -> 71`,
Gothic critical removal, Eixample remaining high, crew disruption `HIGH`, and
the Creative-first recommendation of Option A. A superseded claim that creative
preservation becomes `95`, or that Option A crew disruption is `MEDIUM`, is
rejected. An invalid initial attempt is `REGENERATE_ONCE`. An invalid retry is
`USE_DETERMINISTIC_EXPLANATION`.

## 14. Shadow and live immutability

Shadow simulation copies operational state. The live graph fingerprint and its
stable serialization are unchanged after Options A, B, and C, the rejected
candidate, ranking, and grounding. No authoritative production mutation exists
in this certification.

## 15. Why Bedrock is not operational truth

The fast certification path does not call a model, Bedrock, Strands, Alexa, or
the network. Ranking and explanation are produced by deterministic functions.
Model output is not evidence and is not required to certify the recommendation.

## 16. Evidence and fingerprint certification

`tools/evidence-report/src/sr03-report.ts` serializes the certification object
returned by the analysis. It does not restate scores beside that object. The
report records fixture, graph, policy, scoring, and recovery-algorithm
versions, both live and shadow fingerprints, and is byte-identical across
repeated generation. The report-local schema is `SR-03-EVIDENCE-REPORT-v1`.
Historical fixture, policy, and scoring identifiers are not bumped.

## 17. Historical target amendments

Earlier planning text said creative preservation moved `61 -> 95` and that
Option A crew disruption was `MEDIUM`. Those targets are not produced by the
accepted scorers.

- `61 -> 95` is superseded by operational creative preservation `59 -> 71`.
- Option A crew `MEDIUM` is superseded by `HIGH`.

The v1.0 and v1.1 addenda are the active amendment. Historical plan and spec
files keep their original wording.

## 18. SR-03 exit evidence

Exit evidence is the canonical recovery test, the generated SR-03 report, this
document, and the updated claim matrix. SR-03 is not closed by this commit.
Closure still requires the certification commit to be integrated to main and
both CI and Security to succeed for that integrated SHA.
