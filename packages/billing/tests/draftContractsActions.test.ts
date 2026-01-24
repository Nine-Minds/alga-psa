import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentTenant = 'tenant-1';

const mockKnexFactory = () => {
  const calls: {
    where: any[][];
    andWhere: any[][];
    select: any[][];
    orderBy: any[][];
  } = { where: [], andWhere: [], select: [], orderBy: [] };

  const builder: any = {};
  builder.leftJoin = vi.fn(() => builder);
  builder.where = vi.fn((...args: any[]) => {
    calls.where.push(args);
    return builder;
  });
  builder.andWhere = vi.fn((...args: any[]) => {
    calls.andWhere.push(args);
    if (typeof args[0] === 'function') {
      const callback = args[0];
      const whereBuilder = {
        whereNull: vi.fn(() => whereBuilder),
        orWhere: vi.fn(() => whereBuilder),
      };
      callback(whereBuilder);
    }
    return builder;
  });
  builder.select = vi.fn((...args: any[]) => {
    calls.select.push(args);
    return builder;
  });
  builder.orderBy = vi.fn((...args: any[]) => {
    calls.orderBy.push(args);
    return Promise.resolve([]);
  });

  const knex: any = vi.fn(() => builder);

  return { knex, calls };
};

const createTenantKnex = vi.fn();
vi.mock('@alga-psa/db', () => ({ createTenantKnex: (...args: any[]) => createTenantKnex(...args) }));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ id: 'user-1' }, { tenant: currentTenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

describe('getDraftContracts action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTenant = 'tenant-1';
  });

  it('filters by status=draft', async () => {
    const { knex, calls } = mockKnexFactory();
    createTenantKnex.mockResolvedValue({ knex });

    const { getDraftContracts } = await import('../src/actions/contractActions');
    await getDraftContracts();

    expect(calls.andWhere.some((args) => args[0] === 'co.status' && args[1] === 'draft')).toBe(true);
  });

  it('filters by tenant', async () => {
    const { knex, calls } = mockKnexFactory();
    createTenantKnex.mockResolvedValue({ knex });

    const { getDraftContracts } = await import('../src/actions/contractActions');
    await getDraftContracts();

    expect(calls.where.some((args) => args[0]?.['co.tenant'] === 'tenant-1')).toBe(true);
  });

  it('returns empty array when no drafts exist', async () => {
    const { knex } = mockKnexFactory();
    createTenantKnex.mockResolvedValue({ knex });

    const { getDraftContracts } = await import('../src/actions/contractActions');
    const result = await getDraftContracts();

    expect(result).toEqual([]);
  });

  it('select includes client_name', async () => {
    const { knex, calls } = mockKnexFactory();
    createTenantKnex.mockResolvedValue({ knex });

    const { getDraftContracts } = await import('../src/actions/contractActions');
    await getDraftContracts();

    const flatSelectArgs = calls.select.flat();
    expect(flatSelectArgs).toContain('c.client_name');
  });

  it('orders by updated_at descending', async () => {
    const { knex, calls } = mockKnexFactory();
    createTenantKnex.mockResolvedValue({ knex });

    const { getDraftContracts } = await import('../src/actions/contractActions');
    await getDraftContracts();

    expect(calls.orderBy.some((args) => args[0] === 'co.updated_at' && args[1] === 'desc')).toBe(true);
  });

  it("user from different tenant cannot see other tenant's drafts (T062)", async () => {
    currentTenant = 'tenant-2';

    const { knex, calls } = mockKnexFactory();
    createTenantKnex.mockResolvedValue({ knex });

    const { getDraftContracts } = await import('../src/actions/contractActions');
    await getDraftContracts();

    expect(calls.where.some((args) => args[0]?.['co.tenant'] === 'tenant-2')).toBe(true);
    expect(calls.where.some((args) => args[0]?.['co.tenant'] === 'tenant-1')).toBe(false);
  });
});
