import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback(_knex)),
  getTenantContext: vi.fn(() => 'tenant-1'),
  auditLog: vi.fn(async () => undefined),
  createReport: vi.fn(async (input: Record<string, unknown>) => ({
    report_id: 'report-1',
    ...input,
  })),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
  getTenantContext: mocks.getTenantContext,
  auditLog: mocks.auditLog,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('../../../../../packages/billing/src/models/creditReconciliationReport', () => ({
  default: {
    create: mocks.createReport,
  },
}));

import {
  validateCreditBalanceWithoutCorrection,
  validateCreditTrackingRemainingAmounts,
} from '../../../../../packages/billing/src/actions/creditReconciliationActions';

type Row = Record<string, any>;
type TableState = Record<string, Row[]>;

function compare(value: unknown, operator: string, expected: unknown): boolean {
  if (operator === '=') {
    return value === expected;
  }
  if (operator === '>') {
    return Number(value) > Number(expected);
  }
  if (operator === '<') {
    return Number(value) < Number(expected);
  }
  throw new Error(`Unsupported operator ${operator}`);
}

function createMockTransaction(state: TableState) {
  const trx: any = (tableName: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let sortColumn: string | null = null;
    let sortDirection: 'asc' | 'desc' = 'asc';

    const apply = () => {
      const rows = [...(state[tableName] ?? [])].filter((row) =>
        predicates.every((predicate) => predicate(row)),
      );

      if (sortColumn) {
        rows.sort((left, right) => {
          const leftValue = left[sortColumn!];
          const rightValue = right[sortColumn!];
          if (leftValue === rightValue) {
            return 0;
          }
          return sortDirection === 'asc'
            ? String(leftValue).localeCompare(String(rightValue))
            : String(rightValue).localeCompare(String(leftValue));
        });
      }

      return rows;
    };

    const builder: any = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn((columnOrCriteria: string | Record<string, unknown> | ((qb: unknown) => void), operatorOrValue?: unknown, maybeValue?: unknown) => {
        if (typeof columnOrCriteria === 'function') {
          const groupPredicates: Array<(row: Row) => boolean> = [];
          const groupBuilder = {
            whereNull: (column: string) => {
              groupPredicates.push((row) => row[column] == null);
              return groupBuilder;
            },
            orWhere: (column: string, operatorOrGroupedValue: unknown, groupedMaybeValue?: unknown) => {
              const operator = groupedMaybeValue === undefined ? '=' : String(operatorOrGroupedValue);
              const expectedValue =
                groupedMaybeValue === undefined ? operatorOrGroupedValue : groupedMaybeValue;
              groupPredicates.push((row) => compare(row[column], operator, expectedValue));
              return groupBuilder;
            },
          };
          columnOrCriteria.call(groupBuilder, groupBuilder);
          predicates.push((row) =>
            groupPredicates.length === 0
              ? true
              : groupPredicates.some((predicate) => predicate(row)),
          );
          return builder;
        }

        if (typeof columnOrCriteria === 'string') {
          const operator = maybeValue === undefined ? '=' : String(operatorOrValue);
          const expectedValue = maybeValue === undefined ? operatorOrValue : maybeValue;
          predicates.push((row) => compare(row[columnOrCriteria], operator, expectedValue));
          return builder;
        }

        predicates.push((row) =>
          Object.entries(columnOrCriteria).every(([key, expectedValue]) => row[key] === expectedValue),
        );
        return builder;
      }),
      whereIn: vi.fn((column: string, values: unknown[]) => {
        predicates.push((row) => values.includes(row[column]));
        return builder;
      }),
      orderBy: vi.fn((column: string, direction: 'asc' | 'desc' = 'asc') => {
        sortColumn = column;
        sortDirection = direction;
        return builder;
      }),
      first: vi.fn(async () => apply()[0]),
      update: vi.fn(async (updates: Record<string, unknown>) => {
        const rows = apply();
        rows.forEach((row) => Object.assign(row, updates));
        return rows.length;
      }),
      insert: vi.fn(async (records: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = Array.isArray(records) ? records : [records];
        const target = state[tableName] ?? [];
        rows.forEach((row) => target.push({ ...row }));
        state[tableName] = target;
        return rows;
      }),
      then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(apply()).then(resolve, reject),
    };

    return builder;
  };

  return trx;
}

