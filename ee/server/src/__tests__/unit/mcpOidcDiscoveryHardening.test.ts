import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverOidc, _clearOidcCache } from '@ee/lib/mcp/oidcDiscovery';

/**
 * CF007 — "no URL/request-selected issuer, no TLS bypass", at the one place in
 * this repo where an issuer is learned from the network rather than configured.
 *
 * A discovery document is self-asserted: whatever host answers gets to name the
 * `issuer` it wants, and that string becomes the trusted-issuer binding that
 * `idpToken.verifyAgentToken` later admits tokens against. So the document has
 * to be constrained by the URL it was fetched from, not taken at its word.
 *
 * These are offline; the live Google/Microsoft coverage is in mcpIdpPresets.test.ts
 * and is what proves the rules below do not reject real providers.
 */

const realFetch = globalThis.fetch;

function respondWith(doc: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => doc,
  }) as unknown as typeof fetch;
}

beforeEach(() => _clearOidcCache());
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe('OIDC discovery transport', () => {
  it('refuses a cleartext discovery URL', async () => {
    await expect(discoverOidc('http://idp.example.com/.well-known/openid-configuration'))
      .rejects.toThrow(/must use https/);
  });

  it('allows loopback http so a local emulator needs no certificate', async () => {
    respondWith({
      issuer: 'http://127.0.0.1:4010/tenant-a/v2.0',
      jwks_uri: 'http://127.0.0.1:4010/tenant-a/discovery/v2.0/keys',
    });
    const cfg = await discoverOidc('http://127.0.0.1:4010/tenant-a/v2.0/.well-known/openid-configuration');
    expect(cfg.issuer).toBe('http://127.0.0.1:4010/tenant-a/v2.0');
  });

  it('refuses a discovery URL that is not an absolute URL', async () => {
    await expect(discoverOidc('/.well-known/openid-configuration')).rejects.toThrow(/not a valid absolute URL/);
  });

  it('refuses keys served over cleartext even when discovery itself was https', async () => {
    respondWith({
      issuer: 'https://idp.example.com',
      jwks_uri: 'http://idp.example.com/keys',
    });
    await expect(discoverOidc('https://idp.example.com/.well-known/openid-configuration'))
      .rejects.toThrow(/keys must be fetched over https/);
  });
});

describe('OIDC discovery issuer binding (Discovery 1.0 section 4.3)', () => {
  it('refuses a document that names an issuer it was not reached at', async () => {
    // The attack this exists for: a host that can answer a discovery request
    // claims to be Microsoft, and every later token check trusts that string.
    respondWith({
      issuer: 'https://login.microsoftonline.com/victim-tenant/v2.0',
      jwks_uri: 'https://attacker.example.com/keys',
    });
    await expect(discoverOidc('https://attacker.example.com/.well-known/openid-configuration'))
      .rejects.toThrow(/issuer mismatch/);
  });

  it('accepts an exactly matching issuer', async () => {
    respondWith({ issuer: 'https://idp.example.com', jwks_uri: 'https://idp.example.com/keys' });
    await expect(discoverOidc('https://idp.example.com/.well-known/openid-configuration'))
      .resolves.toMatchObject({ issuer: 'https://idp.example.com' });
  });

  it("accepts Microsoft's templated multi-tenant issuer for one path segment", async () => {
    // Measured, not assumed: the real `common` authority answers with the
    // placeholder verbatim because the tenant is only known at token time.
    respondWith({
      issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
      jwks_uri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    });
    const cfg = await discoverOidc('https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration');
    expect(cfg.issuer).toBe('https://login.microsoftonline.com/{tenantid}/v2.0');
  });

  it('does not let the placeholder swallow more than one segment', async () => {
    respondWith({
      issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0',
      jwks_uri: 'https://login.microsoftonline.com/keys',
    });
    await expect(
      discoverOidc('https://login.microsoftonline.com/a/b/v2.0/.well-known/openid-configuration'),
    ).rejects.toThrow(/issuer mismatch/);
  });

  it('does not treat a suffixed lookalike host as a match', async () => {
    respondWith({
      issuer: 'https://accounts.google.com',
      jwks_uri: 'https://accounts.google.com.evil.test/keys',
    });
    await expect(discoverOidc('https://accounts.google.com.evil.test/.well-known/openid-configuration'))
      .rejects.toThrow(/issuer mismatch/);
  });
});
