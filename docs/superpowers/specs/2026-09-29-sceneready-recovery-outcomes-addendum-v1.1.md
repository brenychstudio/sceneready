# SceneReady Recovery Outcomes Addendum v1.1

STATUS=APPROVED_VERSIONED_AMENDMENT
DATE=29 September 2026
EXTENDS=2026-09-29-sceneready-recovery-outcomes-addendum-v1.0.md
BASE_CANONICAL_DESIGN=SceneReady Canonical Design v1.0

This addendum extends recovery-outcome measurement. It does not edit addendum
v1.0, and v1.0 remains byte-stable. It does not replace Canonical Design v1.0.
It does not certify SR-03. It does not start final SR-03G Task 7, and it does
not start SR-04.

The new functions live in `packages/recovery-outcomes` beside the v1 creative
and crew functions. Readiness, shadow mutation, feasibility, ranking, agent
reasoning, authority, and execution stay outside this package.
`recovery-ranking` does not import it. A caller composes outcome derivation
and ranking later.

These values were not selected to make Option A win.

## 1. Why v1.1 exists

Addendum v1.0 gave deterministic producers for `creativePreservation` and
`crewDisruption`. The accepted ranker still consumes seven metrics. Schedule
stability and logistics impact had no producer. A dry run held those two
fields equal only so they would not decide the result. Those equal values were
not certified. `newRiskIntroduced` was still a caller-authored enum.

v1.1 closes those three gaps. It does not retune creative preservation, crew
disruption, readiness, or the ranker. The numbers below are the outputs of the
stated rules on the already accepted consequence events. They were not
selected to make Option A win. On the metrics this addendum adds, Option A is
not the best schedule, not the lightest logistics burden, and not distinguished
by introduced risk.

## 2. Seven recovery-ranking metrics

The ranker consumes exactly these metrics:

| Metric               | Direction        |
| -------------------- | ---------------- |
| readinessImprovement | higher is better |
| creativePreservation | higher is better |
| scheduleStability    | higher is better |
| evidenceConfidence   | higher is better |
| logisticsImpact      | lower is better  |
| crewDisruption       | lower is better  |
| newRiskIntroduced    | lower is better  |

`scheduleStability` is an integer `0..100`. `logisticsImpact`,
`crewDisruption`, and `newRiskIntroduced` are `NONE`, `LOW`, `MEDIUM`, `HIGH`,
or `CRITICAL`.

## 3. Which metrics already had producers

Before this amendment, four of the seven already had deterministic producers:

| Metric               | Producer                                          |
| -------------------- | ------------------------------------------------- |
| readinessImprovement | shadow readiness score minus live readiness score |
| creativePreservation | `SR-CREATIVE-PRESERVATION-v1`                     |
| crewDisruption       | `SR-CREW-DISRUPTION-v1`                           |
| evidenceConfidence   | shadow assessment confidence score                |

`scheduleStability`, `logisticsImpact`, and `newRiskIntroduced` did not. This
amendment adds only those three. It does not reimplement readiness or
confidence inside `packages/recovery-outcomes`.

## 4. Schedule Stability definition

`SCHEDULE_STABILITY` means how much of the production's timing structure is
preserved by a recovery option relative to the live plan.

It is an integer `0..100` and is maximized by the ranker. It measures the
severity of schedule disturbance, not the number of affected people. Breadth
of human coordination stays with `crewDisruption`.

The input is a normalized immutable event list. The caller derives events from
validated intervention and live-shadow consequences. The function does not
inspect option identity.

## 5. SR-SCHEDULE-STABILITY-v1

```text
SCHEDULE_STABILITY_ALGORITHM_VERSION = SR-SCHEDULE-STABILITY-v1
BOUND_SOURCE_INTERVENTION_CONTRACT = v1
```

`evaluateScheduleStability` returns `AVAILABLE` or `WITHHELD`. It does not
throw on malformed input. Available output carries `algorithmVersion`,
`boundSource`, and `scheduleStability`. Output is deeply frozen. Input is not
mutated. Exact duplicate events are deduped. The same identity with a
different payload withholds `CONFLICTING_EVENT`.

