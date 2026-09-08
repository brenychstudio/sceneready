import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findContentPatternMatches, isSensitiveTrackedEnvFile } from './credential-patterns.js';

export type PublicBoundaryViolationCode =
  | 'PRIVATE_FILESYSTEM_PATH'
  | 'AWS_ACCESS_KEY_PATTERN'
  | 'BEARER_TOKEN_PATTERN'
  | 'PRIVATE_KEY_BLOCK'
  | 'PASSWORD_ASSIGNMENT_PATTERN'
  | 'API_KEY_ASSIGNMENT_PATTERN'
  | 'REAL_PHONE_PATTERN'
  | 'REAL_EMAIL_PATTERN'
  | 'TRACKED_ENV_FILE';

export interface PublicBoundaryViolation {
  readonly code: PublicBoundaryViolationCode;
  readonly path: string;
  readonly line: number | null;
  readonly redactedPreview: string;
}

export interface PublicBoundaryAuditResult {
  readonly violations: readonly PublicBoundaryViolation[];
  readonly scannedFiles: number;
  readonly skippedBinaryFiles: number;
}

export interface PublicBoundaryAuditInput {
  readonly root: string;
  readonly syntheticText?: string;
  readonly syntheticPath?: string;
}

export class PublicBoundaryAuditError extends Error {
  readonly code: 'GIT_ENUMERATION_FAILED' | 'TRACKED_TEXT_READ_FAILED';
  readonly path: string | null;

  constructor(
    code: 'GIT_ENUMERATION_FAILED' | 'TRACKED_TEXT_READ_FAILED',
    path: string | null,
    detail: string,
    cause?: unknown,
  ) {
    const message =
      path === null
        ? `Public-boundary audit failed: ${detail}`
        : `Public-boundary audit failed for ${path}: ${detail}`;
    if (cause !== undefined) {
      super(message, { cause });
    } else {
      super(message);
    }
    this.name = 'PublicBoundaryAuditError';
    this.code = code;
    this.path = path;
  }
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

function normalizeRepoPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function isPathInsideRoot(root: string, absolutePath: string): boolean {
  const relativePath = relative(root, absolutePath);
  if (relativePath === '' || isAbsolute(relativePath)) {
    return false;
  }
  const posix = relativePath.replaceAll('\\', '/');
  return posix !== '..' && !posix.startsWith('../');
}

function redactSpan(line: string, start: number, end: number): string {
  const secret = line.slice(start, end);
  if (secret.length === 0) {
    return '***';
  }
  return line.split(secret).join('***').replaceAll('\r', ' ').replaceAll('\n', ' ').trim();
}

function sortViolations(violations: readonly PublicBoundaryViolation[]): PublicBoundaryViolation[] {
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
    return compareStrings(left.redactedPreview, right.redactedPreview);
  });
}

function scanText(path: string, text: string): PublicBoundaryViolation[] {
  const violations: PublicBoundaryViolation[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    for (const match of findContentPatternMatches(line)) {
      violations.push({
        code: match.code,
        path,
        line: index + 1,
        redactedPreview: redactSpan(line, match.start, match.end),
      });
    }
  }
  return violations;
}

function envFileViolation(path: string): PublicBoundaryViolation {
  return {
    code: 'TRACKED_ENV_FILE',
    path,
    line: null,
    redactedPreview: 'tracked sensitive env file',
  };
}

function scanVirtualFile(
  path: string,
  text: string,
): {
  violations: PublicBoundaryViolation[];
  skippedBinaryFiles: number;
} {
  const violations: PublicBoundaryViolation[] = [];
  if (isSensitiveTrackedEnvFile(path)) {
    violations.push(envFileViolation(path));
  }
  if (text.includes('\0')) {
    return { violations, skippedBinaryFiles: 1 };
  }
  violations.push(...scanText(path, text));
  return { violations, skippedBinaryFiles: 0 };
}

