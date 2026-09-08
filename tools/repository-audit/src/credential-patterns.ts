export type PublicBoundaryContentCode =
  | 'PRIVATE_FILESYSTEM_PATH'
  | 'AWS_ACCESS_KEY_PATTERN'
  | 'BEARER_TOKEN_PATTERN'
  | 'PRIVATE_KEY_BLOCK'
  | 'PASSWORD_ASSIGNMENT_PATTERN'
  | 'API_KEY_ASSIGNMENT_PATTERN'
  | 'REAL_PHONE_PATTERN'
  | 'REAL_EMAIL_PATTERN';

export interface ContentPatternMatch {
  readonly code: PublicBoundaryContentCode;
  readonly start: number;
  readonly end: number;
}

export const AWS_ACCESS_KEY_PATTERN = /(?<![A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])/g;

export const BEARER_TOKEN_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/-]{16,}={0,3})/g;

export const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g;

export const PASSWORD_ASSIGNMENT_PATTERN =
  /(?:^|[\s,{])["']?(?:password|passwd|pwd)["']?\s*[:=]\s*(["'][^"'\n]+["']|[^\s,;"']+)/gi;

export const API_KEY_ASSIGNMENT_PATTERN =
  /(?:^|[\s,{])["']?api[-_]?key["']?\s*[:=]\s*(["'][^"'\n]+["']|[^\s,;"']+)/gi;

export const REAL_PHONE_PATTERN = /(?<![A-Za-z0-9+/])\+[1-9]\d{7,14}(?![A-Za-z0-9+/])/g;

export const REAL_EMAIL_PATTERN =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export const WINDOWS_PRIVATE_PATH_PATTERN =
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:PROJECTS|Users)(?:[\\/][^\s'"`]+)?/gi;

export const POSIX_PRIVATE_PATH_PATTERN =
  /(?<![A-Za-z0-9])\/(?:home|Users)\/([A-Za-z0-9._-]+)(?:\/[^\s'"`]*)?/g;

const PLACEHOLDER_VALUES = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'changeme',
  'change-me',
  'change_me',
  'your_password',
  'your-password',
  'yourpassword',
  'placeholder',
  'example',
  'dummy',
  'sample',
  'test',
  'todo',
  'redacted',
  'xxx',
  'xxxxx',
  'null',
  'undefined',
  'none',
  'n/a',
  'na',
  'replace_me',
  'replaceme',
  'replace-me',
  'insert_here',
  'api_key',
  'api-key',
  'apikey',
  'your_api_key',
  'your-api-key',
  'your-api-key-here',
  'your_api_key_here',
]);

const SENSITIVE_ENV_BASENAMES = new Set(['.env', '.env.local', '.env.production', '.env.staging']);

const RESERVED_EMAIL_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);

function cloneGlobal(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function collect(pattern: RegExp, line: string): RegExpMatchArray[] {
  return [...line.matchAll(cloneGlobal(pattern))];
}

export function unwrapAssignedValue(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

export function isPlaceholderSecret(value: string): boolean {
  const trimmed = unwrapAssignedValue(value).trim();
  if (trimmed.length === 0) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower)) {
    return true;
  }
  if (/^<[^>]+>$/.test(trimmed) || /^\$\{[^}]+\}$/.test(trimmed)) {
    return true;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) || /^%[A-Za-z_][A-Za-z0-9_]*%$/.test(trimmed)) {
    return true;
  }
  if (/^process\.env\.[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return true;
  }
  return (
    /^\*+$/.test(trimmed) || /^x+$/i.test(trimmed) || /^\.+$/.test(trimmed) || /^-+$/.test(trimmed)
  );
}

export function isReservedEmailDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (RESERVED_EMAIL_DOMAINS.has(lower)) {
    return true;
  }
  for (const reserved of RESERVED_EMAIL_DOMAINS) {
    if (lower.endsWith(`.${reserved}`)) {
      return true;
    }
  }
  return lower.endsWith('.invalid') || lower.endsWith('.test') || lower.endsWith('.example');
}

export function isSensitiveTrackedEnvFile(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  const base = index === -1 ? normalized : normalized.slice(index + 1);
  return SENSITIVE_ENV_BASENAMES.has(base);
}

