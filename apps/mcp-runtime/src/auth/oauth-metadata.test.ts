import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { OAUTH_SCOPES, buildOAuthMetadata, rejectTokenStorage } from './oauth-metadata.js';

describe('OAuth metadata', () => {
  it('advertises the SceneReady scopes and PKCE without a token store', () => {
    const metadata = buildOAuthMetadata({
      issuer: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_example',
      authorizationEndpoint: 'https://example.com/oauth2/authorize',
      tokenEndpoint: 'https://example.com/oauth2/token',
    });
    expect(metadata.scopes_supported).toEqual(OAUTH_SCOPES);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.grant_types_supported).toEqual(['authorization_code', 'client_credentials']);
    expect(metadata.response_types_supported).toEqual(['code']);
    expect(JSON.stringify(metadata)).not.toContain('access_token');
  });

  it('rejects storing an access token in the prohibited sinks', () => {
    expect(() => rejectTokenStorage('ledger')).toThrow(/ledger/);
    expect(() => rejectTokenStorage('logs')).toThrow(/logs/);
    expect(() => rejectTokenStorage('traces')).toThrow(/traces/);
    expect(() => rejectTokenStorage('browser-local-storage')).toThrow(/browser-local-storage/);
  });

  it('does not persist tokens from this module', () => {
    const source = readFileSync(new URL('./oauth-metadata.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('localStorage');
    expect(source).not.toMatch(/access_token\s*[:=]/);
  });
});
