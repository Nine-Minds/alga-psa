import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

type Row = Record<string, any>;

function normalizeTableName(tableName: string) {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function createQueryBuilder(rows: Row[], tableName: string) {
  let resultRows = [...rows];
  let insertedRow: Row | null = null;

  const builder: any = {
    where: vi.fn((criteria: Record<string, any>) => {
      resultRows = resultRows.filter((row) =>
        Object.entries(criteria).every(([key, expected]) => row[key] === expected),
      );
      return builder;
    }),
    andWhere: vi.fn(() => builder),
    select: vi.fn(() => builder),
    first: vi.fn(async () => resultRows[0]),
    update: vi.fn(async () => 1),
    insert: vi.fn((payload: Row) => {
      insertedRow = {
        invoice_id: payload.invoice_id ?? `invoice-${rows.length + 1}`,
        ...payload,
      };
      rows.push(insertedRow);
      resultRows = [insertedRow];
      return builder;
    }),
    returning: vi.fn(async () => (insertedRow ? [insertedRow] : [])),
    raw: vi.fn((sql: string) => sql),
    then: (resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject),
  };

  if (tableName === 'ticket_materials' || tableName === 'project_materials') {
    builder.andWhere = vi.fn(() => builder);
  }

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
    ],
    invoices: [],
    client_billing_settings: [
      {
        client_id: 'client-1',
        tenant: 'tenant-1',
        suppress_zero_dollar_invoices: false,
        zero_dollar_invoice_handling: 'draft',
      },
    ],
    default_billing_settings: [],
    ticket_materials: [],
    project_materials: [],
  };

  const knex = vi.fn((tableName: string) =>
    createQueryBuilder(rowsByTable[normalizeTableName(tableName)] ?? [], normalizeTableName(tableName)),
  ) as any;
  knex.raw = vi.fn((sql: string) => sql);

  const getFullInvoiceById = vi.fn(async (_knex: unknown, _tenant: string, invoiceId: string) => {
    const invoice = rowsByTable.invoices.find((row) => row.invoice_id === invoiceId);
    return {
      invoice_id: invoiceId,
      billing_cycle_id: invoice?.billing_cycle_id ?? null,
      status: 'draft',
      invoice_charges: [
        {
          item_id: 'charge-1',
          service_period_start: '2025-01-01',
          service_period_end: '2025-02-01',
        },
      ],
    };
  });

  const contractBillingResult = {
    charges: [
      {
        type: 'product',
        serviceId: 'service-1',
        serviceName: 'Managed Router',
        quantity: 1,
        rate: 4200,
        total: 4200,
        tax_amount: 200,
        tax_rate: 5,
        tax_region: 'US-NY',
        is_taxable: true,
        client_contract_id: 'contract-1',
        contract_name: 'Zenith Annual Support',
        client_contract_line_id: 'line-1',
        servicePeriodStart: '2025-01-01',
        servicePeriodEnd: '2025-02-01',
        billingTiming: 'arrears',
      },
    ],
    discounts: [],
    adjustments: [],
    totalAmount: 4200,
    finalAmount: 4200,
    currency_code: 'USD',
  };

  const clientBillingResult = {
    ...contractBillingResult,
    charges: contractBillingResult.charges.map((charge) => ({
      ...charge,
      client_contract_id: 'assignment-1',
      contract_name: 'Acme Managed Services',
    })),
  };

  return {
    rowsByTable,
    clientBillingResult,
    contractBillingResult,
    knex,
    createTenantKnex: vi.fn(async () => ({ knex })),
    withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
      callback(knex),
    ),
    validateClientBillingEmail: vi.fn(async () => ({ valid: true })),
    getClientDetails: vi.fn(async () => ({
      client_id: 'client-1',
      client_name: 'Acme Corp',
      tax_region: 'US-NY',
    })),
    calculateAndDistributeTax: vi.fn(async () => 200),
    persistInvoiceCharges: vi.fn(async () => 4200),
    updateInvoiceTotalsAndRecordTransaction: vi.fn(async () => undefined),
    getNextBillingDate: vi.fn(async () => '2025-03-01T00:00:00.000Z'),
    getDueDate: vi.fn(async () => '2025-03-15'),
    selectDueRecurringServicePeriodsForBillingWindow: vi.fn(async () => ({
      'line-1': {
        duePosition: 'arrears',
        servicePeriodStart: '2025-01-01',
        servicePeriodEnd: '2025-02-01',
        servicePeriodStartExclusive: '2025-01-01',
        servicePeriodEndExclusive: '2025-02-01',
        coverageRatio: 1,
      },
    })),
    calculateBilling: vi.fn(async () => clientBillingResult),
    calculateBillingForExecutionWindow: vi.fn(async () => contractBillingResult),
    getClientDefaultTaxRegionCode: vi.fn(async () => 'US-NY'),
    getInitialInvoiceTaxSource: vi.fn(async () => 'internal'),
    shouldUseTaxDelegation: vi.fn(async () => false),
    getClientContractPurchaseOrderContext: vi.fn(async () => ({
      po_number: 'PO-100',
      po_required: false,
      po_amount: null,
    })),
    getPurchaseOrderConsumedCents: vi.fn(async () => 0),
    computePurchaseOrderOverage: vi.fn(),
    getClientCredit: vi.fn(async () => 0),
    applyCreditToInvoice: vi.fn(async () => undefined),
    finalizeInvoiceWithKnex: vi.fn(async () => undefined),
    getAnalyticsAsync: vi.fn(async () => ({
      analytics: { capture: vi.fn() },
      AnalyticsEvents: { INVOICE_GENERATED: 'invoice_generated' },
    })),
    getFullInvoiceById,
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
  requireTenantId: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('@alga-psa/shared/services/numberingService', () => ({
  SharedNumberingService: {
    getNextNumber: vi.fn(async () => 'INV-1001'),
  },
}));

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  validateClientBillingEmail: mocks.validateClientBillingEmail,
  getClientDetails: mocks.getClientDetails,
  calculateAndDistributeTax: mocks.calculateAndDistributeTax,
  persistInvoiceCharges: mocks.persistInvoiceCharges,
  updateInvoiceTotalsAndRecordTransaction: mocks.updateInvoiceTotalsAndRecordTransaction,
}));

vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({
  getNextBillingDate: mocks.getNextBillingDate,
  getDueDate: mocks.getDueDate,
}));

vi.mock('../../../../../packages/billing/src/lib/billing/billingEngine', () => ({
  BillingEngine: class {
    selectDueRecurringServicePeriodsForBillingWindow =
      mocks.selectDueRecurringServicePeriodsForBillingWindow;
    calculateBilling = mocks.calculateBilling;
    calculateBillingForExecutionWindow = mocks.calculateBillingForExecutionWindow;
    rolloverUnapprovedTime = vi.fn(async () => undefined);
  },
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getFullInvoiceById: mocks.getFullInvoiceById,
  },
}));

vi.mock('@alga-psa/shared/billingClients', () => ({
  getClientDefaultTaxRegionCode: mocks.getClientDefaultTaxRegionCode,
}));

vi.mock('../../../../../packages/billing/src/actions/taxSourceActions', () => ({
  getInitialInvoiceTaxSource: mocks.getInitialInvoiceTaxSource,
  shouldUseTaxDelegation: mocks.shouldUseTaxDelegation,
}));

vi.mock('../../../../../packages/billing/src/services/purchaseOrderService', () => ({
  computePurchaseOrderOverage: mocks.computePurchaseOrderOverage,
  getClientContractPurchaseOrderContext: mocks.getClientContractPurchaseOrderContext,
  getPurchaseOrderConsumedCents: mocks.getPurchaseOrderConsumedCents,
}));

vi.mock('../../../../../packages/billing/src/models/clientContractLine', () => ({
  default: {
    getClientCredit: mocks.getClientCredit,
  },
}));

vi.mock('../../../../../packages/billing/src/actions/creditActions', () => ({
  applyCreditToInvoice: mocks.applyCreditToInvoice,
}));

vi.mock('../../../../../packages/billing/src/actions/invoiceModification', () => ({
  finalizeInvoiceWithKnex: mocks.finalizeInvoiceWithKnex,
}));

vi.mock('../../../../../packages/billing/src/services/taxService', () => ({
  TaxService: class TaxService {
    ensureDefaultTaxSettings = vi.fn(async () => undefined);
  },
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getAnalyticsAsync: mocks.getAnalyticsAsync,
}));

const { generateInvoice, generateInvoiceForSelectionInput } = await import(
  '../../../../../packages/billing/src/actions/invoiceGeneration'
);

describe('selector-input recurring generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rowsByTable.invoices.length = 0;
    mocks.validateClientBillingEmail.mockResolvedValue({ valid: true });
    mocks.calculateBilling.mockResolvedValue(mocks.clientBillingResult);
    mocks.calculateBillingForExecutionWindow.mockResolvedValue(mocks.contractBillingResult);
  });

  it('T046: recurring generation API accepts a selector-input execution window and creates an invoice with no billing_cycle_id bridge', async () => {
    const selectorInput = buildContractCadenceDueSelectionInput({
      clientId: 'client-1',
      contractId: 'contract-1',
      contractLineId: 'line-1',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    });

    const result = await generateInvoiceForSelectionInput(selectorInput);

    expect(mocks.selectDueRecurringServicePeriodsForBillingWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-08',
      '2025-03-08',
      selectorInput.executionWindow.identityKey,
    );
    expect(mocks.calculateBillingForExecutionWindow).toHaveBeenCalled();
    expect(mocks.rowsByTable.invoices[0]?.billing_cycle_id ?? null).toBeNull();
    expect(result).toMatchObject({
      billing_cycle_id: null,
    });
  });

  it('T047: recurring generation API accepts a compatibility billing-cycle wrapper and routes internally through the selector-input pipeline', async () => {
    const result = await generateInvoice('cycle-1');

    expect(mocks.selectDueRecurringServicePeriodsForBillingWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z',
      'cycle-1',
    );
    expect(mocks.calculateBilling).toHaveBeenCalled();
    expect(mocks.rowsByTable.invoices[0]?.billing_cycle_id).toBe('cycle-1');
    expect(result).toMatchObject({
      billing_cycle_id: 'cycle-1',
    });
  });
});
