# Dependency Rules

This document describes the dependency and public-repository boundary rules that
SceneReady actually enforces in `tools/repository-audit`. It is not an
aspirational roadmap.

## 1. Purpose

SceneReady separates deterministic, pure operational logic from runtime, cloud,
and UI adapters.

Locked pure packages must remain free of AWS, CDK, Strands, React, and MCP
runtime coupling so domain, evidence, replay, and ranking logic can be reasoned
about without pulling in cloud SDKs or presentation frameworks. Adapter
workspaces (`apps/*`, selected `packages/*` such as agent and presentation,
`services/*`, `infrastructure/*`, and `tools/*`) may use those families when
their role requires it.

## 2. Locked Pure Package Set

The following workspace packages are locked as pure:

- `@sceneready/domain`
- `@sceneready/production-pack`
- `@sceneready/evidence`
- `@sceneready/production-graph`
- `@sceneready/readiness-engine`
- `@sceneready/solar-engine`
- `@sceneready/intervention-engine`
- `@sceneready/shadow-simulation`
- `@sceneready/recovery-ranking`
- `@sceneready/mcp-human-authority`
- `@sceneready/communications`
- `@sceneready/replay`

This set is encoded as `LOCKED_PURE_PACKAGES` in
`tools/repository-audit/src/dependency-boundaries.ts`.

## 3. Forbidden Pure Dependencies

Locked pure packages must not import or declare the following families.

| Family       | Implemented match                                    | Violation code                     |
| ------------ | ---------------------------------------------------- | ---------------------------------- |
| AWS SDK      | `@aws-sdk/*`, `aws-sdk`                              | `PURE_PACKAGE_IMPORTS_AWS`         |
| CDK coupling | `aws-cdk-lib`, `aws-cdk`, `@aws-cdk/*`, `constructs` | `PURE_PACKAGE_IMPORTS_CDK`         |
| Strands      | `@strands-agents/*`                                  | `PURE_PACKAGE_IMPORTS_STRANDS`     |
| React        | `react`, `react-dom`                                 | `PURE_PACKAGE_IMPORTS_REACT`       |
| MCP runtime  | `@modelcontextprotocol/*`                            | `PURE_PACKAGE_IMPORTS_MCP_RUNTIME` |

Matching uses explicit package identities or explicit package-family prefixes
only. Package names are not classified by generic substring search.

AWS Bedrock and AgentCore SDK packages are forbidden only because they are
`@aws-sdk/*` modules, for example `@aws-sdk/client-bedrock-runtime`. Arbitrary
package names that merely contain `bedrock`, `agentcore`, or `agent-core` are
not forbidden unless they independently match one of the families above.

Enforcement applies to both:

- source module specifiers; and
- `dependencies`, `devDependencies`, `peerDependencies`, and
  `optionalDependencies` in the locked pure package's `package.json`.

Root toolchain manifests and non-pure workspaces are not subject to these
family bans. A manifest finding is omitted when source in the same workspace
already reports the same forbidden family, so one coupling is not double-counted
as both an import and a declaration.

## 4. Workspace Import Rules

Cross-workspace imports must use public `@sceneready/*` package entry points.

Implemented rules:

- No `@sceneready` deep imports through `src` or `dist` subpaths
  (`SCENEREADY_DEEP_IMPORT`).
- No relative filesystem escape into another workspace
  (`CROSS_WORKSPACE_RELATIVE_IMPORT`).
- `packages/*` must not import `apps/*` source, including public app workspace
  entry points (`PACKAGE_IMPORTS_APP_LAYER`).
- `packages/*` must not import `services/*` source
  (`PACKAGE_IMPORTS_SERVICE_LAYER`).
- `packages/*` must not import `infrastructure/*` source
  (`PACKAGE_IMPORTS_INFRASTRUCTURE_LAYER`).

When a layer finding already fully describes a relative import, a duplicate
relative-escape finding is not emitted.

