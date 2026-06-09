/**
 * T060–T063, T065–T069 — Hudu reference-data server actions, unit-mocked:
 * auth gate, feature flag, tiers, knex, secret provider, repository, the
 * mapping resolver and the Hudu client are mocked; the reference cache and
 * value stripping (referenceData.ts) stay REAL so the cache/strip behavior is
 * exercised end-to-end through the actions. The reveal audit sink is mocked
 * here (payload asserted) and covered for real in huduRevealAudit.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const CLIENT_2 = '22222222-2222-2222-2222-222222222222';
const BASE_URL = 'https://docs.example.com';
const PASSWORD_VALUE = 'hunter2-plaintext';
const OTP_VALUE = 'JBSWY3DPEHPK3PXP';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();
const assertAddOnAccessMock = vi.fn();

const knexCallableMock = vi.fn();
const createTenantKnexMock = vi.fn();

const getTenantSecretMock = vi.fn();
const setTenantSecretMock = vi.fn();
const deleteTenantSecretMock = vi.fn();

const getHuduIntegrationMock = vi.fn();
const upsertHuduIntegrationMock = vi.fn();
const setHuduIntegrationActiveMock = vi.fn();
const touchHuduIntegrationLastSyncedMock = vi.fn();

const resolveCompanyIdMock = vi.fn();

const getAssetsMock = vi.fn();
const getArticlesMock = vi.fn();
const getAssetPasswordsMock = vi.fn();
const getAssetPasswordMock = vi.fn();
const createHuduClientMock = vi.fn(async () => ({
  getAssets: getAssetsMock,
  getArticles: getArticlesMock,
  getAssetPasswords: getAssetPasswordsMock,
  getAssetPassword: getAssetPasswordMock,
}));

const revealAuditMock = vi.fn();

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerDebugMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: { isEnabled: isEnabledMock },
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('server/src/lib/tier-gating/assertAddOnAccess', () => ({
  assertAddOnAccess: assertAddOnAccessMock,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    deleteTenantSecret: deleteTenantSecretMock,
  })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: loggerDebugMock,
  },
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
  upsertHuduIntegration: upsertHuduIntegrationMock,
  setHuduIntegrationActive: setHuduIntegrationActiveMock,
  touchHuduIntegrationLastSynced: touchHuduIntegrationLastSyncedMock,
}));

// Keep parseCompaniesCache real; fake only the knex-level mapping resolver.
vi.mock('@ee/lib/integrations/hudu/companyMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveHuduCompanyIdForClient: resolveCompanyIdMock,
}));

// Keep HuduRequestError (instanceof checks) real; fake only the factory.
vi.mock('@ee/lib/integrations/hudu/huduClient', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createHuduClient: createHuduClientMock,
}));

vi.mock('@ee/lib/integrations/hudu/revealAudit', () => ({
  writeHuduPasswordRevealAudit: revealAuditMock,
}));

// Dynamic import: a static import would invoke the partial module factory
// before the mock consts above are initialized (TDZ).
const { HuduRequestError } = await import('@ee/lib/integrations/hudu/huduClient');
const { clearHuduReferenceCache, getHuduReferenceCacheSize } = await import(
  '@ee/lib/integrations/hudu/referenceData'
);

async function importActions() {
  return import('@ee/lib/actions/integrations/huduDataActions');
}

function noPasswordAccessError() {
  return new HuduRequestError({
    kind: 'no_password_access',
    status: 403,
    message: 'Hudu API key lacks password access (403).',
  });
}

/** 60 items = 3 Hudu pages (25+25+10) as aggregated by the paginated client. */
function pagedAssets(): Array<Record<string, unknown>> {
  return Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    company_id: 101,
    name: `Asset ${i + 1}`,
    asset_type: 'Server',
    url: i === 0 ? '/a/asset-1' : null,
  }));
}

