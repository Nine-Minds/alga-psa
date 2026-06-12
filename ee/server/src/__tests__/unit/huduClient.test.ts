import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosCreateMock = vi.fn();
const axiosIsAxiosErrorMock = vi.fn((e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError));
const requestMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: axiosCreateMock,
    isAxiosError: axiosIsAxiosErrorMock,
  },
  create: axiosCreateMock,
  isAxiosError: axiosIsAxiosErrorMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const getTenantSecretMock = vi.fn();
const getSecretProviderInstanceMock = vi.fn(async () => ({
  getTenantSecret: getTenantSecretMock,
  getAppSecret: vi.fn(),
  setTenantSecret: vi.fn(),
  deleteTenantSecret: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock,
}));

const VALID_CREDS = { apiKey: 'super-secret-key', baseUrl: 'https://acme.huducloud.com' };
const noopSleep = async () => {};

/** Build an axios-style error with a response status (and optional headers/data). */
function axiosError(status: number, opts: { headers?: Record<string, string>; data?: unknown } = {}) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, headers: opts.headers ?? {}, data: opts.data },
  };
}

/** Build a network-level axios error (no response). */
function networkError(code = 'ECONNABORTED') {
  return { isAxiosError: true, code, message: 'timeout of 30000ms exceeded' };
}

/** A page body keyed by the resource name. */
function page(key: string, count: number) {
  return { data: { [key]: Array.from({ length: count }, (_, i) => ({ id: i + 1 })) } };
}

async function importClient() {
  return import('@ee/lib/integrations/hudu/huduClient');
}

beforeEach(() => {
  vi.resetModules();
  axiosCreateMock.mockReset();
  requestMock.mockReset();
  getTenantSecretMock.mockReset();
  axiosIsAxiosErrorMock.mockImplementation((e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError));

  axiosCreateMock.mockReturnValue({ request: requestMock });
});

describe('T010: header + base URL injection', () => {
  it('builds the axios instance with x-api-key header and /api/v1 base URL', async () => {
    const { HuduClient } = await importClient();

    new HuduClient({ tenantId: 't1', credentials: VALID_CREDS, sleep: noopSleep });

    expect(axiosCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://acme.huducloud.com/api/v1',
        headers: expect.objectContaining({ 'x-api-key': 'super-secret-key' }),
      })
    );
  });

  it('normalizes a base URL that already includes /api/v1', async () => {
    const { buildHuduApiBaseUrl } = await importClient();
    expect(buildHuduApiBaseUrl('https://acme.huducloud.com/api/v1/')).toBe('https://acme.huducloud.com/api/v1');
    expect(buildHuduApiBaseUrl('https://acme.huducloud.com/')).toBe('https://acme.huducloud.com/api/v1');
  });
});

