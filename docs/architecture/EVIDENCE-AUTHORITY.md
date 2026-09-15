# Evidence Authority

This document describes the implemented SR-02 evidence-authority boundary. It
does not change Task-2 conflict semantics or Task-5 gate semantics.

## Trust states

Canonical evidence trust states remain:

`LIVE`, `CONFIRMED`, `RECORDED`, `FALLBACK`, `STALE`, `MISSING`

## Failure versus uncertainty

`MISSING PROOF` is not `PROVEN FAILURE`.

- A missing, conflicted, or stale required proof yields `UNRESOLVED` gate and
  domain health, not an invented `FAILED` result.
- A confirmed negative operational fact, such as a `DENIED` model-release
  validity proof, may support a known `FAILED` rights gate.
- Unresolved required evidence prevents `READY` and prevents `CERTIFIED`.
- Unresolved required evidence does not by itself create `BLOCKED`.

## Fingerprints

Content fingerprints use the existing canonical SHA-256 of canonical JSON:

- production pack / fixture: `fingerprintProductionPack`
- evidence envelopes: `fingerprintEvidenceContent` / `contentFingerprint`
- production graph: `ProductionGraph.fingerprint`

Collections of evidence IDs and fingerprints are unique and lexicographically
sorted. Core evaluation does not use `Date.now()`, `Math.random()`, or UUID
generators as operational authority.

## Report generation

The SR-02 machine evidence report is generated from the same deterministic
functions used for pack validation, graph compilation, causal propagation, and
readiness evaluation. Protected R0/R1/R2 numbers are verified against computed
output. They are not substituted by scenario-name branches.