function rawPasswords(): Array<Record<string, unknown>> {
  return [
    {
      id: 42,
      company_id: 101,
      name: 'Office WiFi',
      username: 'admin',
      password: PASSWORD_VALUE,
      otp_secret: OTP_VALUE,
      totp_code: '987654',
      url: '/passwords/42',
      password_folder_name: 'Network',
      description: 'WPA2 key',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
    },
    {
      id: 43,
      company_id: 101,
      name: 'Router',
      username: null,
      password: 'another-secret-value',
      url: null,
    },
  ];
}

function revealRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    company_id: 101,
    name: 'Office WiFi',
    username: 'admin',
    password: PASSWORD_VALUE,
    otp_secret: OTP_VALUE,
    url: '/passwords/42',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHuduReferenceCache();

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  assertAddOnAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getTenantSecretMock.mockResolvedValue(null);
  setTenantSecretMock.mockResolvedValue(undefined);
  deleteTenantSecretMock.mockResolvedValue(undefined);

  getHuduIntegrationMock.mockResolvedValue({
    tenant: TENANT,
    base_url: BASE_URL,
    is_active: true,
    settings: {
      password_access: true,
      companies_cache: {
        companies: [{ id: 101, name: 'Acme', id_in_integration: null, url: '/companies/101' }],
        fetched_at: '2026-06-09T10:00:00.000Z',
      },
    },
  });

  resolveCompanyIdMock.mockImplementation(async (_knex, _tenant, clientId) =>
    clientId === CLIENT_1 ? '101' : clientId === CLIENT_2 ? '202' : null
  );

  getAssetsMock.mockResolvedValue(pagedAssets());
  getArticlesMock.mockResolvedValue([
    { id: 7, company_id: 101, name: 'Runbook', url: 'https://docs.example.com/kba/7' },
    { id: 8, company_id: 101, name: 'Onboarding', url: null },
  ]);
  getAssetPasswordsMock.mockResolvedValue(rawPasswords());
  getAssetPasswordMock.mockResolvedValue(revealRecord());
  revealAuditMock.mockResolvedValue(undefined);
});

describe('T060: getHuduCompanyAssets', () => {
  it('resolves the mapping and returns the paginated asset list with count and deep-links', async () => {
    const { getHuduCompanyAssets } = await importActions();

    const result = await getHuduCompanyAssets(CLIENT_1);

    expect(resolveCompanyIdMock).toHaveBeenCalledWith(knexCallableMock, TENANT, CLIENT_1);
    expect(createHuduClientMock).toHaveBeenCalledWith(TENANT);
    expect(getAssetsMock).toHaveBeenCalledTimes(1);
    expect(getAssetsMock).toHaveBeenCalledWith(101);

    expect(result).toMatchObject({
      state: 'ok',
      count: 60,
      huduCompanyId: '101',
      companyUrl: `${BASE_URL}/companies/101`,
      fromCache: false,
    });
    const ok = result as Extract<typeof result, { state: 'ok' }>;
    expect(ok.items).toHaveLength(60);
    // Record's own url wins; records without one fall back to the company url.
    expect(ok.items[0]).toMatchObject({ name: 'Asset 1', hudu_url: `${BASE_URL}/a/asset-1` });
    expect(ok.items[1]).toMatchObject({ name: 'Asset 2', hudu_url: `${BASE_URL}/companies/101` });
    expect(new Date(ok.fetchedAt).toISOString()).toBe(ok.fetchedAt);
  });

  it('is read-gated', async () => {
    const { getHuduCompanyAssets } = await importActions();

    await getHuduCompanyAssets(CLIENT_1);

    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'read');
  });

  it('maps a Hudu failure to a typed error envelope', async () => {
    getAssetsMock.mockRejectedValue(
      new HuduRequestError({ kind: 'rate_limited', status: 429, message: 'Hudu rate limit exceeded (429).' })
    );
    const { getHuduCompanyAssets } = await importActions();

    const result = await getHuduCompanyAssets(CLIENT_1);

    expect(result).toEqual({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
  });
});

describe('T061: getHuduCompanyArticles', () => {
  it('returns the company articles with count and deep-links', async () => {
    const { getHuduCompanyArticles } = await importActions();

    const result = await getHuduCompanyArticles(CLIENT_1);

    expect(getArticlesMock).toHaveBeenCalledWith(101);
    expect(result).toMatchObject({ state: 'ok', count: 2, huduCompanyId: '101' });
    const ok = result as Extract<typeof result, { state: 'ok' }>;
    expect(ok.items[0]).toMatchObject({ id: 7, hudu_url: 'https://docs.example.com/kba/7' });
    expect(ok.items[1]).toMatchObject({ id: 8, hudu_url: `${BASE_URL}/companies/101` });
  });
});

describe('T062: getHuduCompanyPasswords strips every value-bearing field (F062/F064)', () => {
  it('returns metadata-only summaries: no password/otp/totp key on ANY item, no value in the payload', async () => {
    const { getHuduCompanyPasswords } = await importActions();

    const result = await getHuduCompanyPasswords(CLIENT_1);

    expect(getAssetPasswordsMock).toHaveBeenCalledWith(101);
    expect(result).toMatchObject({ state: 'ok', count: 2 });
    const ok = result as Extract<typeof result, { state: 'ok' }>;

    expect(ok.items).toHaveLength(2);
    for (const item of ok.items) {
      expect(Object.keys(item).sort()).toEqual([
        'company_id',
        'created_at',
        'description',
        'hudu_url',
        'id',
        'name',
        'password_folder_name',
        'updated_at',
        'url',
        'username',
      ]);
      expect('password' in item).toBe(false);
      expect('otp_secret' in item).toBe(false);
      expect('totp_code' in item).toBe(false);
    }
    expect(ok.items[0]).toMatchObject({ id: 42, name: 'Office WiFi', username: 'admin' });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PASSWORD_VALUE);
    expect(serialized).not.toContain(OTP_VALUE);
    expect(serialized).not.toContain('another-secret-value');
  });
});

