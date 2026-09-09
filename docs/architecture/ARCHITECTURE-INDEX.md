# Architecture Authority Index

This index records the checksum-frozen SceneReady design authority imported in
SR-00E. The three files below are the approved v1.0 authority set. Modifications
require an explicit reviewed authority or version change.

## Authority hierarchy

1. PRIMARY NORMATIVE AUTHORITY — SceneReady Canonical Design v1.0
2. COMPETITION CONTEXT AUTHORITY — SceneReady Competition Brief v1.0
3. IMPLEMENTATION INTERPRETATION AUTHORITY — SceneReady Implementation Interpretations v1.0

Canonical Design v1.0 is the primary normative design authority. The Competition
Brief v1.0 is competition framing and evidence context. Implementation
Interpretations v1.0 are bounded implementation clarifications and do not replace the canonical design.
They cannot silently alter product thesis, authority model, scope, tracks, or
canonical R0→R4 behavior.

## Frozen identities

| Authority role                          | Repository path                                                                       | Byte count | SHA-256                                                            | Status          |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ | --------------- |
| PRIMARY NORMATIVE AUTHORITY             | `docs/superpowers/specs/2026-09-04-sceneready-canonical-design-v1.0.md`               | 11051      | `f54b5d562c437c6ea3c342795a1ee264e038fb99f2ebe5f1e7d885827e3e22e5` | checksum-frozen |
| COMPETITION CONTEXT AUTHORITY           | `docs/superpowers/specs/2026-09-04-sceneready-competition-brief-v1.0.md`              | 1317       | `5dadafb25d99fe8e81f7d07cea5083b9bd2e25b00c73bf272d96aa9753963042` | checksum-frozen |
| IMPLEMENTATION INTERPRETATION AUTHORITY | `docs/superpowers/specs/2026-09-04-sceneready-implementation-interpretations-v1.0.md` | 2539       | `d015befc7a3232d108107fa73c881b249f96d0a64682e5768f9305d809d6f2c6` | checksum-frozen |

All three files are checksum-frozen.

## Local design baseline tag

After independent acceptance and canonical integration, the expected local
design baseline tag is `v0.0.0-design`. That tag is not created in this import
stage. The public tag URL remains pending first public repository push.
