# Claim to Evidence

This table maps currently supported SceneReady foundation claims to implementation,
tests, live proof, and submission use. It covers SR-00A through SR-00D only.

| Claim | Implementation | Test | Live proof | Submission use |
| --- | --- | --- | --- | --- |
| SceneReady is a clean-room public-ready competition repository | `docs/submission/HACKATHON-WORK.md`, `docs/submission/OPEN-SOURCE-CONTRIBUTION.md`, governance files | `tools/repository-audit/src/governance.test.ts` | Local/canonical repository proof: accepted SR-00A through SR-00C history. Public GitHub publication and first CI execution remain PENDING FIRST PUBLIC CI RUN | Provenance and originality evidence |
| Repository uses Apache-2.0 candidate licensing | `LICENSE`, `NOTICE` | `tools/repository-audit/src/governance.test.ts` | Tracked license files on canonical main. PENDING FIRST PUBLIC CI RUN | License compliance evidence |
| Strict Node 22 TypeScript monorepo exists | Root `package.json` engines and workspaces, `tsconfig*.json`, `.npmrc` | `tools/repository-audit/src/toolchain.test.ts`, `tools/repository-audit/src/workspace-layout.test.ts` | Local Node v22.23.2 / npm 10.9.8 validation. PENDING FIRST PUBLIC CI RUN | Toolchain identity evidence |
| Dependency boundaries are enforced | `tools/repository-audit/src/dependency-boundaries.ts`, `docs/architecture/DEPENDENCY-RULES.md` | `tools/repository-audit/src/dependency-boundaries.test.ts` | Local repository audit reports zero dependency-boundary violations. PENDING FIRST PUBLIC CI RUN | Architecture purity evidence |
| Public repository boundary is enforced | `tools/repository-audit/src/public-boundary.ts`, `tools/repository-audit/src/credential-patterns.ts` | `tools/repository-audit/src/public-boundary.test.ts`, `npm run audit:public-boundary` | Local `PUBLIC_BOUNDARY=PASS`. PENDING FIRST PUBLIC CI RUN | Secret and personal-data hygiene evidence |
| CI validates pull requests and main | `.github/workflows/ci.yml` | `tools/repository-audit/src/ci-contract.test.ts` | PENDING FIRST PUBLIC CI RUN | Mandatory pull-request and main validation evidence |
| CI security workflow generates CycloneDX SBOM evidence | `.github/workflows/security.yml` | `tools/repository-audit/src/ci-contract.test.ts` | Local `npm sbom --sbom-format=cyclonedx` produces CycloneDX JSON. PENDING FIRST PUBLIC CI RUN | Dependency and SBOM evidence |

Unsupported product capabilities are omitted until a later milestone implements them.
