const CANONICAL_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

export const AUTHORITY_SESSION_ROLES = [
  'PRODUCTION_LEAD',
  'ASSISTANT',
  'DEMO_PRODUCTION_LEAD',
] as const;

export type AuthoritySessionRole = (typeof AUTHORITY_SESSION_ROLES)[number];

export const AUTHORITY_SESSION_NAMESPACES = ['LIVE', 'REPLAY'] as const;

export type AuthoritySessionNamespace = (typeof AUTHORITY_SESSION_NAMESPACES)[number];

export interface AuthenticatedAuthoritySession {
  readonly accountId: string;
  readonly actorId: string;
  readonly productionId: string;
  readonly role: AuthoritySessionRole;
  readonly authorityNamespace: AuthoritySessionNamespace;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
}

export class AuthorityBoundaryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthorityBoundaryError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new AuthorityBoundaryError(code, message);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_SESSION', `${field} must be a non-empty string`);
  }
  return value;
}

function readRole(value: unknown): AuthoritySessionRole {
  if (value === 'PRODUCTION_LEAD' || value === 'ASSISTANT' || value === 'DEMO_PRODUCTION_LEAD') {
    return value;
  }
  fail('INVALID_SESSION', 'role is not an authority session role');
}

function readNamespace(value: unknown): AuthoritySessionNamespace {
  if (value === 'LIVE' || value === 'REPLAY') {
    return value;
  }
  fail('INVALID_SESSION', 'authority namespace must be LIVE or REPLAY');
}

function matchGroup(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    fail('INVALID_TIMESTAMP', 'timestamps must be canonical UTC instants');
  }
  return value;
}

/**
 * Validates an injected UTC instant.
 * This reads the caller's timestamp. It does not read a clock.
 */
export function readCanonicalInstant(timestamp: string): string {
  if (typeof timestamp !== 'string') {
    fail('INVALID_TIMESTAMP', 'timestamps must be canonical UTC instants');
  }
  const match = CANONICAL_TIMESTAMP.exec(timestamp);
  if (match === null) {
    fail('INVALID_TIMESTAMP', 'timestamps must be canonical UTC instants');
  }
  const year = Number(matchGroup(match, 1));
  const month = Number(matchGroup(match, 2));
  const day = Number(matchGroup(match, 3));
  const hour = Number(matchGroup(match, 4));
  const minute = Number(matchGroup(match, 5));
  const second = Number(matchGroup(match, 6));
  const millisecond = Number(matchGroup(match, 7));
  const instant = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (new Date(instant).toISOString() !== timestamp) {
    fail('INVALID_TIMESTAMP', 'timestamp is not a real UTC instant');
  }
  return timestamp;
}

function instantMilliseconds(timestamp: string): number {
  return Date.parse(readCanonicalInstant(timestamp));
}

export function isStrictlyBefore(earlier: string, later: string): boolean {
  return instantMilliseconds(earlier) < instantMilliseconds(later);
}

/** Adds an explicit TTL to an injected instant. This does not read a clock. */
export function expiresAtFromTtl(issuedAt: string, ttlSeconds: number): string {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    fail('INVALID_TTL', 'ttlSeconds must be a positive integer');
  }
  const issuedMilliseconds = instantMilliseconds(issuedAt);
  const expiresMilliseconds = issuedMilliseconds + ttlSeconds * 1000;
  if (!Number.isSafeInteger(expiresMilliseconds)) {
    fail('INVALID_TTL', 'expiry is outside the representable instant range');
  }
  const expiresAt = new Date(expiresMilliseconds).toISOString();
  if (!CANONICAL_TIMESTAMP.test(expiresAt) || expiresMilliseconds <= issuedMilliseconds) {
    fail('INVALID_TTL', 'expiry must be strictly after issuance');
  }
  return expiresAt;
}

/** Copies a structurally valid session. Does not consult a clock and does not check expiry. */
export function readAuthenticatedAuthoritySession(
  session: AuthenticatedAuthoritySession,
): AuthenticatedAuthoritySession {
  if (typeof session !== 'object' || session === null) {
    fail('INVALID_SESSION', 'session must be an object');
  }
  const authenticatedAt = readCanonicalInstant(session.authenticatedAt);
  const expiresAt = readCanonicalInstant(session.expiresAt);
  if (!isStrictlyBefore(authenticatedAt, expiresAt)) {
    fail('INVALID_SESSION', 'authenticatedAt must be before expiresAt');
  }
  return Object.freeze({
    accountId: requireText(session.accountId, 'accountId'),
    actorId: requireText(session.actorId, 'actorId'),
    productionId: requireText(session.productionId, 'productionId'),
    role: readRole(session.role),
    authorityNamespace: readNamespace(session.authorityNamespace),
    authenticatedAt,
    expiresAt,
  });
}
