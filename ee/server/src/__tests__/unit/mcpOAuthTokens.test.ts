import { beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

/**
 * AlgaPSA-issued MCP access tokens (plan: Alga as MCP AS). Drives the REAL jose
 * mint/verify pipeline in tokens.ts; only the signing-key store (DB-backed) is
 * mocked, swapped for an in-test ES256 keypair. Covers token integrity and the
 * resource-bound audience (plan test T006).
 */
vi.mock('@ee/lib/mcp/oauth/keys', () => ({
  getActiveSigningKey: vi.fn(),
  getVerificationKey: vi.fn(),
}));

import {
  mintAccessToken,
  verifyAccessToken,
  looksLikeAlgaToken,
  mcpResource,
} from '@ee/lib/mcp/oauth/tokens';
import { getActiveSigningKey, getVerificationKey } from '@ee/lib/mcp/oauth/keys';

const mActive = vi.mocked(getActiveSigningKey);
const mVerify = vi.mocked(getVerificationKey);

const BASE = 'https://algapsa.com';
let publicKey: CryptoKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256', { extractable: true });
  publicKey = kp.publicKey;
  privateKey = kp.privateKey;
  mActive.mockResolvedValue({ kid: 'k1', alg: 'ES256', privateKey });
  mVerify.mockImplementation(async (kid: string) => (kid === 'k1' ? publicKey : null));
});

const mintArgs = {
  base: BASE,
  tenant: 't-1',
  userId: 'user-1',
  clientId: 'https://claude.ai/.well-known/oauth-client',
  grantId: 'grant-1',
  scope: 'mcp',
};

describe('MCP access tokens', () => {
  it('round-trips: minted claims verify back', async () => {
    const token = await mintAccessToken(mintArgs);
    const claims = await verifyAccessToken({ token, base: BASE });
    expect(claims).not.toBeNull();
    expect(claims).toMatchObject({
      userId: 'user-1',
      tenant: 't-1',
      clientId: 'https://claude.ai/.well-known/oauth-client',
      grantId: 'grant-1',
      scope: 'mcp',
    });
  });

  it('binds the audience to the MCP resource (T006): wrong base is rejected', async () => {
    const token = await mintAccessToken(mintArgs);
    // A resource server at a different base must NOT accept this token (aud/iss mismatch).
    expect(await verifyAccessToken({ token, base: 'https://evil.example.com' })).toBeNull();
    // Sanity: the audience is exactly the MCP resource for the issuing base.
    expect(mcpResource(BASE)).toBe('https://algapsa.com/api/mcp');
  });

  it('rejects an expired token', async () => {
    const token = await mintAccessToken({ ...mintArgs, ttlSeconds: -10 });
    expect(await verifyAccessToken({ token, base: BASE })).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const token = await mintAccessToken(mintArgs);
    const tampered = token.slice(0, -3) + (token.endsWith('a') ? 'bbb' : 'aaa');
    expect(await verifyAccessToken({ token: tampered, base: BASE })).toBeNull();
  });

  it('rejects a token signed by an unknown key (no matching kid)', async () => {
    const other = await generateKeyPair('ES256', { extractable: true });
    const jwk = await exportJWK(other.publicKey);
    void jwk;
    const foreign = await new SignJWT({ tenant: 't-1', client_id: 'x', grant_id: 'g', scope: 'mcp' })
      .setProtectedHeader({ alg: 'ES256', kid: 'unknown', typ: 'at+jwt' })
      .setIssuer(BASE)
      .setSubject('user-1')
      .setAudience(mcpResource(BASE))
      .setExpirationTime('5m')
      .sign(other.privateKey);
    expect(await verifyAccessToken({ token: foreign, base: BASE })).toBeNull();
  });

  it('looksLikeAlgaToken distinguishes at+jwt from other JWTs', async () => {
    const token = await mintAccessToken(mintArgs);
    expect(looksLikeAlgaToken(token)).toBe(true);
    const idpJwt = await new SignJWT({ foo: 'bar' })
      .setProtectedHeader({ alg: 'ES256' })
      .sign(privateKey);
    expect(looksLikeAlgaToken(idpJwt)).toBe(false);
    expect(looksLikeAlgaToken('not-a-jwt')).toBe(false);
  });
});
