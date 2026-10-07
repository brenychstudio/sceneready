import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

export const SECURITY_AUDIT_POLICY_VERSION = 'SR-SECURITY-AUDIT-POLICY-v1.1';
export const APPROVED_EXCEPTION_STATUS = 'APPROVED_TEMPORARY_UPSTREAM_EXCEPTION';
export const APPROVED_EXCEPTION_SCOPE = 'BUILD_TOOLCHAIN_ONLY';
export const RUNTIME_IMAGE = 'sceneready-mcp:local';
export const CDK_LOCK_PATH = 'node_modules/aws-cdk-lib';
export const BUNDLED_BRACE_DEPENDENCY_PATH =
  'node_modules/aws-cdk-lib/node_modules/brace-expansion';
export const ACTIVE_BRACE_ADVISORY_IDS = [
  'GHSA-6j4f-fj2g-mc7p',
  'GHSA-q2hr-2g5m-vwhr',
  'GHSA-qhr7-859c-m2p7',
] as const;

const AFFECTED_BRACE_MIN = '4.0.0';
const FIXED_BRACE_MIN = '5.0.12';
const OFFICIAL_CDK_TARBALL =
  /^https:\/\/registry\.npmjs\.org\/aws-cdk-lib\/-\/aws-cdk-lib-\d+\.\d+\.\d+\.tgz$/;
const REASON_PRIORITY = [
  'CRITICAL_ADVISORY_PRESENT',
  'VULNERABLE_CDK_DEPENDENCY_RUNTIME_REACHABLE',
  'UNEXPECTED_HIGH_ADVISORY',
  'UPSTREAM_PATCH_AVAILABLE',
  'TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH',
] as const;

const RUNTIME_CDK_IMPORT_ROOTS = [
  'apps/mcp-runtime/src',
  'services',
  'packages/authority',
  'packages/communications',
] as const;

const EXTRA_RUNTIME_MANIFESTS = ['apps/mcp-runtime/package.json'] as const;
const SKIP_DIRECTORIES = new Set([
  '.git',
  'artifacts',
  'cdk.out',
  'coverage',
  'dist',
  'node_modules',
]);
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export class SecurityAuditInternalError extends Error {
  constructor(detail: string) {
    super(`Security audit failed: ${detail}`);
    this.name = 'SecurityAuditInternalError';
  }
}

export interface ObservedAdvisory {
  readonly packageName: string;
  readonly severity: string;
  readonly nodes: readonly string[];
  readonly advisoryIds: readonly string[];
}

export interface NpmAuditFacts {
  readonly highCount: number;
  readonly criticalCount: number;
  readonly highAdvisories: readonly ObservedAdvisory[];
  readonly criticalAdvisories: readonly ObservedAdvisory[];
}

export interface ToolchainAdvisory {
  readonly packageName: string;
  readonly installedVersion: string;
  readonly dependencyPath: string;
  readonly upstreamPackage: string;
  readonly upstreamVersion: string;
  readonly advisoryIds: readonly string[];
  readonly severity: string;
  readonly reason: string;
  readonly runtimeReachable: boolean;
  readonly officialFixAvailable: boolean;
  readonly firstObserved: string;
  readonly reviewRule: string;
  readonly expiryRule: string;
}

export interface ToolchainAdvisoryDocument {
  readonly policyVersion: string;
  readonly status: string;
  readonly scope: string;
  readonly advisories: readonly ToolchainAdvisory[];
}

export type AllowlistParseResult =
  | { readonly ok: true; readonly document: ToolchainAdvisoryDocument }
  | { readonly ok: false; readonly reason: string };

export interface InstalledCdkToolchain {
  readonly upstreamVersion: string | null;
  readonly upstreamIntegrity: string | null;
  readonly upstreamDev: boolean;
  readonly upstreamResolved: string | null;
  readonly braceVersion: string | null;
  readonly braceInBundle: boolean;
}

export interface SecurityAuditEvaluationInput {
  readonly fullHighAdvisories: readonly ObservedAdvisory[];
  readonly fullCriticalAdvisories: readonly ObservedAdvisory[];
  readonly fullHighCount: number;
  readonly fullCriticalCount: number;
  readonly runtimeHighCount: number;
  readonly runtimeCriticalCount: number;
  readonly allowlist: readonly ToolchainAdvisory[];
  readonly allowlistStatus: string;
  readonly allowlistScope: string;
  readonly allowlistPolicyVersion: string;
  readonly installedBraceVersion: string | null;
  readonly installedBracePath: string | null;
  readonly installedBraceInBundle: boolean;
  readonly installedUpstreamVersion: string | null;
  readonly upstreamIsDevDependency: boolean;
  readonly latestUpstreamVersion: string;
  readonly latestBundledBraceVersion: string | null;
  readonly runtimeHasAwsCdkLib: boolean;
  readonly runtimeVulnerableBracePaths: readonly string[];
  readonly runtimeCdkImports: readonly RuntimeImportFinding[];
  readonly prohibitedFindings: readonly string[];
}

