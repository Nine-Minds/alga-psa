/**
 * T040/T046 — Hudu company-mapping server actions, unit-mocked: auth gate,
 * feature flag, tiers, knex, the hudu_integrations repository and the Hudu
 * client are mocked; the matcher + cache shaping stay REAL (partial module
 * mock keeps only the knex-level row functions fake). The row functions
 * themselves run against the real DB in
 * integration/hudu-company-mappings.integration.test.ts (T044/T045/T047/T048).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const CLIENT_2 = '22222222-2222-2222-2222-222222222222';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
let clientsRows: Array<{ client_id: string; client_name: string }> = [];
const knexCallableMock = vi.fn((_table: string) => {
  const qb: Record<string, unknown> = {};
  qb.where = vi.fn(() => qb);
  qb.select = vi.fn(async () => clientsRows);
  return qb;
});

const getHuduIntegrationMock = vi.fn();
const upsertHuduIntegrationMock = vi.fn();

const getCompaniesMock = vi.fn();
const createHuduClientMock = vi.fn(async () => ({ getCompanies: getCompaniesMock }));

const getHuduCompanyMappingRowsMock = vi.fn();
const setHuduCompanyMappingRowMock = vi.fn();
const clearHuduCompanyMappingRowMock = vi.fn();

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

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
  upsertHuduIntegration: upsertHuduIntegrationMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduClient', () => ({
  createHuduClient: createHuduClientMock,
}));

// Keep the REAL matcher + cache shaping; fake only the knex-level row access.
vi.mock('@ee/lib/integrations/hudu/companyMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduCompanyMappingRows: getHuduCompanyMappingRowsMock,
  setHuduCompanyMappingRow: setHuduCompanyMappingRowMock,
  clearHuduCompanyMappingRow: clearHuduCompanyMappingRowMock,
}));

async function importActions() {
  return import('@ee/lib/actions/integrations/huduMappingActions');
}

/** 60 companies = 3 Hudu pages (25+25+10); the client aggregates pages (T010). */
function pagedCompanies(): Array<Record<string, unknown>> {
  return Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    name: `Company ${i + 1}`,
    id_in_integration: i === 0 ? CLIENT_1 : i === 1 ? 4711 : null,
    url: `https://hudu.example.com/companies/${i + 1}`,
    company_type: 'MSP Client', // must NOT leak into the cache
    archived: false,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  clientsRows = [];

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduIntegrationMock.mockResolvedValue(null);
  upsertHuduIntegrationMock.mockResolvedValue({});

  getCompaniesMock.mockResolvedValue(pagedCompanies());
  getHuduCompanyMappingRowsMock.mockResolvedValue([]);
  setHuduCompanyMappingRowMock.mockResolvedValue({ ok: true, mapping: { id: 'mapping-1' } });
  clearHuduCompanyMappingRowMock.mockResolvedValue(1);
});

describe('T040: syncHuduCompanies', () => {
  it('fetches the full paginated company list and persists the compact settings cache', async () => {
    getHuduIntegrationMock.mockResolvedValue({
      tenant: TENANT,
      settings: { password_access: true },
    });
    const { syncHuduCompanies } = await importActions();

    const result = await syncHuduCompanies();

    expect(createHuduClientMock).toHaveBeenCalledWith(TENANT);
    expect(getCompaniesMock).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({ success: true });
    const data = (result as { data: { companies: unknown[]; fetched_at: string } }).data;
    expect(data.companies).toHaveLength(60);
    expect(new Date(data.fetched_at).toISOString()).toBe(data.fetched_at);

    // Cache entries are compact {id,name,id_in_integration,url} — nothing else.
    expect(data.companies[0]).toEqual({
      id: 1,
      name: 'Company 1',
      id_in_integration: CLIENT_1,
      url: 'https://hudu.example.com/companies/1',
    });
    // Numeric id_in_integration is normalized to a string; missing → null.
    expect(data.companies[1]).toMatchObject({ id_in_integration: '4711' });
    expect(data.companies[2]).toMatchObject({ id_in_integration: null });

    // Persisted under settings.companies_cache, preserving other settings keys.
    expect(upsertHuduIntegrationMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      settings: {
        password_access: true,
        companies_cache: { companies: data.companies, fetched_at: data.fetched_at },
      },
    });
  });

  it('requires system_settings update', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { syncHuduCompanies } = await importActions();

    await expect(syncHuduCompanies()).rejects.toThrow(/insufficient permissions \(update\)/);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'update');
  });

  it('rejects when the hudu-integration flag is off', async () => {
    isEnabledMock.mockResolvedValue(false);
    const { syncHuduCompanies } = await importActions();

    await expect(syncHuduCompanies()).rejects.toThrow(/disabled for this tenant/);
  });

  it('returns a failure envelope when the Hudu fetch fails', async () => {
    getCompaniesMock.mockRejectedValue(new Error('Hudu rate limit exceeded (429).'));
    const { syncHuduCompanies } = await importActions();

    const result = await syncHuduCompanies();

    expect(result).toEqual({ success: false, error: 'Hudu rate limit exceeded (429).' });
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });
});

