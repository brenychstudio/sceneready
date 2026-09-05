import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { assertGovernanceFiles } from './governance.js';

const REQUIRED_FILES = [
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'docs/submission/HACKATHON-WORK.md',
  'docs/submission/ASSET-RIGHTS.md',
  'docs/submission/OPEN-SOURCE-CONTRIBUTION.md',
] as const;

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sceneready-governance-'));
  temporaryRoots.push(root);
  return root;
}

async function writeFixture(root: string, path: string, content: string): Promise<void> {
  const absolutePath = join(root, path);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })));
});

describe('assertGovernanceFiles', () => {
  it('reports missing governance files in deterministic order', async () => {
    const root = await createTemporaryRoot();

    const result = await assertGovernanceFiles(root);

    expect(result.missing).toEqual(REQUIRED_FILES);
  });

  it('detects the Apache-2.0 license from LICENSE content', async () => {
    const root = await createTemporaryRoot();
    await writeFixture(root, 'LICENSE', 'Apache License\nVersion 2.0, January 2004\n');

    const result = await assertGovernanceFiles(root);

    expect(result.licenseId).toBe('Apache-2.0');
  });

  it('returns the clean-room statement from HACKATHON-WORK.md', async () => {
    const root = await createTemporaryRoot();
    await writeFixture(
      root,
      'docs/submission/HACKATHON-WORK.md',
      'SceneReady provenance\n\nNo private BDB source copied\n',
    );

    const result = await assertGovernanceFiles(root);

    expect(result.cleanRoomStatement).toContain('No private BDB source copied');
  });
});