export interface RuntimeImportFinding {
  readonly path: string;
  readonly line: number;
  readonly specifier: string;
}

export interface SecurityAuditEvaluation {
  readonly status: 'PASS' | 'FAIL';
  readonly policyVersion: string;
  readonly productionRuntimeAudit: 'PASS' | 'FAIL';
  readonly toolchainAudit: 'PASS' | 'PASS_WITH_EXACT_UPSTREAM_EXCEPTION' | 'FAIL';
  readonly fullNpmAuditRaw: 'CLEAN' | 'HIGH_PRESENT' | 'CRITICAL_PRESENT';
  readonly runtimeHighCount: number;
  readonly runtimeCriticalCount: number;
  readonly rawHighCount: number;
  readonly rawCriticalCount: number;
  readonly officialFixAvailable: boolean;
  readonly reasons: readonly string[];
}

interface SpawnResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseSemver(version: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: string, right: string): number | null {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (parsedLeft === null || parsedRight === null) {
    return null;
  }
  const pairs: readonly (readonly [number, number])[] = [
    [parsedLeft[0], parsedRight[0]],
    [parsedLeft[1], parsedRight[1]],
    [parsedLeft[2], parsedRight[2]],
  ];
  for (const [leftPart, rightPart] of pairs) {
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

export function braceVersionIsActivelyVulnerable(version: string): boolean {
  const lower = compareSemver(version, AFFECTED_BRACE_MIN);
  const upper = compareSemver(version, FIXED_BRACE_MIN);
  if (lower === null || upper === null) {
    return true;
  }
  return lower >= 0 && upper < 0;
}

export function officialBundledAdvisoryResolved(bundledVersion: string | null): boolean {
  if (bundledVersion === null) {
    return true;
  }
  return !braceVersionIsActivelyVulnerable(bundledVersion);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function advisoryIdsFromVia(via: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of via) {
    if (!isRecord(entry) || typeof entry.url !== 'string') {
      continue;
    }
    for (const match of entry.url.matchAll(/GHSA-[0-9a-z-]+/g)) {
      const id = match[0];
      if (id !== undefined && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }
  return ids;
}

export function parseNpmAuditDocument(text: string): NpmAuditFacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    throw new SecurityAuditInternalError(
      `npm audit JSON could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed.metadata) || !isRecord(parsed.vulnerabilities)) {
    throw new SecurityAuditInternalError('npm audit JSON is missing metadata or vulnerabilities');
  }
  const counts = parsed.metadata.vulnerabilities;
  if (!isRecord(counts) || typeof counts.high !== 'number' || typeof counts.critical !== 'number') {
    throw new SecurityAuditInternalError('npm audit JSON is missing vulnerability counts');
  }

  const highAdvisories: ObservedAdvisory[] = [];
  const criticalAdvisories: ObservedAdvisory[] = [];
  for (const [key, value] of Object.entries(parsed.vulnerabilities)) {
    if (!isRecord(value) || typeof value.severity !== 'string' || !Array.isArray(value.nodes)) {
      throw new SecurityAuditInternalError(`npm audit vulnerability ${key} is malformed`);
    }
    const nodes = value.nodes.filter((node): node is string => typeof node === 'string');
    if (nodes.length !== value.nodes.length) {
      throw new SecurityAuditInternalError(`npm audit vulnerability ${key} has a non-string path`);
    }
    const advisory: ObservedAdvisory = {
      packageName: typeof value.name === 'string' ? value.name : key,
      severity: value.severity,
      nodes,
      advisoryIds: advisoryIdsFromVia(Array.isArray(value.via) ? value.via : []),
    };
    if (value.severity === 'high') {
      highAdvisories.push(advisory);
    } else if (value.severity === 'critical') {
      criticalAdvisories.push(advisory);
    }
  }

  return {
    highCount: counts.high,
    criticalCount: counts.critical,
    highAdvisories,
    criticalAdvisories,
  };
}

export function parseToolchainAdvisoryDocument(value: unknown): AllowlistParseResult {
  if (!isRecord(value)) {
    return { ok: false, reason: 'toolchain advisory document is not an object' };
  }
  const policyVersion = readString(value, 'policyVersion');
  const status = readString(value, 'status');
  const scope = readString(value, 'scope');
  if (policyVersion !== SECURITY_AUDIT_POLICY_VERSION || status === null || scope === null) {
    return { ok: false, reason: 'toolchain advisory document has an invalid policy header' };
  }
  if (!Array.isArray(value.advisories)) {
    return { ok: false, reason: 'toolchain advisory document is missing advisories' };
  }

  const advisories: ToolchainAdvisory[] = [];
  for (const entry of value.advisories) {
    if (!isRecord(entry)) {
      return { ok: false, reason: 'toolchain advisory entry is not an object' };
    }
    const packageName = readString(entry, 'package');
    const installedVersion = readString(entry, 'installedVersion');
    const dependencyPath = readString(entry, 'dependencyPath');
    const upstreamPackage = readString(entry, 'upstreamPackage');
    const upstreamVersion = readString(entry, 'upstreamVersion');
    const severity = readString(entry, 'severity');
    const reason = readString(entry, 'reason');
    const firstObserved = readString(entry, 'firstObserved');
    const reviewRule = readString(entry, 'reviewRule');
    const expiryRule = readString(entry, 'expiryRule');
    if (
      packageName === null ||
      installedVersion === null ||
      dependencyPath === null ||
      upstreamPackage === null ||
      upstreamVersion === null ||
      severity === null ||
      reason === null ||
      firstObserved === null ||
      reviewRule === null ||
      expiryRule === null ||
      typeof entry.runtimeReachable !== 'boolean' ||
      typeof entry.officialFixAvailable !== 'boolean' ||
      !Array.isArray(entry.advisoryIds)
    ) {
      return { ok: false, reason: 'toolchain advisory entry is missing a required field' };
    }
    const advisoryIds = entry.advisoryIds.filter((id): id is string => typeof id === 'string');
    if (
      advisoryIds.length !== entry.advisoryIds.length ||
      new Set(advisoryIds).size !== advisoryIds.length
    ) {
      return { ok: false, reason: 'toolchain advisory ids must be unique strings' };
    }
    advisories.push({
      packageName,
      installedVersion,
      dependencyPath,
      upstreamPackage,
      upstreamVersion,
      advisoryIds,
      severity,
      reason,
      runtimeReachable: entry.runtimeReachable,
      officialFixAvailable: entry.officialFixAvailable,
      firstObserved,
      reviewRule,
      expiryRule,
    });
  }

  return {
    ok: true,
    document: { policyVersion, status, scope, advisories },
  };
}

export function readInstalledCdkToolchain(lockText: string): InstalledCdkToolchain {
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockText);
  } catch (error) {
    throw new SecurityAuditInternalError(
      `package-lock.json could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed.packages)) {
    throw new SecurityAuditInternalError('package-lock.json is missing packages');
  }
  const upstream = parsed.packages[CDK_LOCK_PATH];
  const brace = parsed.packages[BUNDLED_BRACE_DEPENDENCY_PATH];
  return {
    upstreamVersion:
      isRecord(upstream) && typeof upstream.version === 'string' ? upstream.version : null,
    upstreamIntegrity:
      isRecord(upstream) && typeof upstream.integrity === 'string' ? upstream.integrity : null,
    upstreamDev: isRecord(upstream) && upstream.dev === true,
    upstreamResolved:
      isRecord(upstream) && typeof upstream.resolved === 'string' ? upstream.resolved : null,
    braceVersion: isRecord(brace) && typeof brace.version === 'string' ? brace.version : null,
    braceInBundle: isRecord(brace) && brace.inBundle === true,
  };
}

function isCdkSynthesisSpecifier(specifier: string): boolean {
  return (
    specifier === 'aws-cdk-lib' ||
    specifier.startsWith('aws-cdk-lib/') ||
    specifier === 'constructs' ||
    specifier.startsWith('constructs/')
  );
}

function lineOfPosition(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

function specifiersInSource(path: string, text: string): RuntimeImportFinding[] {
  if (path.endsWith('/package.json') || path === 'package.json') {
    return manifestDependencyFindings(path, text);
  }
  const kind = path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : path.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const findings: RuntimeImportFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isCdkSynthesisSpecifier(node.moduleSpecifier.text)
    ) {
      findings.push({
        path,
        line: lineOfPosition(source, node.moduleSpecifier.getStart(source)),
        specifier: node.moduleSpecifier.text,
      });
    }
    if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (
        (dynamicImport || requireCall) &&
        argument !== undefined &&
        ts.isStringLiteral(argument) &&
        isCdkSynthesisSpecifier(argument.text)
      ) {
        findings.push({
          path,
          line: lineOfPosition(source, argument.getStart(source)),
          specifier: argument.text,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function manifestDependencyFindings(path: string, text: string): RuntimeImportFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [{ path, line: 1, specifier: 'unreadable-package-json' }];
  }
  if (!isRecord(parsed)) {
    return [];
  }
  const findings: RuntimeImportFinding[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = parsed[field];
    if (!isRecord(dependencies)) {
      continue;
    }
    for (const name of Object.keys(dependencies)) {
      if (isCdkSynthesisSpecifier(name)) {
        findings.push({ path, line: 1, specifier: name });
      }
    }
  }
  return findings;
}

export function findCdkSynthesisImportsInSources(
  files: Readonly<Record<string, string>>,
): readonly RuntimeImportFinding[] {
  return Object.entries(files).flatMap(([path, text]) => specifiersInSource(path, text));
}

function isAnalyzedFile(name: string): boolean {
  return (
    name === 'package.json' ||
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('.js') ||
    name.endsWith('.jsx') ||
    name.endsWith('.mjs') ||
    name.endsWith('.cjs')
  );
}

async function collectFiles(root: string, relativeDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          await walk(child);
        }
        continue;
      }
      if (entry.isFile() && isAnalyzedFile(entry.name)) {
        files[child] = await readFile(join(root, child), 'utf8');
      }
    }
  };
  await walk(relativeDir);
  return files;
}

