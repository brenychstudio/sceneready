import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACTIVE_BRACE_ADVISORY_IDS,
  APPROVED_EXCEPTION_SCOPE,
  APPROVED_EXCEPTION_STATUS,
  BUNDLED_BRACE_DEPENDENCY_PATH,
  SECURITY_AUDIT_POLICY_VERSION,
  braceVersionIsActivelyVulnerable,
  evaluateSecurityAudit,
  findCdkSynthesisImportsInSources,
  findProhibitedToolchainRepacks,
  findRepositoryRuntimeCdkImports,
  officialBundledAdvisoryResolved,
  parseNpmAuditDocument,
  parseToolchainAdvisoryDocument,
  readInstalledCdkToolchain,
  type SecurityAuditEvaluationInput,
  type ToolchainAdvisory,
} from './security-audit.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function acceptedException(): ToolchainAdvisory {
  return {
    packageName: 'brace-expansion',
    installedVersion: '5.0.9',
    dependencyPath: BUNDLED_BRACE_DEPENDENCY_PATH,
    upstreamPackage: 'aws-cdk-lib',
    upstreamVersion: '2.272.0',
    advisoryIds: [...ACTIVE_BRACE_ADVISORY_IDS],
    severity: 'high',
    reason: 'bundled upstream copy',
    runtimeReachable: false,
    officialFixAvailable: false,
    firstObserved: '2026-10-04',
    reviewRule: 'exact match only',
    expiryRule: 'expire when an official fixed release exists',
  };
}

function acceptedInput(): SecurityAuditEvaluationInput {
  return {
    fullHighAdvisories: [
      {
        packageName: 'brace-expansion',
        severity: 'high',
        nodes: [BUNDLED_BRACE_DEPENDENCY_PATH],
        advisoryIds: [...ACTIVE_BRACE_ADVISORY_IDS],
      },
    ],
    fullCriticalAdvisories: [],
    fullHighCount: 1,
    fullCriticalCount: 0,
    runtimeHighCount: 0,
    runtimeCriticalCount: 0,
    allowlist: [acceptedException()],
    allowlistStatus: APPROVED_EXCEPTION_STATUS,
    allowlistScope: APPROVED_EXCEPTION_SCOPE,
    allowlistPolicyVersion: SECURITY_AUDIT_POLICY_VERSION,
    installedBraceVersion: '5.0.9',
    installedBracePath: BUNDLED_BRACE_DEPENDENCY_PATH,
    installedBraceInBundle: true,
    installedUpstreamVersion: '2.272.0',
    upstreamIsDevDependency: true,
    latestUpstreamVersion: '2.272.0',
    latestBundledBraceVersion: '5.0.9',
    runtimeHasAwsCdkLib: false,
    runtimeVulnerableBracePaths: [],
    runtimeCdkImports: [],
    prohibitedFindings: [],
  };
}

describe('brace-expansion advisory range', () => {
  it('treats 4.0.0 through 5.0.11 as the active advisory range', () => {
    expect(braceVersionIsActivelyVulnerable('4.0.0')).toBe(true);
    expect(braceVersionIsActivelyVulnerable('5.0.9')).toBe(true);
    expect(braceVersionIsActivelyVulnerable('5.0.11')).toBe(true);
    expect(braceVersionIsActivelyVulnerable('5.0.12')).toBe(false);
    expect(braceVersionIsActivelyVulnerable('2.0.2')).toBe(false);
    expect(braceVersionIsActivelyVulnerable('not-a-version')).toBe(true);
  });

  it('treats a missing or fixed bundled copy as an available official fix', () => {
    expect(officialBundledAdvisoryResolved(null)).toBe(true);
    expect(officialBundledAdvisoryResolved('5.0.12')).toBe(true);
    expect(officialBundledAdvisoryResolved('5.0.9')).toBe(false);
  });
});

