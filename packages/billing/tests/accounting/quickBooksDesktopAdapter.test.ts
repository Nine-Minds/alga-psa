import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingExportAdapterContext, AccountingExportLine } from '@alga-psa/types';

const harness = vi.hoisted(() => {
  const rows: Record<string, any[]> = {};
  const builder = (list: any[]) => {
    const qb: any = {};
    for (const method of ['select', 'where', 'whereIn', 'whereNull', 'orderBy']) {
      qb[method] = () => qb;
    }
    qb.first = async () => list[0] ?? null;
    qb.then = (resolve: any, reject?: any) => Promise.resolve(list).then(resolve, reject);
    return qb;
  };
  const knex: any = (table: string) => builder(rows[table] ?? []);
  const tenantDb = () => ({ table: (table: string) => builder(rows[table] ?? []) });

  const mappings = {
    services: {} as Record<string, any>,
    discount: null as any,
    taxRegions: {} as Record<string, any>,
    terms: {} as Record<string, any>,
    clients: {} as Record<string, any>
  };
  const resolverCalls: Array<{ method: string; adapterType: string }> = [];
  const resolver = {
    resolveServiceMapping: async (p: any) => {
      resolverCalls.push({ method: 'service', adapterType: p.adapterType });
      return mappings.services[p.serviceId] ?? null;
    },
    resolveDiscountMapping: async (p: any) => {
      resolverCalls.push({ method: 'discount', adapterType: p.adapterType });
      return mappings.discount;
    },
    resolveTaxCodeMapping: async (p: any) => mappings.taxRegions[p.taxRegionId] ?? null,
    resolvePaymentTermMapping: async (p: any) => mappings.terms[p.paymentTermId] ?? null,
    resolveClientMapping: async (p: any) => mappings.clients[p.clientId] ?? null
  };

  const upserts: any[] = [];
  const lockFailures = new Set<string>();
  return { rows, knex, tenantDb, mappings, resolver, resolverCalls, upserts, lockFailures };
});

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: harness.knex, tenant: 'tenant-x' })),
  tenantDb: vi.fn(() => harness.tenantDb()),
  withTransaction: vi.fn(async (knex: any, cb: (trx: any) => Promise<unknown>) => cb(knex))
}));

vi.mock('../../src/services/accountingMappingResolver', () => ({
  AccountingMappingResolver: { create: vi.fn(async () => harness.resolver) }
}));

vi.mock('../../src/lib/invoiceExternalSyncLock', () => ({
  lockInvoiceForExternalSync: vi.fn(async (_trx: unknown, _tenant: string, invoiceId: string) => {
    if (harness.lockFailures.has(invoiceId)) {
      const { AppError } = await import('@alga-psa/core');
      throw new AppError('INVOICE_CANCELLED', `Invoice ${invoiceId} was voided`);
    }
  })
}));

vi.mock('../../src/repositories/invoiceMappingRepository', () => ({
  KnexInvoiceMappingRepository: class {
    async upsertInvoiceMapping(input: unknown) {
      harness.upserts.push(input);
    }
  }
}));

import { QuickBooksDesktopAdapter, formatIifDate, sanitizeIifField } from '../../src/adapters/accounting/quickBooksDesktopAdapter';

const NOW = '2026-01-01T00:00:00.000Z';
const SETTINGS = {
  arAccount: 'Accounts Receivable',
  defaultIncomeAccount: 'Services Income',
  salesTaxPayableAccount: 'Sales Tax Payable',
  defaultSalesTaxItem: 'State Tax'
};

function context(
  lines: Array<Partial<AccountingExportLine>>,
  adapterSettings: Record<string, unknown> = SETTINGS
): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: 'tenant-x',
      batch_id: 'batch-1',
      adapter_type: 'quickbooks_desktop',
      target_realm: null,
      export_type: 'invoice',
      status: 'pending',
      queued_at: NOW,
      created_at: NOW,
      updated_at: NOW
    } as any,
    lines: lines.map((line, index) => ({
      tenant: 'tenant-x',
      line_id: `line-${index + 1}`,
      batch_id: 'batch-1',
      status: 'pending',
      amount_cents: 0,
      created_at: NOW,
      updated_at: NOW,
      ...line
    })) as AccountingExportLine[],
    adapterSettings
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    invoice_id: 'inv-1',
    invoice_number: 'INV-1001',
    po_number: 'PO-77',
    invoice_date: '2026-03-15',
    due_date: '2026-04-14',
    total_amount: 10000,
    client_id: 'client-1',
    currency_code: 'USD',
    tax_source: 'internal',
    ...overrides
  };
}

