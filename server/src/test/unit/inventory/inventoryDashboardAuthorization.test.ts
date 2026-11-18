import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { OverdueAdvanceVendorReturn } from '@alga-psa/inventory/lib/dashboardQueries';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  createTenantKnex: vi.fn(),
  queryReturns: vi.fn(),
  filterReadableAssets: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (user: { user_id: string; tenant: string }, ctx: { tenant: string }) => unknown) =>
    () => fn({ user_id: 'user', tenant: 'tenant' }, { tenant: 'tenant' }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: (db: Knex, fn: (trx: Knex) => unknown) => fn(db),
  resolveEffectiveTimeZone: async () => 'UTC',
}));
vi.mock('@alga-psa/assets/lib/assetReadAuthorization', () => ({
  createAssetReadContext: async () => ({}),
  filterReadableAssets: mocks.filterReadableAssets,
}));
vi.mock('@alga-psa/inventory/lib/tenantCurrency', () => ({ resolveTenantCurrency: async () => 'EUR' }));
vi.mock('@alga-psa/inventory/lib/dashboardQueries', () => ({
  queryOverdueAdvanceVendorReturns: mocks.queryReturns,
  queryGhostWeek: async () => ({ count: 0, est_total: null, techs: [] }),
  queryUnbilled: async () => ({ total: 0, from_stock: { rows: [] }, dropship: { so_count: 0, amount: 0 }, ghost: { count: 0, amount: null } }),
  queryPriceCreep: async () => null,
  queryRmaReceivables: async () => ({ rows: [] }),
  queryDeployments: async () => [],
  queryPipeline: async () => ({}),
  queryDeadStock: async () => null,
  queryValueWowDeltaByCurrency: async () => [],
  totalMoneyByCurrency: () => 0,
  queryOverdueLoaners: async () => [],
  queryCountApprovals: async () => [],
  queryBillCreep: async () => [],
  queryWarrantyExpiring: async () => ({ count: 0, clients: [] }),
  queryVanContext: async () => new Map(),
}));

import { getInventoryDashboardData } from '@alga-psa/inventory/actions/inventoryDashboardActions';

// Other dashboard sources have no rows; only the vendor returns under test contribute attention.
function emptyDashboardDb(): Knex {
  const query: Record<string, unknown> = {
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    first: async () => undefined,
  };
  for (const method of ['where', 'andWhere', 'whereIn', 'whereNotNull', 'whereRaw', 'andWhereRaw', 'join', 'leftJoin', 'joinRaw', 'groupBy', 'orderBy', 'orderByRaw', 'select', 'count', 'sum']) {
    query[method] = () => query;
  }
  return Object.assign(() => query, { raw: () => ({}) }) as unknown as Knex;
}

const returns: OverdueAdvanceVendorReturn[] = [
  {
    rma_id: 'hidden', rma_number: 'RMA-HIDDEN', rma_reference: 'PRIVATE-VENDOR-REF',
    asset_id: 'restricted-asset', client_id: 'restricted-client',
    return_by: '2026-11-01', overdue_days: 4, days_until_due: -4,
  },
  {
    rma_id: 'visible', rma_number: 'RMA-VISIBLE', rma_reference: null,
    asset_id: 'readable-asset', client_id: 'readable-client',
    return_by: '2026-11-07', overdue_days: 0, days_until_due: 2,
  },
];

describe('inventory dashboard vendor-return authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.createTenantKnex.mockResolvedValue({ knex: emptyDashboardDb() });
    mocks.queryReturns.mockResolvedValue(returns);
    mocks.filterReadableAssets.mockImplementation(async (_trx, _tenant, _ctx, assets) =>
      assets.filter((asset: { asset_id: string }) => asset.asset_id === 'readable-asset'));
  });

  it('omits unreadable returns from attention and urgent counts while retaining readable returns', async () => {
    const result = await getInventoryDashboardData();

    expect(result.attention).toEqual([
      expect.objectContaining({
        id: 'rma-vendor-return-visible', name: 'RMA-VISIBLE', band: 'amber',
        action: { key: 'view', href: '/msp/inventory/rma?rmaId=visible' },
      }),
    ]);
    expect(result.header).toMatchObject({ attention_count: 1, urgent_count: 0 });
  });

  it('returns no vendor-return attention or counts when all assets are unreadable', async () => {
    mocks.filterReadableAssets.mockResolvedValue([]);

    const result = await getInventoryDashboardData();

    expect(result.attention).toEqual([]);
    expect(result.header).toMatchObject({ attention_count: 0, urgent_count: 0 });
  });

  it('refuses the dashboard before reading data when inventory read is denied', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    expect(await getInventoryDashboardData()).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.queryReturns).not.toHaveBeenCalled();
  });
});
