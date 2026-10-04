# Security Audit Policy v1.1

Policy version: `SR-SECURITY-AUDIT-POLICY-v1.1`

This policy is the repository security gate for npm advisories. It does not say
that the full dependency tree is clean.

The gate reports three separate results:

```text
PRODUCTION_RUNTIME_AUDIT=PASS
TOOLCHAIN_AUDIT=PASS_WITH_EXACT_UPSTREAM_EXCEPTION
FULL_NPM_AUDIT_RAW=HIGH_PRESENT
```

`FULL_NPM_AUDIT_RAW=HIGH_PRESENT` means the raw `npm audit` of the whole
install tree still reports a High. That raw result is evidence. It is not
relabeled as `HIGH=0`.

## Runtime gate

`aws-cdk-lib` is a devDependency of `@sceneready/infrastructure-cdk` and is not
declared by the MCP runtime, services, authority, or communications packages.
The production/runtime dependency audit is:

```text
npm audit --omit=dev --audit-level=high
```

That command is necessary and not sufficient. The gate also inspects the local
ARM64 image `sceneready-mcp:local`, built from `apps/mcp-runtime/Dockerfile`.
The image copies runtime source only. It does not copy `node_modules`.

Required runtime result:

```text
RUNTIME_HIGH=0
RUNTIME_CRITICAL=0
RUNTIME_HAS_AWS_CDK_LIB=NO
RUNTIME_HAS_VULNERABLE_BRACE_EXPANSION=NO
```

`RUNTIME_HAS_VULNERABLE_BRACE_EXPANSION` refers to brace-expansion in the active
range `4.0.0` through `5.0.11`. The official Node 22 slim image may contain
npm's own brace-expansion `2.0.2`. That copy is outside this advisory range.
A copy inside the active range fails the gate.

Any High or Critical in the production/runtime audit fails closed. A runtime
import of `aws-cdk-lib` or `constructs`, or either package appearing in the
final image, fails closed with
`VULNERABLE_CDK_DEPENDENCY_RUNTIME_REACHABLE`.

## Toolchain exception

`docs/security/TOOLCHAIN-ADVISORIES.json` may allow only the exact bundled
advisory set recorded there.

Current exception:

```text
STATUS=APPROVED_TEMPORARY_UPSTREAM_EXCEPTION
SCOPE=BUILD_TOOLCHAIN_ONLY
package=brace-expansion
installedVersion=5.0.9
dependencyPath=node_modules/aws-cdk-lib/node_modules/brace-expansion
upstreamPackage=aws-cdk-lib
upstreamVersion=2.272.0
advisoryIds=GHSA-6j4f-fj2g-mc7p GHSA-q2hr-2g5m-vwhr GHSA-qhr7-859c-m2p7
```

Eligibility, all of which were checked before this exception was added:

1. The vulnerable package is bundled inside official `aws-cdk-lib`.
2. `2.272.0` was the newest official release at approval.
3. `npm audit fix` reports the bundled copy cannot be replaced.
4. The deployed runtime image does not contain that copy.
5. Runtime source does not import `aws-cdk-lib` or `constructs`.
6. CDK synthesis is build tooling. Production and user input is not passed into
   brace-expansion.
7. No Critical advisory is present.
8. The exception names the exact package, version, path, and advisory set.
9. Any additional High fails the gate.
10. The exception expires when a fixed official `aws-cdk-lib` release exists.

The validator fails closed when the package, version, path, upstream package,
upstream version, or advisory set differs; when a new High or any Critical
appears; when `runtimeReachable` is true; or when an official fixed
`aws-cdk-lib` release exists.

## Expiry

Every run executes `npm view aws-cdk-lib version` and compares the published
tarball identity with the lockfile. When the newest official release is no
longer the pinned tarball, the run inspects that release's bundled
brace-expansion. If the bundled copy is absent or outside
`4.0.0`–`5.0.11`, the gate fails:

```text
STATUS=FAIL
REASON=UPSTREAM_PATCH_AVAILABLE
```

CI must not auto-upgrade `aws-cdk-lib`. A newer official release that still
bundles the same vulnerable brace-expansion does not clear the advisory and
does not by itself expire the exception.

## Prohibited workarounds

The gate rejects:

- unofficial `aws-cdk-lib` forks
- `@depup/aws-cdk-lib`
- npm `overrides` or `resolutions` used to rewrite this tree
- `preinstall`, `install`, or `postinstall` scripts that patch `aws-cdk-lib` or
  brace-expansion
- manual `node_modules` replacement
- lockfile entries whose `aws-cdk-lib` tarball is not the official npm registry
  package

## Command

```text
npm run audit:security
powershell -ExecutionPolicy Bypass -File scripts/security-audit.ps1
```

Raw `npm audit --json` is written to `artifacts/local/sr05-npm-audit.json`.
That directory is gitignored. The security workflow uploads it as evidence.