describe('T046: getHuduCompanyMappings', () => {
  const cache = {
    companies: [
      { id: 101, name: 'Mapped Co', id_in_integration: null, url: 'https://hudu.example.com/companies/101' },
      { id: 202, name: 'Acme', id_in_integration: null, url: null },
      { id: 303, name: 'Zzz Unique', id_in_integration: null, url: null },
    ],
    fetched_at: '2026-06-09T10:00:00.000Z',
  };

  it('merges the cached list with mappings (+ client name) and suggestions for unmapped companies', async () => {
    getHuduIntegrationMock.mockResolvedValue({ tenant: TENANT, settings: { companies_cache: cache } });
    getHuduCompanyMappingRowsMock.mockResolvedValue([
      {
        id: 'mapping-101',
        tenant: TENANT,
        integration_type: 'hudu',
        alga_entity_type: 'client',
        alga_entity_id: CLIENT_1,
        external_entity_id: '101',
        client_name: 'Mapped Client',
      },
    ]);
    clientsRows = [
      { client_id: CLIENT_1, client_name: 'Mapped Client' },
      { client_id: CLIENT_2, client_name: 'Acme' },
    ];
    const { getHuduCompanyMappings } = await importActions();

    const result = await getHuduCompanyMappings();

    expect(result).toEqual({
      success: true,
      data: {
        fetched_at: cache.fetched_at,
        fromCache: true,
        companies: [
          {
            hudu_company_id: 101,
            hudu_company_name: 'Mapped Co',
            id_in_integration: null,
            url: 'https://hudu.example.com/companies/101',
            mapping: { mapping_id: 'mapping-101', client_id: CLIENT_1, client_name: 'Mapped Client' },
            suggestion: null,
          },
          {
            hudu_company_id: 202,
            hudu_company_name: 'Acme',
            id_in_integration: null,
            url: null,
            mapping: null,
            suggestion: { client_id: CLIENT_2, client_name: 'Acme', source: 'exact_name', confidence: 0.9 },
          },
          {
            hudu_company_id: 303,
            hudu_company_name: 'Zzz Unique',
            id_in_integration: null,
            url: null,
            mapping: null,
            suggestion: null,
          },
        ],
      },
    });

    // Cache hit: no live Hudu fetch, and a read never writes settings.
    expect(createHuduClientMock).not.toHaveBeenCalled();
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('falls back to a live fetch when no cache exists (without persisting on the read path)', async () => {
    getHuduIntegrationMock.mockResolvedValue({ tenant: TENANT, settings: {} });
    getCompaniesMock.mockResolvedValue([
      { id: 7, name: 'Live Co', id_in_integration: null, url: null },
    ]);
    const { getHuduCompanyMappings } = await importActions();

    const result = await getHuduCompanyMappings();

    expect(createHuduClientMock).toHaveBeenCalledWith(TENANT);
    expect(result).toMatchObject({
      success: true,
      data: {
        fromCache: false,
        companies: [{ hudu_company_id: 7, hudu_company_name: 'Live Co', mapping: null, suggestion: null }],
      },
    });
    expect(upsertHuduIntegrationMock).not.toHaveBeenCalled();
  });

  it('is read-gated', async () => {
    const { getHuduCompanyMappings } = await importActions();
    getHuduIntegrationMock.mockResolvedValue({ tenant: TENANT, settings: { companies_cache: cache } });

    await getHuduCompanyMappings();

    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'read');
  });
});

describe('F045 action wrappers: setHuduCompanyMapping / clearHuduCompanyMapping', () => {
  it('enriches missing metadata from the companies cache before writing', async () => {
    getHuduIntegrationMock.mockResolvedValue({
      tenant: TENANT,
      settings: {
        companies_cache: {
          companies: [{ id: 101, name: 'Mapped Co', id_in_integration: 'psa-1', url: 'https://h/c/101' }],
          fetched_at: '2026-06-09T10:00:00.000Z',
        },
      },
    });
    const { setHuduCompanyMapping } = await importActions();

    const result = await setHuduCompanyMapping({ clientId: CLIENT_1, huduCompanyId: 101 });

    expect(result).toEqual({ success: true, data: { mapping_id: 'mapping-1' } });
    expect(setHuduCompanyMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      clientId: CLIENT_1,
      huduCompanyId: 101,
      metadata: { hudu_company_name: 'Mapped Co', id_in_integration: 'psa-1', url: 'https://h/c/101' },
    });
  });

  it('surfaces the typed one-to-one rejection from the row layer', async () => {
    setHuduCompanyMappingRowMock.mockResolvedValue({
      ok: false,
      code: 'client_already_mapped',
      message: 'Client is already mapped to Hudu company 101. Clear that mapping first.',
    });
    const { setHuduCompanyMapping } = await importActions();

    const result = await setHuduCompanyMapping({ clientId: CLIENT_1, huduCompanyId: 202 });

    expect(result).toEqual({
      success: false,
      code: 'client_already_mapped',
      error: 'Client is already mapped to Hudu company 101. Clear that mapping first.',
    });
  });

  it('clearHuduCompanyMapping reports not_found when nothing was cleared', async () => {
    clearHuduCompanyMappingRowMock.mockResolvedValue(0);
    const { clearHuduCompanyMapping } = await importActions();

    const result = await clearHuduCompanyMapping({ huduCompanyId: 999 });

    expect(result).toEqual({ success: false, error: 'Mapping not found.', code: 'not_found' });
  });

  it('clearHuduCompanyMapping clears by mapping id and is update-gated', async () => {
    const { clearHuduCompanyMapping } = await importActions();

    const result = await clearHuduCompanyMapping({ mappingId: 'mapping-1' });

    expect(result).toEqual({ success: true, data: { cleared: 1 } });
    expect(clearHuduCompanyMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      mappingId: 'mapping-1',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'system_settings', 'update');
  });
});
