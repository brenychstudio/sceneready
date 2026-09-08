import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  auditPublicBoundary,
  formatPublicBoundaryOutput,
  PublicBoundaryAuditError,
  type PublicBoundaryAuditResult,
} from './public-boundary.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sceneready-public-boundary-'));
  temporaryRoots.push(root);
  return root;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  return env;
}

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: gitEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}

async function auditSynthetic(
  syntheticPath: string,
  syntheticText: string,
): Promise<PublicBoundaryAuditResult> {
  return auditPublicBoundary({
    root: repositoryRoot,
    syntheticPath,
    syntheticText,
  });
}

function serializedAuditViews(result: PublicBoundaryAuditResult): string[] {
  return [
    JSON.stringify(result),
    formatPublicBoundaryOutput(result),
    result.violations
      .map((item) => `${item.code}:${item.path}:${item.line}:${item.redactedPreview}`)
      .join('\n'),
  ];
}

function expectNoWholeSecret(result: PublicBoundaryAuditResult, secret: string): void {
  expect(secret.length).toBeGreaterThan(8);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(formatPublicBoundaryOutput(result)).not.toContain(secret);
  for (const view of serializedAuditViews(result)) {
    expect(view).not.toContain(secret);
  }
  for (const item of result.violations) {
    expect(item.redactedPreview).not.toContain(secret);
  }
}

async function expectSecretFamilyHidden(
  code: PublicBoundaryAuditResult['violations'][number]['code'],
  syntheticPath: string,
  syntheticText: string,
  secrets: readonly string[],
): Promise<PublicBoundaryAuditResult> {
  const result = await auditSynthetic(syntheticPath, syntheticText);
  expect(result.violations.map((item) => item.code)).toEqual([code]);
  for (const secret of secrets) {
    expectNoWholeSecret(result, secret);
  }
  return result;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })),
  );
});

