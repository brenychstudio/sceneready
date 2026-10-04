export const OAUTH_SCOPES = [
  'sceneready/service',
  'sceneready/production.read',
  'sceneready/replay.approve',
  'sceneready/live.approve',
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const TOKEN_STORAGE_PROHIBITIONS = [
  'ledger',
  'logs',
  'traces',
  'browser-local-storage',
] as const;

export type TokenStorageProhibition = (typeof TOKEN_STORAGE_PROHIBITIONS)[number];

export interface OAuthMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly scopes_supported: readonly OAuthScope[];
  readonly response_types_supported: readonly ['code'];
  readonly grant_types_supported: readonly ['authorization_code', 'client_credentials'];
  readonly code_challenge_methods_supported: readonly ['S256'];
  readonly token_endpoint_auth_methods_supported: readonly ['client_secret_basic', 'none'];
}

export interface OAuthMetadataInput {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

function requireHttps(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an https URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must be an https URL`);
  }
  return url.toString();
}

export function buildOAuthMetadata(input: OAuthMetadataInput): OAuthMetadata {
  return Object.freeze({
    issuer: requireHttps(input.issuer, 'issuer'),
    authorization_endpoint: requireHttps(input.authorizationEndpoint, 'authorization endpoint'),
    token_endpoint: requireHttps(input.tokenEndpoint, 'token endpoint'),
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ['code'] as const,
    grant_types_supported: ['authorization_code', 'client_credentials'] as const,
    code_challenge_methods_supported: ['S256'] as const,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'] as const,
  });
}

export function rejectTokenStorage(sink: string): void {
  if ((TOKEN_STORAGE_PROHIBITIONS as readonly string[]).includes(sink)) {
    throw new Error(`OAuth access tokens must not be stored in ${sink}`);
  }
}