export async function findRepositoryRuntimeCdkImports(
  root: string,
): Promise<readonly RuntimeImportFinding[]> {
  const files: Record<string, string> = {};
  for (const relativeDir of RUNTIME_CDK_IMPORT_ROOTS) {
    Object.assign(files, await collectFiles(root, relativeDir));
  }
  for (const manifest of EXTRA_RUNTIME_MANIFESTS) {
    files[manifest] = await readFile(join(root, manifest), 'utf8');
  }
  return findCdkSynthesisImportsInSources(files);
}

export function findProhibitedToolchainRepacks(
  manifests: Readonly<Record<string, string>>,
  lockText: string,
): readonly string[] {
  const findings: string[] = [];
  for (const [path, text] of Object.entries(manifests)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      findings.push(`${path}: package manifest is unreadable`);
      continue;
    }
    if (!isRecord(parsed)) {
      findings.push(`${path}: package manifest is not an object`);
      continue;
    }
    if ('overrides' in parsed) {
      findings.push(`${path}: npm overrides are prohibited for toolchain advisory containment`);
    }
    if ('resolutions' in parsed) {
      findings.push(
        `${path}: dependency resolutions are prohibited for toolchain advisory containment`,
      );
    }
    const scripts = parsed.scripts;
    if (isRecord(scripts)) {
      for (const key of ['preinstall', 'install', 'postinstall'] as const) {
        const script = scripts[key];
        if (
          typeof script === 'string' &&
          /aws-cdk-lib|brace-expansion|@depup\/aws-cdk-lib/.test(script)
        ) {
          findings.push(`${path}: ${key} patches a toolchain package`);
        }
      }
    }
    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = parsed[field];
      if (!isRecord(dependencies)) {
        continue;
      }
      for (const [name, spec] of Object.entries(dependencies)) {
        if (
          name === '@depup/aws-cdk-lib' ||
          (typeof spec === 'string' && spec.includes('@depup/aws-cdk-lib'))
        ) {
          findings.push(`${path}: unofficial aws-cdk-lib package ${name}`);
        }
        if (name === 'aws-cdk-lib' && (typeof spec !== 'string' || !/^\d+\.\d+\.\d+$/.test(spec))) {
          findings.push(`${path}: aws-cdk-lib must be an official numeric version`);
        }
      }
    }
  }

  if (lockText.includes('@depup/aws-cdk-lib')) {
    findings.push('package-lock.json: unofficial @depup/aws-cdk-lib entry');
  }
  const installed = readInstalledCdkToolchain(lockText);
  if (
    installed.upstreamResolved !== null &&
    !OFFICIAL_CDK_TARBALL.test(installed.upstreamResolved)
  ) {
    findings.push('package-lock.json: aws-cdk-lib is not the official npm registry tarball');
  }
  return findings;
}

