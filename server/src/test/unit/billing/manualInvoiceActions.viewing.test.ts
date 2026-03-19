import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const deleteCalls: Record<string, any>[] = [];
  const updateCalls: Record<string, any>[] = [];
  let lastCriteria: Record<string, any> | null = null;

  function createTableBuilder(tableName: string) {
    const builder: any = {
      where: vi.fn((criteria: Record<string, any>) => {
        lastCriteria = criteria;
        return builder;
      }),
      first: vi.fn(async () => {
        if (
          tableName === 'invoices' &&
          lastCriteria?.invoice_id === 'invoice-1' &&
          lastCriteria?.is_manual === true &&
          lastCriteria?.tenant === 'tenant-1'
        ) {
          return {
            invoice_id: 'invoice-1',
            is_manual: true,
            tenant: 'tenant-1',
          };
        }

        return null;
      }),
      update: vi.fn(async (payload: Record<string, any>) => {
        updateCalls.push({ tableName, criteria: lastCriteria, payload });
        return 1;
      }),
      delete: vi.fn(async () => {
        deleteCalls.push({ tableName, criteria: lastCriteria });
        return 1;
      }),
    };

    return builder;
  }

  const trx = vi.fn((tableName: string) => createTableBuilder(tableName));
  const knex = vi.fn((tableName: string) => createTableBuilder(tableName)) as any;
  knex.transaction = vi.fn(async (callback: (trx: typeof trx) => Promise<unknown>) => callback(trx));

  const validateSessionAndTenant = vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    knex,
  }));
  const getClientDetails = vi.fn(async () => ({
    client_id: 'client-1',
    client_name: 'Acme Corp',
    default_currency_code: 'USD',
  }));
  const persistManualInvoiceCharges = vi.fn(async () => undefined);
  const getFullInvoiceById = vi.fn(async () => ({
    invoice_id: 'invoice-1',
    invoice_charges: [
      {
        item_id: 'recurring-1',
        description: 'Managed Router',
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: 'arrears',
        recurring_detail_periods: [
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'arrears',
          },
        ],
      },
      {
        item_id: 'manual-1',
        description: 'Manual adjustment',
      },
    ],
  }));
  const recalculateInvoice = vi.fn(async () => undefined);

  return {
    deleteCalls,
    updateCalls,
    validateSessionAndTenant,
    getClientDetails,
    persistManualInvoiceCharges,
    getFullInvoiceById,
    recalculateInvoice,
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
  getSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  validateSessionAndTenant: mocks.validateSessionAndTenant,
  getClientDetails: mocks.getClientDetails,
  persistManualInvoiceCharges: mocks.persistManualInvoiceCharges,
}));

vi.mock('../../../../../packages/billing/src/models/invoice', () => ({
  default: {
    getFullInvoiceById: mocks.getFullInvoiceById,
  },
}));

vi.mock('../../../../../packages/billing/src/lib/billing/billingEngine', () => ({
  BillingEngine: class {
    recalculateInvoice = mocks.recalculateInvoice;
  },
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(async () => ({
    analytics: { capture: vi.fn() },
    AnalyticsEvents: {},
  })),
}));

const { updateManualInvoice } = await import(
  '../../../../../packages/billing/src/actions/manualInvoiceActions'
);

describe('manual invoice edit and viewing compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteCalls.length = 0;
    mocks.updateCalls.length = 0;
  });

  it('T085: manual invoice editing and viewing continue to work when invoice detail rows include canonical recurring periods', async () => {
    const result = await updateManualInvoice('invoice-1', {
      clientId: 'client-1',
      items: [
        {
          service_id: 'service-1',
          quantity: 1,
          description: 'Manual adjustment',
          rate: 1500,
        },
      ],
      currency_code: 'USD',
    });

    expect(mocks.persistManualInvoiceCharges).toHaveBeenCalledTimes(1);
    expect(mocks.recalculateInvoice).toHaveBeenCalledWith('invoice-1');
    expect(mocks.getFullInvoiceById).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'invoice-1');
    expect(mocks.deleteCalls).toEqual([
      {
        tableName: 'invoice_charges',
        criteria: {
          invoice_id: 'invoice-1',
          tenant: 'tenant-1',
        },
      },
    ]);
    expect(mocks.updateCalls[0]).toMatchObject({
      tableName: 'invoices',
      criteria: { invoice_id: 'invoice-1' },
      payload: expect.objectContaining({
        currency_code: 'USD',
      }),
    });
    expect(result.invoice_charges[0]).toMatchObject({
      item_id: 'recurring-1',
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      billing_timing: 'arrears',
    });
  });

  it('T266: manual invoice actions remain stable when operating on invoices that also contain canonical recurring detail-backed charges', async () => {
    const result = await updateManualInvoice('invoice-1', {
      clientId: 'client-1',
      items: [
        {
          service_id: 'service-1',
          quantity: 1,
          description: 'Manual adjustment',
          rate: 1500,
        },
      ],
      currency_code: 'USD',
    });

    expect(mocks.persistManualInvoiceCharges).toHaveBeenCalledTimes(1);
    expect(mocks.recalculateInvoice).toHaveBeenCalledWith('invoice-1');

    const recurringCharge = result.invoice_charges.find((charge: any) => charge.item_id === 'recurring-1');
    const manualCharge = result.invoice_charges.find((charge: any) => charge.item_id === 'manual-1');

    expect(recurringCharge).toMatchObject({
      recurring_detail_periods: [
        {
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          billing_timing: 'arrears',
        },
      ],
    });
    expect(recurringCharge).not.toHaveProperty('recurring_projection');
    expect(manualCharge).not.toHaveProperty('recurring_detail_periods');
    expect(manualCharge).not.toHaveProperty('service_period_start');
    expect(manualCharge).not.toHaveProperty('service_period_end');
  });
});
