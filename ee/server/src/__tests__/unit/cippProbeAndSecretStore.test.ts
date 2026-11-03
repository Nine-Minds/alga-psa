// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  secrets: new Map<string, string>(),
  deleted: [] as string[],
}));

vi.mock('axios', () => {
  const isAxiosError = (e: any) => Boolean(e?.isAxiosError);
  return { default: { get: hoisted.get, isAxiosError }, get: hoisted.get, isAxiosError };
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async (_tenant: string, key: string) => hoisted.secrets.get(key) ?? null),
    setTenantSecret: vi.fn(async (_tenant: string, key: string, value: string) => { hoisted.secrets.set(key, value); }),
    deleteTenantSecret: vi.fn(async (_tenant: string, key: string) => { hoisted.deleted.push(key); hoisted.secrets.delete(key); }),
  })),
}));

import {
  clearEntraCippCredentials,
  getEntraCippCredentials,
  saveEntraCippCredentials,
} from '@ee/lib/integrations/entra/providers/cipp/cippSecretStore';
import { probeCippCredentials } from '@ee/lib/integrations/entra/providers/cipp/cippProbe';
import { ENTRA_ALL_SECRET_KEYS, ENTRA_CIPP_SECRET_KEYS } from '@ee/lib/integrations/entra/secrets';
import {
  CippTokenService,
  setCippTokenServiceForTests,
  type CippFetch,
} from '@ee/lib/integrations/entra/providers/cipp/cippTokenService';

const SECRET = 'probe-secret-VALUE';
const API_CLIENT = {
  authType: 'api_client' as const,
  baseUrl: 'https://cipp.test',
  clientId: 'client-1',
  clientSecret: SECRET,
  directoryId: 'dir-1',
};

describe('CIPP secret store', () => {
  beforeEach(() => { hoisted.secrets.clear(); hoisted.deleted.length = 0; });

  it('round-trips an API client, including the secret, through the secret store', async () => {
    await saveEntraCippCredentials('t', API_CLIENT);
    expect(hoisted.secrets.get('entra_cipp_client_secret')).toBe(SECRET);
    expect(hoisted.secrets.get('entra_cipp_auth_type')).toBe('api_client');
    expect(await getEntraCippCredentials('t')).toEqual(API_CLIENT);
  });

  it('round-trips a legacy key and retires stale API-client fields', async () => {
    await saveEntraCippCredentials('t', API_CLIENT);
    await saveEntraCippCredentials('t', { authType: 'legacy_api_token', baseUrl: 'https://cipp.test', apiToken: 'key' });
    expect(await getEntraCippCredentials('t')).toEqual({ authType: 'legacy_api_token', baseUrl: 'https://cipp.test', apiToken: 'key' });
    expect(hoisted.secrets.has('entra_cipp_client_secret')).toBe(false);

    await saveEntraCippCredentials('t', API_CLIENT);
    expect(hoisted.secrets.has('entra_cipp_api_token')).toBe(false);
  });

  it('loads a row saved before authType existed as legacy', async () => {
    hoisted.secrets.set('entra_cipp_base_url', 'https://cipp.test');
    hoisted.secrets.set('entra_cipp_api_token', 'old-key');
    expect(await getEntraCippCredentials('t')).toEqual({
      authType: 'legacy_api_token', baseUrl: 'https://cipp.test', apiToken: 'old-key',
    });
  });

  it('treats an incomplete API client as not configured', async () => {
    hoisted.secrets.set('entra_cipp_base_url', 'https://cipp.test');
    hoisted.secrets.set('entra_cipp_auth_type', 'api_client');
    hoisted.secrets.set('entra_cipp_client_id', 'c');
    expect(await getEntraCippCredentials('t')).toBeNull();
  });

  it('includes every CIPP key in ENTRA_ALL_SECRET_KEYS and deletes them all on clear', async () => {
    for (const key of Object.values(ENTRA_CIPP_SECRET_KEYS)) {
      expect(ENTRA_ALL_SECRET_KEYS).toContain(key);
    }
    await saveEntraCippCredentials('t', API_CLIENT);
    await clearEntraCippCredentials('t');
    expect(hoisted.secrets.size).toBe(0);
    expect(hoisted.deleted).toEqual(expect.arrayContaining(Object.values(ENTRA_CIPP_SECRET_KEYS)));
  });
});

