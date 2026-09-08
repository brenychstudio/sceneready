import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';

export const LOCKED_PURE_PACKAGES = [
  '@sceneready/domain',
  '@sceneready/production-pack',
  '@sceneready/evidence',
  '@sceneready/production-graph',
  '@sceneready/readiness-engine',
  '@sceneready/solar-engine',
  '@sceneready/intervention-engine',
  '@sceneready/shadow-simulation',
  '@sceneready/recovery-ranking',
  '@sceneready/mcp-human-authority',
  '@sceneready/communications',
  '@sceneready/replay',
] as const;

export type DependencyBoundaryViolationCode =
  | 'PURE_PACKAGE_IMPORTS_AWS'
  | 'PURE_PACKAGE_IMPORTS_CDK'
  | 'PURE_PACKAGE_IMPORTS_STRANDS'
  | 'PURE_PACKAGE_IMPORTS_REACT'
  | 'PURE_PACKAGE_IMPORTS_MCP_RUNTIME'
  | 'SCENEREADY_DEEP_IMPORT'
  | 'CROSS_WORKSPACE_RELATIVE_IMPORT'
  | 'PACKAGE_IMPORTS_APP_LAYER'
  | 'PACKAGE_IMPORTS_SERVICE_LAYER'
  | 'PACKAGE_IMPORTS_INFRASTRUCTURE_LAYER';

export interface DependencyBoundaryViolation {
  readonly code: DependencyBoundaryViolationCode;
  readonly path: string;
  readonly line: number | null;
  readonly moduleSpecifier: string | null;
  readonly message: string;
}

export interface DependencyBoundaryAuditResult {
  readonly violations: readonly DependencyBoundaryViolation[];
}

export interface DependencyBoundaryAuditOptions {
  readonly files?: Readonly<Record<string, string>>;
}

export class DependencyBoundaryAnalysisError extends Error {
  readonly path: string | null;

  constructor(path: string | null, detail: string, cause?: unknown) {
    const message =
      path === null
        ? `Dependency-boundary analysis failed: ${detail}`
        : `Dependency-boundary analysis failed for ${path}: ${detail}`;
    if (cause !== undefined) {
      super(message, { cause });
    } else {
      super(message);
    }
    this.name = 'DependencyBoundaryAnalysisError';
    this.path = path;
  }
}

type WorkspaceLayer = 'app' | 'package' | 'service' | 'infrastructure' | 'tool';

interface LockedWorkspace {
  readonly directory: string;
  readonly name: string;
  readonly layer: WorkspaceLayer;
}

interface CollectedSpecifier {
  readonly specifier: string;
  readonly line: number;
}

const LOCKED_WORKSPACE_ENTRIES = [
  ['apps/mcp-runtime', '@sceneready/mcp-runtime'],
  ['apps/mcp-runtime/ui', '@sceneready/mcp-runtime-ui'],
  ['apps/judge-console', '@sceneready/judge-console'],
  ['packages/domain', '@sceneready/domain'],
  ['packages/production-pack', '@sceneready/production-pack'],
  ['packages/evidence', '@sceneready/evidence'],
  ['packages/production-graph', '@sceneready/production-graph'],
  ['packages/readiness-engine', '@sceneready/readiness-engine'],
  ['packages/solar-engine', '@sceneready/solar-engine'],
  ['packages/intervention-engine', '@sceneready/intervention-engine'],
  ['packages/shadow-simulation', '@sceneready/shadow-simulation'],
  ['packages/recovery-ranking', '@sceneready/recovery-ranking'],
  ['packages/agent', '@sceneready/agent'],
  ['packages/mcp-human-authority', '@sceneready/mcp-human-authority'],
  ['packages/authority', '@sceneready/authority'],
  ['packages/communications', '@sceneready/communications'],
  ['packages/replay', '@sceneready/replay'],
  ['packages/observability', '@sceneready/observability'],
  ['packages/presentation', '@sceneready/presentation'],
  ['packages/evals', '@sceneready/evals'],
  ['services/risk-watch', '@sceneready/risk-watch'],
  ['services/execution-worker', '@sceneready/execution-worker'],
  ['services/replay-seeder', '@sceneready/replay-seeder'],
  ['infrastructure/cdk', '@sceneready/infrastructure-cdk'],
  ['tools/validate-pack', '@sceneready/validate-pack'],
  ['tools/replay-cli', '@sceneready/replay-cli'],
  ['tools/repository-audit', '@sceneready/repository-audit'],
  ['tools/evidence-report', '@sceneready/evidence-report'],
  ['tools/release-audit', '@sceneready/release-audit'],
] as const;