describe('T011: credential resolution precedence', () => {
  it('prefers the tenant secret over env', async () => {
    getTenantSecretMock.mockImplementation(async (_tenant: string, name: string) =>
      name === 'hudu_api_key' ? 'tenant-key' : 'https://tenant.huducloud.com'
    );
    process.env.HUDU_API_KEY = 'env-key';
    process.env.HUDU_BASE_URL = 'https://env.huducloud.com';

    const { resolveHuduCredentials } = await import('@ee/lib/integrations/hudu/secrets');
    const creds = await resolveHuduCredentials('tenant-1');

    expect(creds).toEqual({ apiKey: 'tenant-key', baseUrl: 'https://tenant.huducloud.com' });
    delete process.env.HUDU_API_KEY;
    delete process.env.HUDU_BASE_URL;
  });

  it('falls back to env when the tenant secret is absent', async () => {
    getTenantSecretMock.mockResolvedValue(undefined);
    process.env.HUDU_API_KEY = 'env-key';
    process.env.HUDU_BASE_URL = 'https://env.huducloud.com';

    const { resolveHuduCredentials } = await import('@ee/lib/integrations/hudu/secrets');
    const creds = await resolveHuduCredentials('tenant-1');

    expect(creds).toEqual({ apiKey: 'env-key', baseUrl: 'https://env.huducloud.com' });
    delete process.env.HUDU_API_KEY;
    delete process.env.HUDU_BASE_URL;
  });

  it('throws when neither tenant secret nor env provides credentials', async () => {
    getTenantSecretMock.mockResolvedValue(undefined);
    delete process.env.HUDU_API_KEY;
    delete process.env.HUDU_BASE_URL;

    const { resolveHuduCredentials, HuduCredentialsError } = await import('@ee/lib/integrations/hudu/secrets');

    await expect(resolveHuduCredentials('tenant-1')).rejects.toBeInstanceOf(HuduCredentialsError);
  });

  it('does not leak the api key into the missing-credential error', async () => {
    getTenantSecretMock.mockImplementation(async (_tenant: string, name: string) =>
      // Only the key is present; base URL missing -> error must not echo the key.
      name === 'hudu_api_key' ? 'secret-key-value' : undefined
    );
    delete process.env.HUDU_BASE_URL;

    const { resolveHuduCredentials } = await import('@ee/lib/integrations/hudu/secrets');
    await expect(resolveHuduCredentials('tenant-1')).rejects.toThrow(/base URL/);
    await expect(resolveHuduCredentials('tenant-1')).rejects.not.toThrow(/secret-key-value/);
  });
});

describe('T012/T013: pagination', () => {
  it('fetches multiple pages and stops at the first page with < 25 items', async () => {
    const { HuduClient } = await importClient();
    requestMock
      .mockResolvedValueOnce(page('companies', 25))
      .mockResolvedValueOnce(page('companies', 25))
      .mockResolvedValueOnce(page('companies', 7));

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    const companies = await client.getCompanies();

    expect(companies).toHaveLength(57);
    expect(requestMock).toHaveBeenCalledTimes(3);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ params: expect.objectContaining({ page: 1 }) });
    expect(requestMock.mock.calls[2][0]).toMatchObject({ params: expect.objectContaining({ page: 3 }) });
  });

  it('treats an empty page as terminal and returns accumulated items', async () => {
    const { HuduClient } = await importClient();
    requestMock
      .mockResolvedValueOnce(page('companies', 25))
      .mockResolvedValueOnce(page('companies', 0));

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    const companies = await client.getCompanies();

    expect(companies).toHaveLength(25);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});

