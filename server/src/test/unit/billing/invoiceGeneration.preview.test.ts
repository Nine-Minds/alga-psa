import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBillingCycleDueSelectionInput,
  buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

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
    whereNotNull: vi.fn((column: string) => {
      resultRows = resultRows.filter((row) => row[normalizeColumn(column)] != null);
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
  const getClientContractPurchaseOrderContext = vi.fn(async () => ({ po_number: null, po_amount: null }));
  const getPurchaseOrderConsumedCents = vi.fn(async () => 0);
  const computePurchaseOrderOverage = vi.fn(
    ({
      authorizedCents,
      consumedCents,
      invoiceTotalCents,
    }: {
      authorizedCents: number;
      consumedCents: number;
      invoiceTotalCents: number;
    }) => ({
      authorizedCents,
      consumedCents,
      remainingCents: authorizedCents - consumedCents,
      invoiceTotalCents,
      overageCents: Math.max(0, invoiceTotalCents - Math.max(0, authorizedCents - consumedCents)),
    }),
  );
  const hasPermission = vi.fn(() => true);
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
    getPurchaseOrderConsumedCents,
    computePurchaseOrderOverage,
    hasPermission,
    selectDueRecurringServicePeriodsForBillingWindow,
    calculateBilling,
    calculateBillingForExecutionWindow: vi.fn(async (...args: any[]) => calculateBilling(...args)),
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
  hasPermission: mocks.hasPermission,
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
  computePurchaseOrderOverage: mocks.computePurchaseOrderOverage,
  getClientContractPurchaseOrderContext: mocks.getClientContractPurchaseOrderContext,
  getPurchaseOrderConsumedCents: mocks.getPurchaseOrderConsumedCents,
}));

vi.mock('../../../../../packages/billing/src/lib/billing/billingEngine', () => ({
  BillingEngine: class {
    selectDueRecurringServicePeriodsForBillingWindow =
      mocks.selectDueRecurringServicePeriodsForBillingWindow;
    calculateBilling = mocks.calculateBilling;
    calculateBillingForExecutionWindow = mocks.calculateBillingForExecutionWindow;
  },
}));

const {
  previewInvoice,
  previewInvoiceForSelectionInput,
  getPurchaseOrderOverageForSelectionInput,
  generateInvoiceForSelectionInput,
} = await import(
  '../../../../../packages/billing/src/actions/invoiceGeneration'
);