function charge(overrides: Record<string, unknown> = {}) {
  return {
    item_id: 'charge-1',
    invoice_id: 'inv-1',
    service_id: 'svc-1',
    description: 'Managed services',
    quantity: 2,
    unit_price: 5000,
    total_price: 10000,
    net_amount: 10000,
    tax_amount: 0,
    is_taxable: false,
    is_discount: false,
    tax_region: null,
    ...overrides
  };
}

function parse(content: string) {
  return content
    .split('\r\n')
    .filter((row) => row.length > 0)
    .map((row) => row.split('\t'));
}

function field(rows: string[][], header: string, row: string[], name: string): string {
  const headerRow = rows.find((r) => r[0] === header)!;
  return row[headerRow.indexOf(name)];
}

async function transformContent(ctx: AccountingExportAdapterContext) {
  const adapter = await QuickBooksDesktopAdapter.create();
  const result = await adapter.transform(ctx);
  const content = String(result.files?.[0]?.content ?? '');
  return { result, content, rows: parse(content) };
}

beforeEach(() => {
  for (const key of Object.keys(harness.rows)) delete harness.rows[key];
  harness.mappings.services = { 'svc-1': { external_entity_id: 'qb-1', metadata: { name: 'Consulting' } } };
  harness.mappings.discount = { external_entity_id: 'Discount', metadata: null };
  harness.mappings.taxRegions = {};
  harness.mappings.terms = { net_30: { external_entity_id: 'Net 30' } };
  harness.mappings.clients = {};
  harness.resolverCalls.length = 0;
  harness.upserts.length = 0;
  harness.lockFailures.clear();
  harness.rows.clients = [{ client_id: 'client-1', client_name: 'Acme Corp', payment_terms: 'net_30' }];
});

