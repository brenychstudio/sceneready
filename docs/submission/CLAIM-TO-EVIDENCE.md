# Claim to Evidence

This table maps currently supported SceneReady claims to implementation, tests,
live proof, and submission use. It covers the accepted SR-00 foundation through
SR-02 graph, readiness, and evidence-report work.

| Claim | Implementation | Test | Live proof | Submission use |
| --- | --- | --- | --- | --- |
| SceneReady is a clean-room public-ready competition repository | `docs/submission/HACKATHON-WORK.md`, `docs/submission/OPEN-SOURCE-CONTRIBUTION.md`, governance files | `tools/repository-audit/src/governance.test.ts` | Local/canonical repository proof: accepted SR-00 through SR-02 history. Public GitHub publication and first CI execution remain PENDING FIRST PUBLIC CI RUN | Provenance and originality evidence |
| Repository uses Apache-2.0 candidate licensing | `LICENSE`, `NOTICE` | `tools/repository-audit/src/governance.test.ts` | Tracked license files on canonical main | License compliance evidence |
| Strict Node 22 TypeScript monorepo exists | Root `package.json` engines and workspaces, `tsconfig*.json`, `.npmrc` | `tools/repository-audit/src/toolchain.test.ts`, `tools/repository-audit/src/workspace-layout.test.ts` | Local Node 22 / npm 10 validation and GitHub Actions CI | Toolchain identity evidence |
| Dependency boundaries are enforced | `tools/repository-audit/src/dependency-boundaries.ts`, `docs/architecture/DEPENDENCY-RULES.md` | `tools/repository-audit/src/dependency-boundaries.test.ts` | Local repository audit reports zero dependency-boundary violations | Architecture purity evidence |
| Public repository boundary is enforced | `tools/repository-audit/src/public-boundary.ts`, `tools/repository-audit/src/credential-patterns.ts` | `tools/repository-audit/src/public-boundary.test.ts`, `npm run audit:public-boundary` | Local `PUBLIC_BOUNDARY=PASS` and GitHub Actions Security | Secret and personal-data hygiene evidence |
| CI validates pull requests and main | `.github/workflows/ci.yml` | `tools/repository-audit/src/ci-contract.test.ts` | GitHub Actions CI on canonical `main` | Mandatory pull-request and main validation evidence |
| CI security workflow generates CycloneDX SBOM evidence | `.github/workflows/security.yml` | `tools/repository-audit/src/ci-contract.test.ts` | GitHub Actions Security on canonical `main` | Dependency and SBOM evidence |
| Canonical Barcelona production pack validates and fingerprints deterministically | `packages/production-pack/src`, `fixtures/barcelona-aer-ss27` | `packages/production-pack/src/validate.test.ts`, `fixtures/barcelona-aer-ss27/fixture.test.ts` | Pack fingerprint `13a1183c848d5762764da1f646f2ffc97321f976bb8c3ff340425a99117263be` | Production-pack identity evidence |
| Evidence envelopes and conflicts are deterministic | `packages/evidence/src` | `packages/evidence/src/envelope.test.ts`, `packages/evidence/src/conflicts.test.ts` | Local evidence package tests | Evidence-authority evidence |
| Typed production graph compiles to SR-GRAPH-v1 | `packages/production-graph/src/compile.ts` | `packages/production-graph/src/compile.test.ts` | Graph fingerprint from `compileProductionGraph` | Graph identity evidence |
| Causal risk propagation traces weather drift to D2 | `packages/production-graph/src/propagate.ts`, `packages/production-graph/src/trace.ts` | `packages/production-graph/src/propagate.test.ts` | Path `EVIDENCE-WEATHER-DRIFT` → `DELIVERABLE-D2` | Causal-impact evidence |
| Five hard gates and six domains evaluate fail-closed | `packages/readiness-engine/src/gates.ts`, `packages/readiness-engine/src/domain-health.ts` | `packages/readiness-engine/src/gates.test.ts` | Missing proof remains `UNRESOLVED`, not `FAILED` | Gate and domain-health evidence |
| SR-SCORE-v1 certifies R0/R1/R2 protected assessments | `packages/readiness-engine/src/scoring.ts`, `packages/readiness-engine/src/evaluate.ts` | `packages/readiness-engine/src/evaluate.test.ts` | R0 78/94/BLOCKED/CERTIFIED; R1 86/96/READY/CERTIFIED; R2 74/96/AT_RISK/CERTIFIED | Readiness and certification evidence |
| Production phase lifecycle bounds activity mutation | `packages/domain/src/lifecycle.ts` | `packages/readiness-engine/src/lifecycle.test.ts` | `EIXAMPLE_ACTIVE` + `COMPLETED` + `SHIFT_ACTIVITY` => `ACTIVITY_IMMUTABLE_AFTER_COMPLETION` | Lifecycle evidence |
| Outcome metrics are evidence-backed and do not invent money | `packages/readiness-engine/src/outcomes.ts` | `packages/readiness-engine/src/lifecycle.test.ts` | R2-to-recovered comparison: 2 protected CRITICAL deliverables, 15 minute studio-delay reduction, `monetaryImpact=null` | Operational-outcome evidence |
| SR-02 machine evidence report is generated from core functions | `tools/evidence-report/src/sr02-report.ts`, `docs/architecture/READINESS-MATHEMATICS.md`, `docs/architecture/EVIDENCE-AUTHORITY.md` | `tools/evidence-report/src/sr02-report.test.ts` | `npx tsx tools/evidence-report/src/sr02-report.ts` emits `SR-02-EVIDENCE-REPORT-v1` JSON | Competition evidence report |

Unsupported product capabilities, including Shadow Simulation, recovery options,
SR-03 intervention policy, AWS/Alexa/Bedrock runtime, and Judge Console, are
omitted until a later milestone implements them.
