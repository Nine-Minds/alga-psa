import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const getActiveEntraPartnerConnectionMock = vi.fn();
const getEntraProviderAdapterMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/connectionRepository', () => ({
  getActiveEntraPartnerConnection: getActiveEntraPartnerConnectionMock,
}));

vi.mock('@ee/lib/integrations/entra/providers', () => ({
  getEntraProviderAdapter: getEntraProviderAdapterMock,
}));

type KnexHarness = {
  insertMock: ReturnType<typeof vi.fn>;
  onConflictMock: ReturnType<typeof vi.fn>;
  mergeMock: ReturnType<typeof vi.fn>;
  selectMock: ReturnType<typeof vi.fn>;
};

function createDiscoveryKnexHarness(persistedRows: Array<Record<string, unknown>>): KnexHarness {
  const mergeMock = vi.fn(async () => undefined);
  const onConflictMock = vi.fn(() => ({ merge: mergeMock }));
  const insertMock = vi.fn(() => ({ onConflict: onConflictMock }));
  const whereMock = vi.fn().mockReturnThis();
  const whereInMock = vi.fn().mockReturnThis();
  const orderByMock = vi.fn().mockReturnThis();
  const selectMock = vi.fn(async () => persistedRows);

  let callIndex = 0;
  const knexMock = vi.fn((_table: string) => {
    if (callIndex === 0) {
      callIndex += 1;
      return { insert: insertMock };
    }

    return {
      where: whereMock,
      whereIn: whereInMock,
      orderBy: orderByMock,
      select: selectMock,
    };
  }) as any;

  knexMock.fn = { now: vi.fn(() => 'db-now') };
  knexMock.raw = vi.fn((value: string) => `RAW(${value})`);
  createTenantKnexMock.mockResolvedValue({ knex: knexMock });

  return {
    insertMock,
    onConflictMock,
    mergeMock,
    selectMock,
  };
}

describe('discoverManagedTenantsForTenant upsert behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    getActiveEntraPartnerConnectionMock.mockReset();
    getEntraProviderAdapterMock.mockReset();

    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    getActiveEntraPartnerConnectionMock.mockResolvedValue({
      connection_type: 'direct',
    });
  });

  it('T052: inserts new managed tenants and updates existing rows idempotently', async () => {
    const provider = {
      listManagedTenants: vi.fn(async () => [
        {
          entraTenantId: 'entra-52',
          displayName: 'Acme 52',
          primaryDomain: 'acme52.example.com',
          sourceUserCount: 12,
          raw: { id: 'entra-52' },
        },
      ]),
    };
    getEntraProviderAdapterMock.mockReturnValue(provider);

    const harness = createDiscoveryKnexHarness([
      {
        tenant: 'tenant-52',
        managed_tenant_id: 'managed-52',
        entra_tenant_id: 'entra-52',
        display_name: 'Acme 52',
        primary_domain: 'acme52.example.com',
        source_user_count: 12,
        discovered_at: '2026-02-20T00:00:00.000Z',
        last_seen_at: '2026-02-20T00:00:00.000Z',
        metadata: { id: 'entra-52' },
        created_at: '2026-02-20T00:00:00.000Z',
        updated_at: '2026-02-20T00:00:00.000Z',
      },
    ]);

    const { discoverManagedTenantsForTenant } = await import('@ee/lib/integrations/entra/discoveryService');
    const result = await discoverManagedTenantsForTenant('tenant-52');

    expect(provider.listManagedTenants).toHaveBeenCalledWith({ tenant: 'tenant-52' });
    expect(harness.onConflictMock).toHaveBeenCalledWith(['tenant', 'entra_tenant_id']);
    expect(harness.mergeMock).toHaveBeenCalledTimes(1);
    expect(result.discoveredTenantCount).toBe(1);
    expect(result.discoveredTenants[0]).toMatchObject({
      managedTenantId: 'managed-52',
      entraTenantId: 'entra-52',
    });
  });

  it('T053: merges updated display name and primary domain values for discovered tenants', async () => {
    const provider = {
      listManagedTenants: vi.fn(async () => [
        {
          entraTenantId: 'entra-53',
          displayName: 'Renamed Tenant 53',
          primaryDomain: 'renamed53.example.com',
          sourceUserCount: 5,
          raw: { id: 'entra-53' },
        },
      ]),
    };
    getEntraProviderAdapterMock.mockReturnValue(provider);

    const harness = createDiscoveryKnexHarness([
      {
        tenant: 'tenant-53',
        managed_tenant_id: 'managed-53',
        entra_tenant_id: 'entra-53',
        display_name: 'Renamed Tenant 53',
        primary_domain: 'renamed53.example.com',
        source_user_count: 5,
        discovered_at: '2026-02-20T00:00:00.000Z',
        last_seen_at: '2026-02-20T00:00:00.000Z',
        metadata: { id: 'entra-53' },
        created_at: '2026-02-20T00:00:00.000Z',
        updated_at: '2026-02-20T00:00:00.000Z',
      },
    ]);

    const { discoverManagedTenantsForTenant } = await import('@ee/lib/integrations/entra/discoveryService');
    const result = await discoverManagedTenantsForTenant('tenant-53');

    const mergeArg = harness.mergeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(mergeArg.display_name).toBe('RAW(EXCLUDED.display_name)');
    expect(mergeArg.primary_domain).toBe('RAW(EXCLUDED.primary_domain)');
    expect(result.discoveredTenants[0]).toMatchObject({
      displayName: 'Renamed Tenant 53',
      primaryDomain: 'renamed53.example.com',
    });
  });

  it('T054: persists provider source user counts on insert and merge paths', async () => {
    const provider = {
      listManagedTenants: vi.fn(async () => [
        {
          entraTenantId: 'entra-54',
          displayName: 'Tenant 54',
          primaryDomain: 'tenant54.example.com',
          sourceUserCount: 33,
          raw: { id: 'entra-54' },
        },
      ]),
    };
    getEntraProviderAdapterMock.mockReturnValue(provider);

    const harness = createDiscoveryKnexHarness([
      {
        tenant: 'tenant-54',
        managed_tenant_id: 'managed-54',
        entra_tenant_id: 'entra-54',
        display_name: 'Tenant 54',
        primary_domain: 'tenant54.example.com',
        source_user_count: 33,
        discovered_at: '2026-02-20T00:00:00.000Z',
        last_seen_at: '2026-02-20T00:00:00.000Z',
        metadata: { id: 'entra-54' },
        created_at: '2026-02-20T00:00:00.000Z',
        updated_at: '2026-02-20T00:00:00.000Z',
      },
    ]);

    const { discoverManagedTenantsForTenant } = await import('@ee/lib/integrations/entra/discoveryService');
    await discoverManagedTenantsForTenant('tenant-54');

    const insertRows = harness.insertMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    const mergeArg = harness.mergeMock.mock.calls[0][0] as Record<string, unknown>;

    expect(insertRows[0].source_user_count).toBe(33);
    expect(mergeArg.source_user_count).toBe('RAW(EXCLUDED.source_user_count)');
  });
});
