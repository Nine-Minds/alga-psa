import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  builder.whereNotNull = vi.fn(() => builder);
  builder.join = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
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

function buildReportKnex(params: {
  revenueFacts: any[];
  assignments?: any[];
  contractLines?: any[];
}) {
  const assignments = params.assignments ?? [
    {
      client_contract_id: 'cc-1',
      client_id: 'client-1',
      is_active: true,
      start_date: '2025-01-01',
      end_date: null,
      contract_id: 'contract-1',
      contract_name: 'Managed Services',
      client_name: 'Acme Industries',
    },
  ];
  const contractLines = params.contractLines ?? [
    { contract_id: 'contract-1', custom_rate: 20000 },
  ];

  return vi.fn((table: string) => {
    if (table === 'invoice_charges as ic') {
      return buildThenableQuery(params.revenueFacts);
    }
    if (table === 'client_contracts as cc') {
      return buildThenableQuery(assignments);
    }
    if (table === 'contract_lines as cl') {
      return buildThenableQuery(contractLines);
    }
    throw new Error(`Unexpected table ${table}`);
  });
}

describe('contractReportActions recurring service-period basis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts YTD revenue by canonical recurring service period when detail rows exist and falls back to invoice date otherwise', async () => {
    const revenueFacts = [
      {
        item_id: 'charge-december-service',
        client_contract_id: 'cc-1',
        invoice_date: '2025-01-05',
        net_amount: 10000,
        item_detail_id: 'detail-december-service',
        service_period_end: '2024-12-31',
        allocated_amount: null,
      },
      {
        item_id: 'charge-january-service',
        client_contract_id: 'cc-1',
        invoice_date: '2025-02-01',
        net_amount: 12000,
        item_detail_id: 'detail-january-service',
        service_period_end: '2025-01-31',
        allocated_amount: null,
      },
      {
        item_id: 'charge-manual-fallback',
        client_contract_id: 'cc-1',
        invoice_date: '2025-03-01',
        net_amount: 5000,
        item_detail_id: null,
        service_period_end: null,
        allocated_amount: null,
      },
      {
        item_id: 'charge-advance-annual',
        client_contract_id: 'cc-1',
        invoice_date: '2024-12-20',
        net_amount: 30000,
        item_detail_id: 'detail-advance-annual',
        service_period_end: '2025-12-31',
        allocated_amount: null,
      },
    ];
    const assignments = [
      {
        client_contract_id: 'cc-1',
        client_id: 'client-1',
        is_active: true,
        start_date: '2025-01-01',
        end_date: null,
        contract_id: 'contract-1',
        contract_name: 'Managed Services',
        client_name: 'Acme Industries',
      },
    ];
    const contractLines = [
      { contract_id: 'contract-1', custom_rate: 20000 },
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

    createTenantKnex.mockResolvedValue({ knex });

    const { getContractRevenueReport } = await import('@alga-psa/billing/actions/contractReportActions');
    const [row] = await getContractRevenueReport();

    expect(row).toMatchObject({
      contract_name: 'Managed Services',
      client_name: 'Acme Industries',
      monthly_recurring: 20000,
      total_billed_ytd: 47000,
      status: 'active',
    });
  });

  it('T269: client-cadence report output stays parity-stable when recurring revenue facts move from invoice-date fallback to canonical detail periods', async () => {
    const legacyFacts = [
      {
        item_id: 'charge-january-service',
        client_contract_id: 'cc-1',
        invoice_date: '2025-02-01',
        net_amount: 12000,
        item_detail_id: null,
        service_period_end: null,
        allocated_amount: null,
      },
    ];
    const canonicalFacts = [
      {
        item_id: 'charge-january-service',
        client_contract_id: 'cc-1',
        invoice_date: '2025-02-01',
        net_amount: 12000,
        item_detail_id: 'detail-january-service',
        service_period_end: '2025-01-31',
        allocated_amount: null,
      },
    ];

    createTenantKnex.mockResolvedValueOnce({ knex: buildReportKnex({ revenueFacts: legacyFacts }) });
    const { getContractRevenueReport } = await import('@alga-psa/billing/actions/contractReportActions');
    const legacyOutput = await getContractRevenueReport();

    createTenantKnex.mockResolvedValueOnce({ knex: buildReportKnex({ revenueFacts: canonicalFacts }) });
    const canonicalOutput = await getContractRevenueReport();

    expect(canonicalOutput).toEqual(legacyOutput);
    expect(canonicalOutput).toEqual([
      {
        contract_name: 'Managed Services',
        client_name: 'Acme Industries',
        monthly_recurring: 20000,
        total_billed_ytd: 12000,
        status: 'active',
      },
    ]);
  });
});