describe('T063: short-lived cache with refresh bypass', () => {
  it('serves the second call within the TTL from cache (single Hudu fetch)', async () => {
    const { getHuduCompanyAssets } = await importActions();

    const first = await getHuduCompanyAssets(CLIENT_1);
    const second = await getHuduCompanyAssets(CLIENT_1);

    expect(getAssetsMock).toHaveBeenCalledTimes(1);
    expect(createHuduClientMock).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ state: 'ok', fromCache: false });
    expect(second).toMatchObject({ state: 'ok', fromCache: true, count: 60 });
    expect((second as { fetchedAt: string }).fetchedAt).toBe((first as { fetchedAt: string }).fetchedAt);
  });

  it('refresh: true bypasses and repopulates the cache', async () => {
    const { getHuduCompanyAssets } = await importActions();

    await getHuduCompanyAssets(CLIENT_1);
    const refreshed = await getHuduCompanyAssets(CLIENT_1, { refresh: true });
    const after = await getHuduCompanyAssets(CLIENT_1);

    expect(getAssetsMock).toHaveBeenCalledTimes(2);
    expect(refreshed).toMatchObject({ state: 'ok', fromCache: false });
    expect(after).toMatchObject({ state: 'ok', fromCache: true });
  });

  it('keeps separate entries per company and per resource', async () => {
    const { getHuduCompanyAssets, getHuduCompanyPasswords } = await importActions();

    await getHuduCompanyAssets(CLIENT_1);
    await getHuduCompanyAssets(CLIENT_2); // different mapped company → its own fetch
    await getHuduCompanyPasswords(CLIENT_1); // different resource → its own fetch

    expect(getAssetsMock).toHaveBeenCalledTimes(2);
    expect(getAssetsMock).toHaveBeenNthCalledWith(1, 101);
    expect(getAssetsMock).toHaveBeenNthCalledWith(2, 202);
    expect(getAssetPasswordsMock).toHaveBeenCalledTimes(1);
    expect(getHuduReferenceCacheSize()).toBe(3);
  });
});

