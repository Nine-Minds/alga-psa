import { beforeEach, describe, expect, it } from 'vitest';
import { discoverOidc, _clearOidcCache } from '@ee/lib/mcp/oidcDiscovery';
import { resolveIdpFromPreset, microsoftDiscoveryUrl } from '@ee/lib/mcp/idpPresets';

/**
 * MCP agent-IdP presets + OIDC discovery (easy-path Tiers 1, F002/F003/F004).
 *
 * Per the lean/80-20 test strategy these are the high-value live tests: they
 * exercise OIDC discovery against the REAL Google + Microsoft well-known docs
 * (T001/T002), the preset resolution that builds on it (T003), and the custom
 * regression that must keep working unchanged (T009). They are network-bound by
 * design — the whole point is that discovery derives JWKS without hand entry.
 */

beforeEach(() => {
  _clearOidcCache();
});

describe('OIDC discovery (live)', () => {
  // T001
  it('resolves the real Google well-known to issuer + jwks_uri', async () => {
    const cfg = await discoverOidc('https://accounts.google.com/.well-known/openid-configuration');
    expect(cfg.issuer).toBe('https://accounts.google.com');
    expect(cfg.jwksUri).toMatch(/^https:\/\//);
    expect(cfg.jwksUri).toContain('googleapis.com');
  });

  // T002
  it('resolves the real Microsoft v2.0 well-known (common) to a v2.0 issuer + jwks_uri', async () => {
    const cfg = await discoverOidc(microsoftDiscoveryUrl('common'));
    // The `common` authority returns a templated issuer; concrete-tenant tokens
    // carry the resolved {tenantid}. Either way it is a login.microsoftonline.com
    // v2.0 issuer.
    expect(cfg.issuer).toMatch(/^https:\/\/login\.microsoftonline\.com\/.+\/v2\.0$/);
    expect(cfg.jwksUri).toMatch(/^https:\/\//);
    expect(cfg.jwksUri).toContain('microsoftonline.com');
  });

  it('caches by discovery URL (second call returns the same object)', async () => {
    const a = await discoverOidc('https://accounts.google.com/.well-known/openid-configuration');
    const b = await discoverOidc('https://accounts.google.com/.well-known/openid-configuration');
    expect(b).toBe(a); // identity, not just deep-equal -> served from cache
  });

  it('throws a clear error when the discovery doc is unreachable', async () => {
    await expect(
      discoverOidc('https://accounts.google.com/.well-known/does-not-exist'),
    ).rejects.toThrow(/OIDC discovery/);
  });
});

describe('provider preset resolution (live)', () => {
  // T003 (google)
  it('google preset -> fixed issuer + discovered JWKS + default subject_claim sub', async () => {
    const r = await resolveIdpFromPreset('google');
    expect(r.issuer).toBe('https://accounts.google.com');
    expect(r.jwksUri).toMatch(/^https:\/\//);
    expect(r.subjectClaim).toBe('sub');
  });

  // T003 (microsoft)
  it('microsoft preset + tenant id -> v2.0 issuer + discovered JWKS + default subject_claim azp', async () => {
    const r = await resolveIdpFromPreset('microsoft', { entraTenantId: 'common' });
    expect(r.issuer).toMatch(/^https:\/\/login\.microsoftonline\.com\/.+\/v2\.0$/);
    expect(r.jwksUri).toMatch(/^https:\/\//);
    expect(r.subjectClaim).toBe('azp');
  });

  it('microsoft preset allows overriding the default subject claim', async () => {
    const r = await resolveIdpFromPreset('microsoft', { entraTenantId: 'common', subjectClaim: 'oid' });
    expect(r.subjectClaim).toBe('oid');
  });

  it('microsoft preset without a tenant id is rejected', async () => {
    await expect(resolveIdpFromPreset('microsoft', {})).rejects.toThrow(/Entra tenant id/);
  });
});

describe('custom IdP (regression — Phase-2 parity)', () => {
  // T009
  it('custom kind passes raw issuer/jwks/claim through verbatim, no discovery', async () => {
    const r = await resolveIdpFromPreset('custom', {
      issuer: 'https://login.example.com/tenant',
      jwksUri: 'https://login.example.com/tenant/jwks',
      subjectClaim: 'client_id',
    });
    expect(r).toEqual({
      issuer: 'https://login.example.com/tenant',
      jwksUri: 'https://login.example.com/tenant/jwks',
      subjectClaim: 'client_id',
    });
  });

  it('custom defaults the subject claim to sub when omitted', async () => {
    const r = await resolveIdpFromPreset('custom', {
      issuer: 'https://login.example.com/tenant',
      jwksUri: 'https://login.example.com/tenant/jwks',
    });
    expect(r.subjectClaim).toBe('sub');
  });

  it('custom kind requires both issuer and jwksUri', async () => {
    await expect(resolveIdpFromPreset('custom', { issuer: 'https://x/y' })).rejects.toThrow(/issuer and jwksUri/);
  });
});
