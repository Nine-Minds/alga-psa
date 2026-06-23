/**
 * T023–T026 — Hudu connection server actions (connect / test / getStatus /
 * disconnect), unit-mocked: secret provider, repository, HuduClient and the
 * gating modules are mocked; no DB or network. The repository itself is
 * covered against the real DB in the migration integration test (T022).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';
const API_KEY = 'super-secret-api-key-123';
const BASE_URL = 'https://docs.example.com';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();

const getTenantSecretMock = vi.fn();
const setTenantSecretMock = vi.fn();
const deleteTenantSecretMock = vi.fn();

const knexCallableMock = vi.fn();
const createTenantKnexMock = vi.fn();

const getHuduIntegrationMock = vi.fn();
const upsertHuduIntegrationMock = vi.fn();
const setHuduIntegrationActiveMock = vi.fn();
const touchHuduIntegrationLastSyncedMock = vi.fn();

const validateConnectionMock = vi.fn();
const huduClientConstructorSpy = vi.fn();

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

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    deleteTenantSecret: deleteTenantSecretMock,
  })),
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
  upsertHuduIntegration: upsertHuduIntegrationMock,
  setHuduIntegrationActive: setHuduIntegrationActiveMock,
  touchHuduIntegrationLastSynced: touchHuduIntegrationLastSyncedMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduClient', () => ({
  buildHuduApiBaseUrl: (baseUrl: string) =>
    baseUrl.trim().replace(/\/+$/, '').replace(/\/api(?:\/v1)?$/, '').concat('/api/v1'),
  HuduClient: class {
    constructor(config: unknown) {
      huduClientConstructorSpy(config);
    }
    validateConnection = validateConnectionMock;
  },
}));

async function importActions() {
  return import('@ee/lib/actions/integrations/huduActions');
}

const validResult = { ok: true, connected: true, passwordAccess: true };
const invalidKeyResult = {
  ok: false,
  connected: false,
  passwordAccess: false,
  error: { kind: 'invalid_key', status: 401, message: 'Hudu rejected the API key (401).' },
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HUDU_API_KEY;
  delete process.env.HUDU_BASE_URL;

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  getTenantSecretMock.mockResolvedValue(null);
  setTenantSecretMock.mockResolvedValue(undefined);
  deleteTenantSecretMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduIntegrationMock.mockResolvedValue(null);
  upsertHuduIntegrationMock.mockImplementation(async (_knex, tenant, input) => ({
    tenant,
    integration_id: 'integration-1',
    base_url: input.base_url ?? null,
    is_active: input.is_active ?? false,
    connected_at: input.connected_at ?? null,
    last_synced_at: input.last_synced_at ?? null,
    settings: input.settings ?? {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  setHuduIntegrationActiveMock.mockResolvedValue(undefined);

  validateConnectionMock.mockResolvedValue(validResult);
});

describe('T023: connectHudu', () => {
  it('stores both secrets via the secret provider and upserts the row active', async () => {
    const { connectHudu } = await importActions();

    const result = await connectHudu({ baseUrl: BASE_URL, apiKey: API_KEY });

    expect(result).toMatchObject({
      success: true,
      data: { connected: true, isActive: true, baseUrl: BASE_URL, passwordAccess: true },
    });
    expect(setTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_api_key', API_KEY);
    expect(setTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_base_url', BASE_URL);
    expect(upsertHuduIntegrationMock).toHaveBeenCalledWith(
      knexCallableMock,
      TENANT,
      expect.objectContaining({
        base_url: BASE_URL,
        is_active: true,
        connected_at: expect.any(String),
        settings: { password_access: true },
      })
    );
    // Candidate creds are validated against the live instance before storing.
    expect(huduClientConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: API_KEY, baseUrl: BASE_URL } })
    );
  });

  it('does not store secrets or upsert when validation fails', async () => {
    validateConnectionMock.mockResolvedValue(invalidKeyResult);
    const { connectHudu } = await importActions();

    const result = await connectHudu({ baseUrl: BASE_URL, apiKey: 'bad-key' });

    expect(result).toEqual({
      success: false,
      error: 'Hudu rejected the API key (401).',
      errorKind: 'invalid_key',
    });
    expect(setTenantSecretMock).not.toHaveBeenCalled();
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('reuses the stored api key only when the input keeps the stored base URL', async () => {
    getTenantSecretMock.mockImplementation(async (_tenant: string, name: string) =>
      name === 'hudu_api_key' ? API_KEY : BASE_URL
    );
    const { connectHudu } = await importActions();

    const result = await connectHudu({ baseUrl: BASE_URL });

    expect(result).toMatchObject({ success: true, data: { connected: true } });
    expect(huduClientConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: API_KEY, baseUrl: BASE_URL } })
    );
    expect(setTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_api_key', API_KEY);
    expect(setTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_base_url', BASE_URL);
  });

  it('requires a fresh api key when changing the base URL', async () => {
    getTenantSecretMock.mockImplementation(async (_tenant: string, name: string) =>
      name === 'hudu_api_key' ? API_KEY : BASE_URL
    );
    const { connectHudu } = await importActions();

    const result = await connectHudu({ baseUrl: 'https://new.example.com' });

    expect(result).toEqual({ success: false, error: 'Hudu API key is required when changing the base URL.' });
    expect(huduClientConstructorSpy).not.toHaveBeenCalled();
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  it('F033: still requires an api key when none is stored', async () => {
    const { connectHudu } = await importActions();

    const result = await connectHudu({ baseUrl: BASE_URL });

    expect(result).toEqual({ success: false, error: 'Hudu API key is required when changing the base URL.' });
    expect(validateConnectionMock).not.toHaveBeenCalled();
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  it('rejects when the caller lacks system_settings update', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { connectHudu } = await importActions();

    await expect(connectHudu({ baseUrl: BASE_URL, apiKey: API_KEY })).rejects.toThrow(
      /insufficient permissions \(update\)/
    );
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'update');
  });

  it('rejects when the hudu-integration flag is off', async () => {
    isEnabledMock.mockResolvedValue(false);
    const { connectHudu } = await importActions();

    await expect(connectHudu({ baseUrl: BASE_URL, apiKey: API_KEY })).rejects.toThrow(
      /disabled for this tenant/
    );
  });
});

describe('T024: testHuduConnection', () => {
  it('returns connected + capability for valid candidate credentials', async () => {
    const { testHuduConnection } = await importActions();

    const result = await testHuduConnection({ baseUrl: BASE_URL, apiKey: API_KEY });

    expect(result).toEqual({ success: true, data: { connected: true, passwordAccess: true } });
    // Candidate validation must not persist anything.
    expect(setTenantSecretMock).not.toHaveBeenCalled();
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('returns a typed error shape for invalid credentials', async () => {
    validateConnectionMock.mockResolvedValue(invalidKeyResult);
    const { testHuduConnection } = await importActions();

    const result = await testHuduConnection({ baseUrl: BASE_URL, apiKey: 'bad-key' });

    expect(result).toEqual({
      success: true,
      data: {
        connected: false,
        passwordAccess: false,
        errorKind: 'invalid_key',
        error: 'Hudu rejected the API key (401).',
      },
    });
  });

  it('validates the stored credentials when no candidate is provided', async () => {
    getTenantSecretMock.mockImplementation(async (_tenant: string, name: string) =>
      name === 'hudu_api_key' ? API_KEY : BASE_URL
    );
    const { testHuduConnection } = await importActions();

    const result = await testHuduConnection();

    expect(result).toEqual({ success: true, data: { connected: true, passwordAccess: true } });
    expect(getTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_api_key');
    expect(getTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_base_url');
    expect(huduClientConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { apiKey: API_KEY, baseUrl: BASE_URL } })
    );
  });

  it('requires a fresh api key when testing a changed base URL', async () => {
    getTenantSecretMock.mockImplementation(async (_tenant: string, name: string) =>
      name === 'hudu_api_key' ? API_KEY : BASE_URL
    );
    const { testHuduConnection } = await importActions();

    const result = await testHuduConnection({ baseUrl: 'https://new.example.com' });

    expect(result).toEqual({ success: false, error: 'Hudu API key is required when changing the base URL.' });
    expect(huduClientConstructorSpy).not.toHaveBeenCalled();
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  it('returns an actionable error when no credentials are configured', async () => {
    const { testHuduConnection } = await importActions();

    const result = await testHuduConnection();

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/not configured/),
    });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});

describe('T025: getHuduConnectionStatus', () => {
  it('never includes the api key, even when secrets exist', async () => {
    getTenantSecretMock.mockResolvedValue(API_KEY);
    getHuduIntegrationMock.mockResolvedValue({
      tenant: TENANT,
      integration_id: 'integration-1',
      base_url: BASE_URL,
      is_active: true,
      connected_at: '2026-06-09T00:00:00.000Z',
      last_synced_at: null,
      settings: { password_access: true },
      created_at: '2026-06-09T00:00:00.000Z',
      updated_at: '2026-06-09T00:00:00.000Z',
    });
    const { getHuduConnectionStatus } = await importActions();

    const result = await getHuduConnectionStatus();

    expect(result).toEqual({
      success: true,
      data: {
        connected: true,
        isActive: true,
        baseUrl: BASE_URL,
        connectedAt: '2026-06-09T00:00:00.000Z',
        lastSyncedAt: null,
        passwordAccess: true,
      },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toMatch(/api_?key/i);
    // Status is metadata-only: the secret store is never even read.
    expect(getTenantSecretMock).not.toHaveBeenCalled();
  });

  it('reports not connected when no row exists', async () => {
    getHuduIntegrationMock.mockResolvedValue(null);
    const { getHuduConnectionStatus } = await importActions();

    const result = await getHuduConnectionStatus();

    expect(result).toEqual({
      success: true,
      data: {
        connected: false,
        isActive: false,
        baseUrl: null,
        connectedAt: null,
        lastSyncedAt: null,
        passwordAccess: false,
      },
    });
  });
});

describe('T026: disconnectHudu', () => {
  it('deletes both secrets, marks the row inactive, and leaves mappings untouched', async () => {
    const { disconnectHudu } = await importActions();

    const result = await disconnectHudu();

    expect(result).toEqual({ success: true, data: { disconnected: true } });
    expect(deleteTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_api_key');
    expect(deleteTenantSecretMock).toHaveBeenCalledWith(TENANT, 'hudu_base_url');
    expect(setHuduIntegrationActiveMock).toHaveBeenCalledWith(knexCallableMock, TENANT, false);

    // Mappings retained: the shared CE mapping table is never touched.
    expect(knexCallableMock).not.toHaveBeenCalledWith('tenant_external_entity_mappings');
    expect(knexCallableMock).not.toHaveBeenCalled();
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });
});
