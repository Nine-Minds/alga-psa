import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
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
  });

  it('T032: report results keep the two known shared contracts split into separate client-owned rows', async () => {
    const invoices = [
      { client_contract_id: 'cc-green-thumb', total_billed_ytd: 240000 },
      { client_contract_id: 'cc-btm-machinery', total_billed_ytd: 240000 },
      { client_contract_id: 'cc-worrynot-works', total_billed_ytd: 180000 },
      { client_contract_id: 'cc-benjamin-wolf-group', total_billed_ytd: 180000 },
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
      if (table === 'invoices') {
        return buildThenableQuery(invoices);
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
