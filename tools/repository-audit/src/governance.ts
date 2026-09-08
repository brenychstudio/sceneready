import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface GovernanceAuditResult {
  readonly missing: readonly string[];
  readonly licenseId: 'Apache-2.0' | 'UNKNOWN';
  readonly cleanRoomStatement: string;
}

const GOVERNANCE_FILES = [
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'docs/submission/HACKATHON-WORK.md',
  'docs/submission/ASSET-RIGHTS.md',
  'docs/submission/OPEN-SOURCE-CONTRIBUTION.md',
] as const;

async function readGovernanceFile(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return null;
    }

    throw error;
  }
}

export async function assertGovernanceFiles(root: string): Promise<GovernanceAuditResult> {
  const contents = await Promise.all(
    GOVERNANCE_FILES.map(async (path) => ({
      path,
      content: await readGovernanceFile(root, path),
    })),
  );
  const missing = contents.filter(({ content }) => content === null).map(({ path }) => path);
  const license = contents.find(({ path }) => path === 'LICENSE')?.content ?? '';
  const cleanRoomStatement =
    contents.find(({ path }) => path === 'docs/submission/HACKATHON-WORK.md')?.content ?? '';
  const licenseId =
    license.includes('Apache License') && license.includes('Version 2.0, January 2004')
      ? 'Apache-2.0'
      : 'UNKNOWN';

  return {
    missing,
    licenseId,
    cleanRoomStatement,
  };
}
