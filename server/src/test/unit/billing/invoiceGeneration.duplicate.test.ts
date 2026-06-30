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

  // Columns sourced from joined tables are not present on the base-table rows;
  // treat filters on missing columns as pass-through.
  const matchesValue = (row: Row, column: string, expected: any) => {
    const value = row[normalizeColumn(column)];
    return value === undefined ? true : value === expected;
  };

  const applyWhere = (...args: any[]) => {
    if (typeof args[0] === 'function') {
      // Grouped where callbacks are treated as pass-through in this stub.
      return builder;
    }
    if (typeof args[0] === 'object' && args[0] !== null) {
      const criteria: Record<string, any> = args[0];
      resultRows = resultRows.filter((row) =>
        Object.entries(criteria).every(([key, expected]) => matchesValue(row, key, expected)),
      );
      return builder;
    }
    if (args.length === 2) {
      resultRows = resultRows.filter((row) => matchesValue(row, args[0], args[1]));
      return builder;
    }
    // (column, operator, value) form — only equality is meaningful for this stub.
    if (args.length === 3 && args[1] === '=') {
      resultRows = resultRows.filter((row) => matchesValue(row, args[0], args[2]));
    }
    return builder;
  };

  const builder: any = {
    where: vi.fn(applyWhere),
    andWhere: vi.fn(applyWhere),
    join: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    modify: vi.fn((callback: (qb: any) => void) => {
      callback(builder);
      return builder;
    }),
    whereIn: vi.fn((column: string, values: any[]) => {
      resultRows = resultRows.filter((row) => {
        const value = row[normalizeColumn(column)];
        return value === undefined ? true : values.includes(value);
      });
      return builder;
    }),
    whereNotIn: vi.fn((column: string, values: any[]) => {
      resultRows = resultRows.filter((row) => {
        const value = row[normalizeColumn(column)];
        return value === undefined ? true : !values.includes(value);
      });
      return builder;
    }),
    whereNotNull: vi.fn((column: string) => {
      resultRows = resultRows.filter((row) => row[normalizeColumn(column)] != null);
      return builder;
    }),
    whereNull: vi.fn((column: string) => {
      resultRows = resultRows.filter((row) => row[normalizeColumn(column)] == null);
      return builder;
    }),
    orderBy: vi.fn(() => builder),
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
        obligation_type: 'client_contract_line',
        obligation_id: 'line-1',
        lifecycle_state: 'active',
        schedule_key: 'schedule:tenant-1:client_contract_line:assignment-1:client:advance',
        period_key: 'period:2025-02-01:2025-03-01',
        service_period_start: '2025-02-01',
        service_period_end: '2025-03-01',
        revision: 1,
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
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
  }),
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
      executionIdentityKey: selectorInput.executionWindow.identityKey,
      invoiceId: 'invoice-1',
    });
  });
});