describe('QuickBooksDesktopAdapter IIF transform', () => {
  it('writes one balanced INVOICE transaction per invoice with header rows, CRLF, and mapped names', async () => {
    harness.rows.invoices = [invoice({ total_amount: 10000 })];
    harness.rows.invoice_charges = [charge()];
    harness.mappings.clients = { 'client-1': { external_entity_id: 'Acme Corporation' } };

    const { content, rows, result } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', client_id: 'client-1', amount_cents: 10000 }])
    );

    expect(content.endsWith('\r\n')).toBe(true);
    expect(rows.map((r) => r[0])).toEqual(['!TRNS', '!SPL', '!ENDTRNS', 'TRNS', 'SPL', 'ENDTRNS']);

    const trns = rows[3];
    expect(field(rows, '!TRNS', trns, 'TRNSTYPE')).toBe('INVOICE');
    expect(field(rows, '!TRNS', trns, 'DATE')).toBe('03/15/2026');
    expect(field(rows, '!TRNS', trns, 'DUEDATE')).toBe('04/14/2026');
    expect(field(rows, '!TRNS', trns, 'ACCNT')).toBe('Accounts Receivable');
    expect(field(rows, '!TRNS', trns, 'NAME')).toBe('Acme Corporation');
    expect(field(rows, '!TRNS', trns, 'AMOUNT')).toBe('100.00');
    expect(field(rows, '!TRNS', trns, 'DOCNUM')).toBe('INV-1001');
    expect(field(rows, '!TRNS', trns, 'TERMS')).toBe('Net 30');
    expect(field(rows, '!TRNS', trns, 'PONUM')).toBe('PO-77');
    expect(field(rows, '!TRNS', trns, 'MEMO')).toBe('AlgaPSA: inv-1 | PO PO-77');
    expect(field(rows, '!TRNS', trns, 'TRNSID')).toBe('');

    const spl = rows[4];
    expect(field(rows, '!SPL', spl, 'ACCNT')).toBe('Services Income');
    expect(field(rows, '!SPL', spl, 'INVITEM')).toBe('Consulting');
    expect(field(rows, '!SPL', spl, 'AMOUNT')).toBe('-100.00');
    expect(field(rows, '!SPL', spl, 'QNTY')).toBe('-2');
    expect(field(rows, '!SPL', spl, 'PRICE')).toBe('50.00');
    expect(field(rows, '!SPL', spl, 'TAXABLE')).toBe('N');
    expect(field(rows, '!SPL', spl, 'MEMO')).toBe('Managed services');

    expect(harness.resolverCalls.every((call) => call.adapterType === 'quickbooks_csv')).toBe(true);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].lineIds).toEqual(['line-1']);
  });

  it('uses the client name when unmapped and leaves unmapped payment terms blank', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];
    harness.mappings.terms = {};

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );
    expect(field(rows, '!TRNS', rows[3], 'NAME')).toBe('Acme Corp');
    expect(field(rows, '!TRNS', rows[3], 'TERMS')).toBe('');
  });

  it('prefers the mapping qbdIncomeAccount over the default income account', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];
    harness.mappings.services['svc-1'].metadata.qbdIncomeAccount = 'Consulting Income';

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );
    expect(field(rows, '!SPL', rows[4], 'ACCNT')).toBe('Consulting Income');
  });

  it('keeps every invoice in its own TRNS/ENDTRNS block and every transaction balanced', async () => {
    harness.rows.invoices = [
      invoice({ total_amount: 10000 }),
      invoice({ invoice_id: 'inv-2', invoice_number: 'INV-1002', po_number: null, total_amount: 17500 })
    ];
    harness.rows.invoice_charges = [
      charge(),
      charge({ item_id: 'charge-2', invoice_id: 'inv-2', quantity: 1.5, unit_price: 12000, net_amount: 18000, total_price: 18000 }),
      charge({ item_id: 'charge-3', invoice_id: 'inv-2', service_id: null, is_discount: true, quantity: 1, unit_price: null, net_amount: -500, total_price: -500 })
    ];

    const { rows } = await transformContent(
      context([
        { document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 },
        { document_id: 'inv-2', document_line_id: 'charge-2', amount_cents: 18000 },
        { document_id: 'inv-2', document_line_id: 'charge-3', amount_cents: -500 }
      ])
    );

    expect(rows.slice(3).map((r) => r[0])).toEqual(['TRNS', 'SPL', 'ENDTRNS', 'TRNS', 'SPL', 'SPL', 'ENDTRNS']);

    let balance = 0;
    for (const row of rows.slice(3)) {
      if (row[0] === 'TRNS') balance += Math.round(Number(field(rows, '!TRNS', row, 'AMOUNT')) * 100);
      if (row[0] === 'SPL') balance += Math.round(Number(field(rows, '!SPL', row, 'AMOUNT')) * 100);
      if (row[0] === 'ENDTRNS') {
        expect(balance).toBe(0);
        balance = 0;
      }
    }

    const discount = rows[8];
    expect(field(rows, '!SPL', discount, 'INVITEM')).toBe('Discount');
    expect(field(rows, '!SPL', discount, 'AMOUNT')).toBe('5.00');
    expect(field(rows, '!SPL', discount, 'QNTY')).toBe('-1');
    expect(field(rows, '!SPL', discount, 'PRICE')).toBe('-5.00');
    expect(field(rows, '!SPL', rows[7], 'QNTY')).toBe('-1.5');
    expect(field(rows, '!TRNS', rows[6], 'AMOUNT')).toBe('175.00');
    expect(field(rows, '!TRNS', rows[6], 'MEMO')).toBe('AlgaPSA: inv-2');
  });

  it('adds one AUTOSTAX sales tax split from the region mapping and flags taxable lines', async () => {
    harness.rows.invoices = [invoice({ total_amount: 10800 })];
    harness.rows.invoice_charges = [
      charge({ tax_amount: 500, is_taxable: true, tax_region: 'CA' }),
      charge({ item_id: 'charge-2', net_amount: 4000, total_price: 4000, quantity: 1, unit_price: 4000, tax_amount: 300, is_taxable: true, tax_region: 'CA' })
    ];
    harness.mappings.taxRegions = { CA: { external_entity_id: 'TAX', metadata: { qbdSalesTaxItem: 'CA Sales Tax' } } };

    const { rows } = await transformContent(
      context([
        { document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 },
        { document_id: 'inv-1', document_line_id: 'charge-2', amount_cents: 4000 }
      ])
    );

    expect(rows.slice(3).map((r) => r[0])).toEqual(['TRNS', 'SPL', 'SPL', 'SPL', 'ENDTRNS']);
    expect(field(rows, '!TRNS', rows[3], 'AMOUNT')).toBe('148.00');
    const tax = rows[6];
    expect(field(rows, '!SPL', tax, 'ACCNT')).toBe('Sales Tax Payable');
    expect(field(rows, '!SPL', tax, 'INVITEM')).toBe('CA Sales Tax');
    expect(field(rows, '!SPL', tax, 'AMOUNT')).toBe('-8.00');
    expect(field(rows, '!SPL', tax, 'EXTRA')).toBe('AUTOSTAX');
    expect(field(rows, '!SPL', rows[4], 'TAXABLE')).toBe('Y');
  });

  it('falls back to the default sales tax item when the region mapping has none', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ tax_amount: 500, tax_region: 'NV' })];
    harness.mappings.taxRegions = { NV: { external_entity_id: 'TAX', metadata: null } };

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );
    expect(field(rows, '!SPL', rows[5], 'INVITEM')).toBe('State Tax');
  });

  it('uses the tax code mapping value as the sales tax item, ahead of the default', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ tax_amount: 500, tax_region: 'PA' })];
    harness.mappings.taxRegions = { PA: { external_entity_id: 'PA Sales Tax', metadata: null } };

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );
    expect(field(rows, '!SPL', rows[5], 'INVITEM')).toBe('PA Sales Tax');
  });

  it('prefers qbdSalesTaxItem metadata over the mapping value', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ tax_amount: 500, tax_region: 'PA' })];
    harness.mappings.taxRegions = { PA: { external_entity_id: 'PA Sales Tax', metadata: { qbdSalesTaxItem: 'PA Group' } } };

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );
    expect(field(rows, '!SPL', rows[5], 'INVITEM')).toBe('PA Group');
  });

  it('never uses a QuickBooks Online pseudo tax code as the Desktop sales tax item', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ tax_amount: 500, tax_region: 'NJ' })];
    harness.mappings.taxRegions = { NJ: { external_entity_id: 'non', metadata: null } };

    await expect(
      transformContent(
        context([{ document_id: 'inv-1', document_line_id: 'charge-1' }], { ...SETTINGS, defaultSalesTaxItem: '' })
      )
    ).rejects.toMatchObject({ code: 'QBD_SALES_TAX_ITEM_MISSING' });
  });

  it('fails an invoice whose tax regions resolve to different sales tax items', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [
      charge({ tax_amount: 500, tax_region: 'CA' }),
      charge({ item_id: 'charge-2', tax_amount: 300, tax_region: 'NV' })
    ];
    harness.mappings.taxRegions = {
      CA: { external_entity_id: 'TAX', metadata: { qbdSalesTaxItem: 'CA Sales Tax' } },
      NV: { external_entity_id: 'TAX', metadata: { qbdSalesTaxItem: 'NV Sales Tax' } }
    };

    await expect(
      transformContent(
        context([
          { document_id: 'inv-1', document_line_id: 'charge-1' },
          { document_id: 'inv-1', document_line_id: 'charge-2' }
        ])
      )
    ).rejects.toMatchObject({ code: 'QBD_MIXED_SALES_TAX_ITEMS' });
  });

  it('omits the tax split for externally taxed invoices but still flags taxable lines', async () => {
    harness.rows.invoices = [invoice({ tax_source: 'pending_external' })];
    harness.rows.invoice_charges = [charge({ tax_amount: 500, is_taxable: true, tax_region: 'CA' })];

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }], {
        ...SETTINGS,
        defaultSalesTaxItem: ''
      })
    );
    expect(rows.slice(3).map((r) => r[0])).toEqual(['TRNS', 'SPL', 'ENDTRNS']);
    expect(field(rows, '!TRNS', rows[3], 'AMOUNT')).toBe('100.00');
    expect(field(rows, '!SPL', rows[4], 'TAXABLE')).toBe('Y');
  });

  it('exports a $0 prepaid block consumption line as its quantity at a zero rate', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ quantity: 4, unit_price: 0, net_amount: 0, total_price: 0 })];

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 0 }])
    );
    const spl = rows[4];
    expect(field(rows, '!SPL', spl, 'QNTY')).toBe('-4');
    expect(field(rows, '!SPL', spl, 'PRICE')).toBe('0.00');
    expect(field(rows, '!SPL', spl, 'AMOUNT')).toBe('0.00');
    expect(field(rows, '!TRNS', rows[3], 'AMOUNT')).toBe('0.00');
  });

  it('scales amounts by the invoice currency', async () => {
    harness.rows.invoices = [invoice({ currency_code: 'JPY' })];
    harness.rows.invoice_charges = [charge({ quantity: 2, unit_price: 5000, net_amount: 10000, total_price: 10000 })];

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000, currency_code: 'JPY' }])
    );
    expect(field(rows, '!TRNS', rows[3], 'AMOUNT')).toBe('10000');
    expect(field(rows, '!SPL', rows[4], 'PRICE')).toBe('5000');
  });

  it('strips IIF separators from free-text fields', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ description: 'Line one\r\nLine\ttwo "quoted"' })];

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );
    expect(rows[4]).toHaveLength(rows[1].length);
    expect(field(rows, '!SPL', rows[4], 'MEMO')).toBe("Line one Line two 'quoted'");
  });

  it('fails closed on a missing item mapping', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ service_id: 'svc-unmapped' })];

    await expect(
      transformContent(context([{ document_id: 'inv-1', document_line_id: 'charge-1' }]))
    ).rejects.toMatchObject({ code: 'QBD_MAPPING_MISSING' });
  });

  it('fails closed when no income account is configured', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];

    await expect(
      transformContent(
        context([{ document_id: 'inv-1', document_line_id: 'charge-1' }], { ...SETTINGS, defaultIncomeAccount: '' })
      )
    ).rejects.toMatchObject({ code: 'QBD_INCOME_ACCOUNT_MISSING' });
  });

  it('fails closed when a taxed invoice has no sales tax item', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge({ tax_amount: 500, tax_region: 'CA' })];

    await expect(
      transformContent(
        context([{ document_id: 'inv-1', document_line_id: 'charge-1' }], { ...SETTINGS, defaultSalesTaxItem: '' })
      )
    ).rejects.toMatchObject({ code: 'QBD_SALES_TAX_ITEM_MISSING' });
  });

  it('rejects a customer name over the QuickBooks Desktop 41-character limit', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];
    harness.rows.clients = [{ client_id: 'client-1', client_name: 'A'.repeat(42), payment_terms: null }];

    await expect(
      transformContent(context([{ document_id: 'inv-1', document_line_id: 'charge-1' }]))
    ).rejects.toMatchObject({ code: 'QBD_NAME_TOO_LONG' });
  });

  it('applies default account names when settings are absent', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];
    harness.mappings.services['svc-1'].metadata.qbdIncomeAccount = 'Sales';

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }], {})
    );
    expect(field(rows, '!TRNS', rows[3], 'ACCNT')).toBe('Accounts Receivable');
  });
});

