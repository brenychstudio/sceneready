# SceneReady Recovery Outcomes Addendum v1.0

STATUS=APPROVED_VERSIONED_AMENDMENT
DATE=29 September 2026
BASE_CANONICAL_DESIGN=SceneReady Canonical Design v1.0

This addendum is a versioned amendment to recovery-outcome measurement. It does
not replace Canonical Design v1.0, and it does not edit that document. It does
not certify SR-03. It does not overwrite SR-02 evidence.

The normative functions live in `packages/recovery-outcomes`. Readiness, shadow
mutation, feasibility, ranking, agent reasoning, authority, and execution stay
outside this package. `recovery-ranking` does not import it in this amendment.
A caller composes outcome derivation and ranking later.

## 1. Reason for amendment

Accepted source already evaluates look-level creative intent, simulates shadow
risk transitions, and ranks recovery options that consume `creativePreservation`
and `crewDisruption`. No accepted producer emitted the recovery-level creative
metric or the crew-disruption level.

Static envelope quality for the canonical exterior looks is 82 in the live plan
and 82 after the direct Gothic risk is removed. A delta of 0 cannot support a
claim that the option protects creative intent, so static quality remains a
diagnostic rather than the ranking metric.

Operational creative preservation has to move when a direct causal risk on a
creative look is removed, reduced, or introduced. Crew disruption has to
describe human coordination burden relative to the live plan, not membership in
the production.

## 2. Superseded recovery targets

This amendment supersedes only these conflicting prior recovery targets:

- creative preservation 61 -> 95
- Option A crew disruption MEDIUM
- the literal invalid Option B shorten sample

Those values are not produced by the accepted scorers and are not targets of
`SR-CREATIVE-PRESERVATION-v1` or `SR-CREW-DISRUPTION-v1`. Historical documents
are left unchanged. Later certification must use the results in this addendum
instead of 61, 95, and MEDIUM.

## 3. Creative Preservation definition

`CREATIVE_PRESERVATION` means how much of the production's declared exterior
creative intent remains operationally deliverable in the evaluated state.

It is not readiness, evidence confidence, an envelope count, a raw solar score,
model judgment, or option identity.

## 4. Creative algorithm and version

```text
CREATIVE_PRESERVATION_ALGORITHM_VERSION = SR-CREATIVE-PRESERVATION-v1
BOUND_SOURCE_SCORING_VERSION = SR-SCORE-v1
```

`evaluateCreativePreservation` returns `AVAILABLE` or `WITHHELD`. It does not
throw on malformed input. Output is deeply frozen. Input is not mutated.

## 5. Bound SR-SCORE-v1 snapshot

`SR-CREATIVE-PRESERVATION-v1` freezes this accepted scoring snapshot. The
weights are not a new aesthetic scale. A future change requires a new creative
algorithm version. This amendment does not bump `SR-SCORE-v1`.

| Importance | Weight |
| ---------- | -----: |
| LOW        |      1 |
| MEDIUM     |      1 |
| HIGH       |      2 |
| CRITICAL   |      3 |

| Risk severity | Weight |
| ------------- | -----: |
| LOW           |      1 |
| MEDIUM        |      2 |
| HIGH          |      4 |
| CRITICAL      |      6 |

`NONE` is not a risk severity.

## 6. Direct-risk linkage

A risk counts only when `risk.subjectId === look.activityId`.

Schedule-successor propagation, shared incident cones, and unrelated subjects
are excluded. In particular, a studio subject does not enter exterior creative
preservation. The compiled production graph can carry risk farther than the
certified evaluation impacts. This metric does not close that linkage gap by
inference. The authoritative creative link is subject equality with the look
activity.

## 7. Worst-multiple-direct-risk rule

If several direct risks name one look, only the worst severity is used, once,
by the bound severity weight. Severity weights are unique, so the worst
severity is unique. An identical duplicate risk does not multiply the penalty.
A second risk id with the same subject and the same severity is still one
penalty. The same risk id with a different subject or severity withholds the
metric as `CONFLICTING_RISK`.

## 8. Formula

For each look:

```text
lookFloor = min(startScore, endScore)
```

If the look has no direct risk, `survival = 1/1`. Otherwise:

```text
survival = (6 - severityWeight[worstDirectSeverity]) / 6
```

The survival denominator stays 6 when a risk applies, so the fractions are
exactly LOW 5/6, MEDIUM 4/6, HIGH 2/6, and CRITICAL 0/6. CRITICAL is not
rewritten to 0/1 in the survival fields.

```text
operationalLookValue = lookFloor * survival
```

Looks group by `envelopeId`. Each envelope votes once:

```text
envelopeScore = arithmetic mean of member operationalLookValue values
```

```text
finalQuotient =
  sum(envelopeScore * importanceWeight[envelopeImportance])
  /
  sum(importanceWeight[envelopeImportance])
```

Operational values, envelope scores, and quotients are exact rationals in
lowest terms. Survival fractions are not reduced below denominator 6.

## 9. Rounding and fail-closed behavior