describe('T065: 403 on the passwords list is a typed state (F066)', () => {
  it('returns no_password_access instead of throwing', async () => {
    getAssetPasswordsMock.mockRejectedValue(noPasswordAccessError());
    const { getHuduCompanyPasswords } = await importActions();

    const result = await getHuduCompanyPasswords(CLIENT_1);

    expect(result).toEqual({ state: 'no_password_access' });
    expect(getHuduReferenceCacheSize()).toBe(0); // failures are never cached
  });
});

describe('T066: unmapped client short-circuits without any Hudu call', () => {
  it.each([
    ['getHuduCompanyAssets'],
    ['getHuduCompanyArticles'],
    ['getHuduCompanyPasswords'],
  ] as const)('%s returns { state: unmapped }', async (actionName) => {
    const actions = await importActions();
    const action = actions[actionName] as (clientId: string) => Promise<unknown>;

    const result = await action('unmapped-client-id');

    expect(result).toEqual({ state: 'unmapped' });
    expect(createHuduClientMock).not.toHaveBeenCalled();
    expect(getAssetsMock).not.toHaveBeenCalled();
    expect(getArticlesMock).not.toHaveBeenCalled();
    expect(getAssetPasswordsMock).not.toHaveBeenCalled();
    expect(getHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('revealHuduPassword also returns unmapped without fetching', async () => {
    const { revealHuduPassword } = await importActions();

    const result = await revealHuduPassword('unmapped-client-id', 42);

    expect(result).toEqual({ state: 'unmapped' });
    expect(createHuduClientMock).not.toHaveBeenCalled();
    expect(getAssetPasswordMock).not.toHaveBeenCalled();
    expect(revealAuditMock).not.toHaveBeenCalled();
  });
});

describe('T067: revealHuduPassword — single live GET, transient value, zero persistence', () => {
  it('does one targeted GET, returns the value, and writes nothing to DB/Vault/cache', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const { revealHuduPassword } = await importActions();

    const result = await revealHuduPassword(CLIENT_1, 42);

    expect(result).toEqual({ state: 'ok', value: PASSWORD_VALUE });

    // Single targeted GET — never the list endpoint.
    expect(getAssetPasswordMock).toHaveBeenCalledTimes(1);
    expect(getAssetPasswordMock).toHaveBeenCalledWith(42);
    expect(getAssetPasswordsMock).not.toHaveBeenCalled();

    // Nothing persisted: no repo writes, no Vault writes, no raw knex usage, no cache entry.
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
    expect(setHuduIntegrationActiveMock).not.toHaveBeenCalled();
    expect(touchHuduIntegrationLastSyncedMock).not.toHaveBeenCalled();
    expect(setTenantSecretMock).not.toHaveBeenCalled();
    expect(deleteTenantSecretMock).not.toHaveBeenCalled();
    expect(knexCallableMock).not.toHaveBeenCalled();
    expect(getHuduReferenceCacheSize()).toBe(0);

    // The value never reaches any log sink (logger or console).
    const logged = JSON.stringify([
      loggerInfoMock.mock.calls,
      loggerWarnMock.mock.calls,
      loggerErrorMock.mock.calls,
      loggerDebugMock.mock.calls,
      ...consoleSpies.map((spy) => spy.mock.calls),
    ]);
    expect(logged).not.toContain(PASSWORD_VALUE);
    expect(logged).not.toContain(OTP_VALUE);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      '[HuduDataActions] password revealed',
      { tenant: TENANT, clientId: CLIENT_1, huduPasswordId: '42', huduCompanyId: '101' }
    );
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  it('is read-gated (technician view flow; the audit is the compensating control)', async () => {
    const { revealHuduPassword } = await importActions();

    await revealHuduPassword(CLIENT_1, 42);

    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'read');
  });

  it('returns not_found when the record belongs to another company (no cross-company leak)', async () => {
    getAssetPasswordMock.mockResolvedValue(revealRecord({ company_id: 999 }));
    const { revealHuduPassword } = await importActions();

    const result = await revealHuduPassword(CLIENT_1, 42);

    expect(result).toEqual({ state: 'not_found' });
    expect('value' in (result as Record<string, unknown>)).toBe(false);
    expect(revealAuditMock).not.toHaveBeenCalled();
  });

  it('maps a Hudu 404 to not_found', async () => {
    getAssetPasswordMock.mockRejectedValue(
      new HuduRequestError({ kind: 'not_found', status: 404, message: 'Hudu resource not found (404).' })
    );
    const { revealHuduPassword } = await importActions();

    const result = await revealHuduPassword(CLIENT_1, 42);

    expect(result).toEqual({ state: 'not_found' });
  });
});

describe('T068: every reveal is audited (who/when/which, never the value)', () => {
  it('writes the audit entry before returning the value', async () => {
    const { revealHuduPassword } = await importActions();

    await revealHuduPassword(CLIENT_1, 42);

    expect(revealAuditMock).toHaveBeenCalledTimes(1);
    expect(revealAuditMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      userId: 'user-1',
      clientId: CLIENT_1,
      huduPasswordId: 42,
      huduCompanyId: '101',
    });
    const auditPayload = JSON.stringify(revealAuditMock.mock.calls);
    expect(auditPayload).not.toContain(PASSWORD_VALUE);
    expect(auditPayload).not.toContain(OTP_VALUE);
  });

  it('fails CLOSED: an audit failure aborts the reveal and the value is not returned', async () => {
    revealAuditMock.mockRejectedValue(new Error('Failed to write audit log'));
    const { revealHuduPassword } = await importActions();

    const result = await revealHuduPassword(CLIENT_1, 42);

    expect(result).toEqual({ state: 'error', error: 'Failed to write audit log' });
    expect('value' in (result as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(PASSWORD_VALUE);
  });
});

describe('T069: reveal against a key lacking password permission', () => {
  it('returns the typed no_password_access state and no value', async () => {
    getAssetPasswordMock.mockRejectedValue(noPasswordAccessError());
    const { revealHuduPassword } = await importActions();

    const result = await revealHuduPassword(CLIENT_1, 42);

    expect(result).toEqual({ state: 'no_password_access' });
    expect('value' in (result as Record<string, unknown>)).toBe(false);
    expect(revealAuditMock).not.toHaveBeenCalled();
  });
});

describe('F070: getHuduClientContext (client-tab gating probe)', () => {
  it('reports connected + mapped without any Hudu API call', async () => {
    const { getHuduClientContext } = await importActions();

    const result = await getHuduClientContext(CLIENT_1);

    expect(result).toEqual({ connected: true, mapped: true });
    expect(createHuduClientMock).not.toHaveBeenCalled();
  });

  it('reports unmapped for a client with no mapping row', async () => {
    const { getHuduClientContext } = await importActions();

    const result = await getHuduClientContext('99999999-9999-9999-9999-999999999999');

    expect(result).toEqual({ connected: true, mapped: false });
  });

  it('short-circuits to not connected (no mapping lookup) when no active integration row', async () => {
    getHuduIntegrationMock.mockResolvedValue(null);
    const { getHuduClientContext } = await importActions();

    const result = await getHuduClientContext(CLIENT_1);

    expect(result).toEqual({ connected: false, mapped: false });
    expect(resolveCompanyIdMock).not.toHaveBeenCalled();
  });

  it('resolves hidden (not throwing) on an internal failure', async () => {
    getHuduIntegrationMock.mockRejectedValue(new Error('db down'));
    const { getHuduClientContext } = await importActions();

    const result = await getHuduClientContext(CLIENT_1);

    expect(result).toEqual({ connected: false, mapped: false });
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it('is read-gated', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { getHuduClientContext } = await importActions();

    await expect(getHuduClientContext(CLIENT_1)).rejects.toThrow(
      'Forbidden: insufficient permissions (read)'
    );
  });
});
