import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IBillingCharge } from '@alga-psa/types';
import { BillingEngine } from '../../../../../packages/billing/src/lib/billing/billingEngine';

type Row = Record<string, any>;

function normalizeTableName(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumn(column: string): string {
  return column
    .replace(/^LOWER\(/i, '')
    .replace(/^DATE\(/i, '')
    .replace(/\)$/g, '')
    .replace(/^.*\./, '')
    .replace(/\s+as\s+.*$/i, '')
    .trim();
}

function applyOperator(rowValue: any, operator: string, expected: any) {
  switch (operator) {
    case '=':
      return rowValue === expected;
    case '>=':
      return String(rowValue) >= String(expected);
    case '<=':
      return String(rowValue) <= String(expected);
    default:
      throw new Error(`Unsupported operator ${operator}`);
  }
}

function createQueryBuilder(rows: Row[]) {
  let resultRows = [...rows];

  const builder: any = {
    join: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    select: vi.fn(() => builder),
    where: vi.fn((columnOrCriteria: string | Record<string, any>, operatorOrValue?: any, maybeValue?: any) => {
      if (typeof columnOrCriteria === 'object') {
        resultRows = resultRows.filter((row) =>
          Object.entries(columnOrCriteria).every(([column, expected]) =>
            row[normalizeColumn(column)] === expected,
          ),
        );
        return builder;
      }

      const column = normalizeColumn(columnOrCriteria);
      const operator = maybeValue === undefined ? '=' : operatorOrValue;
      const expected = maybeValue === undefined ? operatorOrValue : maybeValue;
      resultRows = resultRows.filter((row) => applyOperator(row[column], operator, expected));
      return builder;
    }),
    whereIn: vi.fn((column: string, values: any[]) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => values.includes(row[normalized]));
      return builder;
    }),
    whereNull: vi.fn(() => builder),
    whereNotNull: vi.fn(() => builder),
    whereRaw: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    count: vi.fn(() => {
      resultRows = [{ count: resultRows.length }];
      return builder;
    }),
    first: vi.fn(async () => resultRows[0]),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject),
  };

  return builder;
}

const mocks = vi.hoisted(() => {
  const rowsByTable: Record<string, Row[]> = {};
  const trx = vi.fn((tableName: string) => createQueryBuilder(rowsByTable[normalizeTableName(tableName)] ?? [])) as any;
  trx.raw = vi.fn((sql: string) => sql);

  return {
    rowsByTable,
    trx,
    createTenantKnex: vi.fn(async () => ({ knex: trx, tenant: 'tenant-1' })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) => callback(trx)),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'user-1',
          tenant: 'tenant-1',
        },
        { tenant: 'tenant-1' },
        ...args,
      ),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

const { getAvailableRecurringDueWork } = await import('../../../../../packages/billing/src/actions/billingAndTax');

describe('non-contract due-work reader', () => {
  const unresolvedSpy = vi.spyOn(BillingEngine.prototype, 'calculateUnresolvedNonContractChargesForExecutionWindow');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rowsByTable.client_billing_cycles = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: 'cycle-2025-03',
        billing_cycle: 'monthly',
        period_start_date: '2025-03-01',
        period_end_date: '2025-04-01',
        effective_date: '2025-03-01',
        invoice_id: null,
      },
    ];
    mocks.rowsByTable.clients = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        default_currency_code: 'USD',
      },
    ];
    mocks.rowsByTable.client_tax_settings = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        tax_source_override: 'internal',
      },
    ];
    mocks.rowsByTable.client_contracts = [];
    mocks.rowsByTable.recurring_service_periods = [];

    unresolvedSpy.mockResolvedValue([] as IBillingCharge[]);
  });

  it('T041: unresolved approved billable time appears as a non-contract candidate', async () => {
    unresolvedSpy.mockResolvedValueOnce([
      {
        type: 'time',
        serviceId: 'svc-time',
        serviceName: 'Emergency Support',
        userId: 'user-1',
        duration: 2,
        quantity: 2,
        rate: 15000,
        total: 30000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: null,
        entryId: 'te-1',
        is_taxable: true,
        servicePeriodStart: '2025-03-01',
        servicePeriodEnd: '2025-04-01',
        billingTiming: 'arrears',
      },
    ] as IBillingCharge[]);

    const result = await getAvailableRecurringDueWork({ page: 1, pageSize: 10 });

    expect(result.invoiceCandidates).toHaveLength(1);
    expect(result.invoiceCandidates[0]?.members[0]).toMatchObject({
      scheduleKey: 'schedule:tenant-1:non_contract:time:te-1',
      contractId: null,
      contractLineId: null,
    });
  });

  it('T042: unresolved approved billable usage appears as a non-contract candidate', async () => {
    unresolvedSpy.mockResolvedValueOnce([
      {
        type: 'usage',
        serviceId: 'svc-usage',
        serviceName: 'API Calls',
        quantity: 100,
        rate: 25,
        total: 2500,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: null,
        usageId: 'usage-1',
        is_taxable: true,
        servicePeriodStart: '2025-03-01',
        servicePeriodEnd: '2025-04-01',
        billingTiming: 'arrears',
      },
    ] as IBillingCharge[]);

    const result = await getAvailableRecurringDueWork({ page: 1, pageSize: 10 });

    expect(result.invoiceCandidates).toHaveLength(1);
    expect(result.invoiceCandidates[0]?.members[0]).toMatchObject({
      scheduleKey: 'schedule:tenant-1:non_contract:usage:usage-1',
      contractId: null,
      contractLineId: null,
    });
  });
});
