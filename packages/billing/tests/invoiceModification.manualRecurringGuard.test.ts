import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  invoice: {
    invoice_id: 'invoice-1',
    client_id: 'client-1',
    status: 'draft',
    invoice_number: 'INV-1001',
  } as Record<string, any> | null,
  client: {
    client_id: 'client-1',
    tax_region: 'US-WA',
  } as Record<string, any> | null,
  nonManualTargets: [] as Array<Record<string, any>>,
  queriedTables: [] as string[],
};

const recalculateInvoiceMock = vi.fn(async () => undefined);

function createBuilder(table: string) {
  const builder: any = {};
  builder.leftJoin = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.andWhere = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.whereNot = vi.fn(() => builder);
  builder.orWhereNull = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.update = vi.fn(async () => 1);
  builder.delete = vi.fn(async () => 1);
  builder.first = vi.fn(async () => {
    if (table === 'invoices') {
      return state.invoice;
    }

    if (table === 'clients') {
      return state.client;
    }

    return undefined;
  });
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) => {
    const rows = table === 'invoice_charges as ic' ? state.nonManualTargets : [];
    return Promise.resolve(rows).then(onFulfilled, onRejected);
  });
  return builder;
}

function createMockTrx() {
  return ((table: string) => {
    state.queriedTables.push(table);
    return createBuilder(table);
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

describe('manual invoice edits preserve recurring provenance', () => {
  beforeEach(() => {
    state.invoice = {
      invoice_id: 'invoice-1',
      client_id: 'client-1',
      status: 'draft',
      invoice_number: 'INV-1001',
    };
    state.client = {
      client_id: 'client-1',
      tax_region: 'US-WA',
    };
    state.nonManualTargets = [
      {
        item_id: 'recurring-1',
        description: 'Managed Services',
        item_detail_id: 'detail-1',
      },
    ];
    state.queriedTables = [];
    recalculateInvoiceMock.mockClear();
  });

  it('T207: rejects updates that would manually mutate recurring invoice charges backed by canonical detail periods', async () => {
    const { updateInvoiceManualItems } = await import('../src/actions/invoiceModification.ts');

    await expect(
      updateInvoiceManualItems('invoice-1', {
        updatedItems: [
          {
            item_id: 'recurring-1',
            description: 'Edited recurring line',
            rate: 15000,
          },
        ],
        newItems: [],
        removedItemIds: [],
      } as any)
    ).rejects.toThrow(
      'Cannot manually edit recurring invoice charges once canonical detail periods exist. Add an adjustment as a manual item or cancel and regenerate the invoice instead.'
    );

    expect(state.queriedTables).toContain('invoice_charges as ic');
    expect(recalculateInvoiceMock).not.toHaveBeenCalled();
  });
});