describe('invoice preview recurring timing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockReturnValue(true);
    mocks.validateClientBillingEmail.mockResolvedValue({ valid: true });
    mocks.getClientDetails.mockResolvedValue({
      client_id: 'client-1',
      client_name: 'Acme Corp',
      location_address: '100 Main St',
      tax_region: 'US-NY',
    });
    mocks.getNextBillingDate.mockResolvedValue('2025-03-01');
    mocks.getDueDate.mockResolvedValue('2025-03-15');
    mocks.getClientDefaultTaxRegionCode.mockResolvedValue('US-NY');
    mocks.getClientLogoUrl.mockResolvedValue(null);
    mocks.getClientContractPurchaseOrderContext.mockResolvedValue({ po_number: null, po_amount: null });
    mocks.getPurchaseOrderConsumedCents.mockResolvedValue(0);
    mocks.computePurchaseOrderOverage.mockImplementation(
      ({
        authorizedCents,
        consumedCents,
        invoiceTotalCents,
      }: {
        authorizedCents: number;
        consumedCents: number;
        invoiceTotalCents: number;
      }) => ({
        authorizedCents,
        consumedCents,
        remainingCents: authorizedCents - consumedCents,
        invoiceTotalCents,
        overageCents: Math.max(0, invoiceTotalCents - Math.max(0, authorizedCents - consumedCents)),
      }),
    );
    mocks.selectDueRecurringServicePeriodsForBillingWindow.mockResolvedValue({
      'contract-line-1': {
        duePosition: 'arrears',
        servicePeriodStart: '2025-01-01',
        servicePeriodEnd: '2025-02-01',
        servicePeriodStartExclusive: '2025-01-01',
        servicePeriodEndExclusive: '2025-02-01',
        coverageRatio: 1,
      },
    });
    mocks.calculateBilling.mockResolvedValue({
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
    });
    mocks.calculateBillingForExecutionWindow.mockResolvedValue({
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
          client_contract_id: 'contract-1',
          contract_name: 'Zenith Annual Support',
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
    });
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
        recurringTimingSelectionSource: 'persisted',
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

    expect(result).toMatchObject({ success: true });
    expect(result.success && result.data.items[0]).toMatchObject({
      description: 'Managed Router',
      servicePeriodStart: '2025-01-01',
      servicePeriodEnd: '2025-02-01',
      billingTiming: 'arrears',
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

    expect(result).toMatchObject({ success: true });
    expect(result.success && result.data.items[0]).toMatchObject({
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
    });
  });

  it('T041: selector-input preview action validates invoice permissions the same way as the billing-cycle wrapper', async () => {
    mocks.hasPermission.mockReturnValue(false);

    const result = await previewInvoiceForSelectionInput(
      buildContractCadenceDueSelectionInput({
        clientId: 'client-1',
        contractId: 'contract-1',
        contractLineId: 'line-1',
        windowStart: '2025-02-08',
        windowEnd: '2025-03-08',
      }),
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Permission denied: Cannot preview invoices',
      executionIdentityKey: 'contract_cadence_window:contract:client-1:contract-1:line-1:2025-02-08:2025-03-08',
      billingCycleId: null,
    });
    expect(mocks.selectDueRecurringServicePeriodsForBillingWindow).not.toHaveBeenCalled();
  });

  it('T094: compatibility billing-cycle preview wrapper preserves the invalid and unauthorized error shape', async () => {
    mocks.hasPermission.mockReturnValue(false);

    const unauthorizedResult = await previewInvoice('cycle-1');

    expect(unauthorizedResult).toEqual({
      success: false,
      error: 'Permission denied: Cannot preview invoices',
    });
    expect(unauthorizedResult).not.toHaveProperty('executionIdentityKey');
    expect(unauthorizedResult).not.toHaveProperty('billingCycleId');

    mocks.hasPermission.mockReturnValue(true);

    const invalidResult = await previewInvoice('missing-cycle');

    expect(invalidResult).toEqual({
      success: false,
      error: 'Invalid billing cycle',
    });
    expect(invalidResult).not.toHaveProperty('executionIdentityKey');
    expect(invalidResult).not.toHaveProperty('billingCycleId');
  });

  it('T042: selector-input preview action returns the same recurring service-period details as billing-cycle preview for an equivalent client-cadence row', async () => {
    const selectorInput = buildBillingCycleDueSelectionInput({
      clientId: 'client-1',
      billingCycleId: 'cycle-1',
      windowStart: '2025-02-01',
      windowEnd: '2025-03-01',
    });

    const legacyResult = await previewInvoice('cycle-1');
    const selectorResult = await previewInvoiceForSelectionInput(selectorInput);

    expect(selectorResult).toEqual({
      success: true,
      data: expect.objectContaining({
        dueDate: legacyResult.success ? legacyResult.data.dueDate : undefined,
        subtotal: legacyResult.success ? legacyResult.data.subtotal : undefined,
        tax: legacyResult.success ? legacyResult.data.tax : undefined,
        total: legacyResult.success ? legacyResult.data.total : undefined,
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

  it('T043: selector-input preview action returns correct recurring service-period details for a contract-cadence row with no billing-cycle bridge', async () => {
    const selectorInput = buildContractCadenceDueSelectionInput({
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    });

    const result = await previewInvoiceForSelectionInput(selectorInput);

    expect(mocks.selectDueRecurringServicePeriodsForBillingWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-08',
      '2025-03-08',
      selectorInput.executionWindow.identityKey,
    );
    expect(mocks.calculateBillingForExecutionWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-08',
      '2025-03-08',
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
        recurringTimingSelectionSource: 'persisted',
      },
    );
    expect(result).toMatchObject({ success: true });
    expect(result.success && result.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Managed Router',
          servicePeriodStart: '2025-01-01',
          servicePeriodEnd: '2025-02-01',
          billingTiming: 'arrears',
        }),
      ]),
    );
  });

  it('T044: selector-input PO-overage action returns null when the preview spans no PO-governed client contract', async () => {
    mocks.calculateBillingForExecutionWindow.mockResolvedValueOnce({
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
          client_contract_id: null,
          contract_name: null,
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 4000,
      finalAmount: 4000,
      currency_code: 'USD',
    });

    const result = await getPurchaseOrderOverageForSelectionInput(
      buildContractCadenceDueSelectionInput({
        clientId: 'client-1',
        contractId: 'contract-1',
        contractLineId: 'line-1',
        windowStart: '2025-02-08',
        windowEnd: '2025-03-08',
      }),
    );

    expect(result).toBeNull();
    expect(mocks.getClientContractPurchaseOrderContext).not.toHaveBeenCalled();
    expect(mocks.computePurchaseOrderOverage).not.toHaveBeenCalled();
  });

  it('T045: selector-input PO-overage action computes overage correctly for a contract-cadence execution window', async () => {
    mocks.calculateBillingForExecutionWindow.mockResolvedValueOnce({
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
          client_contract_id: 'contract-1',
          contract_name: 'Zenith Annual Support',
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 4000,
      finalAmount: 4000,
      currency_code: 'USD',
    });
    mocks.getClientContractPurchaseOrderContext.mockResolvedValueOnce({
      po_number: 'PO-CONTRACT',
      po_amount: 3000,
    });
    mocks.getPurchaseOrderConsumedCents.mockResolvedValueOnce(500);

    const result = await getPurchaseOrderOverageForSelectionInput(
      buildContractCadenceDueSelectionInput({
        clientId: 'client-1',
        contractId: 'contract-1',
        contractLineId: 'line-1',
        windowStart: '2025-02-08',
        windowEnd: '2025-03-08',
      }),
    );

    expect(mocks.computePurchaseOrderOverage).toHaveBeenCalledWith({
      authorizedCents: 3000,
      consumedCents: 500,
      invoiceTotalCents: 4200,
    });
    expect(result).toEqual({
      client_contract_id: 'contract-1',
      po_number: 'PO-CONTRACT',
      authorized_cents: 3000,
      consumed_cents: 500,
      remaining_cents: 2500,
      invoice_total_cents: 4200,
      overage_cents: 1700,
    });
  });

  it('T048/T049: selector-input preview and generate validation failures include execution identity for unbridged recurring windows', async () => {
    mocks.validateClientBillingEmail.mockResolvedValueOnce({
      valid: false,
      error: 'Billing email is required before generating recurring invoices.',
    });
    mocks.validateClientBillingEmail.mockResolvedValueOnce({
      valid: false,
      error: 'Billing email is required before generating recurring invoices.',
    });

    const selectorInput = buildContractCadenceDueSelectionInput({
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    });

    const previewResult = await previewInvoiceForSelectionInput(selectorInput);

    await expect(generateInvoiceForSelectionInput(selectorInput)).rejects.toMatchObject({
      message: 'Billing email is required before generating recurring invoices.',
      executionIdentityKey: selectorInput.executionWindow.identityKey,
      billingCycleId: null,
    });

    expect(previewResult).toMatchObject({
      success: false,
      error: 'Billing email is required before generating recurring invoices.',
      executionIdentityKey: selectorInput.executionWindow.identityKey,
      billingCycleId: null,
    });
  });

  it('T050: selector-input recurring generation still enforces PO-required contract validation', async () => {
    mocks.calculateBillingForExecutionWindow.mockResolvedValueOnce({
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
          client_contract_id: 'contract-1',
          contract_name: 'Zenith Annual Support',
        },
      ],
      discounts: [],
      adjustments: [],
      totalAmount: 4000,
      finalAmount: 4000,
      currency_code: 'USD',
    });
    mocks.getClientContractPurchaseOrderContext.mockResolvedValueOnce({
      po_number: null,
      po_amount: null,
      po_required: true,
    });

    const selectorInput = buildContractCadenceDueSelectionInput({
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    });

    await expect(generateInvoiceForSelectionInput(selectorInput)).rejects.toMatchObject({
      message:
        'Purchase Order is required for this contract but has not been provided. Please add a PO number to the contract before generating invoices.',
      executionIdentityKey: selectorInput.executionWindow.identityKey,
      billingCycleId: null,
    });
  });
});