describe('QuickBooksDesktopAdapter list records for items created by the export prompt', () => {
  const created = (extra: Record<string, unknown> = {}) => ({ createdByExport: true, qbdCreateInBatch: 'batch-1', ...extra });

  beforeEach(() => {
    harness.rows.client_locations = [{
      address_line1: '1 Main St', address_line2: 'Suite 2', city: 'Springfield', state_province: 'IL',
      postal_code: '62701', country_name: 'USA', phone: '555-0100', email: 'ap@acme.test', is_billing_address: true
    }];
  });

  it('defines new customers and items before the transactions that use them', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];
    harness.rows.service_catalog = [{ service_id: 'svc-1', service_name: 'Consulting', description: 'Hourly consulting', default_rate: 5000, item_kind: 'service' }];
    harness.mappings.clients = { 'client-1': { external_entity_id: 'Acme Corp', metadata: created() } };
    harness.mappings.services = { 'svc-1': { external_entity_id: 'Consulting', metadata: created() } };

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );

    expect(rows.map((r) => r[0])).toEqual(['!CUST', 'CUST', '!INVITEM', 'INVITEM', '!TRNS', '!SPL', '!ENDTRNS', 'TRNS', 'SPL', 'ENDTRNS']);
    const cust = rows[1];
    expect(field(rows, '!CUST', cust, 'NAME')).toBe('Acme Corp');
    expect(field(rows, '!CUST', cust, 'BADDR2')).toBe('1 Main St');
    expect(field(rows, '!CUST', cust, 'BADDR4')).toBe('Springfield IL 62701');
    expect(field(rows, '!CUST', cust, 'EMAIL')).toBe('ap@acme.test');
    expect(field(rows, '!CUST', cust, 'TERMS')).toBe('Net 30');

    const item = rows[3];
    expect(field(rows, '!INVITEM', item, 'NAME')).toBe('Consulting');
    expect(field(rows, '!INVITEM', item, 'INVITEMTYPE')).toBe('SERV');
    expect(field(rows, '!INVITEM', item, 'ACCNT')).toBe('Services Income');
    expect(field(rows, '!INVITEM', item, 'PRICE')).toBe('50.00');
    expect(field(rows, '!INVITEM', item, 'DESC')).toBe('Hourly consulting');
  });

  it('creates products as Non-inventory Parts by default and Inventory Parts when configured', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];
    harness.rows.service_catalog = [{ service_id: 'svc-1', service_name: 'Laptop', item_kind: 'product' }];
    harness.rows.product_inventory_settings = [{ service_id: 'svc-1', average_cost: 42000 }];
    harness.mappings.services = { 'svc-1': { external_entity_id: 'Laptop', metadata: created() } };
    const lines = [{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }];

    const nonInventory = await transformContent(context(lines));
    const partRow = nonInventory.rows.find((r) => r[0] === 'INVITEM')!;
    expect(field(nonInventory.rows, '!INVITEM', partRow, 'INVITEMTYPE')).toBe('PART');
    expect(field(nonInventory.rows, '!INVITEM', partRow, 'ASSETACCNT')).toBe('');

    const inventory = await transformContent(
      context(lines, { ...SETTINGS, newProductItemType: 'INVENTORY', inventoryAssetAccount: 'Inventory Asset', cogsAccount: 'Cost of Goods Sold' })
    );
    const invRow = inventory.rows.find((r) => r[0] === 'INVITEM')!;
    expect(field(inventory.rows, '!INVITEM', invRow, 'INVITEMTYPE')).toBe('INVENTORY');
    expect(field(inventory.rows, '!INVITEM', invRow, 'ASSETACCNT')).toBe('Inventory Asset');
    expect(field(inventory.rows, '!INVITEM', invRow, 'COGSACCNT')).toBe('Cost of Goods Sold');
    expect(field(inventory.rows, '!INVITEM', invRow, 'COST')).toBe('420.00');
  });

  it('creates the automatic discount as a Discount item', async () => {
    harness.rows.invoices = [invoice({ total_amount: 9500 })];
    harness.rows.invoice_charges = [
      charge(),
      charge({ item_id: 'charge-2', service_id: null, is_discount: true, quantity: 1, unit_price: null, net_amount: -500, total_price: -500, description: 'Loyalty discount' })
    ];
    harness.mappings.discount = { external_entity_id: 'Loyalty Discount', metadata: created() };

    const { rows } = await transformContent(
      context([
        { document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 },
        { document_id: 'inv-1', document_line_id: 'charge-2', amount_cents: -500 }
      ])
    );
    const items = rows.filter((r) => r[0] === 'INVITEM');
    expect(items).toHaveLength(1);
    expect(field(rows, '!INVITEM', items[0], 'NAME')).toBe('Loyalty Discount');
    expect(field(rows, '!INVITEM', items[0], 'INVITEMTYPE')).toBe('DISC');
  });

  it('never writes list records for mappings linked to existing entries or created by another batch', async () => {
    harness.rows.invoices = [invoice()];
    harness.rows.invoice_charges = [charge()];
    harness.mappings.clients = { 'client-1': { external_entity_id: 'Acme Corp', metadata: { linked_via: 'accounting_export' } } };
    harness.mappings.services = { 'svc-1': { external_entity_id: 'Consulting', metadata: created({ qbdCreateInBatch: 'batch-0' }) } };

    const { rows } = await transformContent(
      context([{ document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 }])
    );
    expect(rows.map((r) => r[0])).toEqual(['!TRNS', '!SPL', '!ENDTRNS', 'TRNS', 'SPL', 'ENDTRNS']);
  });

  it('leaves out the list records of an invoice that failed delivery', async () => {
    harness.rows.invoices = [invoice(), invoice({ invoice_id: 'inv-2', invoice_number: 'INV-1002', client_id: 'client-2' })];
    harness.rows.invoice_charges = [charge(), charge({ item_id: 'charge-2', invoice_id: 'inv-2' })];
    harness.rows.clients = [
      { client_id: 'client-1', client_name: 'Acme Corp', payment_terms: null },
      { client_id: 'client-2', client_name: 'Globex', payment_terms: null }
    ];
    harness.mappings.clients = {
      'client-1': { external_entity_id: 'Acme Corp' },
      'client-2': { external_entity_id: 'Globex', metadata: created() }
    };
    harness.lockFailures.add('inv-2');

    const adapter = await QuickBooksDesktopAdapter.create();
    const ctx = context([
      { document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 },
      { document_id: 'inv-2', document_line_id: 'charge-2', amount_cents: 10000 }
    ]);
    const transformed = await adapter.transform(ctx);
    expect(String(transformed.files?.[0]?.content)).toContain('CUST\tGlobex');

    const delivered = await adapter.deliver(transformed, ctx);
    const content = (delivered.metadata as any).files[0].content as string;
    expect(content).not.toContain('!CUST');
    expect(content).not.toContain('Globex');
  });
});