Closed event kinds:

- `ACTIVITY_TIME_CHANGED` (`subjectId`, `deltaMinutes`)
- `PERSONAL_CALL_TIME_CHANGED` (`subjectId`, `deltaMinutes`)
- `DEPARTURE_TIME_CHANGED` (`subjectId`, `deltaMinutes`)
- `ACTIVITY_SHORTENED` (`subjectId`, `minutes`)
- `BUFFER_ADDED` (`subjectId`, `minutes`)
- `TRANSFER_BUFFER_INCREASED` (`subjectId`, `minutes`)
- `ACTIVITY_ORDER_CHANGED` (`subjectIds`)

Subject ids use the accepted intervention EntityId pattern
`^[A-Z0-9][A-Z0-9-]{2,63}$`. The pattern is copied into this package so the
package does not import the intervention engine. If that pattern or the bound
maxima change, the schedule algorithm version must change.

## 6. Bound intervention maxima

The maxima are the accepted intervention schema limits for contract v1. They
are not a new limit table.

| Event                      | Bound                      |
| -------------------------- | -------------------------- |
| ACTIVITY_TIME_CHANGED      | absolute delta maximum 120 |
| PERSONAL_CALL_TIME_CHANGED | absolute delta maximum 90  |
| DEPARTURE_TIME_CHANGED     | absolute delta maximum 90  |
| ACTIVITY_SHORTENED         | minutes maximum 60         |
| BUFFER_ADDED               | minutes maximum 45         |
| TRANSFER_BUFFER_INCREASED  | minutes maximum 45         |
| ACTIVITY_ORDER_CHANGED     | normalized disturbance 1   |

A signed time delta may be negative. Shorten, buffer, and transfer-buffer
minutes are unsigned. A negative minute value is out of bound. The metric does
not invent the intervention schema's positive minimums as extra withhold
limits. Any integer change with `0 < absoluteChange / boundMaximum <= 1` is in
bound. Zero and values past the maximum withhold.

## 7. Worst-normalized-disturbance formula

For every numeric event:

```text
normalizedDisturbance = absoluteChange / boundMaximum
```

Require `0 < normalizedDisturbance <= 1`. An order change uses normalized
disturbance `1`.

An empty event set scores `100`. Otherwise:

```text
worstDisturbance = max(all normalizedDisturbance values)
rawStability = 100 * (1 - worstDisturbance)
scheduleStability = round half away from zero(rawStability)
```

The quotient is the integer `100 * (bound - absolute) / bound`. A positive
quotient `n/d` rounds by integer arithmetic `(2n + d)` divided by `2d`,
dropping the remainder. It does not call `Math.round`. The result is an
integer `0..100`.

Comparison of disturbances uses cross-multiplication, not floating point.

## 8. Why breadth is not summed

Summing normalized disturbances would count one timing move again for every
person and every related clock. That breadth is already `crewDisruption`. The
schedule score keeps only the worst bounded disturbance so a recovery that
shifts several related clocks is judged by its sharpest move, not by how many
times that move can be restated.

## 9. Canonical A/B/C schedule values 72 / 78 / 100

Option A events:

- `ACTIVITY_TIME_CHANGED` ACT-GOTHIC-SETUP, delta -25, disturbance 25/120
- `DEPARTURE_TIME_CHANGED` ACT-DEPART-GOTHIC, delta -20, disturbance 20/90
- `PERSONAL_CALL_TIME_CHANGED` PERSON-MODEL, PERSON-HMU, and
  PERSON-PHOTO-ASSISTANT, each delta -25, disturbance 25/90

The worst disturbance is `25/90`. Raw stability is `100 * 65/90 = 6500/90`.
Half-away rounding yields 72.

```text
OPTION_A_SCHEDULE_STABILITY = 72
```

Resolved Option B is one event: `BUFFER_ADDED` before ACT-EIXAMPLE-SETUP,
minutes 10. Disturbance is `10/45`. Raw stability is `100 * 35/45 = 3500/45`.
Half-away rounding yields 78.

