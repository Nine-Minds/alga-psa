import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    insertedInvoices: [] as Array<Record<string, any>>,
    invoiceUpdates: [] as Array<Record<string, any>>,
    materialUpdates: [] as Array<Record<string, any>>,
  };

  const createTenantKnex = vi.fn(async () => ({ knex: {} }));
  const withTransaction = vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) => {
    const trx = ((tableName: string) => {
      const queryState = {
        tableName,
        where: undefined as Record<string, any> | undefined,
        andWhere: [] as Array<unknown[]>,
      };

      const builder: any = {
        insert: vi.fn((payload: Record<string, any>) => ({
          returning: vi.fn(async () => {
            const insertedRow = {
              invoice_id: payload.invoice_id ?? 'invoice-1',
              ...payload,
            };
            if (tableName === 'invoices') {
              state.insertedInvoices.push(insertedRow);
            }
            return [insertedRow];
          }),
        })),
        where: vi.fn((criteria: Record<string, any>) => {
          queryState.where = criteria;
          return builder;
        }),
        andWhere: vi.fn((...args: unknown[]) => {
          queryState.andWhere.push(args);
          return builder;
        }),
        update: vi.fn(async (patch: Record<string, any>) => {
          if (tableName === 'invoices') {
            state.invoiceUpdates.push({
              where: queryState.where,
              patch,
            });
          } else {
            state.materialUpdates.push({
              tableName,
              where: queryState.where,
              andWhere: [...queryState.andWhere],
              patch,
            });
          }
          return 1;
        }),
      };

      return builder;
    }) as any;

    return callback(trx);
  });
  const getNextNumber = vi.fn(async () => 'INV-1000');
  const persistInvoiceCharges = vi.fn(async () => 4200);
  const calculateAndDistributeTax = vi.fn(async () => 550);
  const updateInvoiceTotalsAndRecordTransaction = vi.fn(async () => undefined);
  const getClientDetails = vi.fn(async () => ({
    client_id: 'client-1',
    client_name: 'Acme Corp',
  }));
  const getDueDate = vi.fn(async () => '2025-03-15');
  const getClientDefaultTaxRegionCode = vi.fn(async () => 'US-NY');
  const getInitialInvoiceTaxSource = vi.fn(async () => 'internal');
  const shouldUseTaxDelegation = vi.fn(async () => false);
  const getClientCredit = vi.fn(async () => 0);
  const getClientContractPurchaseOrderContext = vi.fn(async () => ({ po_number: 'PO-100' }));
  const analyticsCapture = vi.fn();
  const getAnalyticsAsync = vi.fn(async () => ({
    analytics: {
      capture: analyticsCapture,
    },
    AnalyticsEvents: {
      INVOICE_GENERATED: 'invoice-generated',
    },
  }));

  return {
    state,
    createTenantKnex,
    withTransaction,
    getNextNumber,
    persistInvoiceCharges,
    calculateAndDistributeTax,
    updateInvoiceTotalsAndRecordTransaction,
    getClientDetails,
    getDueDate,
    getClientDefaultTaxRegionCode,
    getInitialInvoiceTaxSource,
    shouldUseTaxDelegation,
    getClientCredit,
    getClientContractPurchaseOrderContext,
    analyticsCapture,
    getAnalyticsAsync,
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'user-1',
          email: 'billing@example.com',
          first_name: 'Bill',
          last_name: 'Admin',
          username: 'billing-admin',
          image: null,
          tenant: 'tenant-1',
          user_type: 'internal',
          contact_id: 'contact-1',
        },
        { tenant: 'tenant-1' },
        ...args,
      ),
  hasPermission: vi.fn(() => true),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: mocks.withTransaction,
  createTenantKnex: mocks.createTenantKnex,
  runWithTenant: (_tenant: string, callback: () => unknown) => callback(),
  requireTenantId: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('@alga-psa/shared/services/numberingService', () => ({
  SharedNumberingService: {
    getNextNumber: mocks.getNextNumber,
  },
}));

vi.mock('@alga-psa/shared/billingClients', () => ({
  getClientDefaultTaxRegionCode: mocks.getClientDefaultTaxRegionCode,
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {},
}));

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  persistInvoiceCharges: mocks.persistInvoiceCharges,
  calculateAndDistributeTax: mocks.calculateAndDistributeTax,
  updateInvoiceTotalsAndRecordTransaction: mocks.updateInvoiceTotalsAndRecordTransaction,
  getClientDetails: mocks.getClientDetails,
  validateClientBillingEmail: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({
  getNextBillingDate: vi.fn(),
  getDueDate: mocks.getDueDate,
}));

vi.mock('../../../../../packages/billing/src/actions/taxSourceActions', () => ({
  getInitialInvoiceTaxSource: mocks.getInitialInvoiceTaxSource,
  shouldUseTaxDelegation: mocks.shouldUseTaxDelegation,
}));

vi.mock('../../../../../packages/billing/src/services/purchaseOrderService', () => ({
  computePurchaseOrderOverage: vi.fn(),
  getClientContractPurchaseOrderContext: mocks.getClientContractPurchaseOrderContext,
  getPurchaseOrderConsumedCents: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/models/clientContractLine', () => ({
  default: {
    getClientCredit: mocks.getClientCredit,
  },
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getAnalyticsAsync: mocks.getAnalyticsAsync,
}));

vi.mock('../../../../../packages/billing/src/services/pdfGenerationService', () => ({
  createPDFGenerationService: vi.fn(),
}));

const { createInvoiceFromBillingResult } = await import(
  '../../../../../packages/billing/src/actions/invoiceGeneration'
);