async function listTrackedFiles(root: string): Promise<string[]> {
  const stdout = await new Promise<Buffer>((resolvePromise, reject) => {
    execFile(
      'git',
      ['ls-files', '-z'],
      {
        cwd: root,
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
        env: gitEnv(),
      },
      (error, output) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolvePromise(Buffer.isBuffer(output) ? output : Buffer.from(output));
      },
    );
  }).catch((error: unknown) => {
    throw new PublicBoundaryAuditError(
      'GIT_ENUMERATION_FAILED',
      null,
      'unable to enumerate Git-tracked files',
      error,
    );
  });

  const paths: string[] = [];
  let start = 0;
  for (let index = 0; index < stdout.length; index += 1) {
    if (stdout[index] === 0) {
      if (index > start) {
        paths.push(stdout.subarray(start, index).toString('utf8'));
      }
      start = index + 1;
    }
  }
  if (start < stdout.length) {
    paths.push(stdout.subarray(start).toString('utf8'));
  }
  return paths.filter((path) => path.length > 0).sort(compareStrings);
}

async function readTrackedFile(root: string, repoPath: string): Promise<Buffer> {
  const absolutePath = resolve(root, repoPath);
  if (!isPathInsideRoot(root, absolutePath)) {
    throw new PublicBoundaryAuditError(
      'TRACKED_TEXT_READ_FAILED',
      repoPath,
      'tracked path escapes repository root',
    );
  }
  try {
    return await readFile(absolutePath);
  } catch (error) {
    throw new PublicBoundaryAuditError(
      'TRACKED_TEXT_READ_FAILED',
      repoPath,
      'unable to read tracked text file',
      error,
    );
  }
}

export function formatPublicBoundaryOutput(result: PublicBoundaryAuditResult): string {
  if (result.violations.length === 0) {
    return 'PUBLIC_BOUNDARY=PASS\n';
  }
  const lines = [
    'PUBLIC_BOUNDARY=FAIL',
    `PUBLIC_BOUNDARY_VIOLATIONS=${result.violations.length}`,
    ...result.violations.map((item) => {
      const location = item.line === null ? item.path : `${item.path}:${item.line}`;
      return `${item.code} ${location} ${item.redactedPreview}`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}

function formatInternalFailure(error: unknown): string {
  if (error instanceof PublicBoundaryAuditError) {
    if (error.path === null) {
      return `PUBLIC_BOUNDARY=INTERNAL_FAILURE\n${error.code}`;
    }
    return `PUBLIC_BOUNDARY=INTERNAL_FAILURE\n${error.code} ${error.path}`;
  }
  return 'PUBLIC_BOUNDARY=INTERNAL_FAILURE';
}

export async function auditPublicBoundary(
  input: PublicBoundaryAuditInput,
): Promise<PublicBoundaryAuditResult> {
  const syntheticText = input.syntheticText;
  if (syntheticText !== undefined) {
    const path = normalizeRepoPath(input.syntheticPath ?? 'synthetic-input');
    const scanned = scanVirtualFile(path, syntheticText);
    return {
      violations: sortViolations(scanned.violations),
      scannedFiles: 1,
      skippedBinaryFiles: scanned.skippedBinaryFiles,
    };
  }

  const root = resolve(input.root);
  const trackedFiles = await listTrackedFiles(root);
  const violations: PublicBoundaryViolation[] = [];
  let skippedBinaryFiles = 0;

  for (const tracked of trackedFiles) {
    const path = normalizeRepoPath(tracked);
    if (isSensitiveTrackedEnvFile(path)) {
      violations.push(envFileViolation(path));
    }
    const buffer = await readTrackedFile(root, path);
    if (isBinaryBuffer(buffer)) {
      skippedBinaryFiles += 1;
      continue;
    }
    violations.push(...scanText(path, buffer.toString('utf8')));
  }

  return {
    violations: sortViolations(violations),
    scannedFiles: trackedFiles.length,
    skippedBinaryFiles,
  };
}

function isCliEntrypoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  const normalizedEntry = entry.replaceAll('\\', '/').toLowerCase();
  if (normalizedEntry.endsWith('/public-boundary.ts')) {
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
  try {
    const result = await auditPublicBoundary({ root: process.cwd() });
    process.stdout.write(formatPublicBoundaryOutput(result));
    process.exit(result.violations.length === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${formatInternalFailure(error)}\n`);
    process.exit(2);
  }
}

if (isCliEntrypoint()) {
  runCli().catch(() => {
    process.stderr.write('PUBLIC_BOUNDARY=INTERNAL_FAILURE\n');
    process.exit(2);
  });
}
