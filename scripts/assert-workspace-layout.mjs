import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const LOCKED_WORKSPACES = [
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
];

const LOCKED_WORKSPACE_PATTERNS = [
  'apps/*',
  'apps/mcp-runtime/ui',
  'packages/*',
  'services/*',
  'infrastructure/*',
  'tools/*',
];

const FORBIDDEN_LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];

function fail(message) {
  process.stderr.write(`WORKSPACE_LAYOUT=FAIL\n${message}\n`);
  process.exit(1);
}

function posixJoin(root, relativePath) {
  return join(root, ...relativePath.split('/'));
}

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN';
    fail(`unable to read ${label}: ${code}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    fail(`invalid JSON: ${label}`);
  }
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function discoverWorkspaceDirectories(root, patterns) {
  const discovered = [];

  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      const parentPath = posixJoin(root, parent);
      if (!existsSync(parentPath)) {
        continue;
      }

      const entries = readdirSync(parentPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`)
        .sort();

      for (const directory of entries) {
        if (existsSync(posixJoin(root, `${directory}/package.json`))) {
          discovered.push(directory);
        }
      }

      continue;
    }

    if (existsSync(posixJoin(root, `${pattern}/package.json`))) {
      discovered.push(pattern);
    }
  }

  return discovered;
}

function resolveRoot() {
  const argument = process.argv[2];
  if (argument === undefined || argument === '') {
    return process.cwd();
  }

  return isAbsolute(argument) ? argument : resolve(process.cwd(), argument);
}

function main() {
  const root = resolveRoot();
  const packageLockPath = posixJoin(root, 'package-lock.json');
  if (!existsSync(packageLockPath)) {
    fail('missing root package-lock.json');
  }

  for (const lockfile of FORBIDDEN_LOCKFILES) {
    if (existsSync(posixJoin(root, lockfile))) {
      fail(`forbidden second package-manager lockfile: ${lockfile}`);
    }
  }

  const rootPackage = readJson(posixJoin(root, 'package.json'), 'package.json');
  if (!sameStringArray(rootPackage.workspaces, LOCKED_WORKSPACE_PATTERNS)) {
    fail('root workspaces must match the locked workspace patterns exactly');
  }

  const lockedDirectories = LOCKED_WORKSPACES.map(([directory]) => directory);
  const lockedDirectorySet = new Set(lockedDirectories);
  const discovered = discoverWorkspaceDirectories(root, LOCKED_WORKSPACE_PATTERNS);

  for (const directory of lockedDirectories) {
    if (!existsSync(posixJoin(root, directory))) {
      fail(`missing workspace directory: ${directory}`);
    }
  }

  const unexpected = discovered.filter((directory) => !lockedDirectorySet.has(directory)).sort();
  if (unexpected[0] !== undefined) {
    fail(`unexpected workspace directory: ${unexpected[0]}`);
  }

  const manifests = [];

  for (const [directory, expectedName] of LOCKED_WORKSPACES) {
    const packageJsonPath = posixJoin(root, `${directory}/package.json`);
    const tsconfigPath = posixJoin(root, `${directory}/tsconfig.json`);
    const indexPath = posixJoin(root, `${directory}/src/index.ts`);

    if (!existsSync(packageJsonPath)) {
      fail(`missing workspace package.json: ${directory}/package.json`);
    }
    if (!existsSync(tsconfigPath)) {
      fail(`missing workspace tsconfig.json: ${directory}/tsconfig.json`);
    }
    if (!existsSync(indexPath)) {
      fail(`missing workspace source: ${directory}/src/index.ts`);
    }

    const manifest = readJson(packageJsonPath, `${directory}/package.json`);
    const name = manifest.name;
    if (typeof name !== 'string' || name === '') {
      fail(`workspace ${directory} package name must be a non-empty string`);
    }

    manifests.push({ directory, expectedName, manifest, name });
  }

  const directoriesByName = new Map();
  for (const { directory, name } of manifests) {
    const dirs = directoriesByName.get(name) ?? [];
    dirs.push(directory);
    directoriesByName.set(name, dirs);
  }

  for (const { name } of manifests) {
    const dirs = directoriesByName.get(name) ?? [];
    if (dirs.length > 1) {
      fail(`duplicate package name: ${name} (${dirs.join(', ')})`);
    }
  }

  for (const { directory, expectedName, manifest, name } of manifests) {
    if (name !== expectedName) {
      fail(`workspace ${directory} name must be ${expectedName}, found ${name}`);
    }

    if (manifest.private !== true) {
      fail(`workspace ${directory} must set private=true`);
    }

    if (manifest.type !== 'module') {
      fail(`workspace ${directory} must set type=module`);
    }

    if (manifest.version !== '0.0.0') {
      fail(`workspace ${directory} version must be 0.0.0`);
    }
  }

  process.stdout.write('WORKSPACE_LAYOUT=PASS\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown assertion failure';
  fail(message);
}
