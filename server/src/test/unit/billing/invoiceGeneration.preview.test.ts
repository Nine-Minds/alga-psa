import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

function normalizeTableName(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumn(column: string): string {
  return column.replace(/^.*\./, '').replace(/\s+as\s+.*$/i, '').trim();
}

function createQueryBuilder(rows: Row[], raw: (sql: string) => string) {
  let resultRows = [...rows];

  const builder: any = {
    where: vi.fn((criteria: Record<string, any>) => {
      resultRows = resultRows.filter((row) =>
        Object.entries(criteria).every(([key, expected]) => row[normalizeColumn(key)] === expected),
      );
      return builder;
    }),
    select: vi.fn(() => builder),
    first: vi.fn(async () => resultRows[0]),
    leftJoin: vi.fn(() => builder),
    raw,
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject),
  };

  return builder;
}

const mocks = vi.hoisted(() => {
  const rowsByTable: Record<string, Row[]> = {
    client_billing_cycles: [
      {
        billing_cycle_id: 'cycle-1',
        tenant: 'tenant-1',
        client_id: 'client-1',
        effective_date: '2025-02-01',
      },
    ],
    clients: [
      {
        client_id: 'client-1',
        tenant: 'tenant-1',
        client_name: 'Acme Corp',
      },
      {
        client_id: 'tenant-client-1',
        tenant: 'tenant-1',
        client_name: 'Alga PSA',
        address: '500 Billing Ave',
      },
    ],
    tenant_companies: [
      {
        tenant: 'tenant-1',
        is_default: true,
        client_id: 'tenant-client-1',
      },
    ],
  };

  const raw = vi.fn((sql: string) => sql);
  const knex = vi.fn((tableName: string) =>
    createQueryBuilder(rowsByTable[normalizeTableName(tableName)] ?? [], raw),
  ) as any;
  knex.raw = raw;

  const createTenantKnex = vi.fn(async () => ({ knex }));
  const withTransaction = vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
    callback(knex),
  );
  const getClientDetails = vi.fn(async () => ({
    client_id: 'client-1',
    client_name: 'Acme Corp',
    location_address: '100 Main St',
    tax_region: 'US-NY',
  }));
  const validateClientBillingEmail = vi.fn(async () => ({ valid: true }));
  const getNextBillingDate = vi.fn(async () => '2025-03-01');
  const getDueDate = vi.fn(async () => '2025-03-15');
  const getClientDefaultTaxRegionCode = vi.fn(async () => 'US-NY');
  const getClientLogoUrl = vi.fn(async () => null);
  const getClientContractPurchaseOrderContext = vi.fn(async () => ({ po_number: null }));
  const selectDueRecurringServicePeriodsForBillingWindow = vi.fn(async () => ({
    'contract-line-1': {
      duePosition: 'arrears',
      servicePeriodStart: '2025-01-01',
      servicePeriodEnd: '2025-02-01',
      servicePeriodStartExclusive: '2025-01-01',
      servicePeriodEndExclusive: '2025-02-01',
      coverageRatio: 1,
    },
  }));
  const calculateBilling = vi.fn(async () => ({
    charges: [
      {
        type: 'product',
        serviceId: 'service-1',
        serviceName: 'Managed Router',
        quantity: 1,
        rate: 4000,
        total: 4000,
        tax_amount: 200,
        tax_rate: 5,
        tax_region: 'US-NY',
        is_taxable: true,
        servicePeriodStart: '2025-01-01',
        servicePeriodEnd: '2025-02-01',
        billingTiming: 'arrears',
      },
    ],
    discounts: [],
    adjustments: [],
    totalAmount: 4000,
    finalAmount: 4000,
    currency_code: 'USD',
  }));

  return {
    createTenantKnex,
    withTransaction,
    getClientDetails,
    validateClientBillingEmail,
    getNextBillingDate,
    getDueDate,
    getClientDefaultTaxRegionCode,
    getClientLogoUrl,
    getClientContractPurchaseOrderContext,
    selectDueRecurringServicePeriodsForBillingWindow,
    calculateBilling,
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
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  getClientDetails: mocks.getClientDetails,
  validateClientBillingEmail: mocks.validateClientBillingEmail,
  calculateAndDistributeTax: vi.fn(),
  persistInvoiceCharges: vi.fn(),
  updateInvoiceTotalsAndRecordTransaction: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({
  getNextBillingDate: mocks.getNextBillingDate,
  getDueDate: mocks.getDueDate,
}));

vi.mock('@alga-psa/shared/billingClients', () => ({
  getClientDefaultTaxRegionCode: mocks.getClientDefaultTaxRegionCode,
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: mocks.getClientLogoUrl,
}));

vi.mock('../../../../../packages/billing/src/services/purchaseOrderService', () => ({
  computePurchaseOrderOverage: vi.fn(),
  getClientContractPurchaseOrderContext: mocks.getClientContractPurchaseOrderContext,
  getPurchaseOrderConsumedCents: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/lib/billing/billingEngine', () => ({
  BillingEngine: class {
    selectDueRecurringServicePeriodsForBillingWindow =
      mocks.selectDueRecurringServicePeriodsForBillingWindow;
    calculateBilling = mocks.calculateBilling;
  },
}));

const { previewInvoice } = await import(
  '../../../../../packages/billing/src/actions/invoiceGeneration'
);

describe('invoice preview recurring timing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T076: one-cycle invoice preview uses canonical service periods and still matches expected recurring totals', async () => {
    const result = await previewInvoice('cycle-1');

    expect(
      mocks.selectDueRecurringServicePeriodsForBillingWindow,
    ).toHaveBeenCalledWith('client-1', '2025-02-01', '2025-03-01', 'cycle-1');
    expect(mocks.calculateBilling).toHaveBeenCalledWith(
      'client-1',
      '2025-02-01',
      '2025-03-01',
      'cycle-1',
      {
        recurringTimingSelections: {
          'contract-line-1': {
            duePosition: 'arrears',
            servicePeriodStart: '2025-01-01',
            servicePeriodEnd: '2025-02-01',
            servicePeriodStartExclusive: '2025-01-01',
            servicePeriodEndExclusive: '2025-02-01',
            coverageRatio: 1,
          },
        },
      },
    );
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        invoiceNumber: 'PREVIEW',
        dueDate: '2025-03-15',
        currencyCode: 'USD',
        subtotal: 4000,
        tax: 200,
        total: 4200,
        customer: {
          name: 'Acme Corp',
          address: '100 Main St',
        },
        items: [
          expect.objectContaining({
            description: 'Managed Router',
            quantity: 1,
            unitPrice: 4000,
            total: 4000,
          }),
        ],
      }),
    });
  });

  it('T083: recurring invoice preview surfaces canonical service periods in preview state', async () => {
    const result = await previewInvoice('cycle-1');

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        items: [
          expect.objectContaining({
            description: 'Managed Router',
            servicePeriodStart: '2025-01-01',
            servicePeriodEnd: '2025-02-01',
            billingTiming: 'arrears',
          }),
        ],
      }),
    });
  });

  it('T194: preview rows keep canonical recurring detail periods when one preview charge spans multiple periods', async () => {
    mocks.calculateBilling.mockResolvedValueOnce({
      charges: [
        {
          type: 'product',
          serviceId: 'service-1',
          serviceName: 'Managed Router',
          quantity: 1,
          rate: 4000,
          total: 4000,
          tax_amount: 200,
          tax_rate: 5,
          tax_region: 'US-NY',
          is_taxable: true,
          recurringDetailPeriods: [
            {
              servicePeriodStart: '2025-01-01',
              servicePeriodEnd: '2025-02-01',
              billingTiming: 'arrears',
            },
            {
              servicePeriodStart: '2025-02-01',
              servicePeriodEnd: '2025-03-01',
              billingTiming: 'advance',
            },
          ],
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 4000,
      finalAmount: 4000,
      currency_code: 'USD',
    });

    const result = await previewInvoice('cycle-1');

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        items: [
          expect.objectContaining({
            description: 'Managed Router',
            servicePeriodStart: '2025-01-01',
            servicePeriodEnd: '2025-03-01',
            billingTiming: null,
            recurringDetailPeriods: [
              {
                servicePeriodStart: '2025-01-01',
                servicePeriodEnd: '2025-02-01',
                billingTiming: 'arrears',
              },
              {
                servicePeriodStart: '2025-02-01',
                servicePeriodEnd: '2025-03-01',
                billingTiming: 'advance',
              },
            ],
          }),
        ],
      }),
    });
  });
});