function entryMatches(
  entry: ToolchainAdvisory,
  observed: ObservedAdvisory,
  input: SecurityAuditEvaluationInput,
): boolean {
  return (
    !entry.runtimeReachable &&
    !entry.officialFixAvailable &&
    entry.severity === 'high' &&
    observed.severity === 'high' &&
    entry.packageName === 'brace-expansion' &&
    entry.packageName === observed.packageName &&
    entry.upstreamPackage === 'aws-cdk-lib' &&
    entry.advisoryIds.length > 0 &&
    sameSet(entry.advisoryIds, observed.advisoryIds) &&
    observed.nodes.length === 1 &&
    observed.nodes[0] === entry.dependencyPath &&
    input.installedBraceVersion === entry.installedVersion &&
    input.installedBracePath === entry.dependencyPath &&
    input.installedBraceInBundle &&
    input.installedUpstreamVersion === entry.upstreamVersion &&
    input.upstreamIsDevDependency &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.firstObserved)
  );
}

function matchToolchainException(input: SecurityAuditEvaluationInput): string | null {
  if (input.fullHighCount !== input.fullHighAdvisories.length) {
    return 'UNEXPECTED_HIGH_ADVISORY';
  }
  if (
    input.allowlistPolicyVersion !== SECURITY_AUDIT_POLICY_VERSION ||
    (input.allowlist.length > 0 &&
      (input.allowlistStatus !== APPROVED_EXCEPTION_STATUS ||
        input.allowlistScope !== APPROVED_EXCEPTION_SCOPE))
  ) {
    return 'TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH';
  }
  if (input.allowlist.length === 0 && input.fullHighAdvisories.length === 0) {
    return null;
  }
  if (input.allowlist.length !== input.fullHighAdvisories.length) {
    return input.fullHighAdvisories.length > input.allowlist.length
      ? 'UNEXPECTED_HIGH_ADVISORY'
      : 'TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH';
  }

  const used = new Set<number>();
  for (const observed of input.fullHighAdvisories) {
    const index = input.allowlist.findIndex(
      (entry, entryIndex) => !used.has(entryIndex) && entryMatches(entry, observed, input),
    );
    if (index === -1) {
      return observed.packageName === 'brace-expansion'
        ? 'TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH'
        : 'UNEXPECTED_HIGH_ADVISORY';
    }
    used.add(index);
  }
  return null;
}

