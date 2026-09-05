import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
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

function buildThenableQuery(result: any) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.whereNotIn = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.whereRaw = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.join = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.countDistinct = vi.fn(() => builder);
  builder.first = vi.fn(() => builder);
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

describe('contractReportActions summary service-period basis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses canonical recurring service periods for YTD totals and decision due dates for at-risk summary counts', async () => {
    const revenueFacts = [
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
        currency_code: 'USD',
      },
    ];
    const contractLines = [
      {
        contract_line_id: 'line-1',
        contract_id: 'contract-1',
        contract_line_type: 'Fixed',
        billing_frequency: 'monthly',
        custom_rate: 20000,
      },
    ];

    // client_contracts is scanned four times: revenue assignments, canonical
    // valuation assignments, YTD currency resolution, then the at-risk count.
    let clientContractsCallCount = 0;
    const knex: any = vi.fn((table: string) => {
      if (table === 'invoice_charges as ic') {
        return buildThenableQuery(revenueFacts);
      }
      if (table === 'client_contracts as cc') {
        clientContractsCallCount += 1;
        if (clientContractsCallCount <= 3) {
          return buildThenableQuery(assignments);
        }
        return buildThenableQuery({ count: '2' });
      }
      if (table === 'contract_lines as cln') {
        return buildThenableQuery(contractLines);
      }
      if (table === 'contract_line_service_configuration as clsc') {
        return buildThenableQuery([]);
      }
      if (table === 'contract_line_unit_pricing_revisions as rev') {
        return buildThenableQuery([]);
      }
      if (table === 'contract_line_service_configuration') return buildThenableQuery([]);
      throw new Error(`Unexpected table ${table}`);
    });

    createTenantKnex.mockResolvedValue({ knex });

    const { getContractReportSummary } = await import('@alga-psa/billing/actions/contractReportActions');
    const summary = await getContractReportSummary();

    expect(summary).toEqual({
      fixedMrrByCurrency: [{ currencyCode: 'USD', totalCents: 20000 }],
      ytdRevenueByCurrency: [{ currencyCode: 'USD', totalCents: 17000 }],
      activeContractCount: 1,
      atRiskDecisionCount: 2,
      variableUsageContractCount: 0,
    });
  });
});