```text
OPTION_B_SCHEDULE_STABILITY = 78
```

Option C has no schedule events.

```text
OPTION_C_SCHEDULE_STABILITY = 100
```

These outputs are not hardcoded. The same function scores any other in-bound
event list. They were not selected to make Option A win. The ranker maximizes
schedule stability, and 72 is worse than 78 and worse than 100.

## 10. Logistics Impact definition

`LOGISTICS_IMPACT` means the physical or logistical burden introduced by a
recovery option relative to the live production plan.

It is minimized by the ranker. It does not duplicate crew coordination or
generic timing instability. A schedule change enters logistics impact only when
the caller supplies an explicit logistics event.

Ordinary call-time changes, ordinary activity timing shifts, `ADD_BUFFER`
before a non-transfer activity, shortening, and missing-confirmation requests
are not logistics events. Passing those records to the logistics function
withholds the metric as malformed. The caller omits them, and an empty
logistics list is `NONE`.

## 11. SR-LOGISTICS-IMPACT-v1

```text
LOGISTICS_IMPACT_ALGORITHM_VERSION = SR-LOGISTICS-IMPACT-v1
```

`evaluateLogisticsImpact` returns `AVAILABLE` or `WITHHELD`. It does not throw
on malformed input. Available output carries `algorithmVersion` and `level`.
Output is deeply frozen. Input is not mutated. Exact duplicate events are
deduped. The same identity with a different payload withholds
`CONFLICTING_EVENT`. Issue codes are unique and sorted. No partial level is
returned.

Required ids use the same accepted EntityId pattern as schedule stability.
This package still does not import the intervention engine.

## 12. Logistics event classes

The highest applicable class wins. This is a semantic class mapping, not a
numeric calibration.

| Level    | Events                                               |
| -------- | ---------------------------------------------------- |
| NONE     | No logistics event                                   |
| LOW      | `TRANSFER_TIMING_CHANGED`, `TRANSFER_BUFFER_CHANGED` |
| MEDIUM   | `LOGISTICS_REVERIFICATION_ADDED`                     |
| HIGH     | `BACKUP_KIT_ACTIVATED`, `ROUTE_SEQUENCE_CHANGED`     |
| CRITICAL | `FALLBACK_LOCATION_SWITCHED`                         |

Closed event fields:

- `TRANSFER_TIMING_CHANGED` (`transferActivityId`)
- `TRANSFER_BUFFER_CHANGED` (`transferActivityId`)
- `LOGISTICS_REVERIFICATION_ADDED` (`subjectId`)
- `BACKUP_KIT_ACTIVATED` (`equipmentPathId`)
- `ROUTE_SEQUENCE_CHANGED` (`activityIds`, at least two distinct valid ids)
- `FALLBACK_LOCATION_SWITCHED` (`activityId`, `fallbackLocationId`)

Malformed events, empty or malformed required ids, a route with fewer than two
valid ids or with duplicate ids, a malformed fallback pair, and conflicting
identities withhold the metric.

## 13. Canonical A/B/C logistics values LOW / NONE / NONE

Option A includes `ADJUST_DEPARTURE` ACT-DEPART-GOTHIC, delta -20. The
canonical logistics consequence is one event:

```text
TRANSFER_TIMING_CHANGED ACT-DEPART-GOTHIC
OPTION_A_LOGISTICS_IMPACT = LOW
```

Option B contains only `ADD_BUFFER` before ACT-EIXAMPLE-SETUP, minutes 10.
That is not a transfer-buffer change, so the logistics event set is empty.

```text
OPTION_B_LOGISTICS_IMPACT = NONE
```

Option C has no logistics event.

```text
OPTION_C_LOGISTICS_IMPACT = NONE
```

An Eixample setup buffer alone is `NONE`. A personal call alone is `NONE`.
These values were not selected to make Option A win. The ranker minimizes
logistics impact, and LOW is worse than NONE.

## 14. New Risk Introduced definition

`NEW_RISK_INTRODUCED` means the worst severity among risks that exist in the
shadow result and did not exist in the corresponding live result.

