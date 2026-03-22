import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type Row = Record<string, any>;

function createMockDb() {
  const tables: Record<string, Row[]> = {
    invoices: [],
  };

  const tx = ((tableName: string) => {
    const rows = tables[tableName] ?? [];
    let filteredRows = rows;

    const builder: any = {
      where(criteria: Record<string, any>) {
        filteredRows = rows.filter((row) =>
          Object.entries(criteria).every(([key, expected]) => row[key] === expected),
        );
        return builder;
      },
      async first() {
        return filteredRows[0] ?? null;
      },
      async update(payload: Row) {
        for (const row of filteredRows) {
          Object.assign(row, payload);
        }
        return filteredRows.length;
      },
    };

    return builder;
  }) as any;

  return { tables, tx };
}

const mocks = vi.hoisted(() => {
  const db = createMockDb();

  return {
    db,
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
      callback(db.tx),
    ),
    createTenantKnex: vi.fn(async () => ({ knex: db.tx, tenant: 'tenant-1' })),
    updateClientCredit: vi.fn(async () => undefined),
    getClientCredit: vi.fn(async () => 0),
    applyCreditToInvoice: vi.fn(async () => undefined),
    validateInvoiceFinalization: vi.fn(async () => ({ canFinalize: true })),
    publishWorkflowEvent: vi.fn(async () => undefined),
    getInvoiceById: vi.fn(async () => null),
  };
});

vi.mock('@alga-psa/db', () => ({
  withTransaction: mocks.withTransaction,
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => action,
  getSession: vi.fn(async () => null),
}));

vi.mock('../../../../../packages/billing/src/models/clientContractLine', () => ({
  default: {
    updateClientCredit: mocks.updateClientCredit,
    getClientCredit: mocks.getClientCredit,
  },
}));

vi.mock('../../../../../packages/billing/src/actions/creditActions', () => ({
  applyCreditToInvoice: mocks.applyCreditToInvoice,
}));

vi.mock('../../../../../packages/billing/src/actions/taxSourceActions', () => ({
  validateInvoiceFinalization: mocks.validateInvoiceFinalization,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: mocks.publishWorkflowEvent,
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getById: mocks.getInvoiceById,
  },
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/creditNoteEventBuilders', () => ({
  buildCreditNoteCreatedPayload: vi.fn((payload) => payload),
  buildCreditNoteVoidedPayload: vi.fn((payload) => payload),
}));

const { finalizeInvoiceWithKnex } = await import(
  '../../../../../packages/billing/src/actions/invoiceModification'
);

describe('invoice finalization kind classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.tables.invoices.length = 0;
    mocks.validateInvoiceFinalization.mockResolvedValue({ canFinalize: true });
    mocks.getClientCredit.mockResolvedValue(0);
  });

  it('T047: true prepayment invoice behavior still works after explicit invoice-kind classification is introduced', async () => {
    mocks.db.tables.invoices.push({
      invoice_id: 'invoice-prepayment',
      tenant: 'tenant-1',
      client_id: 'client-1',
      subtotal: 5000,
      total_amount: 5000,
      billing_cycle_id: null,
      is_prepayment: true,
      finalized_at: null,
      status: 'draft',
      invoice_number: 'INV-1001',
    });

    await finalizeInvoiceWithKnex('invoice-prepayment', mocks.db.tx, 'tenant-1', 'user-1');

    expect(mocks.updateClientCredit).toHaveBeenCalledWith('client-1', 5000);
    expect(mocks.getClientCredit).not.toHaveBeenCalled();
    expect(mocks.db.tables.invoices[0]).toMatchObject({
      status: 'sent',
      finalized_at: expect.any(String),
    });
  });

  it('T046: invoice modification/finalization does not classify a bridge-less recurring invoice as a prepayment', async () => {
    mocks.db.tables.invoices.push({
      invoice_id: 'invoice-recurring',
      tenant: 'tenant-1',
      client_id: 'client-1',
      subtotal: 9000,
      total_amount: 9000,
      billing_cycle_id: null,
      is_prepayment: false,
      finalized_at: null,
      status: 'draft',
      invoice_number: 'INV-2001',
    });

    await finalizeInvoiceWithKnex('invoice-recurring', mocks.db.tx, 'tenant-1', 'user-1');

    expect(mocks.updateClientCredit).not.toHaveBeenCalled();
    expect(mocks.getClientCredit).toHaveBeenCalledWith('client-1');
    expect(mocks.applyCreditToInvoice).not.toHaveBeenCalled();
  });

  it('T048: invoice finalization no longer uses billing_cycle_id nullability as a proxy for prepayment classification', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), '../packages/billing/src/actions/invoiceModification.ts'),
      'utf8',
    );

    expect(source).toContain('function classifyInvoiceCreditHandling(');
    expect(source).toContain('invoice?.is_prepayment');
    expect(source).not.toContain('if (invoice && !invoice.billing_cycle_id)');
  });
});