export function evaluateSecurityAudit(
  input: SecurityAuditEvaluationInput,
): SecurityAuditEvaluation {
  const reasons: string[] = [];
  if (
    input.fullCriticalCount > 0 ||
    input.runtimeCriticalCount > 0 ||
    input.fullCriticalAdvisories.length > 0
  ) {
    reasons.push('CRITICAL_ADVISORY_PRESENT');
  }
  if (
    input.runtimeHasAwsCdkLib ||
    input.runtimeVulnerableBracePaths.length > 0 ||
    input.runtimeCdkImports.length > 0
  ) {
    reasons.push('VULNERABLE_CDK_DEPENDENCY_RUNTIME_REACHABLE');
  }
  if (input.runtimeHighCount > 0) {
    reasons.push('UNEXPECTED_HIGH_ADVISORY');
  }
  if (input.prohibitedFindings.length > 0) {
    reasons.push('TOOLCHAIN_EXCEPTION_SCOPE_MISMATCH');
  }

  const officialFixAvailable = officialBundledAdvisoryResolved(input.latestBundledBraceVersion);
  if (
    officialFixAvailable &&
    (input.allowlist.length > 0 || input.fullHighCount > 0 || input.fullHighAdvisories.length > 0)
  ) {
    reasons.push('UPSTREAM_PATCH_AVAILABLE');
  }

  const mismatch = matchToolchainException(input);
  if (mismatch !== null) {
    reasons.push(mismatch);
  }

  const ordered = REASON_PRIORITY.filter((reason) => reasons.includes(reason));
  const runtimeClean =
    input.runtimeHighCount === 0 &&
    input.runtimeCriticalCount === 0 &&
    !input.runtimeHasAwsCdkLib &&
    input.runtimeVulnerableBracePaths.length === 0 &&
    input.runtimeCdkImports.length === 0;
  const status = ordered.length === 0 ? 'PASS' : 'FAIL';
  return {
    status,
    policyVersion: SECURITY_AUDIT_POLICY_VERSION,
    productionRuntimeAudit: runtimeClean ? 'PASS' : 'FAIL',
    toolchainAudit:
      status === 'FAIL'
        ? 'FAIL'
        : input.fullHighCount > 0
          ? 'PASS_WITH_EXACT_UPSTREAM_EXCEPTION'
          : 'PASS',
    fullNpmAuditRaw:
      input.fullCriticalCount > 0
        ? 'CRITICAL_PRESENT'
        : input.fullHighCount > 0
          ? 'HIGH_PRESENT'
          : 'CLEAN',
    runtimeHighCount: input.runtimeHighCount,
    runtimeCriticalCount: input.runtimeCriticalCount,
    rawHighCount: input.fullHighCount,
    rawCriticalCount: input.fullCriticalCount,
    officialFixAvailable,
    reasons: ordered,
  };
}

export function formatSecurityAuditOutput(
  evaluation: SecurityAuditEvaluation,
  upstreamVersion: string,
  bundledBraceVersion: string | null,
  runtimeHasAwsCdkLib: boolean,
  runtimeHasVulnerableBraceExpansion: boolean,
): string {
  const lines = [
    `SECURITY_POLICY_VERSION=${evaluation.policyVersion}`,
    `PRODUCTION_RUNTIME_AUDIT=${evaluation.productionRuntimeAudit}`,
    `TOOLCHAIN_SECURITY=${evaluation.toolchainAudit}`,
    `FULL_NPM_AUDIT_RAW=${evaluation.fullNpmAuditRaw}`,
    `RUNTIME_AUDIT=${evaluation.productionRuntimeAudit}`,
    `RUNTIME_HIGH=${evaluation.runtimeHighCount}`,
    `RUNTIME_CRITICAL=${evaluation.runtimeCriticalCount}`,
    `RAW_HIGH=${evaluation.rawHighCount}`,
    `RAW_CRITICAL=${evaluation.rawCriticalCount}`,
    `RUNTIME_HAS_AWS_CDK_LIB=${runtimeHasAwsCdkLib ? 'YES' : 'NO'}`,
    `RUNTIME_HAS_VULNERABLE_BRACE_EXPANSION=${runtimeHasVulnerableBraceExpansion ? 'YES' : 'NO'}`,
    `UPSTREAM_LATEST_AWS_CDK_LIB=${upstreamVersion}`,
    `UPSTREAM_BUNDLED_BRACE_EXPANSION=${bundledBraceVersion ?? 'ABSENT'}`,
    `OFFICIAL_FIX_AVAILABLE=${evaluation.officialFixAvailable ? 'YES' : 'NO'}`,
    `STATUS=${evaluation.status}`,
  ];
  const reason = evaluation.reasons[0];
  if (reason !== undefined) {
    lines.push(`REASON=${reason}`);
  }
  return `${lines.join('\n')}\n`;
}

