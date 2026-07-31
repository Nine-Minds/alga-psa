import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    scoped: (t: string) => conn(t),
    subquery: (t: string) => conn(t),
    parentScopedTable: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
    tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
    tenantWhereColumn: (q: any) => q,
  }),
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

function buildThenableQuery(result: any[]) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.whereNotIn = vi.fn(() => builder);
  builder.whereRaw = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.join = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.groupBy = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.andWhere = vi.fn((arg: any) => {
    if (typeof arg === 'function') {
      const callbackBuilder = {
        whereNull: vi.fn(() => callbackBuilder),
        orWhere: vi.fn(() => callbackBuilder),
      };
      arg(callbackBuilder);
    }
    return builder;
  });
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  builder.catch = (onRejected: any) => Promise.resolve(result).catch(onRejected);
  builder.finally = (handler: any) => Promise.resolve(result).finally(handler);
  return builder;
}

describe('contractReportActions shared contract results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T032: report results keep the two known shared contracts split into separate client-owned rows', async () => {
    // Revenue facts without canonical detail periods fall back to invoice-date YTD attribution.
    const revenueFacts = [
      {
        item_id: 'charge-green-thumb',
        client_contract_id: 'cc-green-thumb',
        invoice_date: '2025-03-01',
        net_amount: 240000,
        item_detail_id: null,
        service_period_end: null,
        allocated_amount: null,
      },
      {
        item_id: 'charge-btm-machinery',
        client_contract_id: 'cc-btm-machinery',
        invoice_date: '2025-03-01',
        net_amount: 240000,
        item_detail_id: null,
        service_period_end: null,
        allocated_amount: null,
      },
      {
        item_id: 'charge-worrynot-works',
        client_contract_id: 'cc-worrynot-works',
        invoice_date: '2025-03-01',
        net_amount: 180000,
        item_detail_id: null,
        service_period_end: null,
        allocated_amount: null,
      },
      {
        item_id: 'charge-benjamin-wolf-group',
        client_contract_id: 'cc-benjamin-wolf-group',
        invoice_date: '2025-03-01',
        net_amount: 180000,
        item_detail_id: null,
        service_period_end: null,
        allocated_amount: null,
      },
    ];
    const assignments = [
      {
        client_contract_id: 'cc-green-thumb',
        client_id: 'client-green-thumb',
        is_active: true,
        start_date: '2025-01-01',
        end_date: null,
        contract_id: 'contract-managed-it-services',
        contract_name: 'Managed IT Services',
        client_name: 'The Green Thumb',
      },
      {
        client_contract_id: 'cc-btm-machinery',
        client_id: 'client-btm-machinery',
        is_active: true,
        start_date: '2025-02-01',
        end_date: null,
        contract_id: 'contract-managed-it-services-clone',
        contract_name: 'Managed IT Services',
        client_name: 'BTM Machinery',
      },
      {
        client_contract_id: 'cc-worrynot-works',
        client_id: 'client-worrynot-works',
        is_active: true,
        start_date: '2025-01-15',
        end_date: null,
        contract_id: 'contract-worry-free-essentials',
        contract_name: 'Worry-Free Essentials',
        client_name: 'WorryNot Works IT Services',
      },
      {
        client_contract_id: 'cc-benjamin-wolf-group',
        client_id: 'client-benjamin-wolf-group',
        is_active: true,
        start_date: '2025-02-15',
        end_date: null,
        contract_id: 'contract-worry-free-essentials-clone',
        contract_name: 'Worry-Free Essentials',
        client_name: 'The Benjamin Wolf Group',
      },
    ];
    const contractLines = [
      { contract_id: 'contract-managed-it-services', custom_rate: 20000 },
      { contract_id: 'contract-managed-it-services-clone', custom_rate: 20000 },
      { contract_id: 'contract-worry-free-essentials', custom_rate: 15000 },
      { contract_id: 'contract-worry-free-essentials-clone', custom_rate: 15000 },
    ];

    const knex: any = vi.fn((table: string) => {
      if (table === 'invoice_charges as ic') {
        return buildThenableQuery(revenueFacts);
      }
      if (table === 'client_contracts as cc') {
        return buildThenableQuery(assignments);
      }
      if (table === 'contract_lines as cl') {
        return buildThenableQuery(contractLines);
      }
      throw new Error(`Unexpected table ${table}`);
    });
    knex.raw = vi.fn((sql: string) => sql);

    createTenantKnex.mockResolvedValue({ knex });

    const { getContractRevenueReport } = await import('@alga-psa/billing/actions/contractReportActions');
    const result = await getContractRevenueReport();

    expect(result).toHaveLength(4);
    expect(
      result
        .filter((row) => row.contract_name === 'Managed IT Services')
        .map((row) => row.client_name)
        .sort()
    ).toEqual(['BTM Machinery', 'The Green Thumb']);
    expect(
      result
        .filter((row) => row.contract_name === 'Worry-Free Essentials')
        .map((row) => row.client_name)
        .sort()
    ).toEqual(['The Benjamin Wolf Group', 'WorryNot Works IT Services']);
    expect(result.find((row) => row.client_name === 'BTM Machinery')).toMatchObject({
      contract_name: 'Managed IT Services',
      monthly_recurring: 20000,
      total_billed_ytd: 240000,
      status: 'active',
    });
    expect(result.find((row) => row.client_name === 'The Benjamin Wolf Group')).toMatchObject({
      contract_name: 'Worry-Free Essentials',
      monthly_recurring: 15000,
      total_billed_ytd: 180000,
      status: 'active',
    });
  });
});
