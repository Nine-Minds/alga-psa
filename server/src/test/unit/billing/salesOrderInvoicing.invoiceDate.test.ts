import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';

// generateInvoiceForSalesOrder: the date handed to getDueDate and the inserted
// invoice_date must be the same tenant-local "today" (resolved once per order).
// The real resolveTenantToday runs against the fake DB below; only the clock
// (Temporal.Now.instant) is stubbed.

const mocks = vi.hoisted(() => ({
  settings: undefined as Record<string, unknown> | undefined,
  insertedInvoices: [] as Array<Record<string, any>>,
  getDueDate: vi.fn(),
}));

function makeBuilder(table: string) {
  const rows = () => {
    if (table === 'sales_order_lines') {
      return [{ so_line_id: 'l1', service_id: 's1', quantity_ordered: 2, quantity_fulfilled: 0, quantity_invoiced: 0, unit_price: 100 }];
    }
    return [];
  };
  const qb: any = {
    where: () => qb,
    andWhere: () => qb,
    select: () => qb,
    forUpdate: () => qb,
    orderBy: () => qb,
    whereExists: () => qb,
    update: async () => 1,
    insert: async (row: Record<string, any>) => {
      if (table === 'invoices') mocks.insertedInvoices.push(row);
    },
    first: async () => {
      if (table === 'sales_orders') {
        return { so_id: 'so-1', so_number: 'SO-1', client_id: 'client-1', currency_code: 'USD', status: 'confirmed', invoice_mode: 'manual' };
      }
      if (table === 'tenant_settings') return mocks.settings ? { settings: mocks.settings } : undefined;
      return undefined;
    },
    then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject),
  };
  return qb;
}

const fakeDb: any = vi.fn((table: string) => makeBuilder(table));
fakeDb.raw = vi.fn(() => ({}));
fakeDb.fn = { now: vi.fn(() => 'now') };

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 'tenant-1' }, ...args),
  getSession: vi.fn(),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: fakeDb })),
  withTransaction: vi.fn(async (_knex: any, cb: (trx: any) => Promise<unknown>) => cb(fakeDb)),
}));
vi.mock('@alga-psa/inventory/actions/fulfillmentActions', () => ({ fulfillSalesOrderLine: vi.fn() }));
vi.mock('@alga-psa/inventory/actions/dropShipActions', () => ({ confirmDropShipShipment: vi.fn() }));
vi.mock('../../../../../packages/billing/src/actions/invoiceGeneration', () => ({
  generateInvoiceNumber: vi.fn(async () => 'INV-1'),
}));
vi.mock('../../../../../packages/billing/src/actions/billingAndTax', () => ({ getDueDate: mocks.getDueDate }));
vi.mock('../../../../../packages/billing/src/actions/taxSourceActions', () => ({
  getInitialInvoiceTaxSource: vi.fn(async () => 'internal'),
}));
vi.mock('../../../../../packages/billing/src/services/taxService', () => ({ TaxService: class {} }));
vi.mock('../../../../../packages/billing/src/services/invoiceService', () => ({
  validateSessionAndTenant: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
  getClientDetails: vi.fn(async () => ({ client_id: 'client-1', client_name: 'Acme' })),
  validateClientBillingEmail: vi.fn(async () => ({ valid: true })),
  persistManualInvoiceCharges: vi.fn(async () => undefined),
  calculateAndDistributeTax: vi.fn(async () => undefined),
  updateInvoiceTotalsAndRecordTransaction: vi.fn(async () => undefined),
}));

import { generateInvoiceForSalesOrder } from '../../../../../packages/billing/src/actions/salesOrderInvoicingActions';

describe('generateInvoiceForSalesOrder tenant-local invoice date', () => {
  beforeEach(() => {
    mocks.settings = undefined;
    mocks.insertedInvoices.length = 0;
    mocks.getDueDate.mockReset();
    mocks.getDueDate.mockImplementation(async (_clientId: string, base: string) =>
      Temporal.PlainDate.from(base).add({ days: 30 }).toString());
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(Temporal.Instant.from('2026-10-18T22:00:00Z'));
  });
  afterEach(() => vi.restoreAllMocks());

  it('Sydney tenant at 2026-10-18T22:00Z: due-date base and invoice_date are both 2026-10-19', async () => {
    mocks.settings = { timezone: 'Australia/Sydney' };

    const result = await (generateInvoiceForSalesOrder as any)('so-1');

    expect(result).toMatchObject({ success: true });
    expect(mocks.getDueDate).toHaveBeenCalledTimes(1);
    expect(mocks.getDueDate).toHaveBeenCalledWith('client-1', '2026-10-19');
    expect(mocks.insertedInvoices[0].invoice_date).toBe('2026-10-19');
    expect(mocks.insertedInvoices[0].due_date).toBe('2026-11-18');
  });

  it('no saved timezone: both use the UTC date', async () => {
    const result = await (generateInvoiceForSalesOrder as any)('so-1');

    expect(result).toMatchObject({ success: true });
    expect(mocks.getDueDate).toHaveBeenCalledWith('client-1', '2026-10-18');
    expect(mocks.insertedInvoices[0].invoice_date).toBe('2026-10-18');
  });
});