function npmCommand(args: readonly string[]): {
  readonly command: string;
  readonly args: readonly string[];
} {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(cli)) {
    return { command: process.execPath, args: [cli, ...args] };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
}

function runCaptured(command: string, args: readonly string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
      },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode = error.code;
          const status = 'status' in error ? error.status : undefined;
          const code =
            typeof exitCode === 'number' ? exitCode : typeof status === 'number' ? status : null;
          if (code === null) {
            reject(error);
            return;
          }
          resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) });
          return;
        }
        resolvePromise({ code: 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function runInherit(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise(code ?? 1);
    });
  });
}

async function captureNpmAudit(root: string, omitDev: boolean): Promise<string> {
  const args = ['audit', '--json'];
  if (omitDev) {
    args.push('--omit=dev');
  }
  const invocation = npmCommand(args);
  const result = await runCaptured(invocation.command, invocation.args, root);
  if (result.code !== 0 && result.code !== 1) {
    throw new SecurityAuditInternalError(
      `npm audit exited ${result.code}: ${result.stderr.trim() || 'no stderr'}`,
    );
  }
  return stripBom(result.stdout);
}

async function npmViewString(root: string, args: readonly string[]): Promise<string> {
  const invocation = npmCommand(['view', ...args, '--json']);
  const result = await runCaptured(invocation.command, invocation.args, root);
  if (result.code !== 0) {
    throw new SecurityAuditInternalError(
      `npm view ${args.join(' ')} exited ${result.code}: ${result.stderr.trim() || 'no stderr'}`,
    );
  }
  const parsed: unknown = JSON.parse(stripBom(result.stdout));
  if (typeof parsed !== 'string' || parsed.trim() === '') {
    throw new SecurityAuditInternalError(`npm view ${args.join(' ')} did not return a string`);
  }
  return parsed.trim();
}