const SKIP_DIRECTORY_NAMES = new Set([
  '.git',
  '.vite',
  'artifacts',
  'cdk.out',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const PURE_PACKAGE_NAMES = new Set<string>(LOCKED_PURE_PACKAGES);

function workspaceLayer(directory: string): WorkspaceLayer {
  if (directory.startsWith('apps/')) {
    return 'app';
  }
  if (directory.startsWith('packages/')) {
    return 'package';
  }
  if (directory.startsWith('services/')) {
    return 'service';
  }
  if (directory.startsWith('infrastructure/')) {
    return 'infrastructure';
  }
  if (directory.startsWith('tools/')) {
    return 'tool';
  }

  throw new DependencyBoundaryAnalysisError(
    directory,
    `unable to determine workspace layer for ${directory}`,
  );
}

const LOCKED_WORKSPACES: readonly LockedWorkspace[] = LOCKED_WORKSPACE_ENTRIES.map(
  ([directory, name]) => ({
    directory,
    name,
    layer: workspaceLayer(directory),
  }),
);

const WORKSPACES_LONGEST_DIRECTORY_FIRST = [...LOCKED_WORKSPACES].sort(
  (left, right) => right.directory.length - left.directory.length,
);

const WORKSPACE_BY_NAME = new Map(
  LOCKED_WORKSPACES.map((workspace) => [workspace.name, workspace]),
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown analysis failure';
}

function normalizeRepoPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function dirnamePosix(filePath: string): string {
  const normalized = normalizeRepoPath(filePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function normalizePosixPath(path: string): string {
  const stack: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      const last = stack[stack.length - 1];
      if (stack.length === 0 || last === '..') {
        stack.push('..');
      } else {
        stack.pop();
      }
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function resolveRelativeSpecifier(fromFile: string, specifier: string): string {
  const base = dirnamePosix(fromFile);
  const joined = base === '' ? specifier : `${base}/${specifier}`;
  return normalizePosixPath(joined);
}

function workspaceForPath(path: string): LockedWorkspace | undefined {
  const normalized = normalizeRepoPath(path);
  for (const workspace of WORKSPACES_LONGEST_DIRECTORY_FIRST) {
    if (normalized === workspace.directory || normalized.startsWith(`${workspace.directory}/`)) {
      return workspace;
    }
  }
  return undefined;
}

function isTypeScriptSource(name: string): boolean {
  if (name.endsWith('.d.ts')) {
    return false;
  }
  return (
    name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.mts') || name.endsWith('.cts')
  );
}

function isPackageManifestPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return normalized === 'package.json' || normalized.endsWith('/package.json');
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}

function matchesPackage(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function isBedrockOrAgentCore(specifier: string): boolean {
  if (specifier.startsWith('@sceneready/')) {
    return false;
  }
  const lower = specifier.toLowerCase();
  return lower.includes('bedrock') || lower.includes('agentcore') || lower.includes('agent-core');
}

function classifyPureForbidden(specifier: string): DependencyBoundaryViolationCode | undefined {
  if (
    matchesPackage(specifier, 'aws-cdk-lib') ||
    matchesPackage(specifier, 'aws-cdk') ||
    matchesPackage(specifier, '@aws-cdk') ||
    matchesPackage(specifier, 'constructs')
  ) {
    return 'PURE_PACKAGE_IMPORTS_CDK';
  }
  if (matchesPackage(specifier, '@strands-agents')) {
    return 'PURE_PACKAGE_IMPORTS_STRANDS';
  }
  if (matchesPackage(specifier, 'react') || matchesPackage(specifier, 'react-dom')) {
    return 'PURE_PACKAGE_IMPORTS_REACT';
  }
  if (matchesPackage(specifier, '@modelcontextprotocol')) {
    return 'PURE_PACKAGE_IMPORTS_MCP_RUNTIME';
  }
  if (
    matchesPackage(specifier, '@aws-sdk') ||
    matchesPackage(specifier, 'aws-sdk') ||
    isBedrockOrAgentCore(specifier)
  ) {
    return 'PURE_PACKAGE_IMPORTS_AWS';
  }
  return undefined;
}

function pureFamilyLabel(code: DependencyBoundaryViolationCode): string {
  switch (code) {
    case 'PURE_PACKAGE_IMPORTS_AWS':
      return 'AWS';
    case 'PURE_PACKAGE_IMPORTS_CDK':
      return 'CDK';
    case 'PURE_PACKAGE_IMPORTS_STRANDS':
      return 'Strands';
    case 'PURE_PACKAGE_IMPORTS_REACT':
      return 'React';
    case 'PURE_PACKAGE_IMPORTS_MCP_RUNTIME':
      return 'MCP runtime';
    default:
      return code;
  }
}

const MANIFEST_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

function scenereadyPackageName(specifier: string): string | undefined {
  const match = /^(@sceneready\/[^/]+)/.exec(specifier);
  return match?.[1];
}

function isDeepScenereadyImport(specifier: string): boolean {
  const match = /^@sceneready\/[^/]+\/(.+)$/.exec(specifier);
  const subpath = match?.[1];
  if (subpath === undefined) {
    return false;
  }
  return (
    subpath === 'src' ||
    subpath === 'dist' ||
    subpath.startsWith('src/') ||
    subpath.startsWith('dist/')
  );
}

function layerCodeFor(layer: WorkspaceLayer): DependencyBoundaryViolationCode | undefined {
  if (layer === 'app') {
    return 'PACKAGE_IMPORTS_APP_LAYER';
  }
  if (layer === 'service') {
    return 'PACKAGE_IMPORTS_SERVICE_LAYER';
  }
  if (layer === 'infrastructure') {
    return 'PACKAGE_IMPORTS_INFRASTRUCTURE_LAYER';
  }
  return undefined;
}

function classifyPackageLayerImport(
  filePath: string,
  specifier: string,
): DependencyBoundaryViolationCode | undefined {
  if (isRelativeSpecifier(specifier)) {
    const target = workspaceForPath(resolveRelativeSpecifier(filePath, specifier));
    return target === undefined ? undefined : layerCodeFor(target.layer);
  }

  const packageName = scenereadyPackageName(specifier);
  if (packageName === undefined) {
    return undefined;
  }
  const target = WORKSPACE_BY_NAME.get(packageName);
  return target === undefined ? undefined : layerCodeFor(target.layer);
}

function escapesWorkspace(
  filePath: string,
  specifier: string,
  importer: LockedWorkspace | undefined,
): boolean {
  const targetPath = resolveRelativeSpecifier(filePath, specifier);
  if (targetPath === '..' || targetPath.startsWith('../')) {
    return true;
  }
  const target = workspaceForPath(targetPath);
  if (importer === undefined) {
    return target !== undefined;
  }
  if (target === undefined) {
    return true;
  }
  return target.directory !== importer.directory;
}

function layerMessage(code: DependencyBoundaryViolationCode, specifier: string): string {
  if (code === 'PACKAGE_IMPORTS_APP_LAYER') {
    return `packages/* must not import apps/* source ('${specifier}').`;
  }
  if (code === 'PACKAGE_IMPORTS_SERVICE_LAYER') {
    return `packages/* must not import services/* source ('${specifier}').`;
  }
  return `packages/* must not import infrastructure/* source ('${specifier}').`;
}

function classifySpecifier(
  filePath: string,
  specifier: string,
): { code: DependencyBoundaryViolationCode; message: string } | undefined {
  const importer = workspaceForPath(filePath);

  if (importer !== undefined && PURE_PACKAGE_NAMES.has(importer.name)) {
    const family = classifyPureForbidden(specifier);
    if (family !== undefined) {
      return {
        code: family,
        message: `Pure package ${importer.name} must not import ${pureFamilyLabel(family)} family module '${specifier}'.`,
      };
    }
  }

  if (importer?.layer === 'package') {
    const layerCode = classifyPackageLayerImport(filePath, specifier);
    if (layerCode !== undefined) {
      return {
        code: layerCode,
        message: layerMessage(layerCode, specifier),
      };
    }
  }

  if (isDeepScenereadyImport(specifier)) {
    return {
      code: 'SCENEREADY_DEEP_IMPORT',
      message: `Cross-workspace import must use a public @sceneready/* entry point, not deep import '${specifier}'.`,
    };
  }

  if (isRelativeSpecifier(specifier) && escapesWorkspace(filePath, specifier, importer)) {
    const workspaceDir = importer?.directory ?? dirnamePosix(filePath);
    return {
      code: 'CROSS_WORKSPACE_RELATIVE_IMPORT',
      message: `Relative import '${specifier}' escapes workspace ${workspaceDir}.`,
    };
  }

  return undefined;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function recordLiteralSpecifier(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  collected: CollectedSpecifier[],
  form: string,
): void {
  if (ts.isStringLiteralLike(expression)) {
    collected.push({
      specifier: expression.text.replaceAll('\\', '/'),
      line: lineOf(sourceFile, expression),
    });
    return;
  }

  throw new DependencyBoundaryAnalysisError(
    sourceFile.fileName,
    `${form} module specifier is not a string literal`,
  );
}

function collectModuleSpecifiers(sourceFile: ts.SourceFile): CollectedSpecifier[] {
  const collected: CollectedSpecifier[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      recordLiteralSpecifier(sourceFile, node.moduleSpecifier, collected, 'import');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      recordLiteralSpecifier(sourceFile, node.moduleSpecifier, collected, 'export');
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference)) {
        if (reference.expression === undefined) {
          throw new DependencyBoundaryAnalysisError(
            sourceFile.fileName,
            'import equals module specifier is missing',
          );
        }
        recordLiteralSpecifier(sourceFile, reference.expression, collected, 'import equals');
      }
    } else if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument)) {
        throw new DependencyBoundaryAnalysisError(
          sourceFile.fileName,
          'import type module specifier is not a string literal',
        );
      }
      recordLiteralSpecifier(sourceFile, node.argument.literal, collected, 'import type');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument === undefined) {
          throw new DependencyBoundaryAnalysisError(
            sourceFile.fileName,
            'import() module specifier is missing',
          );
        }
        recordLiteralSpecifier(sourceFile, argument, collected, 'import()');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const argument = node.arguments[0];
        if (argument === undefined) {
          throw new DependencyBoundaryAnalysisError(
            sourceFile.fileName,
            'require() module specifier is missing',
          );
        }
        recordLiteralSpecifier(sourceFile, argument, collected, 'require()');
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return collected;
}

function parsePackageManifestObject(path: string, content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new DependencyBoundaryAnalysisError(path, `invalid JSON: ${errorMessage(error)}`, error);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DependencyBoundaryAnalysisError(path, 'package.json must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function analyzePurePackageManifest(path: string, content: string): DependencyBoundaryViolation[] {
  const workspace = workspaceForPath(path);
  if (workspace === undefined || !PURE_PACKAGE_NAMES.has(workspace.name)) {
    return [];
  }

  const manifest = parsePackageManifestObject(path, content);
  const violations: DependencyBoundaryViolation[] = [];
  const seen = new Set<string>();

  for (const field of MANIFEST_DEPENDENCY_FIELDS) {
    const value = manifest[field];
    if (value === undefined) {
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new DependencyBoundaryAnalysisError(path, `${field} must be a JSON object`);
    }

    const specifiers = Object.keys(value as Record<string, unknown>).sort(compareStrings);
    for (const specifier of specifiers) {
      const family = classifyPureForbidden(specifier);
      if (family === undefined) {
        continue;
      }
      const seenKey = `${family}\0${specifier}`;
      if (seen.has(seenKey)) {
        continue;
      }
      seen.add(seenKey);
      violations.push({
        code: family,
        path,
        line: null,
        moduleSpecifier: specifier,
        message: `Pure package ${workspace.name} must not declare ${pureFamilyLabel(family)} family module '${specifier}' in ${field}.`,
      });
    }
  }

  return violations;
}

function suppressDuplicateManifestFamilies(
  sourceViolations: readonly DependencyBoundaryViolation[],
  manifestViolations: readonly DependencyBoundaryViolation[],
): DependencyBoundaryViolation[] {
  const sourceFamilies = new Set<string>();
  for (const item of sourceViolations) {
    const workspace = workspaceForPath(item.path);
    if (workspace === undefined) {
      continue;
    }
    sourceFamilies.add(`${workspace.directory}\0${item.code}`);
  }

  return manifestViolations.filter((item) => {
    const workspace = workspaceForPath(item.path);
    if (workspace === undefined) {
      return true;
    }
    return !sourceFamilies.has(`${workspace.directory}\0${item.code}`);
  });
}

function analyzeFile(path: string, content: string): DependencyBoundaryViolation[] {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      path,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(path),
    );
  } catch (error) {
    throw new DependencyBoundaryAnalysisError(
      path,
      `TypeScript parser failed: ${errorMessage(error)}`,
      error,
    );
  }

  const violations: DependencyBoundaryViolation[] = [];
  for (const item of collectModuleSpecifiers(sourceFile)) {
    const classified = classifySpecifier(path, item.specifier);
    if (classified === undefined) {
      continue;
    }
    violations.push({
      code: classified.code,
      path,
      line: item.line,
      moduleSpecifier: item.specifier,
      message: classified.message,
    });
  }
  return violations;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function sortViolations(
  violations: readonly DependencyBoundaryViolation[],
): DependencyBoundaryViolation[] {
  return [...violations].sort((left, right) => {
    const byPath = compareStrings(left.path, right.path);
    if (byPath !== 0) {
      return byPath;
    }
    const leftLine = left.line ?? -1;
    const rightLine = right.line ?? -1;
    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }
    const byCode = compareStrings(left.code, right.code);
    if (byCode !== 0) {
      return byCode;
    }
    return compareStrings(left.moduleSpecifier ?? '', right.moduleSpecifier ?? '');
  });
}

