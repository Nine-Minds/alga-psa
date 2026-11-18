// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  creds: null as any,
  get: vi.fn(),
}));

vi.mock('axios', () => {
  const isAxiosError = (e: any) => Boolean(e?.isAxiosError);
  return {
    default: { get: hoisted.get, post: vi.fn(), isAxiosError },
    get: hoisted.get,
    post: vi.fn(),
    isAxiosError,
  };
});

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  getEntraCippCredentials: vi.fn(async () => hoisted.creds),
  saveEntraCippCredentials: vi.fn(),
  clearEntraCippCredentials: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async () => null),
    getAppSecret: vi.fn(async () => null),
  })),
}));

import { CippProviderAdapter } from '@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter';
import {
  CippTokenService,
  setCippTokenServiceForTests,
  type CippFetch,
} from '@ee/lib/integrations/entra/providers/cipp/cippTokenService';
import { sanitizeDeep } from '@ee/lib/integrations/entra/diagnostics/redaction';

const SECRET = 'client-secret-VALUE-9f3a';
const API_CLIENT = {
  authType: 'api_client' as const,
  baseUrl: 'https://cipp.test',
  clientId: 'client-1',
  clientSecret: SECRET,
  directoryId: 'dir-1',
};
const LEGACY = { authType: 'legacy_api_token' as const, baseUrl: 'https://cipp.test', apiToken: 'legacy-key' };
const INPUT = { tenant: 't1', managedTenantId: 'managed-1' };

function axiosError(status: number, data: unknown = {}, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data, headers },
  });
}

function mintResponse(token: string, expiresIn = 3600) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: token, expires_in: expiresIn }) };
}

function sequencedTokens(options: { now?: () => number } = {}) {
  let n = 0;
  const fetch = vi.fn(async () => mintResponse(`minted-token-${++n}`));
  const service = new CippTokenService({ fetch: fetch as unknown as CippFetch, now: options.now });
  setCippTokenServiceForTests(service);
  return { fetch, service };
}

const bearerOf = (callIndex: number) => hoisted.get.mock.calls[callIndex][1].headers;