async function readBundledBraceFromRegistry(version: string, root: string): Promise<string | null> {
  const destination = await mkdtemp(join(tmpdir(), 'sceneready-cdk-'));
  try {
    const invocation = npmCommand([
      'pack',
      `aws-cdk-lib@${version}`,
      '--pack-destination',
      destination,
    ]);
    const packed = await runCaptured(invocation.command, invocation.args, root);
    if (packed.code !== 0) {
      throw new SecurityAuditInternalError(
        `npm pack aws-cdk-lib@${version} exited ${packed.code}: ${packed.stderr.trim()}`,
      );
    }
    const tarballName = (await readdir(destination)).find((name) => name.endsWith('.tgz'));
    if (tarballName === undefined) {
      throw new SecurityAuditInternalError('npm pack produced no aws-cdk-lib tarball');
    }
    const tarball = join(destination, tarballName);
    const listed = await runCaptured('tar', ['-tzf', tarball], root);
    if (listed.code !== 0) {
      throw new SecurityAuditInternalError(`tar listing failed: ${listed.stderr.trim()}`);
    }
    if (!listed.stdout.includes('package/node_modules/brace-expansion/package.json')) {
      return null;
    }
    const extracted = await runCaptured(
      'tar',
      ['-xOf', tarball, 'package/node_modules/brace-expansion/package.json'],
      root,
    );
    if (extracted.code !== 0) {
      throw new SecurityAuditInternalError(`tar extract failed: ${extracted.stderr.trim()}`);
    }
    const parsed: unknown = JSON.parse(stripBom(extracted.stdout));
    if (!isRecord(parsed) || typeof parsed.version !== 'string') {
      throw new SecurityAuditInternalError('bundled brace-expansion package.json has no version');
    }
    return parsed.version;
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

async function inspectOfficialUpstream(
  root: string,
  installed: InstalledCdkToolchain,
): Promise<{ readonly latestVersion: string; readonly bundledBraceVersion: string | null }> {
  const latestVersion = await npmViewString(root, ['aws-cdk-lib', 'version']);
  if (latestVersion === installed.upstreamVersion && installed.upstreamIntegrity !== null) {
    const latestIntegrity = await npmViewString(root, [
      `aws-cdk-lib@${latestVersion}`,
      'dist.integrity',
    ]);
    if (latestIntegrity === installed.upstreamIntegrity) {
      return { latestVersion, bundledBraceVersion: installed.braceVersion };
    }
  }
  return {
    latestVersion,
    bundledBraceVersion: await readBundledBraceFromRegistry(latestVersion, root),
  };
}

interface ImageInventory {
  readonly awsCdkLibPaths: readonly string[];
  readonly braceExpansion: readonly { readonly path: string; readonly version: string }[];
  readonly vulnerableBracePaths: readonly string[];
}

export interface RuntimeImageCommands {
  readonly build: typeof runInherit;
  readonly capture: typeof runCaptured;
}

async function inspectExportedRootfs(
  archive: string,
  root: string,
  capture: typeof runCaptured,
): Promise<ImageInventory> {
  const listed = await capture('tar', ['-tf', archive], root);
  if (listed.code !== 0 || listed.stdout.trim() === '') {
    throw new SecurityAuditInternalError('runtime tar inventory cannot be read');
  }
  const entries = listed.stdout.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const seen = new Set<string>();
  const awsCdkLibPaths: string[] = [];
  const braceExpansion: { path: string; version: string }[] = [];
  for (const entry of entries) {
    if (entry === '.' || entry === './') continue;
    const path = entry.replace(/^\.\//, '').replace(/\/$/, '');
    if (
      path === '' ||
      path.startsWith('/') ||
      path.includes('\\') ||
      [...path].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      path.split('/').some((part) => part === '..' || part === '.' || part === '') ||
      seen.has(path)
    ) {
      throw new SecurityAuditInternalError('runtime tar inventory is malformed or ambiguous');
    }
    seen.add(path);
  }
  for (const entry of entries) {
    const path = entry.replace(/^\.\//, '').replace(/\/$/, '');
    const match = /(?:^|\/)node_modules\/(aws-cdk-lib|brace-expansion)\/package\.json$/.exec(path);
    if (match === null) continue;
    // Only write selected file contents to stdout; never extract rootfs paths onto the host.
    if (['*', '?', '['].some((character) => entry.includes(character))) {
      throw new SecurityAuditInternalError('runtime tar inventory has an ambiguous manifest path');
    }
    const extracted = await capture('tar', ['-xOf', archive, '--', entry], root);
    if (extracted.code !== 0) {
      throw new SecurityAuditInternalError(`runtime package manifest cannot be read: ${path}`);
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(stripBom(extracted.stdout));
    } catch {
      throw new SecurityAuditInternalError(`runtime package manifest is malformed: ${path}`);
    }
    if (
      !isRecord(manifest) ||
      manifest.name !== match[1] ||
      typeof manifest.version !== 'string' ||
      parseSemver(manifest.version) === null
    ) {
      throw new SecurityAuditInternalError(`runtime package manifest is unclassifiable: ${path}`);
    }
    if (match[1] === 'aws-cdk-lib') awsCdkLibPaths.push(`/${path}`);
    else braceExpansion.push({ path: `/${path}`, version: manifest.version });
  }
  return {
    awsCdkLibPaths,
    braceExpansion,
    vulnerableBracePaths: braceExpansion
      .filter((entry) => braceVersionIsActivelyVulnerable(entry.version))
      .map((entry) => entry.path),
  };
}

async function removeInspectionContainer(
  containerId: string,
  root: string,
  capture: typeof runCaptured,
): Promise<void> {
  const removed = await capture('docker', ['rm', '-v', containerId], root);
  if (removed.code !== 0) {
    throw new SecurityAuditInternalError(`docker rm exited ${removed.code}`);
  }
}

export async function inspectRuntimeImage(
  root: string,
  commands: RuntimeImageCommands = { build: runInherit, capture: runCaptured },
): Promise<ImageInventory> {
  const buildCode = await commands.build(
    'docker',
    [
      'build',
      '--platform',
      'linux/arm64',
      '-f',
      'apps/mcp-runtime/Dockerfile',
      '-t',
      RUNTIME_IMAGE,
      'apps/mcp-runtime',
    ],
    root,
  );
  if (buildCode !== 0) {
    throw new SecurityAuditInternalError(`docker build exited ${buildCode}`);
  }
  const architecture = await commands.capture(
    'docker',
    ['image', 'inspect', RUNTIME_IMAGE, '--format', '{{.Architecture}}'],
    root,
  );
  if (architecture.code !== 0 || architecture.stdout.trim() !== 'arm64') {
    throw new SecurityAuditInternalError(
      `runtime image architecture is ${architecture.stdout.trim() || 'unknown'}`,
    );
  }
  const destination = await mkdtemp(join(tmpdir(), 'sceneready-runtime-'));
  let containerId: string | undefined;
  try {
    const created = await commands.capture(
      'docker',
      ['create', '--platform', 'linux/arm64', RUNTIME_IMAGE],
      root,
    );
    if (created.code !== 0 || !/^[a-f0-9]{64}$/.test(created.stdout.trim())) {
      throw new SecurityAuditInternalError(
        'docker create failed or returned an invalid container ID',
      );
    }
    containerId = created.stdout.trim();
    const archive = join(destination, 'rootfs.tar');
    const exported = await commands.capture(
      'docker',
      ['export', '--output', archive, containerId],
      root,
    );
    if (exported.code !== 0) {
      throw new SecurityAuditInternalError(`docker export exited ${exported.code}`);
    }
    return await inspectExportedRootfs(archive, root, commands.capture);
  } finally {
    try {
      if (containerId !== undefined) {
        await removeInspectionContainer(containerId, root, commands.capture);
      }
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  }
}

async function readPackageManifests(root: string): Promise<Record<string, string>> {
  const manifests: Record<string, string> = {
    'package.json': await readFile(join(root, 'package.json'), 'utf8'),
  };
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          await walk(relative === '' ? entry.name : `${relative}/${entry.name}`);
        }
        continue;
      }
      if (entry.isFile() && entry.name === 'package.json') {
        const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
        manifests[path] = await readFile(join(root, path), 'utf8');
      }
    }
  };
  await walk('');
  return manifests;
}

function isCliEntrypoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  const normalizedEntry = entry.replaceAll('\\', '/').toLowerCase();
  if (normalizedEntry.endsWith('/security-audit.ts')) {
    return true;
  }
  try {
    return (
      fileURLToPath(import.meta.url)
        .replaceAll('\\', '/')
        .toLowerCase() === resolve(entry).replaceAll('\\', '/').toLowerCase()
    );
  } catch {
    return false;
  }
}

