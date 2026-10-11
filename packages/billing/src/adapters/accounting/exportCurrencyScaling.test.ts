import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingExportAdapterContext, AccountingExportLine } from '@alga-psa/types';

/**
 * Money is stored as integer minor units whose exponent depends on the
 * currency (USD cents = 2, JPY yen = 0). Every export adapter must scale by
 * the document's own currency — a JPY 10,000 invoice is 10000 on the wire,
 * not 100 — while 2-digit currencies stay byte-for-byte as before.
 *
 * The adapters read their rows through the tenant facade; a table-keyed
 * in-memory fake stands in for the database so the transform runs for real.
 */

const harness = vi.hoisted(() => {
  const rows: Record<string, any[]> = {};
  const tableName = (expr: string) => expr.split(/\s+as\s+/i)[0].trim();
  const builder = (list: any[]) => {
    const qb: any = {};
    for (const method of [
      'select', 'where', 'whereIn', 'whereNull', 'whereNotNull', 'whereRaw',
      'andWhere', 'orderBy', 'limit', 'leftJoin', 'join', 'groupBy'
    ]) {
      qb[method] = () => qb;
    }
    qb.modify = (cb: (q: any) => void) => { cb(qb); return qb; };
    qb.first = async () => list[0] ?? null;
    qb.then = (resolve: any, reject?: any) => Promise.resolve(list).then(resolve, reject);
    return qb;
  };
  const knex: any = (expr: string) => builder(rows[tableName(expr)] ?? []);
  knex.table = knex;
  const tenantDb = () => ({ table: (expr: string) => builder(rows[tableName(expr)] ?? []) });
  return { rows, knex, tenantDb };
});

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: harness.knex, tenant: 'tenant-x' })),
  tenantDb: vi.fn(() => harness.tenantDb()),
  withTransaction: vi.fn(async (knex: any, cb: (trx: any) => Promise<unknown>) => cb(knex))
}));

vi.mock('../../services/accountingMappingResolver', () => ({
  AccountingMappingResolver: {
    create: vi.fn(async () => ({
      resolveServiceMapping: vi.fn(async () => ({
        external_entity_id: 'item-1',
        metadata: { name: 'Consulting', itemCode: 'CONS', accountCode: '200', taxType: 'OUTPUT' }
      })),
      resolveDiscountMapping: vi.fn(async () => null),
      resolveTaxCodeMapping: vi.fn(async () => null),
      resolvePaymentTermMapping: vi.fn(async () => null),
      resolveClientMapping: vi.fn(async () => null),
      ensureCompanyMapping: vi.fn(async () => null)
    }))
  }
}));

vi.mock('../../services/accountingSync/accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    defaultExpenseAccountRef: { value: 'exp-1', name: 'Hardware Expense' },
    autoProvisionCustomers: false,
    defaultClassRef: null,
    defaultDepartmentRef: null
  }))
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboTaxSettings', () => ({
  isQboAutomatedSalesTaxEnabled: vi.fn(async () => false)
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboCompanyCountry', () => ({
  getQboCompanyCountry: vi.fn(async () => null),
  isQboUnitedStatesCompany: vi.fn(async () => true),
  isUnitedStatesQboCountry: (country: string | null) => country === 'US'
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn() },
  getDefaultQboRealmId: vi.fn(async () => 'realm-1')
}));

vi.mock('@alga-psa/shared/billingClients/billingProfileExternalMapping', () => ({
  CLIENT_ENTITY_TYPE: 'client',
  BILLING_PROFILE_ENTITY_TYPE: 'billing_profile',
  resolveInvoiceExportTarget: vi.fn(async (_knex: unknown, _tenant: string, clientId: string, clientName: string) => ({
    algaEntityType: 'client',
    algaEntityId: clientId,
    clientId,
    displayName: clientName,
    isSubCustomer: false
  }))
}));

const TENANT = 'tenant-x';
const REALM = 'realm-1';
const CLIENT = 'client-1';
const INVOICE = 'invoice-1';
const CHARGE = 'charge-1';
const BILL = 'bill-1';
const NOW = '2026-01-01T00:00:00.000Z';

function context(
  exportType: 'invoice' | 'vendor_bill',
  adapterType: string,
  lines: Array<Partial<AccountingExportLine>>
): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: TENANT,
      batch_id: 'batch-1',
      adapter_type: adapterType,
      target_realm: REALM,
      export_type: exportType,
      status: 'pending',
      queued_at: NOW,
      created_at: NOW,
      updated_at: NOW
    } as any,
    lines: lines.map((line, index) => ({
      tenant: TENANT,
      line_id: `line-${index + 1}`,
      batch_id: 'batch-1',
      status: 'pending',
      created_at: NOW,
      updated_at: NOW,
      ...line
    })) as AccountingExportLine[]
  };
}

