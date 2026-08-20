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
    case '>':
      return String(rowValue) > String(expected);
    case '<':
      return String(rowValue) < String(expected);
    case '<>':
      return rowValue !== expected;
    default:
      throw new Error(`Unsupported operator ${operator}`);
  }
}

function buildPredicate(
  columnOrCriteria: string | Record<string, any>,
  operatorOrValue?: any,
  maybeValue?: any,
) {
  if (typeof columnOrCriteria === 'object') {
    return (row: Row) =>
      Object.entries(columnOrCriteria).every(([column, expected]) =>
        row[normalizeColumn(column)] === expected,
      );
  }

  const column = normalizeColumn(columnOrCriteria);
  const operator = maybeValue === undefined ? '=' : operatorOrValue;
  const expected = maybeValue === undefined ? operatorOrValue : maybeValue;
  return (row: Row) => applyOperator(row[column], operator, expected);
}

function createQueryBuilder(rows: Row[]) {
  let resultRows = [...rows];

  const builder: any = {
    join: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    select: vi.fn(() => builder),
    where: vi.fn((columnOrCriteria: string | Record<string, any> | ((this: any, qb?: any) => void), operatorOrValue?: any, maybeValue?: any) => {
      if (typeof columnOrCriteria === 'function') {
        const clauses: Array<{ type: 'and' | 'or'; predicate: (row: Row) => boolean }> = [];
        const addComparison = (
          type: 'and' | 'or',
          nestedColumnOrCriteria: string | Record<string, any>,
          nestedOperatorOrValue?: any,
          nestedMaybeValue?: any,
        ) => {
          clauses.push({
            type,
            predicate: buildPredicate(
              nestedColumnOrCriteria,
              nestedOperatorOrValue,
              nestedMaybeValue,
            ),
          });
          return subBuilder;
        };
        const addNullCheck = (type: 'and' | 'or', column: string, expectNull: boolean) => {
          const normalized = normalizeColumn(column);
          clauses.push({
            type,
            predicate: (row: Row) => expectNull ? row[normalized] == null : row[normalized] != null,
          });
          return subBuilder;
        };
        const addInCheck = (type: 'and' | 'or', column: string, values: any[]) => {
          const normalized = normalizeColumn(column);
          clauses.push({
            type,
            predicate: (row: Row) => values.includes(row[normalized]),
          });
          return subBuilder;
        };
        const subBuilder: any = {
          where: (
            nestedColumnOrCriteria: string | Record<string, any>,
            nestedOperatorOrValue?: any,
            nestedMaybeValue?: any,
          ) => addComparison(
            'and',
            nestedColumnOrCriteria,
            nestedOperatorOrValue,
            nestedMaybeValue,
          ),
          orWhere: (
            nestedColumnOrCriteria: string | Record<string, any>,
            nestedOperatorOrValue?: any,
            nestedMaybeValue?: any,
          ) => addComparison(
            'or',
            nestedColumnOrCriteria,
            nestedOperatorOrValue,
            nestedMaybeValue,
          ),
          whereNull: (column: string) => addNullCheck('and', column, true),
          orWhereNull: (column: string) => addNullCheck('or', column, true),
          whereNotNull: (column: string) => addNullCheck('and', column, false),
          orWhereNotNull: (column: string) => addNullCheck('or', column, false),
          whereIn: (column: string, values: any[]) => addInCheck('and', column, values),
          orWhereIn: (column: string, values: any[]) => addInCheck('or', column, values),
        };
        columnOrCriteria.call(subBuilder, subBuilder);
        resultRows = resultRows.filter((row) =>
          clauses.reduce((matches, clause, index) => {
            const clauseMatches = clause.predicate(row);
            if (index === 0) return clauseMatches;
            return clause.type === 'or' ? matches || clauseMatches : matches && clauseMatches;
          }, clauses.length === 0),
        );
        return builder;
      }

      const predicate = buildPredicate(columnOrCriteria, operatorOrValue, maybeValue);
      resultRows = resultRows.filter((row) => predicate(row));
      return builder;
    }),
    whereIn: vi.fn((column: string, values: any[]) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => values.includes(row[normalized]));
      return builder;
    }),
    whereNull: vi.fn((column: string) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] == null);
      return builder;
    }),
    whereNotNull: vi.fn((column: string) => {
      const normalized = normalizeColumn(column);
      resultRows = resultRows.filter((row) => row[normalized] != null);
      return builder;
    }),
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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

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
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
  getTenantContext: vi.fn(async () => 'tenant-1'),
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
    mocks.rowsByTable.time_entries = [];
    mocks.rowsByTable.usage_tracking = [];

    unresolvedSpy.mockResolvedValue([] as IBillingCharge[]);
  });

  it('T041: unresolved approved billable time appears as a non-contract candidate', async () => {
    mocks.rowsByTable.time_entries = [{
      tenant: 'tenant-1',
      entry_id: 'te-1',
      start_time: '2025-03-15T14:00:00.000Z',
      end_time: '2025-03-15T16:00:00.000Z',
      invoiced: false,
      contract_line_id: null,
      service_id: 'svc-time',
      approval_status: 'APPROVED',
      billable_duration: 120,
      project_client_id: 'client-1',
      ticket_client_id: null,
    }];
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
    expect(result.invoiceCandidates[0]).toMatchObject({
      canGenerate: true,
      hasApprovalBlockers: false,
      approvalBlockedEntryCount: 0,
    });
    expect(result.invoiceCandidates[0]?.members[0]).toMatchObject({
      scheduleKey: 'schedule:tenant-1:unresolved:time:te-1',
      contractId: null,
      contractLineId: null,
      canGenerate: true,
      approvalBlockedEntryCount: 0,
    });
  });

  it('T042: unresolved approved billable usage appears as a non-contract candidate', async () => {
    mocks.rowsByTable.usage_tracking = [{
      tenant: 'tenant-1',
      usage_id: 'usage-1',
      client_id: 'client-1',
      usage_date: '2025-03-15T14:00:00.000Z',
      invoiced: false,
      contract_line_id: null,
      service_id: 'svc-usage',
    }];
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
    expect(result.invoiceCandidates[0]).toMatchObject({
      canGenerate: true,
      hasApprovalBlockers: false,
      approvalBlockedEntryCount: 0,
    });
    expect(result.invoiceCandidates[0]?.members[0]).toMatchObject({
      scheduleKey: 'schedule:tenant-1:unresolved:usage:usage-1',
      contractId: null,
      contractLineId: null,
    });
  });

  it('T043: skips billing-engine hydration for open periods with no unresolved sources', async () => {
    mocks.rowsByTable.client_billing_cycles = Array.from({ length: 100 }, (_, index) => ({
      tenant: 'tenant-1',
      client_id: 'client-1',
      client_name: 'Acme Co',
      billing_cycle_id: `cycle-${index}`,
      billing_cycle: 'monthly',
      period_start_date: `2025-${String((index % 9) + 1).padStart(2, '0')}-01`,
      period_end_date: `2025-${String((index % 9) + 2).padStart(2, '0')}-01`,
      effective_date: '2025-01-01',
      invoice_id: null,
    }));

    await getAvailableRecurringDueWork({ page: 1, pageSize: 10 });

    expect(unresolvedSpy).not.toHaveBeenCalled();
  });

  it('T044: hydrates only the billing window containing a potential unresolved source', async () => {
    mocks.rowsByTable.client_billing_cycles = [
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: 'cycle-january',
        billing_cycle: 'monthly',
        period_start_date: '2025-01-01',
        period_end_date: '2025-02-01',
        effective_date: '2025-01-01',
        invoice_id: null,
      },
      {
        tenant: 'tenant-1',
        client_id: 'client-1',
        client_name: 'Acme Co',
        billing_cycle_id: 'cycle-march',
        billing_cycle: 'monthly',
        period_start_date: '2025-03-01',
        period_end_date: '2025-04-01',
        effective_date: '2025-03-01',
        invoice_id: null,
      },
    ];
    mocks.rowsByTable.time_entries = [{
      tenant: 'tenant-1',
      entry_id: 'te-march',
      start_time: '2025-03-15T14:00:00.000Z',
      end_time: '2025-03-15T15:00:00.000Z',
      invoiced: false,
      contract_line_id: null,
      service_id: 'svc-time',
      approval_status: 'APPROVED',
      billable_duration: 60,
      project_client_id: 'client-1',
      ticket_client_id: null,
    }];

    await getAvailableRecurringDueWork({ page: 1, pageSize: 10 });

    expect(unresolvedSpy).toHaveBeenCalledTimes(1);
    expect(unresolvedSpy).toHaveBeenCalledWith({
      clientId: 'client-1',
      windowStart: '2025-03-01',
      windowEnd: '2025-04-01',
    });
  });

  it.each([
    ['invoiced', { invoiced: true }],
    ['already assigned', { contract_line_id: 'line-1' }],
    ['not approved', { approval_status: 'SUBMITTED' }],
    ['outside the billing window', {
      start_time: '2025-04-02T14:00:00.000Z',
      end_time: '2025-04-02T15:00:00.000Z',
    }],
    ['owned by another client', { project_client_id: 'client-2' }],
    ['owned by another tenant', { tenant: 'tenant-2' }],
  ])('T045: does not hydrate a time source that is %s', async (_label, overrides) => {
    mocks.rowsByTable.time_entries = [{
      tenant: 'tenant-1',
      entry_id: 'te-ineligible',
      start_time: '2025-03-15T14:00:00.000Z',
      end_time: '2025-03-15T15:00:00.000Z',
      invoiced: false,
      contract_line_id: null,
      service_id: 'svc-time',
      approval_status: 'APPROVED',
      billable_duration: 60,
      project_client_id: 'client-1',
      ticket_client_id: null,
      ...overrides,
    }];

    await getAvailableRecurringDueWork({ page: 1, pageSize: 10 });

    expect(unresolvedSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['invoiced', { invoiced: true }],
    ['already assigned', { contract_line_id: 'line-1' }],
    ['outside the billing window', { usage_date: '2025-04-02T14:00:00.000Z' }],
    ['owned by another client', { client_id: 'client-2' }],
    ['owned by another tenant', { tenant: 'tenant-2' }],
  ])('T046: does not hydrate a usage source that is %s', async (_label, overrides) => {
    mocks.rowsByTable.usage_tracking = [{
      tenant: 'tenant-1',
      usage_id: 'usage-ineligible',
      client_id: 'client-1',
      usage_date: '2025-03-15T14:00:00.000Z',
      invoiced: false,
      contract_line_id: null,
      service_id: 'svc-usage',
      ...overrides,
    }];

    await getAvailableRecurringDueWork({ page: 1, pageSize: 10 });

    expect(unresolvedSpy).not.toHaveBeenCalled();
  });
});