async function runCli(): Promise<void> {
  const root = process.cwd();
  const evidenceDirectory = join(root, 'artifacts', 'local');
  await mkdir(evidenceDirectory, { recursive: true });
  const fullText = await captureNpmAudit(root, false);
  const runtimeText = await captureNpmAudit(root, true);
  await writeFile(join(evidenceDirectory, 'sr05-npm-audit.json'), fullText, 'utf8');
  await writeFile(join(evidenceDirectory, 'sr05-npm-audit-runtime.json'), runtimeText, 'utf8');

  const fullFacts = parseNpmAuditDocument(fullText);
  const runtimeFacts = parseNpmAuditDocument(runtimeText);
  const allowlistText = await readFile(
    join(root, 'docs', 'security', 'TOOLCHAIN-ADVISORIES.json'),
    'utf8',
  );
  const allowlist = parseToolchainAdvisoryDocument(JSON.parse(stripBom(allowlistText)));
  const lockText = await readFile(join(root, 'package-lock.json'), 'utf8');
  const installed = readInstalledCdkToolchain(lockText);
  const prohibited = [
    ...findProhibitedToolchainRepacks(await readPackageManifests(root), lockText),
    ...(allowlist.ok ? [] : [allowlist.reason]),
  ];
  const runtimeCdkImports = await findRepositoryRuntimeCdkImports(root);
  const upstream = await inspectOfficialUpstream(root, installed);
  const image = await inspectRuntimeImage(root);
  const document = allowlist.ok ? allowlist.document : null;
  const evaluation = evaluateSecurityAudit({
    fullHighAdvisories: fullFacts.highAdvisories,
    fullCriticalAdvisories: fullFacts.criticalAdvisories,
    fullHighCount: fullFacts.highCount,
    fullCriticalCount: fullFacts.criticalCount,
    runtimeHighCount: runtimeFacts.highCount,
    runtimeCriticalCount: runtimeFacts.criticalCount,
    allowlist: document?.advisories ?? [],
    allowlistStatus: document?.status ?? '',
    allowlistScope: document?.scope ?? '',
    allowlistPolicyVersion: document?.policyVersion ?? '',
    installedBraceVersion: installed.braceVersion,
    installedBracePath: installed.braceVersion === null ? null : BUNDLED_BRACE_DEPENDENCY_PATH,
    installedBraceInBundle: installed.braceInBundle,
    installedUpstreamVersion: installed.upstreamVersion,
    upstreamIsDevDependency: installed.upstreamDev,
    latestUpstreamVersion: upstream.latestVersion,
    latestBundledBraceVersion: upstream.bundledBraceVersion,
    runtimeHasAwsCdkLib: image.awsCdkLibPaths.length > 0,
    runtimeVulnerableBracePaths: image.vulnerableBracePaths,
    runtimeCdkImports,
    prohibitedFindings: prohibited,
  });
  const output = formatSecurityAuditOutput(
    evaluation,
    upstream.latestVersion,
    upstream.bundledBraceVersion,
    image.awsCdkLibPaths.length > 0,
    image.vulnerableBracePaths.length > 0,
  );
  await writeFile(join(evidenceDirectory, 'sr05-security-gate.txt'), output, 'utf8');
  await writeFile(
    join(evidenceDirectory, 'sr05-runtime-closure.json'),
    `${JSON.stringify({ image: RUNTIME_IMAGE, ...image, imports: runtimeCdkImports }, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(output);
  process.exit(evaluation.status === 'PASS' ? 0 : 1);
}

if (isCliEntrypoint()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown security audit failure';
    process.stderr.write(`STATUS=FAIL\nREASON=SECURITY_AUDIT_INTERNAL_FAILURE\n${message}\n`);
    process.exit(2);
  });
}
