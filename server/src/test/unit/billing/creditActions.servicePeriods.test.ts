import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  hasPermission: vi.fn(() => true),
  getById: vi.fn(),
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
  hasPermission: mocks.hasPermission,
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
    getById: mocks.getById,
  },
}));

import {
  getCreditDetails,
  listClientCredits,
} from '../../../../../packages/billing/src/actions/creditActions';

type Row = Record<string, any>;
type TableState = Record<string, Row[]>;

function normalizeColumn(column: string): string {
  return column.replace(/^.*\./, '');
}

function createQueryBuilder(initialRows: Row[]) {
  let rows = [...initialRows];
  let offset = 0;
  let limit: number | null = null;

  const applyWindow = () => {
    const sliced = rows.slice(offset);
    return limit == null ? sliced : sliced.slice(0, limit);
  };

  const builder: any = {
    clone: vi.fn(() => createQueryBuilder(applyWindow())),
    count: vi.fn(async () => [{ count: String(applyWindow().length) }]),
    select: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn((columnOrCriteria: string | Record<string, any>, value?: any) => {
      if (typeof columnOrCriteria === 'string') {
        const normalizedColumn = normalizeColumn(columnOrCriteria);
        rows = rows.filter((row) => row[normalizedColumn] === value);
        return builder;
      }

      rows = rows.filter((row) =>
        Object.entries(columnOrCriteria).every(([key, expected]) => row[normalizeColumn(key)] === expected),
      );
      return builder;
    }),
    orderBy: vi.fn((columnOrOrders: string | Array<{ column: string; order?: 'asc' | 'desc' }>, direction?: 'asc' | 'desc') => {
      const orders = Array.isArray(columnOrOrders)
        ? columnOrOrders
        : [{ column: columnOrOrders, order: direction ?? 'asc' }];

      rows.sort((left, right) => {
        for (const order of orders) {
          const normalizedColumn = normalizeColumn(order.column);
          const leftValue = left[normalizedColumn];
          const rightValue = right[normalizedColumn];

          if (leftValue === rightValue) {
            continue;
          }
          if (leftValue == null) {
            return 1;
          }
          if (rightValue == null) {
            return -1;
          }

          const comparison = String(leftValue).localeCompare(String(rightValue));
          return order.order === 'desc' ? -comparison : comparison;
        }

        return 0;
      });

      return builder;
    }),
    limit: vi.fn((value: number) => {
      limit = value;
      return builder;
    }),
    offset: vi.fn((value: number) => {
      offset = value;
      return builder;
    }),
    first: vi.fn(async () => applyWindow()[0]),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(applyWindow()).then(resolve, reject),
  };

  return builder;
}

function createMockKnex(state: TableState) {
  return vi.fn((tableName: string) => {
    const normalizedTableName = tableName.split(/\s+as\s+/i)[0].trim();
    return createQueryBuilder(state[normalizedTableName] ?? []);
  });
}