The caller supplies that introduced set as `riskId` plus `severity`. The
function does not inspect option identity, and canonical recovery glue must
not hand-author the enum.

## 15. SR-NEW-RISK-INTRODUCED-v1

```text
NEW_RISK_INTRODUCED_ALGORITHM_VERSION = SR-NEW-RISK-INTRODUCED-v1
```

`evaluateNewRiskIntroduced` returns `AVAILABLE` or `WITHHELD`. It does not
throw on malformed input. Available output carries `algorithmVersion` and
`level`. Output is deeply frozen. Input is not mutated.

Input severities are `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`. `NONE` is only
the empty-set result. It is not a valid input severity.

## 16. Worst-introduced-risk rule

| Input                     | Level              |
| ------------------------- | ------------------ |
| Empty introduced-risk set | NONE               |
| One introduced risk       | its severity       |
| Several introduced risks  | the worst severity |

`CRITICAL` outranks `HIGH`, then `MEDIUM`, then `LOW`. Exact duplicate rows
with the same risk id and severity are deduped. The same risk id with two
severities withholds `CONFLICTING_RISK`. Malformed input, an empty risk id, or
a severity outside the four input classes withholds the metric. Issue codes
are unique and sorted. No partial level is returned. Input order does not
change the result.

## 17. Canonical A/B/C values NONE / NONE / NONE

Accepted simulations report no introduced risk for options A, B, and C. Each
canonical value is therefore the empty introduced-risk set, not a branch on
option id.

```text
OPTION_A_NEW_RISK_INTRODUCED = NONE
OPTION_B_NEW_RISK_INTRODUCED = NONE
OPTION_C_NEW_RISK_INTRODUCED = NONE
```

These values were not selected to make Option A win. The three options tie.

## 18. No changes to creative preservation or crew disruption v1

`SR-CREATIVE-PRESERVATION-v1` and `SR-CREW-DISRUPTION-v1` are unchanged.

Canonical creative preservation remains live/R2 59, Option A 71, Option B 59,
and Option C 59. Static envelope quality remains the diagnostic 82 and 82.
Canonical crew disruption remains Option A HIGH, Option B NONE, and Option C
NONE. This amendment does not retune those contracts and does not reopen
61 -> 95 or Option A crew MEDIUM.

## 19. No change to readiness, scoring, policy, or fixture

Accepted Option A readiness remains 74 -> 89. Accepted confidence remains 96.
`SR-SCORE-v1` and `SR-POLICY-v1` are not bumped. The Barcelona fixture
`BCN-DEMO-v1` is unchanged. No fixture, policy, or replay identifier is
minted. SR-02 evidence is not overwritten. This package does not calculate
readiness or confidence.

## 20. Final Task 7 certification requirements

Final certification is not performed here. When it is resumed, every canonical
ranking metric must come from a deterministic producer:

```text
readinessImprovement = shadow readiness score - live readiness score
creativePreservation = SR-CREATIVE-PRESERVATION-v1
scheduleStability = SR-SCHEDULE-STABILITY-v1
logisticsImpact = SR-LOGISTICS-IMPACT-v1
crewDisruption = SR-CREW-DISRUPTION-v1
evidenceConfidence = shadow assessment confidence score
newRiskIntroduced = SR-NEW-RISK-INTRODUCED-v1
```

```text
ALL_SEVEN_RANKING_METRICS_HAVE_DETERMINISTIC_PRODUCER = YES
```

Task 7 must not hand-author `scheduleStability`, `logisticsImpact`, or
`newRiskIntroduced`. It must not tune any of the seven metrics to make Option
A win. It must not modify the Barcelona fixture, `SR-SCORE-v1`, `SR-POLICY-v1`,
`SR-CREATIVE-PRESERVATION-v1`, or `SR-CREW-DISRUPTION-v1` in order to recover
an older target. Version binding of this amendment to replay remains a Task 7
act. This document does not claim that SR-03 is certified.

```text
VERSION_BINDING_DEFERRED_TO_TASK7 = YES
```
