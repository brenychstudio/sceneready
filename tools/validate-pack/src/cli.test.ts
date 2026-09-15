import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runValidatePack } from './index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDir = join(repositoryRoot, 'fixtures/barcelona-aer-ss27');
const cliSourcePath = join(dirname(fileURLToPath(import.meta.url)), 'index.ts');

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sceneready-validate-pack-'));
  temporaryRoots.push(root);
  return root;
}

class MemoryWriter {
  readonly chunks: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }

  toString(): string {
    return this.chunks.join('');
  }
}

async function runCli(args: readonly string[]): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();
  const code = await runValidatePack(args, { stdout, stderr });
  return { code, stdout: stdout.toString(), stderr: stderr.toString() };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })),
  );
});

describe('pack:validate CLI', () => {
  it('exits 0 for the canonical Barcelona fixture and prints JSON', async () => {
    const nowSpy = vi.spyOn(Date, 'now');

    const result = await runCli(['--fixture', fixtureDir]);
    const parsed: unknown = JSON.parse(result.stdout.trim());

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'VALID',
        productionId: 'BCN-DEMO-01',
        fixtureVersion: 'BCN-DEMO-v1',
        policyVersion: 'SR-POLICY-v1',
        graphSchemaVersion: 'SR-GRAPH-v1',
      }),
    );
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('CLI output is not an object');
    }
    const record = parsed as Record<string, unknown>;
    expect(record.packFingerprint).toBe(
      '13a1183c848d5762764da1f646f2ffc97321f976bb8c3ff340425a99117263be',
    );
    expect(record.activatedAt).toBe('2026-09-17T03:45:00Z');
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it('returns byte-equivalent JSON across two validation runs', async () => {
    const first = await runCli(['--fixture', fixtureDir]);
    const second = await runCli(['--fixture', fixtureDir]);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toBe(
      `${JSON.stringify({
        status: 'VALID',
        productionId: 'BCN-DEMO-01',
        fixtureVersion: 'BCN-DEMO-v1',
        policyVersion: 'SR-POLICY-v1',
        graphSchemaVersion: 'SR-GRAPH-v1',
        packFingerprint: '13a1183c848d5762764da1f646f2ffc97321f976bb8c3ff340425a99117263be',
        activatedAt: '2026-09-17T03:45:00Z',
      })}\n`,
    );
  });

  it('exits 2 for invalid fixture input without a stack trace', async () => {
    const missing = await runCli(['--fixture', join(repositoryRoot, 'fixtures/does-not-exist')]);
    expect(missing.code).toBe(2);
    expect(() => JSON.parse(missing.stdout.trim()) as unknown).not.toThrow();
    expect(missing.stdout).not.toMatch(/\s+at\s+/);
    expect(missing.stderr).not.toMatch(/\s+at\s+/);

    const root = await createTemporaryRoot();
    await writeFile(join(root, 'not-a-pack.json'), '{', 'utf8');
    const invalid = await runCli(['--fixture', root]);
    expect(invalid.code).toBe(2);
    const parsed: unknown = JSON.parse(invalid.stdout.trim());
    expect(parsed).toEqual(expect.objectContaining({ status: 'INVALID' }));
    expect(invalid.stdout).not.toMatch(/\s+at\s+/);
    expect(invalid.stderr).not.toMatch(/\s+at\s+/);
  });

  it('does not compile or create a production graph', async () => {
    const source = await readFile(cliSourcePath, 'utf8');
    expect(source).not.toContain('compileProductionGraph');
    expect(source).not.toContain('@sceneready/production-graph');
    expect(source).not.toContain('production-graph');
    expect(source).not.toContain('packOwnedActivationInstant');
    expect(source).toContain('function deriveValidationActivationInstant');
    expect(source).not.toMatch(/export\s+(?:async\s+)?function deriveValidationActivationInstant/);

    const result = await runCli(['--fixture', fixtureDir]);
    const parsed: unknown = JSON.parse(result.stdout.trim());
    expect(parsed).not.toHaveProperty('nodes');
    expect(parsed).not.toHaveProperty('edges');
    expect(parsed).not.toHaveProperty('graphRevision');
    expect(JSON.stringify(parsed)).not.toContain('compileProductionGraph');
  });

  it('exits 0 when invoked as the pack:validate process', () => {
    const result = spawnSync(
      process.execPath,
      [
        join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs'),
        join(repositoryRoot, 'tools/validate-pack/src/index.ts'),
        '--fixture',
        'fixtures/barcelona-aer-ss27',
      ],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        windowsHide: true,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout.trim());
    expect(parsed).toEqual(
      expect.objectContaining({ status: 'VALID', productionId: 'BCN-DEMO-01' }),
    );
  });
});