describe('auditPublicBoundary', () => {
  it('rejects a Windows private absolute path', async () => {
    const privatePath = ['C:', '\\PROJECTS\\', 'clients\\', 'acme\\ledger.txt'].join('');
    const result = await auditSynthetic('synthetic/windows-path.txt', `backup ${privatePath}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expect(result.violations[0]?.path).toBe('synthetic/windows-path.txt');
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, privatePath);
  });

  it('rejects a POSIX user private path', async () => {
    const privatePath = ['/home/', 'alice', '/.ssh/id_ed25519'].join('');
    const result = await auditSynthetic('synthetic/posix-path.txt', `copy ${privatePath}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expect(result.violations[0]?.path).toBe('synthetic/posix-path.txt');
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, privatePath);
  });

  it('rejects an AWS-key-shaped value', async () => {
    const accessKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const result = await auditSynthetic('synthetic/aws.txt', `id=${accessKey}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['AWS_ACCESS_KEY_PATTERN']);
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, accessKey);
  });

  it('rejects a bearer token', async () => {
    const token = ['srpub_', 'abcdefghijklmnopqrstuvwxyz012345'].join('');
    const header = ['Bearer ', token].join('');
    const result = await auditSynthetic('synthetic/bearer.txt', `Authorization: ${header}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['BEARER_TOKEN_PATTERN']);
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, token);
  });

  it('does not leak a full bearer token in the audit result, serialization, or formatted output', async () => {
    const token = ['srpub_', 'leakchecktokenvalue9x7k2mqq'].join('');
    const header = ['Bearer ', token].join('');
    const result = await auditSynthetic('synthetic/bearer-leak.txt', `Authorization: ${header}\n`);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.code).toBe('BEARER_TOKEN_PATTERN');
    expectNoWholeSecret(result, token);
    expectNoWholeSecret(result, header);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(formatPublicBoundaryOutput(result)).not.toContain(token);
    expect(formatPublicBoundaryOutput(result)).not.toContain(header);
  });

  it('rejects a private key block', async () => {
    const begin = ['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join('');
    const end = ['-----END ', 'RSA PRIVATE', ' KEY-----'].join('');
    const body = ['MII', 'EvFakePEMBodyNotALiveKey'].join('');
    const result = await auditSynthetic('synthetic/private-key.txt', `${begin}\n${body}\n${end}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['PRIVATE_KEY_BLOCK']);
    expect(result.violations[0]?.line).toBe(1);
    expect(result.violations[0]?.redactedPreview).not.toContain(begin);
    expect(result.violations[0]?.redactedPreview).not.toContain(body);
  });

  it('rejects an obvious password assignment', async () => {
    const password = ['corr', 'ect-horse-battery-staple-92'].join('');
    const result = await auditSynthetic('synthetic/password.txt', `password = "${password}"\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['PASSWORD_ASSIGNMENT_PATTERN']);
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, password);
  });

  it('rejects an obvious API-key assignment', async () => {
    const apiKey = ['sk_live_', 'abcdefghijklmnopqrstuvwxyz0123'].join('');
    const result = await auditSynthetic('synthetic/api-key.txt', `api_key: "${apiKey}"\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['API_KEY_ASSIGNMENT_PATTERN']);
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, apiKey);
  });

  it('rejects a realistic international phone number', async () => {
    const phone = ['+', '14155552671'].join('');
    const result = await auditSynthetic('synthetic/phone.txt', `contact ${phone}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['REAL_PHONE_PATTERN']);
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, phone);
  });

  it('rejects a real-like email address', async () => {
    const email = ['stage-manager@', 'clientsite.net'].join('');
    const result = await auditSynthetic('synthetic/email.txt', `owner ${email}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['REAL_EMAIL_PATTERN']);
    expect(result.violations[0]?.line).toBe(1);
    expectNoWholeSecret(result, email);
  });

  it('allows user@example.invalid', async () => {
    const result = await auditSynthetic(
      'synthetic/reserved-invalid.txt',
      'owner user@example.invalid\n',
    );

    expect(result.violations).toEqual([]);
  });

  it('allows user@example.com', async () => {
    const result = await auditSynthetic(
      'synthetic/reserved-example.txt',
      'owner user@example.com\n',
    );

    expect(result.violations).toEqual([]);
  });

  it('rejects a tracked .env file', async () => {
    const result = await auditSynthetic('.env', 'NODE_ENV=development\n');

    expect(result.violations).toEqual([
      {
        code: 'TRACKED_ENV_FILE',
        path: '.env',
        line: null,
        redactedPreview: result.violations[0]?.redactedPreview ?? '',
      },
    ]);
    expect(result.violations[0]?.redactedPreview.length).toBeGreaterThan(0);
    expect(result.violations[0]?.redactedPreview).not.toMatch(/[A-Za-z0-9+/=_-]{12,}/);
  });

  it('allows .env.example', async () => {
    const exampleEnv = [
      'API_KEY',
      '=',
      'your-api-key',
      '\n',
      'PASSWORD',
      '=',
      'changeme',
      '\n',
    ].join('');
    const result = await auditSynthetic('.env.example', exampleEnv);

    expect(result.violations).toEqual([]);
  });

  it('skips binary content safely and does not pattern-match embedded secrets', async () => {
    const accessKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const result = await auditSynthetic('synthetic/blob.bin', `png-header\u0000${accessKey}`);

    expect(result.violations).toEqual([]);
    expect(result.scannedFiles).toBe(1);
    expect(result.skippedBinaryFiles).toBe(1);
    expectNoWholeSecret(result, accessKey);
  });

  it('fails closed when Git tracked-file enumeration fails', async () => {
    const root = await createTemporaryRoot();

    await expect(auditPublicBoundary({ root })).rejects.toSatisfy((error: unknown) => {
      return error instanceof PublicBoundaryAuditError && error.code === 'GIT_ENUMERATION_FAILED';
    });
  });

  it('fails closed when a tracked text file cannot be read', async () => {
    const root = await createTemporaryRoot();
    const relativePath = 'tracked-text.txt';
    await writeFile(join(root, relativePath), 'safe text\n', 'utf8');
    runGit(root, ['init']);
    runGit(root, ['add', relativePath]);
    await unlink(join(root, relativePath));

    await expect(auditPublicBoundary({ root })).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof PublicBoundaryAuditError &&
        error.code === 'TRACKED_TEXT_READ_FAILED' &&
        error.path === relativePath
      );
    });
  });

  it('reports zero public-boundary violations for the current repository', async () => {
    const result = await auditPublicBoundary({ root: repositoryRoot });

    expect(result.violations).toEqual([]);
    expect(result.scannedFiles).toBeGreaterThan(0);
    expect(result.skippedBinaryFiles).toBeGreaterThanOrEqual(0);
    expect(formatPublicBoundaryOutput(result)).toBe('PUBLIC_BOUNDARY=PASS\n');
  });

  it('does not treat URL pathnames or repository-relative paths as private filesystem paths', async () => {
    const result = await auditSynthetic(
      'docs/paths.md',
      [
        'See https://example.com/Users/alice/docs',
        'See https://example.com/home/alice/docs',
        'See https://example.com/C:/Users/alice/docs',
        'Relative Users/alice/config is not absolute',
        'Relative home/alice/config is not absolute',
        '',
      ].join('\n'),
    );

    expect(result.violations).toEqual([]);
  });

  it('does not flag .npmrc merely because it begins with a dot', async () => {
    const result = await auditSynthetic('.npmrc', 'engine-strict=true\npackage-lock=true\n');

    expect(result.violations).toEqual([]);
  });

  it('hides the complete value for every secret-bearing violation family', async () => {
    const accessKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const bearerToken = ['srpub_', 'redactionproofvalue9x7k2mqqzz'].join('');
    const bearerHeader = ['Bearer ', bearerToken].join('');
    const begin = ['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join('');
    const end = ['-----END ', 'RSA PRIVATE', ' KEY-----'].join('');
    const body = ['MII', 'EvFakePEMBodyNotALiveKey'].join('');
    const pemBlock = `${begin}\n${body}\n${end}`;
    const password = ['corr', 'ect-horse-battery-staple-92'].join('');
    const apiKey = ['sk_live_', 'abcdefghijklmnopqrstuvwxyz0123'].join('');

    await expectSecretFamilyHidden(
      'AWS_ACCESS_KEY_PATTERN',
      'synthetic/redact-aws.txt',
      `id=${accessKey}\n`,
      [accessKey],
    );
    await expectSecretFamilyHidden(
      'BEARER_TOKEN_PATTERN',
      'synthetic/redact-bearer.txt',
      `Authorization: ${bearerHeader}\n`,
      [bearerToken, bearerHeader],
    );
    const privateKeyResult = await expectSecretFamilyHidden(
      'PRIVATE_KEY_BLOCK',
      'synthetic/redact-private-key.txt',
      `${pemBlock}\n`,
      [begin, body, pemBlock],
    );
    expect(privateKeyResult.violations[0]?.redactedPreview).not.toContain(end);
    await expectSecretFamilyHidden(
      'PASSWORD_ASSIGNMENT_PATTERN',
      'synthetic/redact-password.txt',
      `password = "${password}"\n`,
      [password],
    );
    await expectSecretFamilyHidden(
      'API_KEY_ASSIGNMENT_PATTERN',
      'synthetic/redact-api-key.txt',
      `api_key: "${apiKey}"\n`,
      [apiKey],
    );
  });

  it('allows empty, labeled, angle, and env-style password placeholders', async () => {
    const fixtures = [
      'password=""',
      'password="YOUR_PASSWORD"',
      'password="<password>"',
      'password="${PASSWORD}"',
    ];

    for (const syntheticText of fixtures) {
      const result = await auditSynthetic(
        'synthetic/password-placeholder.txt',
        `${syntheticText}\n`,
      );
      expect(result.violations, syntheticText).toEqual([]);
    }
  });

  it('allows empty, labeled, angle, and env-style API-key placeholders', async () => {
    const fixtures = [
      'apiKey=""',
      'apiKey="YOUR_API_KEY"',
      'api_key="<api-key>"',
      'apiKey="${API_KEY}"',
    ];

    for (const syntheticText of fixtures) {
      const result = await auditSynthetic(
        'synthetic/api-key-placeholder.txt',
        `${syntheticText}\n`,
      );
      expect(result.violations, syntheticText).toEqual([]);
    }
  });

  it('still rejects realistic non-placeholder password and API-key assignments', async () => {
    const password = ['n0tA', 'Placeh0lder-secret-value'].join('');
    const apiKey = ['sk_live_', 'n0tAplaceholderkeyvaluezz'].join('');

    const passwordResult = await auditSynthetic(
      'synthetic/real-password.txt',
      `password = "${password}"\n`,
    );
    const apiKeyResult = await auditSynthetic(
      'synthetic/real-api-key.txt',
      `apiKey = "${apiKey}"\n`,
    );

    expect(passwordResult.violations.map((item) => item.code)).toEqual([
      'PASSWORD_ASSIGNMENT_PATTERN',
    ]);
    expect(apiKeyResult.violations.map((item) => item.code)).toEqual([
      'API_KEY_ASSIGNMENT_PATTERN',
    ]);
    expectNoWholeSecret(passwordResult, password);
    expectNoWholeSecret(apiKeyResult, apiKey);
  });

  it('detects Windows private absolute paths on C, D, and Z drives', async () => {
    const cUsers = ['C:', '\\Users\\', 'alice\\appdata\\secret.txt'].join('');
    const dProjects = ['D:', '\\Projects\\', 'clients\\acme\\ledger.txt'].join('');
    const zWork = ['Z:', '\\PROJECTS\\', 'work\\notes.txt'].join('');

    const cResult = await auditSynthetic('synthetic/c-users.txt', `backup ${cUsers}\n`);
    const dResult = await auditSynthetic('synthetic/d-projects.txt', `backup ${dProjects}\n`);
    const zResult = await auditSynthetic('synthetic/z-work.txt', `backup ${zWork}\n`);

    expect(cResult.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expect(dResult.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expect(zResult.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expectNoWholeSecret(cResult, cUsers);
    expectNoWholeSecret(dResult, dProjects);
    expectNoWholeSecret(zResult, zWork);
  });

  it('rejects a Windows private path inside a local file URL', async () => {
    const cUsers = ['C:', '/Users/', 'synthuser', '/private.txt'].join('');
    const dProjects = ['D:', '/Projects/', 'private/project.txt'].join('');
    const cUrl = ['file:///', cUsers].join('');
    const dUrl = ['file:///', dProjects].join('');

    const cResult = await auditSynthetic('synthetic/file-url-c-users.txt', `open ${cUrl}\n`);
    const dResult = await auditSynthetic('synthetic/file-url-d-projects.txt', `open ${dUrl}\n`);

    expect(cResult.violations.length).toBeGreaterThan(0);
    expect(cResult.violations.every((item) => item.code === 'PRIVATE_FILESYSTEM_PATH')).toBe(true);
    expect(dResult.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expectNoWholeSecret(cResult, cUsers);
    expectNoWholeSecret(dResult, dProjects);
  });

  it('rejects a POSIX home private path inside a local file URL', async () => {
    const posixHome = ['/home/', 'synthuser', '/private.txt'].join('');
    const fileUrl = ['file://', posixHome].join('');
    const result = await auditSynthetic('synthetic/file-url-posix-home.txt', `open ${fileUrl}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expectNoWholeSecret(result, posixHome);
  });

  it('rejects a POSIX Users private path inside a local file URL', async () => {
    const posixUsers = ['/Users/', 'synthuser', '/private.txt'].join('');
    const fileUrl = ['file://', posixUsers].join('');
    const result = await auditSynthetic('synthetic/file-url-posix-users.txt', `open ${fileUrl}\n`);

    expect(result.violations.map((item) => item.code)).toEqual(['PRIVATE_FILESYSTEM_PATH']);
    expectNoWholeSecret(result, posixUsers);
  });

  it('allows ordinary HTTPS pathnames that only resemble Windows private paths', async () => {
    const result = await auditSynthetic(
      'docs/https-windows-like.md',
      'See https://example.com/C:/documentation\nSee https://example.com/C:/Users/reference\n',
    );

    expect(result.violations).toEqual([]);
  });

  it('allows ordinary HTTPS pathnames that only resemble POSIX private paths', async () => {
    const result = await auditSynthetic(
      'docs/https-posix-like.md',
      'See https://example.com/Users/reference\nSee https://example.com/home/reference\n',
    );

    expect(result.violations).toEqual([]);
  });

  it('allows repository-relative Users and home paths', async () => {
    const result = await auditSynthetic(
      'docs/relative-paths.md',
      'Relative Users/alice/config is not absolute\nRelative home/alice/config is not absolute\n',
    );

    expect(result.violations).toEqual([]);
  });
});