describe('CippProviderAdapter with an API-client credential', () => {
  let logs: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    hoisted.get.mockReset();
    hoisted.creds = API_CLIENT;
    logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
  });
  afterEach(() => {
    setCippTokenServiceForTests(null);
    logs.forEach((spy) => spy.mockRestore());
  });

  const expectNoLeak = (...values: unknown[]) => {
    const everything = JSON.stringify([
      values.map((v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v)),
      logs.map((spy) => spy.mock.calls),
    ]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toMatch(/minted-token-\d/);
  };

  it('sends only Authorization: Bearer for an API client (no X-API-KEY)', async () => {
    sequencedTokens();
    hoisted.get.mockResolvedValueOnce({ data: [], headers: {}, status: 200 });

    await new CippProviderAdapter().listUsersForTenant(INPUT);

    expect(hoisted.get.mock.calls[0][0]).toBe('https://cipp.test/api/listusers?tenantFilter=managed-1');
    expect(bearerOf(0)).toEqual({ Authorization: 'Bearer minted-token-1' });
  });

  it('leaves legacy requests exactly as they were: Bearer and X-API-KEY, no mint', async () => {
    hoisted.creds = LEGACY;
    const { fetch } = sequencedTokens();
    hoisted.get.mockResolvedValueOnce({ data: [], headers: {}, status: 200 });

    await new CippProviderAdapter().listUsersForTenant(INPUT);

    expect(bearerOf(0)).toEqual({ Authorization: 'Bearer legacy-key', 'X-API-KEY': 'legacy-key' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats a stored credential with no authType as legacy', async () => {
    hoisted.creds = { baseUrl: 'https://cipp.test', apiToken: 'old-key' };
    sequencedTokens();
    hoisted.get.mockResolvedValueOnce({ data: [], headers: {}, status: 200 });
    await new CippProviderAdapter().listUsersForTenant(INPUT);
    expect(bearerOf(0)['X-API-KEY']).toBe('old-key');
  });

  it('on a 401 invalidates the token, re-mints and retries once', async () => {
    const { fetch } = sequencedTokens();
    hoisted.get
      .mockRejectedValueOnce(axiosError(401))
      .mockResolvedValueOnce({ data: [], headers: {}, status: 200 });

    await expect(new CippProviderAdapter().listUsersForTenant(INPUT)).resolves.toEqual([]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hoisted.get).toHaveBeenCalledTimes(2);
    expect(bearerOf(0).Authorization).toBe('Bearer minted-token-1');
    expect(bearerOf(1).Authorization).toBe('Bearer minted-token-2');
  });

  it('reports credential-rejected after a second 401, without a third attempt', async () => {
    sequencedTokens();
    hoisted.get.mockRejectedValue(axiosError(401));

    const error = await new CippProviderAdapter().listUsersForTenant(INPUT).catch((e) => e);

    expect(error.code).toBe('credential-rejected');
    expect(error.reason).toBe('token-rejected');
    expect(hoisted.get).toHaveBeenCalledTimes(2);
    expectNoLeak(error);
  });

  it('re-mints proactively inside the skew during a long sync, without any 401', async () => {
    let now = 0;
    const { fetch } = sequencedTokens({ now: () => now });
    hoisted.get.mockResolvedValue({ data: [], headers: {}, status: 200 });
    const adapter = new CippProviderAdapter();

    await adapter.listUsersForTenant(INPUT);
    now = 3_600_000 - 30_000;
    await adapter.listUsersForTenant(INPUT);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bearerOf(1).Authorization).toBe('Bearer minted-token-2');
  });

  it.each([
    ['AADSTS7000215', 'token-mint-failed', /pasted the secret ID instead of its Value, or the secret has expired/],
    ['AADSTS700016', 'token-mint-failed', /Check the Application \(client\) ID and the Tenant \(directory\) ID/],
    ['AADSTS90002', 'token-mint-failed', /Check the Tenant \(directory\) ID.*15 minutes/s],
    ['AADSTS500011', 'token-scope-rejected', /run Repair Identifier URI on this client/],
    ['AADSTS65001', 'token-mint-failed', /Admin consent is needed/],
  ])('surfaces %s as %s with an actionable message', async (aadsts, code, message) => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: 'invalid_client',
        error_description: `${aadsts}: failed for ${SECRET}`,
        error_codes: [Number(aadsts.slice(6))],
      }),
    }));
    setCippTokenServiceForTests(new CippTokenService({ fetch: fetch as unknown as CippFetch }));

    const error = await new CippProviderAdapter().listUsersForTenant(INPUT).catch((e) => e);

    expect(error.name).toBe('EntraOperatorError');
    expect(error.code).toBe(code);
    expect(error.message).toMatch(message);
    expect(hoisted.get).not.toHaveBeenCalled();
    expectNoLeak(error);
  });

  it('reads a 403 on listtenants as the IP allowlist', async () => {
    sequencedTokens();
    hoisted.get.mockRejectedValue(axiosError(403));

    const error = await new CippProviderAdapter().listManagedTenants({ tenant: 't1' } as any).catch((e) => e);

    expect(error.code).toBe('credential-rejected');
    expect(error.reason).toBe('ip-blocked');
    expect(error.message).toMatch(/Allowed IP Ranges/);
  });

  it('reads a 403 on every endpoint, listtenants included, as the IP allowlist', async () => {
    sequencedTokens();
    hoisted.get.mockRejectedValue(axiosError(403));

    const error = await new CippProviderAdapter().listUsersForTenant(INPUT).catch((e) => e);

    expect(error.reason).toBe('ip-blocked');
    expect(error.message).toMatch(/Allowed IP Ranges/);
    expect(hoisted.get.mock.calls.map((c) => c[0])).toEqual([
      'https://cipp.test/api/listusers?tenantFilter=managed-1',
      'https://cipp.test/api/listtenants',
    ]);
  });

  it.each([
    ['listusers', (a: CippProviderAdapter) => a.listUsersForTenant(INPUT)],
    ['listgroups', (a: CippProviderAdapter) => a.listSecurityGroupsForTenant(INPUT)],
    ['listusergroups', (a: CippProviderAdapter) => a.isUserInSecurityGroup({ ...INPUT, userEntraObjectId: 'u', groupId: 'g', membershipMode: 'direct' })],
    ['ListMailboxes', (a: CippProviderAdapter) => (a as any).requestFromCandidates('t1', API_CLIENT, ['/api/ListMailboxes?tenantFilter=m'])],
  ])('names %s when only that endpoint is refused (Custom Role)', async (endpoint, call) => {
    sequencedTokens();
    hoisted.get.mockImplementation(async (url: string) => {
      if (url.toLowerCase().includes(`/api/${endpoint.toLowerCase()}?`)) throw axiosError(403);
      return { data: [], headers: {}, status: 200 };
    });

    const error = await call(new CippProviderAdapter()).catch((e: any) => e);

    expect(error.code).toBe('credential-rejected');
    expect(error.reason).toBe('role-blocked');
    expect(error.message).toContain(endpoint);
    expect(error.message).toMatch(/Custom Role/);
  });

  it('reads an HTML page as a wrong API URL, whether it arrives as 200 or as an error', async () => {
    sequencedTokens();
    hoisted.get.mockResolvedValueOnce({
      data: '<!DOCTYPE html><html></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      status: 200,
    });
    const ok = await new CippProviderAdapter().listUsersForTenant(INPUT).catch((e) => e);
    expect(ok.reason).toBe('html-response');
    expect(ok.message).toMatch(/API URL is missing \/api or points at the wrong host/);

    hoisted.get.mockRejectedValueOnce(axiosError(404, '<html><body>Not found</body></html>', { 'content-type': 'text/html' }));
    const notFound = await new CippProviderAdapter().listUsersForTenant(INPUT).catch((e) => e);
    expect(notFound.reason).toBe('html-response');
  });

  it('probeTenantList reports HTML as html_response, not invalid_payload', async () => {
    sequencedTokens();
    hoisted.get.mockResolvedValueOnce({
      data: '<!DOCTYPE html><html></html>',
      headers: { 'content-type': 'text/html' },
      status: 200,
    });
    const ok = await new CippProviderAdapter().probeTenantList('tenant-1');
    expect(ok.outcome).toBe('html_response');
    expect(ok.error).toMatch(/missing \/api or points at the wrong host/);

    hoisted.get.mockRejectedValueOnce(axiosError(404, '<html></html>', { 'content-type': 'text/html' }));
    const failed = await new CippProviderAdapter().probeTenantList('tenant-1');
    expect(failed.outcome).toBe('html_response');
  });

  it('does not treat HTML as a wrong URL for a legacy credential (behaviour unchanged)', async () => {
    hoisted.creds = LEGACY;
    hoisted.get.mockResolvedValueOnce({ data: '<!DOCTYPE html>', headers: { 'content-type': 'text/html' }, status: 200 });
    await expect(new CippProviderAdapter().listUsersForTenant(INPUT)).resolves.toEqual([]);
  });

  it('keeps legacy 401/403 messaging unchanged', async () => {
    hoisted.creds = LEGACY;
    hoisted.get.mockRejectedValue(axiosError(403));
    const error = await new CippProviderAdapter().listUsersForTenant(INPUT).catch((e) => e);
    expect(error.code).toBe('credential-rejected');
    expect(error.reason).toBeUndefined();
    expect(error.message).toBe('CIPP rejected the stored API credential. Rotate it from the Connection tab to resume syncing.');
    expect(hoisted.get).toHaveBeenCalledTimes(1);
  });

  it('keeps the client secret and minted tokens out of redacted diagnostics', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJhcGk6Ly9jbGllbnQifQ.c2lnbmF0dXJlLXZhbHVl';
    const report = {
      steps: [{
        id: 'cipp_token_mint',
        data: { clientSecret: SECRET, client_secret: SECRET, accessToken: jwt, authorization: `Bearer ${jwt}`, authType: 'api_client' },
        error: { message: `request failed: client_secret=${SECRET} Authorization: Bearer ${jwt}` },
      }],
    };
    const redacted = JSON.stringify(sanitizeDeep(report, true));
    expect(redacted).not.toContain(SECRET);
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toContain('c2lnbmF0dXJl');
    expect(redacted).toContain('api_client');
  });
});