describe('toolchain security gate', () => {
  it('accepts only the exact bundled CDK advisory', () => {
    const result = evaluateSecurityAudit(acceptedInput());

    expect(result.status).toBe('PASS');
    expect(result.productionRuntimeAudit).toBe('PASS');
    expect(result.toolchainAudit).toBe('PASS_WITH_EXACT_UPSTREAM_EXCEPTION');
    expect(result.fullNpmAuditRaw).toBe('HIGH_PRESENT');
    expect(result.rawHighCount).toBe(1);
    expect(result.rawCriticalCount).toBe(0);
    expect(result.officialFixAvailable).toBe(false);
  });

  it('passes a clean tree without an exception', () => {
    const result = evaluateSecurityAudit({
      ...acceptedInput(),
      fullHighAdvisories: [],
      fullHighCount: 0,
      allowlist: [],
      allowlistStatus: '',
      allowlistScope: '',
      latestBundledBraceVersion: '5.0.12',
    });

    expect(result.status).toBe('PASS');
    expect(result.toolchainAudit).toBe('PASS');
    expect(result.fullNpmAuditRaw).toBe('CLEAN');
  });

  it('fails closed when another High appears', () => {
    const input = acceptedInput();
    const result = evaluateSecurityAudit({
      ...input,
      fullHighCount: 2,
      fullHighAdvisories: [
        ...input.fullHighAdvisories,
        {
          packageName: 'left-pad',
          severity: 'high',
          nodes: ['node_modules/left-pad'],
          advisoryIds: ['GHSA-extra-high'],
        },
      ],
    });

    expect(result.status).toBe('FAIL');
    expect(result.reasons).toContain('UNEXPECTED_HIGH_ADVISORY');
  });

  it('fails closed when a Critical advisory appears', () => {
    const result = evaluateSecurityAudit({
      ...acceptedInput(),
      fullCriticalCount: 1,
      fullCriticalAdvisories: [
        {
          packageName: 'example',
          severity: 'critical',
          nodes: ['node_modules/example'],
          advisoryIds: ['GHSA-critical'],
        },
      ],
    });

    expect(result.status).toBe('FAIL');
    expect(result.reasons[0]).toBe('CRITICAL_ADVISORY_PRESENT');
    expect(result.fullNpmAuditRaw).toBe('CRITICAL_PRESENT');
  });

  it('fails closed when the installed version, path, or advisory set changes', () => {
    expect(
      evaluateSecurityAudit({ ...acceptedInput(), installedBraceVersion: '5.0.10' }).reasons,
    ).toContain('TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH');
    expect(
      evaluateSecurityAudit({
        ...acceptedInput(),
        installedBracePath: 'node_modules/brace-expansion',
        fullHighAdvisories: [
          {
            packageName: 'brace-expansion',
            severity: 'high',
            nodes: ['node_modules/brace-expansion'],
            advisoryIds: [...ACTIVE_BRACE_ADVISORY_IDS],
          },
        ],
      }).reasons,
    ).toContain('TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH');
    const input = acceptedInput();
    const observed = input.fullHighAdvisories[0];
    expect(observed).toBeDefined();
    if (observed === undefined) {
      return;
    }
    expect(
      evaluateSecurityAudit({
        ...input,
        fullHighAdvisories: [
          { ...observed, advisoryIds: [...observed.advisoryIds, 'GHSA-new-advisory'] },
        ],
      }).reasons,
    ).toContain('TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH');
  });

  it('fails closed when the exception claims runtime reachability', () => {
    const input = acceptedInput();
    const entry = input.allowlist[0];
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const result = evaluateSecurityAudit({
      ...input,
      allowlist: [{ ...entry, runtimeReachable: true }],
    });

    expect(result.reasons).toContain('TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH');
  });

  it('fails closed when the runtime audit or image still contains the advisory', () => {
    expect(evaluateSecurityAudit({ ...acceptedInput(), runtimeHighCount: 1 }).reasons).toContain(
      'UNEXPECTED_HIGH_ADVISORY',
    );
    expect(
      evaluateSecurityAudit({ ...acceptedInput(), runtimeHasAwsCdkLib: true }).reasons,
    ).toContain('VULNERABLE_CDK_DEPENDENCY_RUNTIME_REACHABLE');
    expect(
      evaluateSecurityAudit({
        ...acceptedInput(),
        runtimeVulnerableBracePaths: ['/usr/local/lib/node_modules/brace-expansion'],
      }).reasons,
    ).toContain('VULNERABLE_CDK_DEPENDENCY_RUNTIME_REACHABLE');
  });

  it('fails closed when runtime source imports CDK synthesis packages', () => {
    const result = evaluateSecurityAudit({
      ...acceptedInput(),
      runtimeCdkImports: [
        { path: 'apps/mcp-runtime/src/index.ts', line: 1, specifier: 'aws-cdk-lib' },
      ],
    });

    expect(result.productionRuntimeAudit).toBe('FAIL');
    expect(result.reasons).toContain('VULNERABLE_CDK_DEPENDENCY_RUNTIME_REACHABLE');
  });

  it('fails closed when an official fixed aws-cdk-lib release exists', () => {
    expect(
      evaluateSecurityAudit({ ...acceptedInput(), latestBundledBraceVersion: '5.0.12' }).reasons,
    ).toContain('UPSTREAM_PATCH_AVAILABLE');
    expect(
      evaluateSecurityAudit({ ...acceptedInput(), latestBundledBraceVersion: null }).reasons,
    ).toContain('UPSTREAM_PATCH_AVAILABLE');
    const input = acceptedInput();
    const entry = input.allowlist[0];
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    expect(
      evaluateSecurityAudit({
        ...input,
        allowlist: [{ ...entry, officialFixAvailable: true }],
      }).reasons,
    ).toContain('TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH');
  });

  it('fails closed for unofficial CDK packages and overrides', () => {
    const result = evaluateSecurityAudit({
      ...acceptedInput(),
      prohibitedFindings: ['package.json: unofficial aws-cdk-lib package @depup/aws-cdk-lib'],
    });

    expect(result.reasons).toContain('TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH');
  });
});

