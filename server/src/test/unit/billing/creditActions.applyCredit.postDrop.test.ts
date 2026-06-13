import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
  auditLog: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/creditNoteEventBuilders', () => ({
  buildCreditNoteAppliedPayload: vi.fn(),
  buildCreditNoteCreatedPayload: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: vi.fn(async () => 'INV-001'),
}));

vi.mock('../../../../../packages/billing/src/actions/creditReconciliationActions', () => ({
  validateCreditBalanceWithoutCorrection: vi.fn(async () => ({
    isValid: true,
    actualBalance: 0,
  })),
}));

vi.mock('../../../../../packages/billing/src/models/clientContractLine', () => ({
  default: {},
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(async () => null),
}));

vi.mock('../../../../../packages/billing/src/models/invoice', () => ({
  default: {
    getById: vi.fn(async () => null),
  },
}));

import { applyCreditToInvoice } from '../../../../../packages/billing/src/actions/creditActions';

type Row = Record<string, any>;

function createCreditApplicationTrx() {
  const state = {
    invoice: {
      invoice_id: 'invoice-1',
      tenant: 'tenant-1',
      credit_applied: 0,
      currency_code: 'USD',
      total_amount: 10000,
      subtotal: 10000,
      tax: 0,
    },
    client: {
      client_id: 'client-1',
      tenant: 'tenant-1',
      credit_balance: 5000,
      updated_at: null as string | null,
    },
    creditEntries: [
      {
        credit_id: 'credit-1',
        tenant: 'tenant-1',
        client_id: 'client-1',
        remaining_amount: 5000,
        transaction_id: 'tx-credit-1',
        is_expired: false,
        currency_code: 'USD',
        expiration_date: null,
        created_at: '2025-01-01T00:00:00.000Z',
      },
    ],
    transactions: [] as Row[],
    allocations: [] as Row[],
  };

  const RAW = Symbol('knex.raw');

  const trx: any = (tableName: string) => {
    if (tableName === 'client_contract_lines') {
      throw new Error('relation "client_contract_lines" does not exist');
    }

    if (tableName === 'invoices') {
      const builder: any = {
        where: vi.fn((_criteria: any) => builder),
        select: vi.fn((_columns: any) => builder),
        first: vi.fn(async () => state.invoice),
        update: vi.fn(async (payload: Row) => {
          // Source updates only credit_applied via trx.raw('COALESCE(credit_applied, 0) + ?')
          // Invoice totals are intentionally immutable after finalization.
          const next = { ...state.invoice };
          for (const [column, value] of Object.entries(payload)) {
            if (value && typeof value === 'object' && (value as any)[RAW]) {
              next[column] = Number(next[column] ?? 0) + Number((value as any).amount);
            } else {
              next[column] = value;
            }
          }
          state.invoice = next;
          return 1;
        }),
      };
      return builder;
    }

    if (tableName === 'credit_allocations') {
      const builder: any = {
        where: vi.fn((_criteria: any) => builder),
        sum: vi.fn(() => builder),
        first: vi.fn(async () => ({ total_applied: 0 })),
        insert: vi.fn(async (payload: Row) => {
          state.allocations.push(payload);
          return [payload];
        }),
      };
      return builder;
    }

    if (tableName === 'clients') {
      const builder: any = {
        where: vi.fn((_criteria: any) => builder),
        select: vi.fn(async () => [state.client]),
        update: vi.fn(async (payload: Row) => {
          state.client = {
            ...state.client,
            ...payload,
          };
          return 1;
        }),
      };
      return builder;
    }

    if (tableName === 'credit_tracking') {
      const builder: any = {
        where: vi.fn((_criteriaOrColumn: any, _value?: any, _extra?: any) => builder),
        whereNot: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        first: vi.fn(async () => undefined),
        then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(state.creditEntries).then(resolve, reject),
        [Symbol.asyncIterator]: undefined,
        update: vi.fn(async (payload: Row) => {
          state.creditEntries[0] = {
            ...state.creditEntries[0],
            ...payload,
          };
          return 1;
        }),
      };
      return builder;
    }

    if (tableName === 'transactions') {
      let whereCriteria: Row | null = null;
      const builder: any = {
        insert: vi.fn((payload: Row) => {
          const inserted = {
            ...payload,
            transaction_id: payload.transaction_id ?? 'tx-apply-1',
          };
          state.transactions.push(inserted);
          return {
            returning: vi.fn(async () => [inserted]),
          };
        }),
        where: vi.fn((criteria: Row) => {
          whereCriteria = criteria;
          return builder;
        }),
        select: vi.fn((_columns: any) => builder),
        first: vi.fn(async () =>
          state.transactions.find((row) =>
            Object.entries(whereCriteria ?? {}).every(([key, value]) => row[key] === value),
          ) ?? null,
        ),
        update: vi.fn(async (payload: Row) => {
          const index = state.transactions.findIndex((row) =>
            Object.entries(whereCriteria ?? {}).every(([key, value]) => row[key] === value),
          );
          if (index >= 0) {
            state.transactions[index] = {
              ...state.transactions[index],
              ...payload,
            };
          }
          return 1;
        }),
      };
      return builder;
    }

    throw new Error(`Unexpected table ${tableName}`);
  };

  trx.raw = vi.fn((_sql: string, bindings?: any[]) => ({
    [RAW]: true,
    amount: Array.isArray(bindings) ? bindings[0] : bindings,
  }));

  return { trx, state };
}

describe('credit application post-drop behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies client credit without querying client_contract_lines in a migrated schema', async () => {
    const { trx, state } = createCreditApplicationTrx();
    mocks.createTenantKnex.mockResolvedValue({ knex: {} });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (trx: unknown) => unknown) =>
      callback(trx),
    );

    await expect(
      applyCreditToInvoice(
        { user_id: 'user-1' } as any,
        { tenant: 'tenant-1' } as any,
        'client-1',
        'invoice-1',
        3000,
      ),
    ).resolves.toBeUndefined();

    expect(state.client.credit_balance).toBe(2000);
    expect(state.invoice.credit_applied).toBe(3000);
    // Invoice totals are immutable after finalization; only credit_applied moves
    // (balance due is derived as total − credit − payments).
    expect(state.invoice.total_amount).toBe(10000);
    expect(state.allocations).toHaveLength(1);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].related_transaction_id).toBe('tx-credit-1');
  });
});
