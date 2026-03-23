import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  invoice: {
    invoice_id: 'invoice-1',
    client_id: 'client-1',
    credit_applied: 0,
    status: 'draft',
  } as Record<string, any> | null,
  hasCanonicalRecurringDetails: true,
  queriedTables: [] as string[],
};

function createQueryBuilder(table: string) {
  const builder: any = {};
  builder.join = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.andWhere = vi.fn(() => builder);
  builder.whereNotNull = vi.fn(() => builder);
  builder.first = vi.fn(async () => {
    if (table === 'invoices') {
      return state.invoice;
    }

    if (table === 'invoice_charge_details as iid') {
      return state.hasCanonicalRecurringDetails ? { item_detail_id: 'detail-1' } : undefined;
    }

    return undefined;
  });
  return builder;
}

function createMockTrx() {
  return ((table: string) => {
    state.queriedTables.push(table);
    return createQueryBuilder(table);
  }) as any;
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

vi.mock('../src/models/clientContractLine', () => ({
  default: {
    updateClientCredit: vi.fn(async () => undefined),
  },
}));

vi.mock('../src/actions/creditActions', () => ({
  applyCreditToInvoice: vi.fn(),
}));

vi.mock('../src/lib/billing/billingEngine', () => ({
  BillingEngine: class BillingEngine {},
}));

vi.mock('../src/services/invoiceService', () => ({
  persistInvoiceCharges: vi.fn(),
  persistManualInvoiceCharges: vi.fn(),
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('../src/actions/taxSourceActions', () => ({
  validateInvoiceFinalization: vi.fn(async () => ({ canFinalize: true })),
}));

describe('hardDeleteInvoice recurring detail safeguards', () => {
  beforeEach(() => {
    state.invoice = {
      invoice_id: 'invoice-1',
      client_id: 'client-1',
      credit_applied: 0,
      status: 'draft',
    };
    state.hasCanonicalRecurringDetails = true;
    state.queriedTables = [];
  });

  it('T205: blocks hard deletion once canonical recurring detail periods exist on the invoice', async () => {
    const { hardDeleteInvoice } = await import('../src/actions/invoiceModification.ts');

    await expect(hardDeleteInvoice('invoice-1')).rejects.toThrow(
      'Cannot delete invoice invoice-1: canonical recurring detail periods already exist. Cancel the invoice instead of deleting it.'
    );

    expect(state.queriedTables).toContain('invoices');
    expect(state.queriedTables).toContain('invoice_charge_details as iid');
    expect(state.queriedTables).not.toContain('transactions');
  });
});
