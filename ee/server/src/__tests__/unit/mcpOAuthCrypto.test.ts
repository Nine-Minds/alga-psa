import crypto from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * PKCE S256 verification (plan test T002 core) and the signed authorization-request
 * blob that protects the consent POST. Pure crypto — DB + auth seams are mocked so
 * the modules import cleanly without a database or session.
 */
vi.mock('@alga-psa/auth', () => ({ getSession: vi.fn() }));

import { verifyPkceS256 } from '@ee/lib/mcp/oauth/grants';
import { signAuthRequest, verifyAuthRequest, type AuthorizeParams } from '@ee/lib/mcp/oauth/authServer';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-mcp-oauth';
});

function s256(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

describe('PKCE S256 (T002)', () => {
  it('accepts a verifier whose S256 hash matches the challenge', () => {
    const verifier = 'a'.repeat(64);
    expect(verifyPkceS256(verifier, s256(verifier))).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    const verifier = 'a'.repeat(64);
    expect(verifyPkceS256('wrong-verifier', s256(verifier))).toBe(false);
  });

  it('rejects an empty / malformed challenge', () => {
    expect(verifyPkceS256('whatever', '')).toBe(false);
  });
});

describe('signed authorization request (consent CSRF integrity)', () => {
  const params: AuthorizeParams = {
    responseType: 'code',
    clientId: 'https://claude.ai/.well-known/oauth-client',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    state: 'xyz',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
    scope: 'mcp',
    resource: 'https://algapsa.com/api/mcp',
  };

  it('round-trips signed params', () => {
    const blob = signAuthRequest(params);
    const out = verifyAuthRequest(blob);
    expect(out).not.toBeNull();
    expect(out).toMatchObject(params);
  });

  it('rejects a tampered blob', () => {
    const blob = signAuthRequest(params);
    const [body, sig] = blob.split('.');
    const forged = Buffer.from(JSON.stringify({ ...params, clientId: 'https://evil.example' })).toString('base64url');
    expect(verifyAuthRequest(`${forged}.${sig}`)).toBeNull();
    void body;
  });

  it('rejects garbage', () => {
    expect(verifyAuthRequest('garbage')).toBeNull();
    expect(verifyAuthRequest('')).toBeNull();
  });
});