`creativePreservation` is the half-away-from-zero rounding of `finalQuotient`
and is an integer from 0 through 100. For a non-negative rational `n/d`, that
rounding is the integer quotient of `(2n + d)` divided by `2d`. A quotient of
1/2 therefore rounds to 1. Floating half-up rounding is not this rule.

The whole metric is withheld, with no partial score, when any of these hold:

- empty look set (`EMPTY_LOOK_SET`)
- missing start or end score (`MISSING_SCORE`)
- non-integer score (`NON_INTEGER_SCORE`)
- score outside 0..100 (`SCORE_OUT_OF_RANGE`)
- invalid importance (`INVALID_IMPORTANCE`)
- duplicate activity id (`DUPLICATE_ACTIVITY_ID`)
- one activity assigned to conflicting envelope ids (`CONFLICTING_ENVELOPE_ID`)
- one envelope with conflicting importance (`CONFLICTING_ENVELOPE_IMPORTANCE`)
- invalid risk severity (`INVALID_RISK_SEVERITY`)
- malformed activity, envelope, risk, or subject id
- conflicting duplicate risk id (`CONFLICTING_RISK`)
- malformed input (`MALFORMED_INPUT`)

Invalid rows are not dropped and are not replaced with 0 or 100. Every
applicable issue code is collected, then returned unique and sorted. The same
input is byte-equivalent across repeats and input order.

## 10. Static envelope quality diagnostic

`staticEnvelopeQuality` uses the same envelope vote with every survival factor
fixed at 1. It explains declared envelope quality before operational risk. It
is not the ranking metric.

On the canonical exterior looks below, static envelope quality is 82 for the
live state and 82 after the Gothic direct risk is removed. The unrounded static
quotient is 412/5.

## 11. Canonical live creative preservation

Canonical look floors, using `min(startScore, endScore)`:

| Look activity        | Floor | Envelope importance |
| -------------------- | ----: | ------------------- |
| ACT-GOTHIC-LOOK-01   |    88 | CRITICAL            |
| ACT-GOTHIC-LOOK-02   |    76 | CRITICAL            |
| ACT-GOTHIC-LOOK-03   |    60 | CRITICAL            |
| ACT-EIXAMPLE-LOOK-04 |   100 | HIGH                |
| ACT-EIXAMPLE-LOOK-05 |    88 | HIGH                |

Live direct risks: ACT-GOTHIC-LOOK-03 CRITICAL, ACT-EIXAMPLE-LOOK-05 HIGH.

Gothic operational mean = (88 + 76 + 0) / 3 = 164/3.
Eixample operational mean = (100 + 88 * 2/6) / 2 = 194/3.
Weighted quotient = (3 * 164/3 + 2 * 194/3) / 5 = 176/3.
Half-away rounding yields 59.

Canonical live creative preservation = 59.
Canonical live static envelope quality = 82.

## 12. Canonical Option A creative preservation

Option A removes the direct ACT-GOTHIC-LOOK-03 risk. ACT-EIXAMPLE-LOOK-05
remains HIGH. Studio risk stays excluded.

Gothic operational mean = (88 + 76 + 60) / 3 = 224/3.
Eixample operational mean stays 194/3.
Weighted quotient = (3 * 224/3 + 2 * 194/3) / 5 = 212/3.
Half-away rounding yields 71.

Canonical Option A creative preservation = 71.
Canonical Option A static envelope quality = 82.

The operational delta is +12 because the direct Gothic CRITICAL risk is gone.
The static diagnostic does not move.

## 13. Canonical Option B creative preservation

Resolved Option B does not change direct look risk. Its creative input is the
live risk set.

Canonical Option B creative preservation = 59.

## 14. Canonical Option C creative preservation

Option C has no interventions and does not change direct look risk.

Canonical Option C creative preservation = 59.

## 15. Crew Disruption definition

`CREW_DISRUPTION` means the human coordination burden introduced by the recovery
option relative to the live production plan.

It is based on crew-facing consequence events supplied by the caller. It does
not count a person merely because that person belongs to the production.

## 16. Crew algorithm and version

```text
CREW_DISRUPTION_ALGORITHM_VERSION = SR-CREW-DISRUPTION-v1
```

`evaluateCrewDisruption` returns `AVAILABLE` or `WITHHELD`. It does not throw
on malformed input. Available output carries `algorithmVersion`, `level`,
`affectedPersonIds`, and `eventKinds`. Person ids and event kinds are unique
and sorted. Output is deeply frozen. Input is not mutated.

## 17. Crew event contract

Closed event kinds:

- `PERSONAL_CALL_TIME_CHANGED`
- `SHARED_ACTIVITY_TIME_CHANGED`
- `SHARED_DEPARTURE_TIME_CHANGED`
- `LOCATION_CHANGED`
- `ACTIVITY_ORDER_CHANGED`
- `REVERIFICATION_DUTY_ADDED`
- `BACKUP_OPERATOR_DUTY_ADDED`

Time-change events carry a non-zero integer `deltaMinutes`. Negative deltas are
valid. A zero delta is invalid (`ZERO_DELTA`). Personal calls carry `personId`.
Shared, location, order, and duty events carry the exact affected person ids.
Order events also carry `activityIds`.

