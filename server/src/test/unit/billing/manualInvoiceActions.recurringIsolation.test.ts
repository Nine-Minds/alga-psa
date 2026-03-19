import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const insertedInvoices: Record<string, any>[] = [];
  const trx = vi.fn((tableName: string) => {
    if (tableName !== 'invoices') {
      throw new Error(`Unexpected table ${tableName}`);
    }

    return {
      insert: vi.fn(async (payload: Record<string, any>) => {
        insertedInvoices.push(payload);
        return [payload];
      }),
    };
  });

  const knex = {
    transaction: vi.fn(async (callback: (trx: typeof trx) => Promise<unknown>) => callback(trx)),
  };

  const validateSessionAndTenant = vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
    knex,
  }));
  const getClientDetails = vi.fn(async () => ({
    client_id: 'client-1',
    client_name: 'Acme Corp',
    default_currency_code: 'USD',
  }));
  const validateClientBillingEmail = vi.fn(async () => ({ valid: true }));
  const persistManualInvoiceCharges = vi.fn(async () => undefined);
  const calculateAndDistributeTax = vi.fn(async () => undefined);
  const updateInvoiceTotalsAndRecordTransaction = vi.fn(async () => undefined);
  const getFullInvoiceById = vi.fn(async () => ({
    invoice_id: 'invoice-1',
    subtotal: 5000,
    tax: 0,
    total_amount: 5000,
    invoice_charges: [
      {
        item_id: 'manual-1',
        description: 'Manual setup fee',
        total_price: 5000,
        is_manual: true,
      },
    ],
  }));
  const billingEngineConstructor = vi.fn();
  const selectDueRecurringServicePeriodsForBillingWindow = vi.fn();
  const capture = vi.fn();
  const getAnalyticsAsync = vi.fn(async () => ({
    analytics: { capture },
    AnalyticsEvents: { INVOICE_GENERATED: 'INVOICE_GENERATED' },
  }));
  const generateInvoiceNumber = vi.fn(async () => 'INV-001');
  const getInitialInvoiceTaxSource = vi.fn(async () => 'internal');

  return {
    insertedInvoices,
    trx,
    validateSessionAndTenant,
    getClientDetails,
    validateClientBillingEmail,
    persistManualInvoiceCharges,
    calculateAndDistributeTax,
    updateInvoiceTotalsAndRecordTransaction,
    getFullInvoiceById,
    billingEngineConstructor,
    selectDueRecurringServicePeriodsForBillingWindow,
    getAnalyticsAsync,
    capture,
    generateInvoiceNumber,
    getInitialInvoiceTaxSource,
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
  validateClientBillingEmail: mocks.validateClientBillingEmail,
  persistManualInvoiceCharges: mocks.persistManualInvoiceCharges,
  calculateAndDistributeTax: mocks.calculateAndDistributeTax,
  updateInvoiceTotalsAndRecordTransaction: mocks.updateInvoiceTotalsAndRecordTransaction,
}));

vi.mock('../../../../../packages/billing/src/models/invoice', () => ({
  default: {
    getFullInvoiceById: mocks.getFullInvoiceById,
  },
}));

vi.mock('../../../../../packages/billing/src/lib/billing/billingEngine', () => ({
  BillingEngine: class {
    constructor() {
      mocks.billingEngineConstructor();
    }

    selectDueRecurringServicePeriodsForBillingWindow =
      mocks.selectDueRecurringServicePeriodsForBillingWindow;
  },
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: mocks.generateInvoiceNumber,
}));

vi.mock('../../../../../packages/billing/src/actions/taxSourceActions', () => ({
  getInitialInvoiceTaxSource: mocks.getInitialInvoiceTaxSource,
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getAnalyticsAsync: mocks.getAnalyticsAsync,
}));

vi.mock('../../../../../packages/billing/src/services/taxService', () => ({
  TaxService: class {},
}));

const { generateManualInvoice } = await import(
  '../../../../../packages/billing/src/actions/manualInvoiceActions'
);

describe('manual invoice recurring isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedInvoices.length = 0;
  });

  it('T084: manual invoice creation remains uncoupled from recurring service-period generation', async () => {
    const result = await generateManualInvoice({
      clientId: 'client-1',
      items: [
        {
          service_id: 'service-1',
          quantity: 1,
          description: 'Manual setup fee',
          rate: 5000,
        },
      ],
      currency_code: 'USD',
    });

    expect(result).toEqual({
      success: true,
      invoice: expect.objectContaining({
        invoice_id: 'invoice-1',
        total_amount: 5000,
      }),
    });
    expect(mocks.generateInvoiceNumber).toHaveBeenCalledTimes(1);
    expect(mocks.persistManualInvoiceCharges).toHaveBeenCalledTimes(1);
    expect(mocks.persistManualInvoiceCharges.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({
        description: 'Manual setup fee',
        rate: 5000,
      }),
    ]);
    expect(mocks.billingEngineConstructor).not.toHaveBeenCalled();
    expect(mocks.selectDueRecurringServicePeriodsForBillingWindow).not.toHaveBeenCalled();
    expect(mocks.insertedInvoices[0]).toMatchObject({
      client_id: 'client-1',
      is_manual: true,
      is_prepayment: false,
      tax_source: 'internal',
    });
  });

  it('T096: non-recurring manual prepayment invoice creation remains unchanged by the service-driven recurring cutover', async () => {
    const result = await generateManualInvoice({
      clientId: 'client-1',
      items: [
        {
          service_id: 'service-prepayment',
          quantity: 1,
          description: 'Prepaid block',
          rate: 12000,
        },
      ],
      isPrepayment: true,
      expirationDate: '2026-12-31',
      currency_code: 'USD',
    });

    expect(result).toEqual({
      success: true,
      invoice: expect.objectContaining({
        invoice_id: 'invoice-1',
        total_amount: 5000,
      }),
    });
    expect(mocks.persistManualInvoiceCharges).toHaveBeenCalledTimes(1);
    expect(mocks.updateInvoiceTotalsAndRecordTransaction).toHaveBeenCalledWith(
      mocks.trx,
      expect.any(String),
      expect.objectContaining({ client_id: 'client-1' }),
      'tenant-1',
      'INV-001',
      '2026-12-31',
    );
    expect(mocks.billingEngineConstructor).not.toHaveBeenCalled();
    expect(mocks.selectDueRecurringServicePeriodsForBillingWindow).not.toHaveBeenCalled();
    expect(mocks.insertedInvoices[0]).toMatchObject({
      client_id: 'client-1',
      is_manual: true,
      is_prepayment: true,
      tax_source: 'internal',
    });
  });
});
