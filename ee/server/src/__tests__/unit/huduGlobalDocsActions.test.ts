/**
 * T240–T242 — listHuduArticlesAcrossCompanies (global-docs group), unit-mocked
 * like the sibling action tests (huduDataActions.test.ts idioms): auth gate,
 * tiers, knex, the integration repository, the mapping rows and
 * the Hudu client factory are fakes; parseCompaniesCache and buildHuduRecordUrl
 * stay REAL so the company-name + deep-link resolution is exercised for real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-hudu-1';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const BASE_URL = 'https://docs.example.com';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const currentUserRef: { value: Record<string, unknown> | null } = { value: internalUser };

const hasPermissionMock = vi.fn();
const assertTierAccessMock = vi.fn();

const knexCallableMock = vi.fn();
const createTenantKnexMock = vi.fn();

const getHuduIntegrationMock = vi.fn();
const getHuduCompanyMappingRowsMock = vi.fn();

const listAllArticlesMock = vi.fn();
const createHuduClientMock = vi.fn(async () => ({
  listAllArticles: listAllArticlesMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      if (!currentUserRef.value) {
        throw new Error('User not authenticated');
      }
      return handler(currentUserRef.value, { tenant: TENANT }, ...args);
    },
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
}));

// Keep parseCompaniesCache real; fake only the knex-level mapping rows.
vi.mock('@ee/lib/integrations/hudu/companyMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduCompanyMappingRows: getHuduCompanyMappingRowsMock,
}));

// Keep HuduRequestError (instanceof checks) real; fake only the factory.
vi.mock('@ee/lib/integrations/hudu/huduClient', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createHuduClient: createHuduClientMock,
}));

// Dynamic imports: static imports would evaluate the modules before the mock
// consts above are initialized (TDZ — huduDataActions.test.ts idiom).
const { listHuduArticlesAcrossCompanies } = await import(
  '@ee/lib/actions/integrations/huduGlobalDocsActions'
);
const { HuduRequestError } = await import('@ee/lib/integrations/hudu/huduClient');

function integrationRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant: TENANT,
    is_active: true,
    base_url: BASE_URL,
    settings: {
      companies_cache: {
        companies: [
          { id: 101, name: 'ExampleCo', id_in_integration: null, url: '/companies/101' },
          { id: 202, name: 'CachedCo', id_in_integration: null, url: '/companies/202' },
        ],
        fetched_at: '2026-06-10T00:00:00.000Z',
      },
    },
    ...overrides,
  };
}

function articles() {
  return [
    {
      id: 1,
      company_id: 101,
      name: 'Mapped Runbook',
      updated_at: '2026-06-01T00:00:00Z',
      url: '/articles/1',
    },
    {
      id: 2,
      company_id: 202,
      name: 'Cached-Only KB',
      updated_at: '2026-05-01T00:00:00Z',
      url: `${BASE_URL}/articles/2`,
    },
    { id: 3, company_id: 999, name: 'Orphan Article', updated_at: null, url: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUserRef.value = internalUser;

  hasPermissionMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduIntegrationMock.mockResolvedValue(integrationRow());
  getHuduCompanyMappingRowsMock.mockResolvedValue([
    {
      id: 'm-1',
      tenant: TENANT,
      integration_type: 'hudu',
      alga_entity_type: 'client',
      alga_entity_id: CLIENT_1,
      external_entity_id: '101',
      metadata: { hudu_company_name: 'ExampleCo' },
      client_name: 'Example Client',
    },
  ]);
  listAllArticlesMock.mockResolvedValue(articles());
});

describe('T240: company → client resolution', () => {
  it('resolves mapped, cached-unmapped and unknown companies (nulls mark the gaps)', async () => {
    const result = await listHuduArticlesAcrossCompanies();

    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.page).toBe(1);
    expect(result.fetchedAt).toEqual(expect.any(String));
    expect(result.articles).toEqual([
      {
        id: 1,
        name: 'Mapped Runbook',
        updated_at: '2026-06-01T00:00:00Z',
        url: `${BASE_URL}/articles/1`,
        company_id: 101,
        company_name: 'ExampleCo',
        client_id: CLIENT_1,
        client_name: 'Example Client',
      },
      {
        id: 2,
        name: 'Cached-Only KB',
        updated_at: '2026-05-01T00:00:00Z',
        url: `${BASE_URL}/articles/2`,
        company_id: 202,
        company_name: 'CachedCo',
        client_id: null,
        client_name: null,
      },
      {
        id: 3,
        name: 'Orphan Article',
        updated_at: null,
        url: null,
        company_id: 999,
        company_name: null,
        client_id: null,
        client_name: null,
      },
    ]);
    expect(getHuduCompanyMappingRowsMock).toHaveBeenCalledWith(knexCallableMock, TENANT);
  });
});

describe('T241: one Hudu page per call, search/page passthrough, hasMore heuristic', () => {
  it('forwards page + search to listAllArticles and calls it exactly once', async () => {
    await listHuduArticlesAcrossCompanies({ page: 3, search: 'wifi' });

    expect(createHuduClientMock).toHaveBeenCalledTimes(1);
    expect(createHuduClientMock).toHaveBeenCalledWith(TENANT);
    expect(listAllArticlesMock).toHaveBeenCalledTimes(1);
    expect(listAllArticlesMock).toHaveBeenCalledWith({ page: 3, search: 'wifi' });
  });

  it('defaults to page 1 with no search', async () => {
    const result = await listHuduArticlesAcrossCompanies();

    expect(listAllArticlesMock).toHaveBeenCalledTimes(1);
    expect(listAllArticlesMock).toHaveBeenCalledWith({ page: 1, search: undefined });
    expect(result).toMatchObject({ state: 'ok', page: 1 });
  });

  it('hasMore is true at a full 25-item page and false below', async () => {
    listAllArticlesMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({ id: i + 1, company_id: null, name: `A${i + 1}` }))
    );
    expect(await listHuduArticlesAcrossCompanies({ page: 2 })).toMatchObject({
      state: 'ok',
      page: 2,
      hasMore: true,
    });

    listAllArticlesMock.mockResolvedValue(articles());
    expect(await listHuduArticlesAcrossCompanies({ page: 2 })).toMatchObject({
      state: 'ok',
      hasMore: false,
    });
    // One Hudu page per invocation — never a fan-out (NFR2).
    expect(listAllArticlesMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces typed Hudu errors (incl. errorKind) instead of throwing', async () => {
    listAllArticlesMock.mockRejectedValue(
      new HuduRequestError({ kind: 'rate_limited', status: 429, message: 'Hudu rate limit exceeded (429).' })
    );

    expect(await listHuduArticlesAcrossCompanies()).toEqual({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
  });
});

describe('T242: guard chain + disconnected state', () => {
  it('rejects when unauthenticated (401 semantics)', async () => {
    currentUserRef.value = null;

    await expect(listHuduArticlesAcrossCompanies()).rejects.toThrow(/not authenticated/);
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('rejects client-portal users outright', async () => {
    currentUserRef.value = { ...internalUser, user_type: 'client' };

    await expect(listHuduArticlesAcrossCompanies()).rejects.toThrow(/^Forbidden$/);
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('rejects without client read permission (403 semantics)', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await expect(listHuduArticlesAcrossCompanies()).rejects.toThrow(
      /insufficient permissions \(read\)/
    );
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'client', 'read');
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('rejects when the integrations tier is missing', async () => {
    assertTierAccessMock.mockRejectedValue(new Error('Integrations tier required'));

    await expect(listHuduArticlesAcrossCompanies()).rejects.toThrow(/Integrations tier required/);
  });

  it('returns the typed disconnected state without any Hudu call when no active connection', async () => {
    getHuduIntegrationMock.mockResolvedValue(null);
    expect(await listHuduArticlesAcrossCompanies()).toEqual({ state: 'disconnected' });

    getHuduIntegrationMock.mockResolvedValue(integrationRow({ is_active: false }));
    expect(await listHuduArticlesAcrossCompanies()).toEqual({ state: 'disconnected' });

    expect(createHuduClientMock).not.toHaveBeenCalled();
    expect(listAllArticlesMock).not.toHaveBeenCalled();
  });
});