describe('runtime CDK import boundary', () => {
  it('flags aws-cdk-lib and constructs imports in runtime source', () => {
    const findings = findCdkSynthesisImportsInSources({
      'apps/mcp-runtime/src/index.ts':
        "import { App } from 'aws-cdk-lib';\nimport type { Construct } from 'constructs';\n",
      'services/risk-watch/src/handler.ts': 'export const ready = true;\n',
    });

    expect(findings.map((finding) => finding.specifier)).toEqual(['aws-cdk-lib', 'constructs']);
  });

  it('does not flag CDK imports outside the runtime roots', async () => {
    await expect(findRepositoryRuntimeCdkImports(repositoryRoot)).resolves.toEqual([]);
  });
});

describe('prohibited toolchain repacks', () => {
  it('rejects forks, overrides, and install-script patches', () => {
    const findings = findProhibitedToolchainRepacks(
      {
        'package.json': JSON.stringify({
          overrides: { 'brace-expansion': '5.0.12' },
          scripts: { postinstall: 'patch aws-cdk-lib' },
          dependencies: { '@depup/aws-cdk-lib': '1.0.0' },
        }),
      },
      JSON.stringify({
        packages: {
          'node_modules/aws-cdk-lib': {
            version: '2.272.0',
            resolved: 'https://example.invalid/aws-cdk-lib.tgz',
            integrity: 'sha512-test',
            dev: true,
          },
        },
      }),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('npm overrides'),
        expect.stringContaining('postinstall'),
        expect.stringContaining('@depup/aws-cdk-lib'),
        expect.stringContaining('official npm registry'),
      ]),
    );
  });
});

