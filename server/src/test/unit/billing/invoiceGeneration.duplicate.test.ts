import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClientCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';

type Row = Record<string, any>;

function normalizeTableName(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function normalizeColumn(column: string): string {
  return column.replace(/^.*\./, '').replace(/\s+as\s+.*$/i, '').trim();
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
    select: vi.fn(() => builder),
    first: vi.fn(async () => resultRows[0]),
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
    invoices: [
      {
        invoice_id: 'invoice-1',
        billing_cycle_id: null,
        tenant: 'tenant-1',
      },
    ],
    recurring_service_periods: [
      {
        record_id: 'record-1',
        tenant: 'tenant-1',
        cadence_owner: 'client',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
        period_key: 'period:2025-02-01:2025-03-01',
        invoice_window_start: '2025-02-01',
        invoice_window_end: '2025-03-01',
        invoice_id: 'invoice-1',
      },
    ],
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

  return {
    createTenantKnex,
    withTransaction,
    validateClientBillingEmail,
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
  getNextBillingDate: vi.fn(),
  getDueDate: vi.fn(),
}));

vi.mock('../../../../../packages/billing/src/lib/billing/billingEngine', () => ({
  BillingEngine: class {},
}));

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getFullInvoiceById: vi.fn(),
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

const {
  generateInvoiceForSelectionInput,
} = await import('../../../../../packages/billing/src/actions/invoiceGeneration');
const {
  DUPLICATE_RECURRING_INVOICE_CODE,
} = await import('../../../../../packages/billing/src/actions/invoiceGeneration.constants');

describe('invoice generation duplicate prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T020: duplicate-invoice prevention blocks a second invoice for the same client-cadence recurring window without consulting invoices.billing_cycle_id', async () => {
    const selectorInput = buildClientCadenceDueSelectionInput({
      clientId: 'client-1',
      scheduleKey: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
      periodKey: 'period:2025-02-01:2025-03-01',
      windowStart: '2025-02-01',
      windowEnd: '2025-03-01',
    });

    await expect(generateInvoiceForSelectionInput(selectorInput)).rejects.toMatchObject({
      message: 'Invoice already exists for this recurring execution window',
      code: DUPLICATE_RECURRING_INVOICE_CODE,
      billingCycleId: null,
      executionIdentityKey: selectorInput.executionWindow.identityKey,
      invoiceId: 'invoice-1',
    });
  });
});