interface ChargeFixture {
  itemId?: string;
  serviceId?: string | null;
  isDiscount?: boolean;
  quantity: number;
  unitPrice: number | null;
  netAmount: number;
  taxAmount: number;
}

function seedInvoice(currency: string, charges: ChargeFixture[]): AccountingExportLine[] {
  harness.rows.invoices = [{
    invoice_id: INVOICE,
    invoice_number: 'INV-0001',
    po_number: null,
    invoice_date: '2026-01-05',
    due_date: '2026-02-04',
    total_amount: charges.reduce((sum, c) => sum + c.netAmount + c.taxAmount, 0),
    client_id: CLIENT,
    currency_code: currency,
    exchange_rate_basis_points: null,
    invoice_type: 'standard',
    billing_profile_id: null,
    tax_source: 'internal'
  }];
  harness.rows.invoice_charges = charges.map((c, index) => ({
    item_id: c.itemId ?? (index === 0 ? CHARGE : `${CHARGE}-${index + 1}`),
    invoice_id: INVOICE,
    service_id: c.serviceId === undefined ? 'svc-1' : c.serviceId,
    description: c.isDiscount ? 'Loyalty discount' : 'Consulting',
    quantity: c.quantity,
    unit_price: c.unitPrice,
    total_price: c.netAmount + c.taxAmount,
    net_amount: c.netAmount,
    tax_amount: c.taxAmount,
    is_taxable: !c.isDiscount,
    is_discount: Boolean(c.isDiscount),
    tax_region: null
  }));
  harness.rows.clients = [{ client_id: CLIENT, client_name: 'Acme KK', billing_email: null, payment_terms: null }];
  harness.rows.tenant_external_entity_mappings = [{
    id: 'map-1',
    integration_type: 'quickbooks_online',
    alga_entity_type: 'client',
    alga_entity_id: CLIENT,
    external_entity_id: 'qbo-cust-1',
    external_realm_id: REALM,
    metadata: null
  }];
  return harness.rows.invoice_charges.map((charge) => ({
    document_id: INVOICE,
    document_line_id: charge.item_id,
    client_id: CLIENT,
    amount_cents: charge.net_amount,
    currency_code: currency
  })) as AccountingExportLine[];
}

function seedVendorBill(currency: string, amount: number): AccountingExportLine[] {
  harness.rows.vendor_bills = [{
    bill_id: BILL,
    bill_number: 'VB-0001',
    vendor_id: 'vendor-1',
    vendor_name: 'Parts Supplier',
    bill_date: '2026-01-05',
    due_date: '2026-02-04',
    total_amount: amount,
    currency_code: currency,
    notes: null
  }];
  harness.rows.vendor_bill_lines = [{
    bill_line_id: 'bill-line-1',
    bill_id: BILL,
    service_id: 'svc-1',
    service_name: 'Hardware',
    description: 'Server parts',
    quantity: 1,
    unit_cost: amount,
    amount
  }];
  return [{ document_id: BILL, document_line_id: null, client_id: null, amount_cents: amount, currency_code: currency }] as AccountingExportLine[];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(harness.rows)) delete harness.rows[key];
});

