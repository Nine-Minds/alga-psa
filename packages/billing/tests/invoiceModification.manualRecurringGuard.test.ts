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
  // Persisted manual rows keyed by item_id. The builder's `update` mutates these
  // so the second pass reads back the values written by the first pass, exactly
  // as the database would.
  manualCharges: new Map<string, Record<string, any>>(),
  queriedTables: [] as string[],
};

interface CapturedUpdate {
  table: string;
  where: Record<string, any>;
  payload: Record<string, any>;
}

const updateCalls: CapturedUpdate[] = [];
const recalculateInvoiceMock = vi.fn(async () => undefined);

function createBuilder(table: string) {
  const criteria: Record<string, any> = {};
  const builder: any = {};
  const isManualRowQuery = () =>
    table === 'invoice_charges' && criteria.item_id !== undefined;

  builder.clone = vi.fn(() => builder);
  builder.forUpdate = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.where = vi.fn((value: Record<string, any>) => {
    Object.assign(criteria, value);
    return builder;
  });
  builder.andWhere = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.whereNot = vi.fn(() => builder);
  builder.whereNotIn = vi.fn(() => builder);
  builder.orWhereNull = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.pluck = vi.fn(async () => []);
  builder.increment = vi.fn(async () => 1);
  builder.update = vi.fn(async (payload: Record<string, any>) => {
    const row = isManualRowQuery() ? state.manualCharges.get(criteria.item_id) : undefined;
    updateCalls.push({ table, where: { ...criteria }, payload });
    if (row) {
      Object.assign(row, payload);
    }
    return 1;
  });
  builder.delete = vi.fn(async () => 1);
  builder.first = vi.fn(async () => {
    if (table === 'invoices') {
      return state.invoice;
    }

    if (table === 'clients') {
      return state.client;
    }

    if (isManualRowQuery()) {
      return state.manualCharges.get(criteria.item_id) ?? undefined;
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

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
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
  validateManualChargeAttribution: vi.fn(),
}));

vi.mock('../src/services/invoiceAutomaticAdjustments', () => ({
  reconcileAutomaticInvoiceAdjustments: vi.fn(async () => ({ automaticDiscountAmount: 0 })),
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
    state.manualCharges = new Map();
    state.queriedTables = [];
    updateCalls.length = 0;
    recalculateInvoiceMock.mockClear();
  });

  it('T207: rejects updates that would manually mutate recurring invoice charges backed by canonical detail periods', async () => {
    const { updateInvoiceManualItems } = await import('../src/actions/invoiceModification.ts');

    const result = await updateInvoiceManualItems('invoice-1', {
        updatedItems: [
          {
            item_id: 'recurring-1',
            description: 'Edited recurring line',
            rate: 15000,
          },
        ],
        newItems: [],
        removedItemIds: [],
      } as any);

    expect(result).toEqual({
      actionError:
      'Cannot manually edit recurring invoice charges once canonical detail periods exist. Add an adjustment as a manual item or cancel and regenerate the invoice instead.'
    });

    expect(state.queriedTables).toContain('invoice_charges as ic');
    expect(recalculateInvoiceMock).not.toHaveBeenCalled();
  });

  it('T208: recalculates manual edits on the open mutation transaction', async () => {
    state.nonManualTargets = [];
    const { updateInvoiceManualItems } = await import('../src/actions/invoiceModification.ts');

    await updateInvoiceManualItems('invoice-1', {
      updatedItems: [],
      newItems: [],
      removedItemIds: [],
    } as any);

    expect(recalculateInvoiceMock).toHaveBeenCalledTimes(1);
    expect(recalculateInvoiceMock).toHaveBeenCalledWith('invoice-1', expect.any(Function), 'tenant-1');
  });

  it('T230: recomputes an edited one-time manual line from its persisted quantity and unit price', async () => {
    state.nonManualTargets = [];
    state.manualCharges.set('manual-1', {
      item_id: 'manual-1',
      invoice_id: 'invoice-1',
      quantity: 1,
      unit_price: 10000,
      net_amount: 10000,
      total_price: 10000,
      is_manual: true,
      is_discount: false,
    });
    const { updateInvoiceManualItems } = await import('../src/actions/invoiceModification.ts');

    await updateInvoiceManualItems('invoice-1', {
      updatedItems: [
        {
          item_id: 'manual-1',
          quantity: 3,
          rate: 5000,
        },
      ],
      newItems: [],
      removedItemIds: [],
    } as any);

    const amountUpdate = updateCalls.find(
      (call) => call.table === 'invoice_charges' && call.where.item_id === 'manual-1' && 'net_amount' in call.payload,
    );
    expect(amountUpdate).toBeTruthy();
    expect(amountUpdate!.payload).toMatchObject({ net_amount: 15000, total_price: 15000 });
  });
});
