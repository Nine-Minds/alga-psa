import { beforeEach, describe, expect, it, vi } from 'vitest';

const countQuery = vi.hoisted(() => ({
  rows: [] as Array<{ preset_id: string; count: string | number }>,
  calls: 0,
  tables: [] as string[],
}));

const trx: any = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: trx })),
  withTransaction: async (_knex: unknown, fn: any) => fn(trx),
  requireTenantId: vi.fn(async () => 'tenant-1'),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('../src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(async () => ({
    analytics: { capture: vi.fn() },
    AnalyticsEvents: {},
  })),
}));

beforeEach(() => {
  countQuery.rows = [];
  countQuery.calls = 0;
  countQuery.tables = [];

  trx.mockImplementation((table: string) => {
    countQuery.tables.push(table);
    const query: any = {};
    query.where = vi.fn(() => query);
    query.groupBy = vi.fn(() => query);
    query.select = vi.fn(() => query);
    query.count = vi.fn(async () => {
      countQuery.calls += 1;
      return countQuery.rows;
    });
    return query;
  });
});

describe('contract line preset service counts', () => {
  it('returns per-preset counts for every preset in a single query', async () => {
    countQuery.rows = [
      { preset_id: 'preset-1', count: '3' },
      { preset_id: 'preset-2', count: 1 },
    ];

    const { getContractLinePresetServiceCounts } = await import('../src/actions/contractLinePresetActions');

    const counts = await getContractLinePresetServiceCounts();

    expect(counts).toEqual({ 'preset-1': 3, 'preset-2': 1 });
    expect(countQuery.calls).toBe(1);
    expect(countQuery.tables).toEqual(['contract_line_preset_services']);
  });

  it('returns an empty map when no preset has services', async () => {
    const { getContractLinePresetServiceCounts } = await import('../src/actions/contractLinePresetActions');

    await expect(getContractLinePresetServiceCounts()).resolves.toEqual({});
    expect(countQuery.calls).toBe(1);
  });

  it('denies the batched read without billing read permission', async () => {
    const { hasPermission } = await import('@alga-psa/auth/rbac');
    vi.mocked(hasPermission).mockResolvedValueOnce(false as any);

    const { getContractLinePresetServiceCounts } = await import('../src/actions/contractLinePresetActions');

    const result = await getContractLinePresetServiceCounts();

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(countQuery.calls).toBe(0);
  });
});