describe('T014: 429 Retry-After backoff + retry cap', () => {
  it('honors Retry-After then succeeds', async () => {
    const { HuduClient } = await importClient();
    requestMock
      .mockRejectedValueOnce(axiosError(429, { headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(page('companies', 1));

    const sleep = vi.fn(async () => {});
    const client = new HuduClient({ credentials: VALID_CREDS, sleep, retryOptions: { maxJitterMs: 0 } });
    const companies = await client.getCompanies();

    expect(companies).toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(2);
    // Retry-After=2s honored (jitter disabled => exactly 2000ms).
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('caps retries and surfaces a rate_limited error when 429 persists', async () => {
    const { HuduClient, HuduRequestError } = await importClient();
    requestMock.mockRejectedValue(axiosError(429, { headers: { 'retry-after': '1' } }));

    const client = new HuduClient({
      credentials: VALID_CREDS,
      sleep: noopSleep,
      retryOptions: { maxAttempts: 3, maxJitterMs: 0 },
    });

    await expect(client.getCompanies()).rejects.toBeInstanceOf(HuduRequestError);
    // maxAttempts=3 => 3 total calls (first + 2 retries), not unbounded.
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('exponentially backs off on transient 5xx then succeeds', async () => {
    const { HuduClient } = await importClient();
    requestMock
      .mockRejectedValueOnce(axiosError(503))
      .mockResolvedValueOnce(page('companies', 1));

    const sleep = vi.fn(async () => {});
    const client = new HuduClient({
      credentials: VALID_CREDS,
      sleep,
      retryOptions: { baseDelayMs: 100, maxJitterMs: 0 },
    });
    await client.getCompanies();

    expect(requestMock).toHaveBeenCalledTimes(2);
    // attempt 1 backoff = baseDelay * 2^0 = 100ms.
    expect(sleep).toHaveBeenCalledWith(100);
  });
});

describe('T015: typed error mapping', () => {
  const cases: Array<[number, string]> = [
    [401, 'invalid_key'],
    [403, 'no_password_access'],
    [404, 'not_found'],
    [422, 'validation'],
    [429, 'rate_limited'],
    [500, 'server_error'],
  ];

  it('maps each HTTP status to a distinct kind', async () => {
    const { toHuduError } = await importClient();
    for (const [status, kind] of cases) {
      const mapped = toHuduError(axiosError(status));
      expect(mapped.kind).toBe(kind);
      expect(mapped.status).toBe(status);
    }
  });

  it('maps a no-response error to network_error', async () => {
    const { toHuduError } = await importClient();
    const mapped = toHuduError(networkError());
    expect(mapped.kind).toBe('network_error');
    expect(mapped.status).toBeUndefined();
  });

  it('surfaces the mapped error kind from a request (no retry for 4xx)', async () => {
    const { HuduClient } = await importClient();
    requestMock.mockRejectedValue(axiosError(404));

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    await expect(client.getCompanies()).rejects.toMatchObject({ hudu: { kind: 'not_found', status: 404 } });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe('T016: resource-name mapping', () => {
  it('maps domain names to Hudu API resource names', async () => {
    const { mapHuduResource } = await importClient();
    expect(mapHuduResource('passwords')).toBe('asset_passwords');
    expect(mapHuduResource('processes')).toBe('procedures');
    expect(mapHuduResource('companies')).toBe('companies');
    expect(mapHuduResource('assets')).toBe('assets');
    expect(mapHuduResource('articles')).toBe('articles');
  });

  it('hits the asset_passwords endpoint when fetching passwords', async () => {
    const { HuduClient } = await importClient();
    requestMock.mockResolvedValue(page('asset_passwords', 0));

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    await client.getAssetPasswords(42);

    expect(requestMock.mock.calls[0][0]).toMatchObject({
      url: '/asset_passwords',
      params: expect.objectContaining({ company_id: 42 }),
    });
  });
});

describe('T017: validateConnection', () => {
  it('returns ok + passwordAccess=true when both probes succeed', async () => {
    const { HuduClient } = await importClient();
    requestMock
      .mockResolvedValueOnce(page('companies', 1)) // /companies?page=1
      .mockResolvedValueOnce(page('asset_passwords', 1)); // /asset_passwords?page=1

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    const result = await client.validateConnection();

    expect(result).toMatchObject({ ok: true, connected: true, passwordAccess: true });
  });

  it('returns ok + passwordAccess=false when the asset_passwords probe is 403', async () => {
    const { HuduClient } = await importClient();
    requestMock
      .mockResolvedValueOnce(page('companies', 1))
      .mockRejectedValueOnce(axiosError(403));

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    const result = await client.validateConnection();

    expect(result).toMatchObject({ ok: true, connected: true, passwordAccess: false });
    expect(result.error).toBeUndefined();
  });

  it('returns not-ok with a typed error when companies probe fails with 401', async () => {
    const { HuduClient } = await importClient();
    requestMock.mockRejectedValueOnce(axiosError(401));

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    const result = await client.validateConnection();

    expect(result).toMatchObject({ ok: false, connected: false, passwordAccess: false });
    expect(result.error?.kind).toBe('invalid_key');
  });
});

describe('T018: redaction', () => {
  it('redactSecret removes the api key from arbitrary strings', async () => {
    const { redactSecret } = await importClient();
    const out = redactSecret('failed with key super-secret-key in url', 'super-secret-key');
    expect(out).not.toContain('super-secret-key');
    expect(out).toContain('[REDACTED]');
  });

  it('never includes the api key in a surfaced request error', async () => {
    const { HuduClient } = await importClient();
    // Simulate an error whose message embeds the api key (worst case).
    const leaky = { isAxiosError: true, message: 'bad key super-secret-key', response: { status: 401, headers: {} } };
    requestMock.mockRejectedValue(leaky);

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    let caught: unknown;
    try {
      await client.getCompanies();
    } catch (e) {
      caught = e;
    }

    const serialized = JSON.stringify({
      message: (caught as Error).message,
      hudu: (caught as { hudu?: unknown }).hudu,
    });
    expect(serialized).not.toContain('super-secret-key');
  });

  it('never includes a password value in a surfaced error', async () => {
    const { HuduClient } = await importClient();
    // A 422 whose response body carries a plaintext password must not surface it.
    requestMock.mockRejectedValue(
      axiosError(422, { data: { asset_password: { password: 'Hunter2Plaintext' } } })
    );

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    let caught: unknown;
    try {
      await client.getAssetPasswords(1);
    } catch (e) {
      caught = e;
    }

    const serialized = JSON.stringify({
      message: (caught as Error).message,
      hudu: (caught as { hudu?: unknown }).hudu,
    });
    expect(serialized).not.toContain('Hunter2Plaintext');
  });
});

describe('T201/T202: listAssetLayouts', () => {
  it('returns typed {id, name} entries from a mocked 200', async () => {
    const { HuduClient } = await importClient();
    requestMock.mockResolvedValueOnce({
      data: {
        asset_layouts: [
          { id: 1, name: 'API Secrets', icon: 'fas fa-key', active: true },
          { id: 7, name: 'Computer Assets', active: true },
        ],
      },
    });

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    const layouts = await client.listAssetLayouts();

    expect(layouts).toEqual([
      { id: 1, name: 'API Secrets' },
      { id: 7, name: 'Computer Assets' },
    ]);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ url: '/asset_layouts' });
  });

  it('maps 401 to invalid_key (no retry)', async () => {
    const { HuduClient, HuduRequestError } = await importClient();
    requestMock.mockRejectedValue(axiosError(401));

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });

    await expect(client.listAssetLayouts()).rejects.toBeInstanceOf(HuduRequestError);
    requestMock.mockRejectedValue(axiosError(401));
    await expect(client.listAssetLayouts()).rejects.toMatchObject({ hudu: { kind: 'invalid_key', status: 401 } });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});

describe('T203/T204: listAllArticles', () => {
  it('passes page + search (no company_id) and returns exactly one typed page', async () => {
    const { HuduClient } = await importClient();
    requestMock.mockResolvedValueOnce({
      data: {
        articles: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Article ${i + 1}`, company_id: 1 })),
      },
    });

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    const articles = await client.listAllArticles({ page: 3, search: 'vpn' });

    expect(articles).toHaveLength(25);
    expect(articles[0]).toMatchObject({ id: 1, name: 'Article 1', company_id: 1 });
    // A full page must NOT trigger a follow-up fetch — one page per call.
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ url: '/articles' });
    expect(requestMock.mock.calls[0][0].params).toEqual({ page: 3, search: 'vpn' });
  });

  it('omits the search param when the term is empty', async () => {
    const { HuduClient } = await importClient();
    requestMock.mockResolvedValueOnce({ data: { articles: [] } });

    const client = new HuduClient({ credentials: VALID_CREDS, sleep: noopSleep });
    await client.listAllArticles({ page: 1, search: '   ' });

    expect(requestMock.mock.calls[0][0].params).toEqual({ page: 1 });
  });

  it('maps 429 to rate_limited after retries are exhausted', async () => {
    const { HuduClient } = await importClient();
    requestMock.mockRejectedValue(axiosError(429, { headers: { 'retry-after': '1' } }));

    const client = new HuduClient({
      credentials: VALID_CREDS,
      sleep: noopSleep,
      retryOptions: { maxAttempts: 2, maxJitterMs: 0 },
    });

    await expect(client.listAllArticles({ page: 1 })).rejects.toMatchObject({
      hudu: { kind: 'rate_limited', status: 429 },
    });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
