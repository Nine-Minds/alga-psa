import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

function createMockDb() {
  const tables: Record<string, Row[]> = {
    clients: [
      {
        client_id: 'client-1',
        tenant: 'tenant-1',
        default_currency_code: 'USD',
      },
    ],
    client_billing_settings: [],
    default_billing_settings: [],
    invoices: [],
    transactions: [],
    credit_tracking: [],
  };
  const accessedTables: string[] = [];

  const tx = ((tableName: string) => {
    accessedTables.push(tableName);
    const rows = tables[tableName] ?? [];
    let filteredRows = rows;
    let insertedRow: Row | null = null;

    const builder: any = {
      where(criteria: Record<string, any>) {
        filteredRows = rows.filter((row) =>
          Object.entries(criteria).every(([key, expected]) => row[key] === expected),
        );
        return builder;
      },
      orderBy() {
        return builder;
      },
      select() {
        return builder;
      },
      async first() {
        return filteredRows[0] ?? null;
      },
      insert(payload: Row) {
        insertedRow = {
          ...payload,
          invoice_id:
            tableName === 'invoices'
              ? payload.invoice_id ?? 'prepayment-invoice-1'
              : payload.invoice_id,
        };
        rows.push(insertedRow);
        return builder;
      },
      returning: vi.fn(async () => (insertedRow ? [insertedRow] : [])),
      toSQL() {
        return { sql: `insert into ${tableName}`, bindings: [] };
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(insertedRow ? [insertedRow] : []).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }) as any;

  return { tx, tables, accessedTables };
}

const mocks = vi.hoisted(() => {
  const db = createMockDb();

  return {
    db,
    createTenantKnex: vi.fn(async () => ({ knex: db.tx })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
      callback(db.tx),
    ),
    publishWorkflowEvent: vi.fn(async () => undefined),
    generateInvoiceNumber: vi.fn(async () => 'INV-1001'),
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
  hasPermission: vi.fn(() => true),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: mocks.generateInvoiceNumber,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/creditNoteEventBuilders', () => ({
  buildCreditNoteCreatedPayload: vi.fn((payload) => payload),
  buildCreditNoteVoidedPayload: vi.fn((payload) => payload),
}));

const { createPrepaymentInvoice } = await import(
  '../../../../../packages/billing/src/actions/creditActions'
);

describe('prepayment invoice service-period policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.tables.invoices.length = 0;
    mocks.db.tables.transactions.length = 0;
    mocks.db.tables.credit_tracking.length = 0;
    mocks.db.accessedTables.length = 0;
  });

  it('T214: prepayment invoices stay non-service financial artifacts with financial dates and no canonical recurring detail rows', async () => {
    const invoice = await createPrepaymentInvoice('client-1', 5000);

    expect(invoice).toMatchObject({
      invoice_id: 'prepayment-invoice-1',
      subtotal: 5000,
      total_amount: 5000,
      status: 'draft',
      invoice_number: 'INV-1001',
    });
    expect(mocks.db.tables.invoices[0]).toMatchObject({
      client_id: 'client-1',
      subtotal: 5000,
      total_amount: 5000,
      billing_period_start: expect.any(String),
      billing_period_end: expect.any(String),
    });
    expect(mocks.db.tables.invoices[0]).not.toHaveProperty('billing_cycle_id');
    expect(mocks.db.tables.transactions[0]).toMatchObject({
      invoice_id: 'prepayment-invoice-1',
      amount: 5000,
      type: 'credit_issuance',
      description: 'Credit issued from prepayment',
    });
    expect(mocks.db.tables.credit_tracking[0]).toMatchObject({
      client_id: 'client-1',
      amount: 5000,
      remaining_amount: 5000,
    });
    expect(mocks.db.accessedTables).not.toContain('invoice_charge_details');
  });
});
