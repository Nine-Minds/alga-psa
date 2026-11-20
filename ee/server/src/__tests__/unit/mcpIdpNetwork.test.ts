import { describe, expect, it, vi } from 'vitest';
import { assertSafeIdpUrl, fetchIdpDocument } from '@ee/lib/mcp/idpNetwork';
import { discoverOidc, _clearOidcCache } from '@ee/lib/mcp/oidcDiscovery';
import type { SafeFetchDeps } from '@/lib/net/safeFetch';

const publicAddress = { address: '93.184.216.34', family: 4 };
const publicLookup = async () => [publicAddress];
const jsonFetch = (body = '{"keys":[]}') => vi.fn(async () => new Response(body));

describe('MCP IdP network trust boundary', () => {
  it('allows public HTTPS and pins the connection while retaining the hostname URL', async () => {
    const fetch = jsonFetch();
    const deps: SafeFetchDeps = { lookup: publicLookup, fetch };
    await assertSafeIdpUrl('https://idp.example.test/tenant/jwks', deps);
    const response = await fetchIdpDocument('https://idp.example.test/tenant/jwks', deps);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'https://idp.example.test/tenant/jwks',
      expect.objectContaining({ redirect: 'manual' }),
      publicAddress,
    );
  });

  it.each([
    'http://idp.example.test/jwks',
    'file:///etc/passwd',
    'https://user:password@idp.example.test/jwks',
    'https://127.1/jwks',
    'https://2130706433/jwks',
    'https://[::1]/jwks',
    'https://[::ffff:7f00:1]/jwks',
    'https://[::ffff:127.0.0.1]/jwks',
    'https://10.0.0.8/jwks',
  ])('rejects forbidden provider URL %s before transport', async (url) => {
    const fetch = jsonFetch();
    await expect(assertSafeIdpUrl(url, { lookup: publicLookup, fetch })).rejects.toThrow();
    await expect(fetchIdpDocument(url, { lookup: publicLookup, fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a DNS answer containing a private destination without connecting', async () => {
    const fetch = jsonFetch();
    const lookup = async () => [publicAddress, { address: '10.20.30.40', family: 4 }];
    await expect(assertSafeIdpUrl('https://rebind.example.test/jwks', { lookup, fetch })).rejects.toThrow(/private|reserved/i);
    await expect(fetchIdpDocument('https://rebind.example.test/jwks', { lookup, fetch })).rejects.toThrow(/private|reserved/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('revalidates each redirect target and refuses a private destination before connecting', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://[::ffff:10.0.0.1]/jwks' } }));
    await expect(fetchIdpDocument('https://idp.example.test/jwks', { lookup: publicLookup, fetch })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-resolves and pins the address on every JWKS fetch, so refresh cannot reuse a later DNS answer', async () => {
    let resolution = 0;
    const lookup = vi.fn(async () => {
      resolution += 1;
      return resolution === 1 ? [publicAddress] : [{ address: '10.0.0.9', family: 4 }];
    });
    const fetch = jsonFetch();
    await fetchIdpDocument('https://refresh.example.test/jwks', { lookup, fetch });
    await expect(fetchIdpDocument('https://refresh.example.test/jwks', { lookup, fetch })).rejects.toThrow(/private|reserved/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses an unsafe JWKS URL returned by discovery when registration validates resolved values', async () => {
    _clearOidcCache();
    const discoveryFetch = vi.fn(async () => new Response(JSON.stringify({
      issuer: 'https://issuer.example.test',
      jwks_uri: 'https://[::ffff:127.0.0.1]/keys',
    })));
    const deps = { lookup: publicLookup, fetch: discoveryFetch };
    const config = await discoverOidc('https://issuer.example.test/.well-known/openid-configuration', deps);
    expect(config.jwksUri).toBe('https://[::ffff:127.0.0.1]/keys');
    await expect(assertSafeIdpUrl(config.jwksUri, deps)).rejects.toThrow();
    expect(discoveryFetch).toHaveBeenCalledTimes(1);
  });
});
