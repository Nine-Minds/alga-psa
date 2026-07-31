import { describe, expect, it, vi } from 'vitest';

/**
 * Authorization Server Metadata (RFC 8414) shape + consistency (plan test T010)
 * and authorize-parameter parsing. Pure functions; the auth seam is mocked so the
 * module imports without a session/DB.
 */
vi.mock('@alga-psa/auth', () => ({ getSession: vi.fn() }));

import { buildAuthServerMetadata, parseAuthorizeParams } from '@ee/lib/mcp/oauth/authServer';

describe('AS metadata (T010)', () => {
  const md = buildAuthServerMetadata('https://algapsa.com/');

  it('advertises the canonical issuer + endpoints under the public base', () => {
    expect(md.issuer).toBe('https://algapsa.com');
    expect(md.authorization_endpoint).toBe('https://algapsa.com/api/mcp/oauth/authorize');
    expect(md.token_endpoint).toBe('https://algapsa.com/api/mcp/oauth/token');
    expect(md.revocation_endpoint).toBe('https://algapsa.com/api/mcp/oauth/revoke');
    expect(md.jwks_uri).toBe('https://algapsa.com/.well-known/jwks.json');
  });

  it('requires PKCE S256 and supports only code + refresh grants', () => {
    expect(md.code_challenge_methods_supported).toEqual(['S256']);
    expect(md.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    expect(md.response_types_supported).toEqual(['code']);
  });

  it('is CIMD-only: no registration_endpoint is advertised', () => {
    expect(md.registration_endpoint).toBeUndefined();
  });

  it('signals CIMD support so clients use it instead of falling back to DCR', () => {
    // Claude (and other clients) only pick CIMD when BOTH are advertised.
    expect(md.client_id_metadata_document_supported).toBe(true);
    expect(md.token_endpoint_auth_methods_supported).toEqual(['none']);
  });

  it('advertises the mcp scope', () => {
    expect(md.scopes_supported).toEqual(['mcp']);
  });
});

describe('parseAuthorizeParams', () => {
  it('extracts the standard authorize parameters', () => {
    const sp = new URLSearchParams({
      response_type: 'code',
      client_id: 'https://claude.ai/.well-known/oauth-client',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      state: 'abc',
      code_challenge: 'xyz',
      code_challenge_method: 'S256',
      scope: 'mcp',
      resource: 'https://algapsa.com/api/mcp',
    });
    expect(parseAuthorizeParams(sp)).toEqual({
      responseType: 'code',
      clientId: 'https://claude.ai/.well-known/oauth-client',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      state: 'abc',
      codeChallenge: 'xyz',
      codeChallengeMethod: 'S256',
      scope: 'mcp',
      resource: 'https://algapsa.com/api/mcp',
    });
  });
});