describe('QuickBooksDesktopAdapter delivery', () => {
  it('records an iif invoice mapping and returns a file containing only delivered invoices', async () => {
    harness.rows.invoices = [invoice(), invoice({ invoice_id: 'inv-2', invoice_number: 'INV-1002' })];
    harness.rows.invoice_charges = [charge(), charge({ item_id: 'charge-2', invoice_id: 'inv-2' })];
    harness.lockFailures.add('inv-2');

    const adapter = await QuickBooksDesktopAdapter.create();
    const ctx = context([
      { document_id: 'inv-1', document_line_id: 'charge-1', amount_cents: 10000 },
      { document_id: 'inv-2', document_line_id: 'charge-2', amount_cents: 10000 }
    ]);
    const transformed = await adapter.transform(ctx);
    const delivered = await adapter.deliver(transformed, ctx);

    expect(delivered.deliveredLines).toEqual([{ lineId: 'line-1', externalDocumentRef: 'iif:INV-1001' }]);
    expect(delivered.failedDocuments).toEqual([
      expect.objectContaining({ documentId: 'inv-2', lineIds: ['line-2'], code: 'INVOICE_CANCELLED' })
    ]);
    expect(harness.upserts).toEqual([
      expect.objectContaining({
        adapterType: 'quickbooks_desktop',
        invoiceId: 'inv-1',
        externalInvoiceId: 'iif:INV-1001'
      })
    ]);

    const files = (delivered.metadata as any).files;
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('quickbooks-desktop-invoices-batch-1.iif');
    expect(files[0].content).toContain('INV-1001');
    expect(files[0].content).not.toContain('INV-1002');
  });

  it('declares a file-mode invoice adapter without tax delegation', async () => {
    const adapter = await QuickBooksDesktopAdapter.create();
    expect(adapter.capabilities()).toMatchObject({
      deliveryMode: 'file',
      supportedExportTypes: ['invoice'],
      supportsTaxDelegation: false
    });
  });
});

describe('IIF helpers', () => {
  it('formats date-only strings and pg DATE values without a timezone shift', () => {
    expect(formatIifDate('2026-12-31')).toBe('12/31/2026');
    expect(formatIifDate(new Date(2026, 0, 2))).toBe('01/02/2026');
    expect(formatIifDate(null)).toBe('');
  });

  it('sanitizes separators', () => {
    expect(sanitizeIifField(' a\tb\nc ')).toBe('a b c');
    expect(sanitizeIifField(undefined)).toBe('');
  });
});