function normalizeInputFiles(files: Readonly<Record<string, string>>): Map<string, string> {
  const entries = Object.entries(files)
    .map(([path, content]) => [normalizeRepoPath(path), content] as const)
    .sort((left, right) => compareStrings(left[0], right[0]));
  return new Map(entries);
}

async function walkTypeScriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw new DependencyBoundaryAnalysisError(
        normalizeRepoPath(relative(root, directory)) || '.',
        `unable to read directory: ${errorMessage(error)}`,
        error,
      );
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORY_NAMES.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && (isTypeScriptSource(entry.name) || entry.name === 'package.json')) {
        files.push(absolutePath);
      }
    }
  };

  await visit(root);
  files.sort(compareStrings);
  return files;
}

async function readRepositorySources(root: string): Promise<Map<string, string>> {
  const resolvedRoot = resolve(root);
  const files = await walkTypeScriptFiles(resolvedRoot);
  const sources = new Map<string, string>();

  for (const absolutePath of files) {
    const path = normalizeRepoPath(relative(resolvedRoot, absolutePath));
    try {
      sources.set(path, await readFile(absolutePath, 'utf8'));
    } catch (error) {
      throw new DependencyBoundaryAnalysisError(
        path,
        `unable to read file: ${errorMessage(error)}`,
        error,
      );
    }
  }

  return sources;
}

export async function auditDependencyBoundaries(
  root: string,
  options?: DependencyBoundaryAuditOptions,
): Promise<DependencyBoundaryAuditResult> {
  try {
    const inputFiles = options?.files;
    const sources =
      inputFiles === undefined
        ? await readRepositorySources(root)
        : normalizeInputFiles(inputFiles);
    const sourceViolations: DependencyBoundaryViolation[] = [];
    const manifestViolations: DependencyBoundaryViolation[] = [];
    for (const [path, content] of sources) {
      if (isPackageManifestPath(path)) {
        manifestViolations.push(...analyzePurePackageManifest(path, content));
        continue;
      }
      sourceViolations.push(...analyzeFile(path, content));
    }
    return {
      violations: sortViolations([
        ...sourceViolations,
        ...suppressDuplicateManifestFamilies(sourceViolations, manifestViolations),
      ]),
    };
  } catch (error) {
    if (error instanceof DependencyBoundaryAnalysisError) {
      throw error;
    }
    throw new DependencyBoundaryAnalysisError(null, errorMessage(error), error);
  }
}