describe('probeCippCredentials', () => {
  const axiosError = (status: number, data: unknown = {}, headers: Record<string, string> = {}) =>
    Object.assign(new Error(`status ${status}`), { isAxiosError: true, response: { status, data, headers } });

  function stubMint(ok: boolean, status: number, body: unknown) {
    const fetch = vi.fn(async () => ({ ok, status, text: async () => JSON.stringify(body) }));
    setCippTokenServiceForTests(new CippTokenService({ fetch: fetch as unknown as CippFetch }));
    return fetch;
  }

  beforeEach(() => { hoisted.get.mockReset(); });
  afterEach(() => { setCippTokenServiceForTests(null); });

  it('passes for an API client and sends only the Bearer header', async () => {
    stubMint(true, 200, { access_token: 'probe-token', expires_in: 3600 });
    hoisted.get.mockResolvedValue({ data: [{}, {}], headers: {} });

    const result = await probeCippCredentials(API_CLIENT);

    expect(result).toMatchObject({ valid: true, tenantCountSample: 2 });
    expect(hoisted.get.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer probe-token' });
  });

  it.each([
    [7000215, 'token_mint_failed', /secret ID instead of its Value/],
    [700016, 'token_mint_failed', /client \(client\) ID|Application \(client\) ID/],
    [90002, 'token_mint_failed', /15 minutes/],
    [500011, 'token_scope_rejected', /Repair Identifier URI/],
  ])('AADSTS%s fails the probe as %s', async (aadsts, code, message) => {
    stubMint(false, 400, { error: 'x', error_description: `AADSTS${aadsts}: ${SECRET}`, error_codes: [aadsts] });
    const result = await probeCippCredentials(API_CLIENT);
    expect(result).toMatchObject({ valid: false, code });
    expect((result as any).error).toMatch(message);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(hoisted.get).not.toHaveBeenCalled();
  });

  it('reads a 403 on listtenants as the IP allowlist', async () => {
    stubMint(true, 200, { access_token: 'probe-token', expires_in: 3600 });
    hoisted.get.mockImplementation(async () => { throw axiosError(403); });
    const result = await probeCippCredentials(API_CLIENT);
    expect(result).toMatchObject({ valid: false, code: 'ip_blocked' });
    expect((result as any).error).toMatch(/Allowed IP Ranges/);
  });

  it('reads an HTML answer as a wrong API URL', async () => {
    stubMint(true, 200, { access_token: 'probe-token', expires_in: 3600 });
    hoisted.get.mockResolvedValue({ data: '<!DOCTYPE html><html/>', headers: { 'content-type': 'text/html' } });
    const result = await probeCippCredentials(API_CLIENT);
    expect(result).toMatchObject({ valid: false, code: 'html_response' });
    expect((result as any).error).toMatch(/API URL is missing \/api or points at the wrong host/);
  });

  const transportError = (code: string) =>
    Object.assign(new Error(`transport ${code}`), { isAxiosError: true, code, response: undefined });

  it.each([
    ['ENOTFOUND', 'dns', /does not resolve \(DNS\)/],
    ['EAI_AGAIN', 'dns', /does not resolve/],
    ['ECONNREFUSED', 'refused', /connection was refused/],
    ['ECONNABORTED', 'timeout', /timed out/],
    ['ETIMEDOUT', 'timeout', /timed out/],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls', /TLS certificate/],
    ['ECONNRESET', 'network', /network request failed/],
  ])('names the transport cause when the host never answers (%s -> %s)', async (code, cause, message) => {
    stubMint(true, 200, { access_token: 'probe-token', expires_in: 3600 });
    hoisted.get.mockImplementation(async () => { throw transportError(code); });

    const result = await probeCippCredentials(API_CLIENT);

    expect(result).toMatchObject({ valid: false, code: 'unreachable', cause });
    expect((result as any).error).toContain('cipp.test');
    expect((result as any).error).toMatch(message);
    expect((result as any).error).not.toBe('CIPP validation request failed.');
    // Same host for every candidate path: one attempt, not three timeouts.
    expect(hoisted.get).toHaveBeenCalledTimes(1);
  });

  it('names the transport cause for a legacy key too', async () => {
    hoisted.get.mockImplementation(async () => { throw transportError('ENOTFOUND'); });
    const result = await probeCippCredentials({ baseUrl: 'https://cipp.test', apiToken: 'k' });
    expect(result).toMatchObject({ valid: false, code: 'unreachable', cause: 'dns' });
  });

  it('fails when a Custom Role blocks listusers even though listtenants works', async () => {
    stubMint(true, 200, { access_token: 'probe-token', expires_in: 3600 });
    hoisted.get.mockImplementation(async (url: string) => {
      if (url.includes('/api/listusers')) throw axiosError(403);
      return { data: [{ customerId: 'tenant-guid-1', defaultDomainName: 'one.example' }], headers: {} };
    });

    const result = await probeCippCredentials(API_CLIENT);

    expect(result).toMatchObject({ valid: false, code: 'role_blocked' });
    expect((result as any).error).toMatch(/Custom Role is blocking it/);
    expect((result as any).error).toContain('listusers');
    // It asked for users the way sync does: one managed tenant via tenantFilter.
    expect(hoisted.get.mock.calls[1][0]).toBe('https://cipp.test/api/listusers?tenantFilter=tenant-guid-1');
    expect(hoisted.get.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer probe-token' });
  });

  it('passes when the role allows listusers', async () => {
    stubMint(true, 200, { access_token: 'probe-token', expires_in: 3600 });
    hoisted.get.mockImplementation(async (url: string) => (
      url.includes('/api/listusers')
        ? { data: [], headers: {} }
        : { data: [{ customerId: 'tenant-guid-1' }, { customerId: 'tenant-guid-2' }], headers: {} }
    ));
    const result = await probeCippCredentials(API_CLIENT);
    expect(result).toMatchObject({ valid: true, tenantCountSample: 2 });
    expect(hoisted.get).toHaveBeenCalledTimes(2);
  });

  it('does not fail the test for a listusers error that is not a refusal', async () => {
    stubMint(true, 200, { access_token: 'probe-token', expires_in: 3600 });
    hoisted.get.mockImplementation(async (url: string) => {
      if (url.includes('/api/listusers')) throw axiosError(500);
      return { data: [{ customerId: 'tenant-guid-1' }], headers: {} };
    });
    const result = await probeCippCredentials(API_CLIENT);
    expect(result).toMatchObject({ valid: true });
  });

  it('does not probe listusers for a legacy key', async () => {
    hoisted.get.mockResolvedValue({ data: [{ customerId: 'tenant-guid-1' }], headers: {} });
    const result = await probeCippCredentials({ baseUrl: 'https://cipp.test', apiToken: 'k' });
    expect(result).toMatchObject({ valid: true });
    expect(hoisted.get).toHaveBeenCalledTimes(1);
  });

  it('leaves the legacy probe request and rejection message unchanged', async () => {
    hoisted.get.mockImplementation(async () => { throw axiosError(403); });
    const result = await probeCippCredentials({ baseUrl: 'https://cipp.test', apiToken: 'k' });
    expect(hoisted.get.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer k', 'X-API-KEY': 'k' });
    expect(result).toMatchObject({ valid: false, code: 'auth_rejected', error: 'CIPP credentials were rejected by the remote API.' });
  });
});