describe('invoice generation header billing periods', () => {
  const recurringBillingResult = {
    charges: [
      {
        item_id: 'charge-1',
        type: 'product',
        description: 'Managed Router',
        quantity: 1,
        rate: 4200,
        total: 4200,
        tax_amount: 0,
        client_contract_id: 'assignment-1',
        client_contract_line_id: 'contract-line-1',
        servicePeriodStart: '2025-01-01',
        servicePeriodEnd: '2025-02-01',
      },
    ],
    discounts: [],
    adjustments: [],
    totalAmount: 4200,
    finalAmount: 4200,
    currency_code: 'USD',
  } as any;

  beforeEach(() => {
    mocks.state.insertedInvoices.length = 0;
    mocks.state.invoiceUpdates.length = 0;
    mocks.state.materialUpdates.length = 0;
    vi.clearAllMocks();

    mocks.createTenantKnex.mockResolvedValue({ knex: {} });
    mocks.getNextNumber.mockResolvedValue('INV-1000');
    mocks.persistInvoiceCharges.mockResolvedValue(4200);
    mocks.calculateAndDistributeTax.mockResolvedValue(550);
    mocks.updateInvoiceTotalsAndRecordTransaction.mockResolvedValue(undefined);
    mocks.getClientDetails.mockResolvedValue({
      client_id: 'client-1',
      client_name: 'Acme Corp',
    });
    mocks.getDueDate.mockResolvedValue('2025-03-15');
    mocks.getClientDefaultTaxRegionCode.mockResolvedValue('US-NY');
    mocks.getInitialInvoiceTaxSource.mockResolvedValue('internal');
    mocks.shouldUseTaxDelegation.mockResolvedValue(false);
    mocks.getClientCredit.mockResolvedValue(0);
    mocks.getClientContractPurchaseOrderContext.mockResolvedValue({ po_number: 'PO-100' });
    mocks.getAnalyticsAsync.mockResolvedValue({
      analytics: {
        capture: mocks.analyticsCapture,
      },
      AnalyticsEvents: {
        INVOICE_GENERATED: 'invoice-generated',
      },
    });
  });

  it('T072: invoice headers keep billing_period_start and billing_period_end on the invoice window even when recurring detail periods differ', async () => {
    await createInvoiceFromBillingResult(
      recurringBillingResult,
      'client-1',
      '2025-02-01',
      '2025-03-01',
      'cycle-1',
      'user-1',
    );

    expect(mocks.state.insertedInvoices).toHaveLength(1);
    expect(mocks.state.insertedInvoices[0]).toMatchObject({
      billing_cycle_id: 'cycle-1',
      po_number: 'PO-100',
    });
    expect(mocks.state.insertedInvoices[0].billing_period_start.toString()).toBe(
      '2025-02-01',
    );
    expect(mocks.state.insertedInvoices[0].billing_period_end.toString()).toBe(
      '2025-03-01',
    );
    expect(mocks.state.insertedInvoices[0].billing_period_start.toString()).not.toBe(
      recurringBillingResult.charges[0].servicePeriodStart,
    );
    expect(mocks.state.insertedInvoices[0].billing_period_end.toString()).not.toBe(
      recurringBillingResult.charges[0].servicePeriodEnd,
    );
  });

  it('T073: invoice subtotal and total updates remain derived from persisted charges and tax, not recurring detail period boundaries', async () => {
    mocks.persistInvoiceCharges.mockResolvedValue(4200);
    mocks.calculateAndDistributeTax.mockResolvedValue(550);

    await createInvoiceFromBillingResult(
      recurringBillingResult,
      'client-1',
      '2025-02-01',
      '2025-03-01',
      'cycle-1',
      'user-1',
    );

    expect(mocks.persistInvoiceCharges).toHaveBeenCalledWith(
      expect.any(Function),
      'invoice-1',
      recurringBillingResult.charges,
      expect.objectContaining({ client_id: 'client-1' }),
      expect.objectContaining({
        user: expect.objectContaining({
          id: 'user-1',
          tenant: 'tenant-1',
        }),
      }),
      'tenant-1',
    );
    expect(mocks.state.invoiceUpdates).toContainEqual({
      where: { invoice_id: 'invoice-1', tenant: 'tenant-1' },
      patch: {
        subtotal: 4200,
        tax: 550,
        total_amount: 4750,
        credit_applied: 0,
      },
    });
    expect(mocks.updateInvoiceTotalsAndRecordTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      'invoice-1',
      expect.objectContaining({ client_id: 'client-1' }),
      'tenant-1',
      'INV-1000',
    );
  });

  it('T074: recurring invoice generation still enters the draft-plus-finalization pipeline after service-period-first timing selection', async () => {
    await createInvoiceFromBillingResult(
      recurringBillingResult,
      'client-1',
      '2025-02-01',
      '2025-03-01',
      'cycle-1',
      'user-1',
    );

    expect(mocks.state.insertedInvoices[0]).toMatchObject({
      invoice_number: 'INV-1000',
      status: 'draft',
      client_id: 'client-1',
      billing_cycle_id: 'cycle-1',
    });
    expect(
      mocks.persistInvoiceCharges.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.updateInvoiceTotalsAndRecordTransaction.mock.invocationCallOrder[0],
    );
    expect(mocks.analyticsCapture).toHaveBeenCalledWith(
      'invoice-generated',
      expect.objectContaining({
        invoice_id: 'invoice-1',
        client_id: 'client-1',
        billing_period_start: '2025-02-01',
        billing_period_end: '2025-03-01',
        charge_count: 1,
        discount_count: 0,
        is_manual: false,
      }),
      'user-1',
    );
  });
});