describe('credit reconciliation remains stable with canonical recurring detail periods', () => {
  beforeEach(() => {
    mocks.createTenantKnex.mockClear();
    mocks.withTransaction.mockClear();
    mocks.getTenantContext.mockReturnValue('tenant-1');
    mocks.auditLog.mockClear();
    mocks.createReport.mockClear();
  });

  it('T092: negative-invoice credits still reconcile correctly after recurring invoices carry canonical detail periods', async () => {
    const state: TableState = {
      transactions: [
        {
          transaction_id: 'credit-tx-1',
          client_id: 'client-1',
          tenant: 'tenant-1',
          amount: 11000,
          type: 'credit_issuance_from_negative_invoice',
          created_at: '2025-01-15T00:00:00.000Z',
          related_transaction_id: null,
        },
        {
          transaction_id: 'application-tx-1',
          client_id: 'client-1',
          tenant: 'tenant-1',
          amount: -11000,
          type: 'credit_application',
          created_at: '2025-02-15T00:00:00.000Z',
          related_transaction_id: 'credit-tx-1',
        },
      ],
      credit_tracking: [
        {
          credit_id: 'credit-1',
          client_id: 'client-1',
          tenant: 'tenant-1',
          transaction_id: 'credit-tx-1',
          remaining_amount: 0,
          is_expired: false,
          expiration_date: null,
        },
      ],
    };

    const result = await validateCreditTrackingRemainingAmounts(
      'client-1',
      createMockTransaction(state) as any,
    );

    expect(result).toEqual({
      isValid: true,
      inconsistentEntries: 0,
      reportIds: [],
    });
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it('T093: expired negative-invoice credits still expire by credit metadata rather than recurring service-period shape', async () => {
    const state: TableState = {
      client_billing_settings: [
        {
          client_id: 'client-1',
          tenant: 'tenant-1',
          enable_credit_expiration: true,
        },
      ],
      default_billing_settings: [],
      clients: [
        {
          client_id: 'client-1',
          tenant: 'tenant-1',
          credit_balance: 0,
        },
      ],
      transactions: [
        {
          transaction_id: 'credit-tx-1',
          client_id: 'client-1',
          tenant: 'tenant-1',
          amount: 11000,
          type: 'credit_issuance_from_negative_invoice',
          status: 'completed',
          created_at: '2024-01-15T00:00:00.000Z',
          expiration_date: '2024-02-15T00:00:00.000Z',
          related_transaction_id: null,
        },
      ],
      credit_tracking: [
        {
          credit_id: 'credit-1',
          client_id: 'client-1',
          tenant: 'tenant-1',
          transaction_id: 'credit-tx-1',
          amount: 11000,
          remaining_amount: 11000,
          is_expired: false,
          expiration_date: '2024-02-15T00:00:00.000Z',
          updated_at: '2024-01-15T00:00:00.000Z',
        },
      ],
    };

    const result = await validateCreditBalanceWithoutCorrection(
      'client-1',
      createMockTransaction(state) as any,
    );

    expect(result.isValid).toBe(false);
    expect(result.expectedBalance).toBe(-11000);
    expect(result.actualBalance).toBe(0);
    expect(state.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'credit_expiration',
          amount: -11000,
          related_transaction_id: 'credit-tx-1',
        }),
      ]),
    );
    expect(state.credit_tracking[0]).toMatchObject({
      credit_id: 'credit-1',
      is_expired: true,
      remaining_amount: 0,
    });
    expect(mocks.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-1',
        tenant: 'tenant-1',
        expected_balance: -11000,
        actual_balance: 0,
        difference: -11000,
        status: 'open',
      }),
      expect.anything(),
    );
  });
});