describe('committed toolchain exception', () => {
  it('matches the installed official CDK bundle and dev-only classification', () => {
    const allowlist = parseToolchainAdvisoryDocument(
      JSON.parse(
        readFileSync(join(repositoryRoot, 'docs/security/TOOLCHAIN-ADVISORIES.json'), 'utf8'),
      ),
    );
    const installed = readInstalledCdkToolchain(
      readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'),
    );
    const infrastructure = JSON.parse(
      readFileSync(join(repositoryRoot, 'infrastructure/cdk/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    expect(allowlist.ok).toBe(true);
    if (!allowlist.ok) {
      return;
    }
    expect(allowlist.document.policyVersion).toBe(SECURITY_AUDIT_POLICY_VERSION);
    expect(allowlist.document.status).toBe(APPROVED_EXCEPTION_STATUS);
    expect(allowlist.document.scope).toBe(APPROVED_EXCEPTION_SCOPE);
    expect(allowlist.document.advisories.map((entry) => entry.advisoryIds)).toEqual([
      [...ACTIVE_BRACE_ADVISORY_IDS],
    ]);
    expect(installed.braceVersion).toBe('5.0.9');
    expect(installed.braceInBundle).toBe(true);
    expect(installed.upstreamVersion).toBe('2.272.0');
    expect(installed.upstreamDev).toBe(true);
    expect(installed.upstreamResolved).toMatch(
      /^https:\/\/registry\.npmjs\.org\/aws-cdk-lib\/-\/aws-cdk-lib-2\.272\.0\.tgz$/,
    );
    expect(infrastructure.dependencies).toBeUndefined();
    expect(infrastructure.devDependencies?.['aws-cdk-lib']).toBe('2.272.0');

    const entry = allowlist.document.advisories[0];
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const result = evaluateSecurityAudit({
      ...acceptedInput(),
      allowlist: allowlist.document.advisories,
      allowlistStatus: allowlist.document.status,
      allowlistScope: allowlist.document.scope,
      allowlistPolicyVersion: allowlist.document.policyVersion,
      installedBraceVersion: installed.braceVersion,
      installedUpstreamVersion: installed.upstreamVersion,
      upstreamIsDevDependency: installed.upstreamDev,
      installedBraceInBundle: installed.braceInBundle,
      fullHighAdvisories: [
        {
          packageName: entry.packageName,
          severity: 'high',
          nodes: [entry.dependencyPath],
          advisoryIds: entry.advisoryIds,
        },
      ],
    });
    expect(result.status).toBe('PASS');
    expect(result.toolchainAudit).toBe('PASS_WITH_EXACT_UPSTREAM_EXCEPTION');
  });

  it('parses the current npm advisory identity without inventing ids', () => {
    const audit = parseNpmAuditDocument(
      JSON.stringify({
        metadata: { vulnerabilities: { high: 1, critical: 0 } },
        vulnerabilities: {
          'brace-expansion': {
            name: 'brace-expansion',
            severity: 'high',
            nodes: [BUNDLED_BRACE_DEPENDENCY_PATH],
            via: [
              { url: 'https://github.com/advisories/GHSA-q2hr-2g5m-vwhr', severity: 'moderate' },
              { url: 'https://github.com/advisories/GHSA-qhr7-859c-m2p7', severity: 'high' },
              { url: 'https://github.com/advisories/GHSA-6j4f-fj2g-mc7p', severity: 'high' },
            ],
          },
        },
      }),
    );

    expect(audit.highCount).toBe(1);
    expect(audit.criticalCount).toBe(0);
    expect(audit.highAdvisories[0]?.advisoryIds).toEqual([
      'GHSA-q2hr-2g5m-vwhr',
      'GHSA-qhr7-859c-m2p7',
      'GHSA-6j4f-fj2g-mc7p',
    ]);
  });

  it('documents the raw High and forbids repacks', () => {
    const policy = readFileSync(
      join(repositoryRoot, 'docs/architecture/SECURITY-AUDIT-POLICY.md'),
      'utf8',
    );
    const dockerfile = readFileSync(join(repositoryRoot, 'apps/mcp-runtime/Dockerfile'), 'utf8');

    expect(policy).toContain(SECURITY_AUDIT_POLICY_VERSION);
    expect(policy).toContain('FULL_NPM_AUDIT_RAW=HIGH_PRESENT');
    expect(policy).toContain('@depup/aws-cdk-lib');
    expect(policy).not.toMatch(/full-tree audit is clean/i);
    expect(dockerfile).not.toMatch(/node_modules/);
    expect(dockerfile).not.toMatch(/npm\s+ci/);
  });
});
