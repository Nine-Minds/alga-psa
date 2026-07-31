import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTenantScope } from '../utils/tenantScopedBuilderDouble';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const getEntraProviderAdapterMock = vi.fn();
const getActiveEntraPartnerConnectionMock = vi.fn();
const filterEntraUsersForTenantMock = vi.fn();
const executeEntraSyncMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/providers', () => ({
  getEntraProviderAdapter: getEntraProviderAdapterMock,
}));

vi.mock('@ee/lib/integrations/entra/connectionRepository', () => ({
  getActiveEntraPartnerConnection: getActiveEntraPartnerConnectionMock,
}));

vi.mock('@ee/lib/integrations/entra/settingsService', () => ({
  filterEntraUsersForTenant: filterEntraUsersForTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/syncEngine', () => ({
  executeEntraSync: executeEntraSyncMock,
}));

function buildKnexDouble() {
  const insertMock = vi.fn(async () => [1]);
  const mappingRow = {
    managed_tenant_id: 'managed-1',
    client_id: 'client-1',
    entra_tenant_id: 'entra-1',
  };

  // tenantDb.tenantJoin calls builder.join under the hood; the double only has
  // to stay chainable for the query the service builds.
  const mappingQuery: Record<string, any> = {
    select: vi.fn(),
    andWhere: vi.fn(),
    orderByRaw: vi.fn(),
    join: vi.fn(),
    first: vi.fn(async () => mappingRow),
  };
  mappingQuery.select.mockReturnValue(mappingQuery);
  mappingQuery.andWhere.mockReturnValue(mappingQuery);
  mappingQuery.orderByRaw.mockReturnValue(mappingQuery);
  mappingQuery.join.mockReturnValue(mappingQuery);

  const knexMock = vi.fn((table: string) => {
    if (table.startsWith('entra_client_tenant_mappings')) {
      return withTenantScope({ where: vi.fn(() => mappingQuery) });
    }
    if (table === 'entra_sync_settings') {
      return withTenantScope({ first: vi.fn(async () => ({ field_sync_config: { email: true } })) });
    }
    if (table === 'entra_sync_runs') {
      return withTenantScope({ insert: insertMock });
    }
    throw new Error(`Unexpected table ${table}`);
  }) as any;

  knexMock.fn = { now: vi.fn(() => 'db-now') };
  knexMock.raw = vi.fn((sql: string, args: unknown[]) => ({ sql, args }));

  return { knexMock, insertMock, mappingQuery };
}

describe('runEntraPreflight', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    getEntraProviderAdapterMock.mockReset();
    getActiveEntraPartnerConnectionMock.mockReset();
    filterEntraUsersForTenantMock.mockReset();
    executeEntraSyncMock.mockReset();

    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    getActiveEntraPartnerConnectionMock.mockResolvedValue({ connection_type: 'direct' });
  });

  it('previews through the real engine with writes disabled, and records the preview as a dry run', async () => {
    const { knexMock, insertMock } = buildKnexDouble();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const listUsersForTenant = vi.fn(async () => [{ entraObjectId: 'o1' }]);
    getEntraProviderAdapterMock.mockReturnValue({ listUsersForTenant });
    filterEntraUsersForTenantMock.mockResolvedValue({
      included: [{ entraObjectId: 'o1' }],
      excluded: [
        {
          reason: 'account_disabled',
          user: {
            entraTenantId: 'entra-1',
            entraObjectId: 'o2',
            displayName: 'Disabled User',
            email: 'disabled@contoso.com',
            userPrincipalName: 'disabled@contoso.com',
          },
        },
        { reason: 'excluded_pattern', user: { entraTenantId: 'entra-1', entraObjectId: 'o3' } },
      ],
    });
    executeEntraSyncMock.mockResolvedValue({
      dryRun: true,
      counters: { created: 1, linked: 0, updated: 0, ambiguous: 0, inactivated: 1 },
      preview: [
        { bucket: 'create', entraObjectId: 'o1', displayName: 'New User', email: null, userPrincipalName: null },
        { bucket: 'mark_inactive', entraObjectId: 'o2', displayName: 'Disabled User', email: null, userPrincipalName: null },
      ],
    });

    const { runEntraPreflight } = await import('@ee/lib/integrations/entra/sync/preflightService');
    const result = await runEntraPreflight({
      tenantId: 'tenant-1',
      managedTenantId: 'managed-1',
      userId: 'user-1',
    });

    // The preview runs the real reconciliation with the flag on, rather than a
    // parallel implementation that could drift from it.
    expect(executeEntraSyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        clientId: 'client-1',
        dryRun: true,
        fieldSyncConfig: { email: true },
        disabledIdentities: [
          expect.objectContaining({ entraObjectId: 'o2', displayName: 'Disabled User' }),
        ],
      })
    );

    // Only the audit row is written, and it is marked as a preview so nothing
    // downstream mistakes it for a sync.
    expect(insertMock).toHaveBeenCalledTimes(1);
    const runRow = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(runRow).toMatchObject({
      tenant: 'tenant-1',
      run_type: 'preflight',
      status: 'completed',
      is_dry_run: true,
      scope_managed_tenant_id: 'managed-1',
      scope_client_id: 'client-1',
      initiated_by: 'user-1',
    });

    expect(result.totalIdentities).toBe(2);
    expect(result.counters.inactivated).toBe(1);
    const createBucket = result.buckets.find((bucket) => bucket.bucket === 'create');
    expect(createBucket?.count).toBe(1);
    expect(result.buckets.map((bucket) => bucket.bucket)).toEqual([
      'create',
      'link',
      'needs_decision',
      'no_change',
      'mark_inactive',
    ]);
  });

  it('refuses a scope that matches no confirmed mapping instead of previewing everything', async () => {
    const { knexMock, mappingQuery } = buildKnexDouble();
    mappingQuery.first.mockResolvedValue(undefined);
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { runEntraPreflight } = await import('@ee/lib/integrations/entra/sync/preflightService');

    await expect(
      runEntraPreflight({ tenantId: 'tenant-1', managedTenantId: 'missing' })
    ).rejects.toThrow('No confirmed mapping matches the requested preflight scope.');
    expect(executeEntraSyncMock).not.toHaveBeenCalled();
  });
});