The caller derives events from deterministic live and shadow consequences. This
package only classifies the events it is given. A planning buffer that moves no
crew-facing clock is not an event. No event list is `NONE`, not a withheld
metric.

Exact duplicate events are deduped. The same identity with a different payload
withholds `CONFLICTING_EVENT`. Identity separates event kind, and where the
kind has a subject, that subject: a personal call and a shared move for the
same person are different identities.

## 18. Crew classification rule

The highest applicable class wins.

| Level    | Rule                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| NONE     | No crew-facing event                                                                |
| LOW      | Exactly one distinct person has a personal call change, and no higher class applies |
| MEDIUM   | Two or more distinct people have personal call changes, and no higher class applies |
| HIGH     | Any shared activity-time change or shared departure-time change                     |
| CRITICAL | Any location change, activity reorder, reverification duty, or backup-operator duty |

A shared move is HIGH even when it names one person. Personal calls do not
lower a shared move, and a shared move does not lower a critical duty.

Malformed events, empty affected-person lists, missing or non-integer deltas,
zero deltas, and conflicting identities withhold the metric. Issue codes are
unique and sorted. No partial level is returned.

## 19. Canonical Option A crew disruption

Option A consequence events are:

- shared activity-time change for ACT-GOTHIC-SETUP, delta -25, affecting
  PERSON-PRODUCTION-LEAD, PERSON-PHOTO-ASSISTANT, PERSON-DIGITAL-TECH, and
  PERSON-PRODUCTION-ASSISTANT
- shared departure-time change for ACT-DEPART-GOTHIC, delta -20, affecting
  PERSON-DIGITAL-TECH, PERSON-HMU, PERSON-MODEL, PERSON-MOTION-OPERATOR,
  PERSON-PHOTO-ASSISTANT, PERSON-PRODUCTION-ASSISTANT, PERSON-PRODUCTION-LEAD,
  and PERSON-STYLIST
- personal call-time changes of -25 for PERSON-MODEL, PERSON-HMU, and
  PERSON-PHOTO-ASSISTANT

The shared moves dominate. Canonical Option A crew disruption = HIGH.

Affected person ids are those eight departure people, sorted. Event kinds are
`PERSONAL_CALL_TIME_CHANGED`, `SHARED_ACTIVITY_TIME_CHANGED`, and
`SHARED_DEPARTURE_TIME_CHANGED`.

## 20. Canonical Option B crew disruption

Resolved Option B produces no crew-facing consequence event.

Canonical Option B crew disruption = NONE.

## 21. Canonical Option C crew disruption

Option C has no interventions and no crew-facing consequence event.

Canonical Option C crew disruption = NONE.

## 22. Resolved Option B

The resolved Option B intervention is:

```text
ADD_BUFFER before ACT-EIXAMPLE-SETUP minutes=10
```

The earlier literal sample that shortened a Gothic activity by a non-positive
duration is superseded. It is not an input to these metrics. Buffer-only Option
B leaves direct look risk unchanged and adds no crew event, which is why
creative preservation stays 59 and crew disruption stays NONE.

## 23. Option A readiness

Accepted Option A readiness remains 74 -> 89. Accepted confidence remains 96.
This package does not calculate readiness or confidence.

## 24. Readiness mathematics unchanged

Readiness mathematics, including `SR-SCORE-v1` as used by the readiness engine,
is unchanged. The severity and importance numbers above are a bound snapshot
for recovery-outcome survival and envelope votes. They do not retune readiness
penalties, gates, or confidence.

## 25. Model output is never metric authority

Model output, grounded prose, and option identity are not metric authority.
`creativePreservation` and `crewDisruption` come only from these pure
functions. The functions take structural looks, direct risks, and normalized
consequence events. They do not call a model, a network, a clock, or a random
source, and they do not approve, execute, send, or mutate production.

## 26. Replay and certification consequences

Replay expectations that still assume creative preservation 61 -> 95, or Option
A crew disruption MEDIUM, are stale relative to this amendment. They are not
rewritten here.

SR-02 evidence is not overwritten and SR-02 is not recertified by this
amendment. SR-03 recovery certification is not claimed. A later certification
task inspects the repository version carriers and binds replay to
`SR-CREATIVE-PRESERVATION-v1` and `SR-CREW-DISRUPTION-v1`.

```text
VERSION_BINDING_DEFERRED_TO_TASK7=YES
```

No fixture, policy, or replay identifier is minted by this amendment. The
Barcelona fixture is unchanged.

## 27. Versioning rule

`SR-CREATIVE-PRESERVATION-v1` and `SR-CREW-DISRUPTION-v1` are the recovery
outcome algorithm versions. Both are pure and deterministic.

`SR-SCORE-v1` remains the bound source scoring version for creative
preservation. `SR-SCORE-v1` and `SR-POLICY-v1` are not bumped. Changing the
survival map, the importance snapshot, the direct-link rule, the rounding
rule, or the crew class rule requires a new algorithm version. It does not
silently revise this one.
