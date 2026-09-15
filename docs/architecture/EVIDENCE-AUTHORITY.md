# Evidence Authority

This document describes accepted implementation from SR-02B through SR-02G. It
does not change Task-2 conflict semantics or Task-5 gate semantics. It does
not claim AWS or live provider ingestion.

## Typed evidence envelopes

Evidence is carried in typed envelopes with deterministic identity:

- `evidenceId`, `productionId`, `kind`, `sourceType`, `authorityClass`
- `trustState`, `observedAt`, `receivedAt`
- optional validity bounds, adapter/algorithm versions
- `mode` (`LIVE` or `REPLAY`)
- `contentFingerprint` from canonical SHA-256 JSON
- payload

Kinds currently implemented: `WEATHER`, `TRAVEL`, `SOLAR`,
`CREW_CONFIRMATION`, `EQUIPMENT_VERIFICATION`, `DOCUMENT`,
`LOCATION_ACCESS`.

## Authority classes

Authority classes currently implemented:

`SYSTEM_DERIVED`, `EXTERNAL_AUTHORITATIVE`, `DOCUMENT_AUTHORITY`,
`SUBJECT_CONFIRMATION`, `PRODUCTION_LEAD_ASSERTION`, `RECORDED_INTERNAL`,
`FALLBACK`

Scope-aware resolution can supersede a weaker class only under explicit
rules (for example FALLBACK losing to a non-FALLBACK class, and person
availability `SUBJECT_CONFIRMATION` superseding `RECORDED_INTERNAL`).

## Scope-aware resolution

Operational scope is `family:subjectId:aspect`. Matching proofs and
conflicts are scoped. Unrelated conflicts do not poison unrelated subjects
or gates.

## Conflict quarantine and active vs superseded

`resolveEvidenceSet` partitions evidence into:

- `active` — currently usable truth
- `superseded` — replaced by higher authority in the same scope
- `conflicts` — quarantined, not active graph or gate truth

`CONFLICTED` evidence is not authoritative truth. Unresolved conflicts
remain `UNRESOLVED`; they are not invented `FAILED` results.

## Freshness and trust

Trust states: `LIVE`, `CONFIRMED`, `RECORDED`, `FALLBACK`, `STALE`,
`MISSING`.

`evaluateEvidenceTrust` can mark an envelope `STALE` against an explicit
now-instant and policy freshness minutes. `MISSING` and `STALE` are not
usable operational truth.

Replay later uses captured envelopes and fingerprints; it does not re-mint
evidence from wall-clock time.

## Failure versus uncertainty

- `MISSING` proof != `FAILED`
- `STALE` proof != `FAILED`
- `CONFLICTED` proof != authoritative truth
- A known negative fact, such as a `DENIED` model-release validity proof,
  may prove failure
- Unresolved required evidence prevents `READY`
- Unresolved required evidence prevents `CERTIFIED`

## Confidence vs readiness

Evidence Confidence Score is distinct from Readiness Score. Confidence
measures required-scope coverage and trust quality. Readiness measures
domain health minus deliverable-weighted causal penalties.

## Fingerprints

Content fingerprints use the existing canonical SHA-256 of canonical JSON:

- production pack / fixture: `fingerprintProductionPack`
- evidence envelopes: `fingerprintEvidenceContent` / `contentFingerprint`
- production graph: `ProductionGraph.fingerprint`

Collections of evidence IDs and fingerprints are unique and
lexicographically sorted. Core evaluation does not use `Date.now()`,
`Math.random()`, or UUID generators as operational authority.

## What is not operational evidence

AI output, LLM summaries, Bedrock content, and dynamically generated prose
are never operational evidence. The SR-02 machine report contains
identifiers, versions, scores, states, fingerprints, causal paths, metrics,
and bounded static reason codes only.

AWS/live provider ingestion is not implemented in SR-02.