describe('credit actions preserve canonical recurring invoice detail context', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.getById.mockReset();
    mocks.createTenantKnex.mockReset();
    mocks.withTransaction.mockReset();
  });

  it('T098: credit-related invoice detail readers and summaries keep canonical recurring service periods', async () => {
    const state: TableState = {
      credit_tracking: [
        {
          credit_id: 'credit-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          transaction_id: 'tx-credit-1',
          amount: 5000,
          remaining_amount: 2500,
          created_at: '2025-02-05T00:00:00.000Z',
          expiration_date: null,
          is_expired: false,
          updated_at: '2025-02-05T00:00:00.000Z',
          currency_code: 'USD',
          transaction_description: 'Credit issued from recurring invoice',
          transaction_type: 'credit_issuance_from_negative_invoice',
          invoice_id: 'invoice-1',
          transaction_date: '2025-02-05T00:00:00.000Z',
        },
      ],
      transactions: [
        {
          transaction_id: 'tx-credit-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          invoice_id: 'invoice-1',
          type: 'credit_issuance_from_negative_invoice',
          description: 'Credit issued from recurring invoice',
          created_at: '2025-02-05T00:00:00.000Z',
          currency_code: 'USD',
        },
        {
          transaction_id: 'tx-apply-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          invoice_id: 'invoice-2',
          type: 'credit_application',
          description: 'Applied credit to invoice invoice-2',
          related_transaction_id: 'tx-credit-1',
          created_at: '2025-03-05T00:00:00.000Z',
          currency_code: 'USD',
        },
      ],
    };

    const knex = createMockKnex(state);
    mocks.createTenantKnex.mockResolvedValue({ knex });
    mocks.withTransaction.mockImplementation(async (knexOrTrx: unknown, callback: (trx: unknown) => unknown) =>
      callback(knexOrTrx),
    );
    mocks.getById.mockResolvedValue({
      invoice_id: 'invoice-1',
      tenant: 'tenant-1',
      client_id: 'client-1',
      invoice_number: 'INV-1001',
      status: 'sent',
      credit_applied: 0,
      subtotal: -5000,
      tax: 0,
      total_amount: -5000,
      currency_code: 'USD',
      invoice_date: '2025-02-05',
      due_date: '2025-02-05',
      is_manual: false,
      invoice_charges: [
        {
          item_id: 'charge-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          description: 'Managed Router',
          quantity: 1,
          rate: -5000,
          unit_price: -5000,
          total_price: -5000,
          tax_amount: 0,
          net_amount: -5000,
          is_manual: false,
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const user = { user_id: 'user-1' } as any;
    const context = { tenant: 'tenant-1' } as any;

    const credits = await listClientCredits(user, context, 'client-1', false, 1, 20);
    const creditDetails = await getCreditDetails(user, context, 'credit-1');

    expect(credits.credits).toEqual([
      expect.objectContaining({
        credit_id: 'credit-1',
        invoice_id: 'invoice-1',
        invoice_number: 'INV-1001',
        invoice_status: 'sent',
        invoice_service_period_start: '2025-01-01T00:00:00.000Z',
        invoice_service_period_end: '2025-02-01T00:00:00.000Z',
        invoice_date_basis: 'canonical_recurring_service_period',
      }),
    ]);

    expect(creditDetails.invoice).toMatchObject({
      invoice_id: 'invoice-1',
      invoice_number: 'INV-1001',
      status: 'sent',
      invoice_charges: [
        expect.objectContaining({
          item_id: 'charge-1',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        }),
      ],
    });
    expect(creditDetails).toMatchObject({
      invoice_date_basis: 'canonical_recurring_service_period',
      invoice_service_period_start: '2025-01-01T00:00:00.000Z',
      invoice_service_period_end: '2025-02-01T00:00:00.000Z',
    });
    expect(creditDetails.transactions).toHaveLength(2);
    expect(mocks.getById).toHaveBeenCalledWith(expect.any(Function), 'tenant-1', 'invoice-1');
  });

  it('T215/T216: negative-invoice credits keep source recurring period context and expose canonical date basis even after the credit is applied later', async () => {
    const state: TableState = {
      credit_tracking: [
        {
          credit_id: 'credit-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          transaction_id: 'tx-credit-1',
          amount: 5000,
          remaining_amount: 0,
          created_at: '2025-02-05T00:00:00.000Z',
          expiration_date: null,
          is_expired: false,
          updated_at: '2025-03-05T00:00:00.000Z',
          currency_code: 'USD',
          transaction_description: 'Credit issued from negative invoice',
          transaction_type: 'credit_issuance_from_negative_invoice',
          invoice_id: 'invoice-1',
          transaction_date: '2025-02-05T00:00:00.000Z',
        },
      ],
      transactions: [
        {
          transaction_id: 'tx-credit-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          invoice_id: 'invoice-1',
          type: 'credit_issuance_from_negative_invoice',
          description: 'Credit issued from negative invoice INV-1001',
          created_at: '2025-02-05T00:00:00.000Z',
          currency_code: 'USD',
        },
        {
          transaction_id: 'tx-apply-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          invoice_id: 'invoice-2',
          type: 'credit_application',
          description: 'Applied credit to invoice invoice-2',
          related_transaction_id: 'tx-credit-1',
          created_at: '2025-03-05T00:00:00.000Z',
          currency_code: 'USD',
        },
      ],
    };

    const knex = createMockKnex(state);
    mocks.createTenantKnex.mockResolvedValue({ knex });
    mocks.withTransaction.mockImplementation(async (knexOrTrx: unknown, callback: (trx: unknown) => unknown) =>
      callback(knexOrTrx),
    );
    mocks.getById.mockResolvedValue({
      invoice_id: 'invoice-1',
      tenant: 'tenant-1',
      client_id: 'client-1',
      invoice_number: 'INV-1001',
      status: 'sent',
      credit_applied: 0,
      subtotal: -5000,
      tax: 0,
      total_amount: -5000,
      currency_code: 'USD',
      invoice_date: '2025-02-05',
      due_date: '2025-02-05',
      is_manual: false,
      invoice_charges: [
        {
          item_id: 'charge-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          description: 'Managed Router credit reversal',
          quantity: 1,
          rate: -5000,
          unit_price: -5000,
          total_price: -5000,
          tax_amount: 0,
          net_amount: -5000,
          is_manual: false,
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const user = { user_id: 'user-1' } as any;
    const context = { tenant: 'tenant-1' } as any;

    const credits = await listClientCredits(user, context, 'client-1', false, 1, 20);
    const creditDetails = await getCreditDetails(user, context, 'credit-1');

    expect(credits.credits[0]).toMatchObject({
      invoice_id: 'invoice-1',
      invoice_service_period_start: '2025-01-01T00:00:00.000Z',
      invoice_service_period_end: '2025-02-01T00:00:00.000Z',
      invoice_date_basis: 'canonical_recurring_service_period',
    });
    expect(creditDetails).toMatchObject({
      invoice_date_basis: 'canonical_recurring_service_period',
      invoice_service_period_start: '2025-01-01T00:00:00.000Z',
      invoice_service_period_end: '2025-02-01T00:00:00.000Z',
    });
    expect(creditDetails.invoice).toMatchObject({
      invoice_id: 'invoice-1',
      invoice_charges: [
        expect.objectContaining({
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
        }),
      ],
    });
    expect(creditDetails.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'credit_application',
          invoice_id: 'invoice-2',
          related_transaction_id: 'tx-credit-1',
        }),
      ]),
    );
  });

  it('T217: credit application history keeps applied-to invoice canonical period context without replacing the source credit invoice summary', async () => {
    const state: TableState = {
      credit_tracking: [
        {
          credit_id: 'credit-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          transaction_id: 'tx-credit-1',
          amount: 5000,
          remaining_amount: 2500,
          created_at: '2025-02-05T00:00:00.000Z',
          expiration_date: null,
          is_expired: false,
          updated_at: '2025-03-05T00:00:00.000Z',
          currency_code: 'USD',
          transaction_description: 'Credit issued from negative invoice',
          transaction_type: 'credit_issuance_from_negative_invoice',
          invoice_id: 'invoice-1',
          transaction_date: '2025-02-05T00:00:00.000Z',
        },
      ],
      transactions: [
        {
          transaction_id: 'tx-credit-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          invoice_id: 'invoice-1',
          type: 'credit_issuance_from_negative_invoice',
          description: 'Credit issued from negative invoice INV-1001',
          created_at: '2025-02-05T00:00:00.000Z',
          currency_code: 'USD',
        },
        {
          transaction_id: 'tx-apply-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          invoice_id: 'invoice-2',
          type: 'credit_application',
          description: 'Applied credit to invoice invoice-2',
          related_transaction_id: 'tx-credit-1',
          created_at: '2025-03-05T00:00:00.000Z',
          currency_code: 'USD',
        },
      ],
    };

    const knex = createMockKnex(state);
    mocks.createTenantKnex.mockResolvedValue({ knex });
    mocks.withTransaction.mockImplementation(async (knexOrTrx: unknown, callback: (trx: unknown) => unknown) =>
      callback(knexOrTrx),
    );
    mocks.getById.mockImplementation(async (_knexOrTrx: unknown, _tenant: string, invoiceId: string) => {
      if (invoiceId === 'invoice-1') {
        return {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          client_id: 'client-1',
          invoice_number: 'INV-1001',
          status: 'sent',
          credit_applied: 0,
          subtotal: -5000,
          tax: 0,
          total_amount: -5000,
          currency_code: 'USD',
          invoice_date: '2025-02-05',
          due_date: '2025-02-05',
          is_manual: false,
          invoice_charges: [
            {
              item_id: 'charge-1',
              invoice_id: 'invoice-1',
              tenant: 'tenant-1',
              description: 'Managed Router credit reversal',
              quantity: 1,
              rate: -5000,
              unit_price: -5000,
              total_price: -5000,
              tax_amount: 0,
              net_amount: -5000,
              is_manual: false,
              service_period_start: '2025-01-01T00:00:00.000Z',
              service_period_end: '2025-02-01T00:00:00.000Z',
              billing_timing: 'arrears',
            },
          ],
        };
      }

      return {
        invoice_id: 'invoice-2',
        tenant: 'tenant-1',
        client_id: 'client-1',
        invoice_number: 'INV-1002',
        status: 'sent',
        credit_applied: 2500,
        subtotal: 5000,
        tax: 0,
        total_amount: 2500,
        currency_code: 'USD',
        invoice_date: '2025-03-05',
        due_date: '2025-03-20',
        is_manual: false,
        invoice_charges: [
          {
            item_id: 'charge-2',
            invoice_id: 'invoice-2',
            tenant: 'tenant-1',
            description: 'Managed Router renewal',
            quantity: 1,
            rate: 5000,
            unit_price: 5000,
            total_price: 5000,
            tax_amount: 0,
            net_amount: 5000,
            is_manual: false,
            service_period_start: '2025-02-01T00:00:00.000Z',
            service_period_end: '2025-03-01T00:00:00.000Z',
            billing_timing: 'arrears',
          },
        ],
      };
    });

    const user = { user_id: 'user-1' } as any;
    const context = { tenant: 'tenant-1' } as any;

    const creditDetails = await getCreditDetails(user, context, 'credit-1');
    const sourceTransaction = creditDetails.transactions.find((transaction) => transaction.transaction_id === 'tx-credit-1');
    const applicationTransaction = creditDetails.transactions.find((transaction) => transaction.transaction_id === 'tx-apply-1');

    expect(creditDetails).toMatchObject({
      invoice_date_basis: 'canonical_recurring_service_period',
      invoice_service_period_start: '2025-01-01T00:00:00.000Z',
      invoice_service_period_end: '2025-02-01T00:00:00.000Z',
    });
    expect(sourceTransaction).toMatchObject({
      invoice_id: 'invoice-1',
      invoice_number: 'INV-1001',
      invoice_status: 'sent',
      invoice_date_basis: 'canonical_recurring_service_period',
      invoice_service_period_start: '2025-01-01T00:00:00.000Z',
      invoice_service_period_end: '2025-02-01T00:00:00.000Z',
    });
    expect(applicationTransaction).toMatchObject({
      type: 'credit_application',
      invoice_id: 'invoice-2',
      invoice_number: 'INV-1002',
      invoice_status: 'sent',
      invoice_date_basis: 'canonical_recurring_service_period',
      invoice_service_period_start: '2025-02-01T00:00:00.000Z',
      invoice_service_period_end: '2025-03-01T00:00:00.000Z',
      related_transaction_id: 'tx-credit-1',
    });
    expect(mocks.getById).toHaveBeenCalledWith(expect.any(Function), 'tenant-1', 'invoice-1');
    expect(mocks.getById).toHaveBeenCalledWith(expect.any(Function), 'tenant-1', 'invoice-2');
  });

  it('T219: transferred credits preserve recurring source lineage in credit readers even when the transfer transaction has no direct invoice id', async () => {
    const state: TableState = {
      credit_tracking: [
        {
          credit_id: 'credit-2',
          tenant: 'tenant-1',
          client_id: 'client-2',
          transaction_id: 'tx-transfer-in-1',
          amount: 3000,
          remaining_amount: 3000,
          created_at: '2025-03-10T00:00:00.000Z',
          expiration_date: null,
          is_expired: false,
          updated_at: '2025-03-10T00:00:00.000Z',
          currency_code: 'USD',
          transaction_description: 'Administrative transfer from client-1',
          transaction_type: 'credit_transfer',
          invoice_id: undefined,
          transaction_date: '2025-03-10T00:00:00.000Z',
          transaction_metadata: {
            source_credit_id: 'credit-1',
            source_invoice_id: 'invoice-1',
            source_invoice_date_basis: 'canonical_recurring_service_period',
            source_invoice_service_period_start: '2025-01-01T00:00:00.000Z',
            source_invoice_service_period_end: '2025-02-01T00:00:00.000Z',
          },
        },
      ],
      transactions: [
        {
          transaction_id: 'tx-transfer-in-1',
          tenant: 'tenant-1',
          client_id: 'client-2',
          invoice_id: undefined,
          type: 'credit_transfer',
          description: 'Administrative transfer from client-1',
          created_at: '2025-03-10T00:00:00.000Z',
          currency_code: 'USD',
          metadata: {
            source_credit_id: 'credit-1',
            source_invoice_id: 'invoice-1',
            source_invoice_date_basis: 'canonical_recurring_service_period',
            source_invoice_service_period_start: '2025-01-01T00:00:00.000Z',
            source_invoice_service_period_end: '2025-02-01T00:00:00.000Z',
          },
        },
      ],
    };

    const knex = createMockKnex(state);
    mocks.createTenantKnex.mockResolvedValue({ knex });
    mocks.withTransaction.mockImplementation(async (knexOrTrx: unknown, callback: (trx: unknown) => unknown) =>
      callback(knexOrTrx),
    );
    mocks.getById.mockResolvedValue({
      invoice_id: 'invoice-1',
      tenant: 'tenant-1',
      client_id: 'client-1',
      invoice_number: 'INV-1001',
      status: 'sent',
      credit_applied: 0,
      subtotal: -5000,
      tax: 0,
      total_amount: -5000,
      currency_code: 'USD',
      invoice_date: '2025-02-05',
      due_date: '2025-02-05',
      is_manual: false,
      invoice_charges: [
        {
          item_id: 'charge-1',
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
          description: 'Managed Router credit reversal',
          quantity: 1,
          rate: -5000,
          unit_price: -5000,
          total_price: -5000,
          tax_amount: 0,
          net_amount: -5000,
          is_manual: false,
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });

    const user = { user_id: 'user-1' } as any;
    const context = { tenant: 'tenant-1' } as any;

    const credits = await listClientCredits(user, context, 'client-2', false, 1, 20);
    const creditDetails = await getCreditDetails(user, context, 'credit-2');

    expect(credits.credits).toEqual([
      expect.objectContaining({
        credit_id: 'credit-2',
        source_credit_id: 'credit-1',
        source_invoice_id: 'invoice-1',
        lineage_origin: 'transferred_credit',
        invoice_number: 'INV-1001',
        invoice_status: 'sent',
        invoice_date_basis: 'canonical_recurring_service_period',
        invoice_service_period_start: '2025-01-01T00:00:00.000Z',
        invoice_service_period_end: '2025-02-01T00:00:00.000Z',
      }),
    ]);
    expect(creditDetails.credit).toMatchObject({
      credit_id: 'credit-2',
      source_credit_id: 'credit-1',
      source_invoice_id: 'invoice-1',
      lineage_origin: 'transferred_credit',
    });
    expect(creditDetails.invoice).toMatchObject({
      invoice_id: 'invoice-1',
      invoice_number: 'INV-1001',
    });
    expect(creditDetails).toMatchObject({
      invoice_date_basis: 'canonical_recurring_service_period',
      invoice_service_period_start: '2025-01-01T00:00:00.000Z',
      invoice_service_period_end: '2025-02-01T00:00:00.000Z',
    });
    expect(creditDetails.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transaction_id: 'tx-transfer-in-1',
          source_credit_id: 'credit-1',
          source_invoice_id: 'invoice-1',
          lineage_origin: 'transferred_credit',
          invoice_number: 'INV-1001',
          invoice_date_basis: 'canonical_recurring_service_period',
        }),
      ]),
    );
  });
});
