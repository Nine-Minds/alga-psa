import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

function normalizeTableName(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumn(column: string): string {
  return column.replace(/^.*\./, '').replace(/\s+as\s+.*$/i, '').trim();
}

function buildClientCadenceServicePeriodRow(overrides: Row = {}): Row {
  return {
    record_id: 'rsp-client-1',
    tenant: 'tenant-1',
    cadence_owner: 'client',
    obligation_type: 'client_contract_line',
    client_id: 'client-1',
    schedule_key: 'schedule:tenant-1:client_contract_line:line-1:client:arrears',
    period_key: 'period:2025-01-01:2025-02-01',
    service_period_start: '2025-01-01',
    service_period_end: '2025-02-01',
    invoice_window_start: '2025-02-01',
    invoice_window_end: '2025-03-01',
    lifecycle_state: 'generated',
    revision: 1,
    invoice_id: null,
    ...overrides,
  };
}

function createQueryBuilder(rows: Row[]) {
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
    whereNotIn: vi.fn((column: string, values: any[]) => {
      resultRows = resultRows.filter((row) => !values.includes(row[normalizeColumn(column)]));
      return builder;
    }),
    select: vi.fn(() => builder),
    first: vi.fn(async () => resultRows[0]),
    join: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    raw: vi.fn((sql: string) => sql),
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
    ],
    invoices: [],
    recurring_service_periods: [buildClientCadenceServicePeriodRow()],
    client_billing_settings: [
      {
        client_id: 'client-1',
        tenant: 'tenant-1',
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: true,
      },
    ],
    default_billing_settings: [],
  };

  const knex = vi.fn((tableName: string) =>
    createQueryBuilder(rowsByTable[normalizeTableName(tableName)] ?? []),
  ) as any;
  knex.raw = vi.fn((sql: string) => sql);

  const createTenantKnex = vi.fn(async () => ({ knex }));
  const withTransaction = vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<unknown>) =>
    callback(knex),
  );
  const validateClientBillingEmail = vi.fn(async () => ({ valid: true }));
  const getNextBillingDate = vi.fn(async () => '2025-03-01T00:00:00.000Z');
  const selectDueRecurringServicePeriodsForBillingWindow = vi.fn(async () => ({}));
  const calculateBilling = vi.fn(async () => ({
    charges: [],
    discounts: [],
    adjustments: [],
    totalAmount: 0,
    finalAmount: 0,
    currency_code: 'USD',
  }));
  const getFullInvoiceById = vi.fn();

  return {
    rowsByTable,
    createTenantKnex,
    withTransaction,
    validateClientBillingEmail,
    getNextBillingDate,
    selectDueRecurringServicePeriodsForBillingWindow,
    calculateBilling,
    calculateBillingForExecutionWindow: vi.fn(async (...args: any[]) => calculateBilling(...args)),
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

vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  validateClientBillingEmail: mocks.validateClientBillingEmail,
  getClientDetails: vi.fn(),
  calculateAndDistributeTax: vi.fn(),
  persistInvoiceCharges: vi.fn(),
  updateInvoiceTotalsAndRecordTransaction: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({
  getNextBillingDate: mocks.getNextBillingDate,
  getDueDate: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/lib/billing/billingEngine', () => ({
  BillingEngine: class {
    selectDueRecurringServicePeriodsForBillingWindow =
      mocks.selectDueRecurringServicePeriodsForBillingWindow;
    calculateBilling = mocks.calculateBilling;
    calculateBillingForExecutionWindow = mocks.calculateBillingForExecutionWindow;
  },
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getFullInvoiceById: mocks.getFullInvoiceById,
  },
}));

vi.mock('../../../../../packages/billing/src/services/purchaseOrderService', () => ({
  computePurchaseOrderOverage: vi.fn(),
  getClientContractPurchaseOrderContext: vi.fn(),
  getPurchaseOrderConsumedCents: vi.fn(),
}));

vi.mock('@alga-psa/shared/billingClients', () => ({
  getClientDefaultTaxRegionCode: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/lib/authHelpers', () => ({
  getAnalyticsAsync: vi.fn(),
}));

const { generateInvoice } = await import(
  '../../../../../packages/billing/src/actions/invoiceGeneration'
);

describe('invoice generation empty recurring selections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rowsByTable.recurring_service_periods.splice(
      0,
      mocks.rowsByTable.recurring_service_periods.length,
      buildClientCadenceServicePeriodRow(),
    );
  });

  it('T077: recurring invoice generation returns the empty-result path when no due recurring service periods exist', async () => {
    const result = await generateInvoice('cycle-1');

    expect(
      mocks.selectDueRecurringServicePeriodsForBillingWindow,
    ).toHaveBeenCalledWith(
      'client-1',
      '2025-02-01',
      '2025-03-01',
    );
    expect(mocks.calculateBillingForExecutionWindow).toHaveBeenCalledWith(
      'client-1',
      '2025-02-01',
      '2025-03-01',
      {
        recurringTimingSelections: {},
        recurringTimingSelectionSource: 'persisted',
      },
    );
    expect(result).toBeNull();
    expect(mocks.getFullInvoiceById).not.toHaveBeenCalled();
  });
});
