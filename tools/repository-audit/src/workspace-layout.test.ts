import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const assertionScript = join(repositoryRoot, 'scripts', 'assert-workspace-layout.mjs');

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
] as const;

const ROOT_WORKSPACE_PATTERNS = [
  'apps/*',
  'apps/mcp-runtime/ui',
  'packages/*',
  'services/*',
  'infrastructure/*',
  'tools/*',
] as const;

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sceneready-workspace-layout-'));
  temporaryRoots.push(root);
  return root;
}

async function writeUtf8(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function writeWorkspace(root: string, directory: string, name: string): Promise<void> {
  await writeUtf8(
    root,
    join(directory, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version: '0.0.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
  await writeUtf8(root, join(directory, 'tsconfig.json'), '{}\n');
  await writeUtf8(root, join(directory, 'src/index.ts'), 'export {};\n');
}

async function writeValidLayout(root: string): Promise<void> {
  await writeUtf8(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@sceneready/root',
        version: '0.0.0',
        private: true,
        type: 'module',
        workspaces: [...ROOT_WORKSPACE_PATTERNS],
      },
      null,
      2,
    )}\n`,
  );
  await writeUtf8(root, 'package-lock.json', '{}\n');

  for (const [directory, name] of LOCKED_WORKSPACES) {
    await writeWorkspace(root, directory, name);
  }
}

function runAssert(root?: string): SpawnSyncReturns<string> {
  const args = root === undefined ? [assertionScript] : [assertionScript, root];
  return spawnSync(process.execPath, args, {
    cwd: root ?? repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })),
  );
});

describe('workspace layout assertion', () => {
  it('prints WORKSPACE_LAYOUT=PASS for the locked repository graph', () => {
    const result = runAssert();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('WORKSPACE_LAYOUT=PASS\n');
    expect(result.stderr).toBe('');
  });

  it('fails when a locked workspace directory is missing', async () => {
    const root = await createTemporaryRoot();
    await writeValidLayout(root);
    await rm(join(root, 'packages/domain'), { recursive: true, force: true });

    const result = runAssert(root);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toBe('WORKSPACE_LAYOUT=PASS\n');
    expect(result.stderr).toContain('packages/domain');
  });

  it('fails when a workspace package name does not match the locked name', async () => {
    const root = await createTemporaryRoot();
    await writeValidLayout(root);
    await writeWorkspace(root, 'packages/domain', '@sceneready/wrong-domain');

    const result = runAssert(root);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toBe('WORKSPACE_LAYOUT=PASS\n');
    expect(result.stderr).toContain('@sceneready/wrong-domain');
  });

  it('fails when two workspaces share the same package name', async () => {
    const root = await createTemporaryRoot();
    await writeValidLayout(root);
    await writeWorkspace(root, 'packages/agent', '@sceneready/domain');

    const result = runAssert(root);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toBe('WORKSPACE_LAYOUT=PASS\n');
    expect(result.stderr).toMatch(/duplicate|@sceneready\/domain/i);
  });

  it('fails when a second package-manager lockfile is present', async () => {
    const root = await createTemporaryRoot();
    await writeValidLayout(root);
    await writeUtf8(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');

    const result = runAssert(root);

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toBe('WORKSPACE_LAYOUT=PASS\n');
    expect(result.stderr).toContain('pnpm-lock.yaml');
  });
});