function isInsideUrl(line: string, index: number): boolean {
  const before = line.slice(0, index);
  const match = /([A-Za-z][A-Za-z0-9+.-]*):\/\/\S*$/.exec(before);
  const scheme = match?.[1];
  if (scheme === undefined) {
    return false;
  }
  return scheme.toLowerCase() !== 'file';
}

function valueSpan(
  match: RegExpMatchArray,
  groupIndex: number,
): { start: number; end: number } | null {
  const raw = match[groupIndex];
  const matchIndex = match.index;
  if (raw === undefined || matchIndex === undefined) {
    return null;
  }
  const offsetInMatch = match[0].lastIndexOf(raw);
  if (offsetInMatch === -1) {
    return null;
  }
  const start = matchIndex + offsetInMatch;
  return { start, end: start + raw.length };
}

function pushMatch(
  matches: ContentPatternMatch[],
  code: PublicBoundaryContentCode,
  start: number,
  end: number,
): void {
  if (end > start) {
    matches.push({ code, start, end });
  }
}

export function findContentPatternMatches(line: string): ContentPatternMatch[] {
  const matches: ContentPatternMatch[] = [];

  for (const match of collect(WINDOWS_PRIVATE_PATH_PATTERN, line)) {
    if (match.index === undefined || isInsideUrl(line, match.index)) {
      continue;
    }
    pushMatch(matches, 'PRIVATE_FILESYSTEM_PATH', match.index, match.index + match[0].length);
  }

  for (const match of collect(POSIX_PRIVATE_PATH_PATTERN, line)) {
    const user = match[1];
    if (
      match.index === undefined ||
      user === undefined ||
      /^\.+$/.test(user) ||
      isInsideUrl(line, match.index)
    ) {
      continue;
    }
    pushMatch(matches, 'PRIVATE_FILESYSTEM_PATH', match.index, match.index + match[0].length);
  }

  for (const match of collect(AWS_ACCESS_KEY_PATTERN, line)) {
    if (match.index === undefined) {
      continue;
    }
    pushMatch(matches, 'AWS_ACCESS_KEY_PATTERN', match.index, match.index + match[0].length);
  }

  for (const match of collect(BEARER_TOKEN_PATTERN, line)) {
    const token = match[1];
    const span = valueSpan(match, 1);
    if (token === undefined || span === null || isPlaceholderSecret(token)) {
      continue;
    }
    pushMatch(matches, 'BEARER_TOKEN_PATTERN', span.start, span.end);
  }

  for (const match of collect(PRIVATE_KEY_BLOCK, line)) {
    if (match.index === undefined) {
      continue;
    }
    pushMatch(matches, 'PRIVATE_KEY_BLOCK', match.index, match.index + match[0].length);
  }

  for (const match of collect(PASSWORD_ASSIGNMENT_PATTERN, line)) {
    const raw = match[1];
    const span = valueSpan(match, 1);
    if (raw === undefined || span === null || isPlaceholderSecret(raw)) {
      continue;
    }
    if (unwrapAssignedValue(raw).trim().length < 8) {
      continue;
    }
    pushMatch(matches, 'PASSWORD_ASSIGNMENT_PATTERN', span.start, span.end);
  }

  for (const match of collect(API_KEY_ASSIGNMENT_PATTERN, line)) {
    const raw = match[1];
    const span = valueSpan(match, 1);
    if (raw === undefined || span === null || isPlaceholderSecret(raw)) {
      continue;
    }
    if (unwrapAssignedValue(raw).trim().length < 8) {
      continue;
    }
    pushMatch(matches, 'API_KEY_ASSIGNMENT_PATTERN', span.start, span.end);
  }

  for (const match of collect(REAL_PHONE_PATTERN, line)) {
    if (match.index === undefined) {
      continue;
    }
    pushMatch(matches, 'REAL_PHONE_PATTERN', match.index, match.index + match[0].length);
  }

  for (const match of collect(REAL_EMAIL_PATTERN, line)) {
    if (match.index === undefined) {
      continue;
    }
    const at = match[0].lastIndexOf('@');
    const domain = at === -1 ? '' : match[0].slice(at + 1);
    if (isReservedEmailDomain(domain)) {
      continue;
    }
    pushMatch(matches, 'REAL_EMAIL_PATTERN', match.index, match.index + match[0].length);
  }

  return matches;
}
