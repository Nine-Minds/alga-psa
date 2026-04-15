import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  invoice: {
    invoice_id: 'invoice-1',
    tenant: 'tenant-1',
    status: 'draft',
    finalized_at: null,
    invoice_number: 'INV-1001',
  } as Record<string, any> | null,
  duplicateInvoice: null as Record<string, any> | null,
  updates: [] as Array<{ table: string; payload: Record<string, any> }>,
};

const recalculateInvoiceMock = vi.fn(async () => undefined);

function normalizeWhereArg(arg1: unknown, arg2?: unknown) {
  if (typeof arg1 === 'string') {
    return { [arg1]: arg2 };
  }

  return (arg1 ?? {}) as Record<string, any>;
}

function createBuilder(table: string) {
  const whereClauses: Array<Record<string, any>> = [];
  const whereNotClauses: Array<Record<string, any>> = [];

  const builder: any = {};

  builder.leftJoin = vi.fn(() => builder);
  builder.join = vi.fn(() => builder);
  builder.andWhere = vi.fn((arg1: unknown, arg2?: unknown) => {
    whereClauses.push(normalizeWhereArg(arg1, arg2));
    return builder;
  });
  builder.where = vi.fn((arg1: unknown, arg2?: unknown) => {
    whereClauses.push(normalizeWhereArg(arg1, arg2));
    return builder;
  });
  builder.whereIn = vi.fn(() => builder);
  builder.whereNot = vi.fn((arg1: unknown, arg2?: unknown) => {
    whereNotClauses.push(normalizeWhereArg(arg1, arg2));
    return builder;
  });
  builder.select = vi.fn(() => builder);
  builder.delete = vi.fn(async () => 1);
  builder.update = vi.fn(async (payload: Record<string, any>) => {
    state.updates.push({ table, payload });
    return 1;
  });
  builder.first = vi.fn(async () => {
    if (table !== 'invoices') {
      return undefined;
    }

    const mergedWhere = Object.assign({}, ...whereClauses);
    const mergedWhereNot = Object.assign({}, ...whereNotClauses);

    if (mergedWhere.invoice_id && mergedWhere.tenant) {
      return state.invoice;
    }

    if (mergedWhere.invoice_number && mergedWhere.tenant && mergedWhereNot.invoice_id) {
      return state.duplicateInvoice;
    }

    return undefined;
  });
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) => Promise.resolve([]).then(onFulfilled, onRejected));

  return builder;
}

function createMockTrx() {
  return ((table: string) => createBuilder(table)) as any;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  getSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: {} })),
    withTransaction: vi.fn(async (_knex: any, callback: any) => callback(createMockTrx())),
  };
});

vi.mock('../src/lib/billing/billingEngine', () => ({
  BillingEngine: class BillingEngine {
    recalculateInvoice = recalculateInvoiceMock;
  },
}));

vi.mock('../src/services/invoiceService', () => ({
  persistInvoiceCharges: vi.fn(),
  persistManualInvoiceCharges: vi.fn(),
}));

vi.mock('../src/models/clientContractLine', () => ({
  default: {
    updateClientCredit: vi.fn(async () => undefined),
  },
}));

vi.mock('../src/actions/creditActions', () => ({
  applyCreditToInvoice: vi.fn(),
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getFullInvoiceById: vi.fn(async () => undefined),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('../src/actions/taxSourceActions', () => ({
  validateInvoiceFinalization: vi.fn(async () => ({ canFinalize: true })),
}));

describe('updateDraftInvoiceProperties', () => {
  beforeEach(() => {
    state.invoice = {
      invoice_id: 'invoice-1',
      tenant: 'tenant-1',
      status: 'draft',
      finalized_at: null,
      invoice_number: 'INV-1001',
    };
    state.duplicateInvoice = null;
    state.updates = [];
    recalculateInvoiceMock.mockClear();
  });

  it('updates invoice number and dates for draft invoices', async () => {
    const { updateDraftInvoiceProperties } = await import('../src/actions/invoiceModification.ts');

    await expect(
      updateDraftInvoiceProperties('invoice-1', {
        invoiceNumber: ' INV-2001 ',
        invoiceDate: '2026-04-20',
        dueDate: null,
      })
    ).resolves.toEqual({
      invoiceId: 'invoice-1',
      invoiceNumber: 'INV-2001',
      invoiceDate: '2026-04-20',
      dueDate: null,
    });

    expect(state.updates).toEqual([
      {
        table: 'invoices',
        payload: expect.objectContaining({
          invoice_number: 'INV-2001',
          invoice_date: '2026-04-20',
          due_date: null,
        }),
      },
    ]);
    expect(recalculateInvoiceMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate invoice numbers before updating', async () => {
    state.duplicateInvoice = { invoice_id: 'invoice-2' };
    const { updateDraftInvoiceProperties } = await import('../src/actions/invoiceModification.ts');

    await expect(
      updateDraftInvoiceProperties('invoice-1', {
        invoiceNumber: 'INV-0001',
        invoiceDate: '2026-04-20',
        dueDate: '2026-05-20',
      })
    ).rejects.toThrow('Invoice number already exists. Choose a different number.');

    expect(state.updates).toHaveLength(0);
  });

  it('rejects edits for finalized invoices', async () => {
    state.invoice = {
      ...state.invoice,
      status: 'sent',
      finalized_at: '2026-04-10',
    };
    const { updateDraftInvoiceProperties } = await import('../src/actions/invoiceModification.ts');

    await expect(
      updateDraftInvoiceProperties('invoice-1', {
        invoiceNumber: 'INV-2002',
        invoiceDate: '2026-04-21',
        dueDate: '2026-05-21',
      })
    ).rejects.toThrow('Only draft invoices can be edited');

    expect(state.updates).toHaveLength(0);
  });
});