## 5. Static Analysis

Module-specifier analysis uses the TypeScript compiler API
(`ts.createSourceFile` and AST walk), not regex-only import matching.

Handled forms:

- `ImportDeclaration`
- `ExportDeclaration` with `moduleSpecifier`
- `import type` / import-type nodes
- `import equals` with an external module reference
- dynamic `import()` with a static string literal
- `require()` with a static string literal

If a dynamic or import-type module specifier is not a string literal, analysis
fails closed with `DependencyBoundaryAnalysisError`. Invalid package manifests
also fail closed.

Real-repository analysis walks TypeScript sources and `package.json` files,
skipping generated trees such as `node_modules`, `dist`, `coverage`, and
`cdk.out`. Tests may supply an in-memory file map instead.

Violations are sorted by path, then line, then code, then module specifier.
Paths are repository-relative with forward slashes.

## 6. Public Repository Boundary

Adjacent enforcement lives in `auditPublicBoundary` and
`npm run audit:public-boundary`. SceneReady is public-by-design; tracked source
must not contain active credentials, private local filesystem locations, real
personal data, or sensitive env files.

Implemented behavior:

- Scan Git-tracked files only, via `execFile` of `git ls-files -z` (no shell).
- High-confidence credential shapes: AWS access-key ids, Bearer tokens, PEM
  private-key blocks, and obvious non-placeholder password / API-key
  assignments.
- Private filesystem paths: any standalone Windows drive-absolute path (a drive
  letter, a colon, then `\` or `/`, then a path; any drive letter; any first
  directory), POSIX `/home/<name>/` and `/Users/<name>/`, and those same
  locations when embedded in local `file:` URLs.
- Ordinary network URL pathnames (for example `https://`) are not treated as
  local filesystem paths merely because a pathname segment resembles a drive
  path, `Users`, or `home`. `file:` URLs are local filesystem context.
- High-confidence personal data: international `+` phone numbers of realistic
  length, and email-like addresses except reserved public-safe domains
  (`example.com`, `example.net`, `example.org`, and `*.invalid` / `*.test` /
  `*.example`).
- Tracked sensitive env files by basename: `.env`, `.env.local`,
  `.env.production`, `.env.staging`. `.env.example` is allowed. Dotfiles such as
  `.npmrc` are not flagged merely because they begin with a dot.
- NUL-containing content is treated as binary, skipped for text-pattern
  matching, and counted.
- Findings expose `code`, repository-relative `path`, `line`, and
  `redactedPreview`. Discovered secret values are not reproduced in results,
  JSON serialization, or CLI output.
- Git enumeration failure and tracked-file read failure fail closed as distinct
  internal audit errors. They do not return a clean result.

The public-boundary scan does not globally exclude `tools/repository-audit`,
tests, documentation, or Markdown. Self-scan cleanliness is achieved with
precise patterns and fragment-constructed fixtures, not broad allowlists.

## 7. Hard Failure Semantics

A policy violation is a hard failure for competition validation. There is no
warning-only competition mode.

- Dependency-boundary policy violations are returned as a sorted violation list.
  Focused tests require that list to be empty for the current repository.
- Public-boundary policy violations cause `npm run audit:public-boundary` to
  print redacted findings and exit non-zero.
- Internal audit failure is distinct from policy violation. Public-boundary
  enumeration/read failures throw `PublicBoundaryAuditError` and the CLI exits
  with a distinct non-zero code. Dependency analysis failures throw
  `DependencyBoundaryAnalysisError`. Both fail closed.

## 8. Future CI Boundary

SR-00C provides repository audit primitives and tests:

- `auditDependencyBoundaries`
- `auditPublicBoundary`
- `npm run audit:public-boundary`
- focused Vitest files under `tools/repository-audit/src`

SR-00D will wire them into GitHub CI and security workflows.

This repository does not currently claim that those GitHub workflows exist.