describe('QuickBooks Online adapter scales money by the document currency', () => {
  it('exports a JPY invoice in whole yen and a USD invoice in dollars', async () => {
    const { QuickBooksOnlineAdapter } = await import('./quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();

    const jpyLines = seedInvoice('JPY', [{ quantity: 2, unitPrice: 5000, netAmount: 10000, taxAmount: 800 }]);
    const jpy = await adapter.transform(context('invoice', adapter.type, jpyLines));
    const jpyInvoice = (jpy.documents[0].payload as any).invoice;
    expect(jpyInvoice.CurrencyRef).toEqual({ value: 'JPY' });
    expect(jpyInvoice.Line[0].Amount).toBe(10000);
    expect(jpyInvoice.Line[0].SalesItemLineDetail.UnitPrice).toBe(5000);
    expect(jpyInvoice.Line[0].SalesItemLineDetail.Qty).toBe(2);
    expect(jpyInvoice.TxnTaxDetail).toEqual({ TotalTax: 800 });

    const usdLines = seedInvoice('USD', [{ quantity: 2, unitPrice: 525, netAmount: 1050, taxAmount: 84 }]);
    const usd = await adapter.transform(context('invoice', adapter.type, usdLines));
    const usdInvoice = (usd.documents[0].payload as any).invoice;
    expect(usdInvoice.CurrencyRef).toEqual({ value: 'USD' });
    expect(usdInvoice.Line[0].Amount).toBe(10.5);
    expect(usdInvoice.Line[0].SalesItemLineDetail.UnitPrice).toBe(5.25);
    expect(usdInvoice.TxnTaxDetail).toEqual({ TotalTax: 0.84 });
  });

  it('exports a JPY vendor bill in whole yen and a USD vendor bill in dollars', async () => {
    const { QuickBooksOnlineAdapter } = await import('./quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();

    const jpy = await adapter.transform(context('vendor_bill', adapter.type, seedVendorBill('JPY', 10000)));
    const jpyBill = (jpy.documents[0].payload as any).bill;
    expect(jpyBill.CurrencyRef).toEqual({ value: 'JPY' });
    expect(jpyBill.Line[0].Amount).toBe(10000);

    const usd = await adapter.transform(context('vendor_bill', adapter.type, seedVendorBill('USD', 12500)));
    const usdBill = (usd.documents[0].payload as any).bill;
    expect(usdBill.CurrencyRef).toEqual({ value: 'USD' });
    expect(usdBill.Line[0].Amount).toBe(125);
  });
});

describe('QuickBooks CSV adapter formats money with the document currency digits', () => {
  it('emits whole-yen strings for JPY and two-decimal strings for USD', async () => {
    const { QuickBooksCSVAdapter } = await import('./quickBooksCSVAdapter');
    const adapter = new QuickBooksCSVAdapter();

    const jpyLines = seedInvoice('JPY', [{ quantity: 2, unitPrice: 5000, netAmount: 10000, taxAmount: 800 }]);
    const jpy = await adapter.transform(context('invoice', adapter.type, jpyLines));
    const jpyRow = (jpy.documents[0].payload as any).csvRows[0];
    expect(jpyRow['*ItemQuantity']).toBe('2');
    expect(jpyRow['*ItemRate']).toBe('5000');
    expect(jpyRow['*ItemAmount']).toBe('10000');
    expect(jpyRow.TaxAmount).toBe('800');

    const usdLines = seedInvoice('USD', [{ quantity: 2, unitPrice: 525, netAmount: 1050, taxAmount: 84 }]);
    const usd = await adapter.transform(context('invoice', adapter.type, usdLines));
    const usdRow = (usd.documents[0].payload as any).csvRows[0];
    expect(usdRow['*ItemRate']).toBe('5.25');
    expect(usdRow['*ItemAmount']).toBe('10.50');
    expect(usdRow.TaxAmount).toBe('0.84');
  });
});

describe('Xero CSV adapter formats unit amounts with the document currency digits', () => {
  it('emits whole-yen unit amounts for JPY and two-decimal (signed) amounts for USD', async () => {
    const { XeroCsvAdapter } = await import('./xeroCsvAdapter');
    const adapter = new XeroCsvAdapter();

    const jpyLines = seedInvoice('JPY', [{ quantity: 2, unitPrice: 5000, netAmount: 10000, taxAmount: 800 }]);
    const jpy = await adapter.transform(context('invoice', adapter.type, jpyLines));
    const jpyRow = (jpy.documents[0].payload as any).rows[0];
    expect(jpyRow['*Quantity']).toBe('2');
    expect(jpyRow['*UnitAmount']).toBe('5000');
    expect(jpyRow.Currency).toBe('JPY');

    const usdLines = seedInvoice('USD', [
      { quantity: 2, unitPrice: 525, netAmount: 1050, taxAmount: 84 },
      { itemId: 'charge-discount', serviceId: null, isDiscount: true, quantity: 1, unitPrice: null, netAmount: -500, taxAmount: 0 }
    ]);
    const usd = await adapter.transform(context('invoice', adapter.type, usdLines));
    const usdRows = (usd.documents[0].payload as any).rows;
    expect(usdRows[0]['*UnitAmount']).toBe('5.25');
    expect(usdRows[1]['*UnitAmount']).toBe('-5.00');
  });
});

describe('QuickBooks Desktop IIF adapter scales the AMOUNT column by line currency', () => {
  it('writes whole yen for JPY lines and dollars for USD lines', async () => {
    const { QuickBooksDesktopAdapter } = await import('./quickBooksDesktopAdapter');
    const adapter = await QuickBooksDesktopAdapter.create();

    const result = await adapter.transform(
      context('invoice', adapter.type, [
        { document_id: 'inv-jpy', document_line_id: 'c1', client_id: CLIENT, amount_cents: 10000, currency_code: 'JPY' },
        { document_id: 'inv-usd', document_line_id: 'c2', client_id: CLIENT, amount_cents: 1050, currency_code: 'USD' }
      ])
    );
    const content = String(result.files?.[0]?.content ?? '');
    const amounts = content
      .split('\n')
      .filter((row) => row.startsWith('TRNS\t'))
      .map((row) => row.split('\t')[5]);
    expect(amounts).toEqual(['10000', '10.5']);
  });
});
