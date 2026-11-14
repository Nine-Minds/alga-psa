import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingExportAdapterContext, AccountingExportLine } from '@alga-psa/types';
import { QboSimulator } from '../src/services/accountingSync/testing/qboSimulator';

/**
 * Discounts reduce the taxable base before tax. These tests drive the real QBO
 * and Xero export adapters over a discounted invoice and check what the
 * external system would compute / receive against Alga's stored invoice:
 *
 * - Alga is the tax authority: the exported tax total and invoice total equal
 *   Alga's stored values (QBO also against the QBO Automated Sales Tax
 *   emulator, which recomputes tax itself).
 * - Tax is delegated: the external system computes tax from what we send, so
 *   the discount line must carry the tax identity of what it discounts, and
 *   QuickBooks must be told to tax after the discount.
 */

const flags = vi.hoisted(() => ({ ast: false }));

const harness = vi.hoisted(() => {
  const rows: Record<string, any[]> = {};
  const tableName = (expr: string) => expr.split(/\s+as\s+/i)[0].trim();
  const builder = (list: any[]) => {
    let selected = list;
    const qb: any = {};
    for (const method of [
      'select', 'whereNull', 'whereNotNull', 'whereRaw',
      'andWhere', 'orderBy', 'orderByRaw', 'limit', 'leftJoin', 'join', 'groupBy'
    ]) {
      qb[method] = () => qb;
    }
    qb.where = (criteria: Record<string, unknown> | string, value?: unknown) => {
      selected = selected.filter((row) => typeof criteria === 'string'
        ? row[criteria.split('.').at(-1)!] === value
        : Object.entries(criteria).every(([key, expected]) => row[key.split('.').at(-1)!] === expected));
      return qb;
    };
    qb.whereIn = (column: string, values: unknown[]) => {
      selected = selected.filter((row) => values.includes(row[column.split('.').at(-1)!]));
      return qb;
    };
    qb.modify = (cb: (q: any) => void) => { cb(qb); return qb; };
    qb.first = async () => selected[0] ?? null;
    qb.update = async () => 1;
    qb.pluck = async (col: string) => selected.map((r) => r[col]);
    qb.then = (resolve: any, reject?: any) => Promise.resolve(selected).then(resolve, reject);
    return qb;
  };
  const knex: any = (expr: string) => builder(rows[tableName(expr)] ?? []);
  knex.table = knex;
  knex.schema = { hasTable: async () => false };
  const tenantDb = () => ({ table: (expr: string) => builder(rows[tableName(expr)] ?? []) });
  return { rows, knex, tenantDb, qboRead: { current: null as any } };
});

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: harness.knex, tenant: 'tenant-x' })),
  tenantDb: vi.fn(() => harness.tenantDb()),
  withTransaction: vi.fn(async (knex: any, cb: (trx: any) => Promise<unknown>) => cb(knex))
}));

vi.mock('../src/services/accountingMappingResolver', () => ({
  AccountingMappingResolver: class {
    resolveServiceMapping = vi.fn(async () => ({
      external_entity_id: 'item-1',
      metadata: { name: 'Consulting', itemCode: 'CONS', accountCode: '200', taxType: 'OUTPUT' }
    }));
    resolveDiscountMapping = vi.fn(async () => ({
      external_entity_id: 'discount-1',
      metadata: { name: 'Discount', itemCode: 'DISC', accountCode: '200', taxType: 'NONE' }
    }));
    resolveTaxCodeMapping = vi.fn(async () => null);
    resolvePaymentTermMapping = vi.fn(async () => null);
    resolveClientMapping = vi.fn(async () => null);
    ensureCompanyMapping = vi.fn(async () => null);
    static create = vi.fn(async () => new this());
  }
}));

vi.mock('../src/services/accountingSync/accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    defaultExpenseAccountRef: { value: 'exp-1', name: 'Hardware Expense' },
    autoProvisionCustomers: false,
    defaultClassRef: null,
    defaultDepartmentRef: null
  }))
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboTaxSettings', () => ({
  isQboAutomatedSalesTaxEnabled: vi.fn(async () => flags.ast)
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboCompanyCountry', () => ({
  getQboCompanyCountry: vi.fn(async () => 'US'),
  isQboUnitedStatesCompany: vi.fn(async () => true),
  isUnitedStatesQboCountry: (country: string | null) => country === 'US'
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn(async () => ({ read: vi.fn(async () => harness.qboRead.current) })) },
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
const NOW = '2026-01-01T00:00:00.000Z';

interface Fixture {
  id: string;
  net: number;
  tax: number;
  discount?: boolean;
  taxable?: boolean;
}

/** 1000.00 of taxable work, a 300.00 untargeted discount, 10% tax -> 70.00. */
const DISCOUNTED_INVOICE: Fixture[] = [
  { id: 'goods', net: 100000, tax: 7000 },
  { id: 'disc', net: -30000, tax: 0, discount: true, taxable: false },
];

function seed(adapterType: string, fixtures: Fixture[]): AccountingExportLine[] {
  const storedNet = fixtures.reduce((sum, f) => sum + f.net, 0);
  const storedTax = fixtures.reduce((sum, f) => sum + f.tax, 0);
  harness.rows.invoices = [{
    invoice_id: INVOICE, invoice_number: 'INV-0001', po_number: null,
    invoice_date: '2026-01-05', due_date: '2026-02-04',
    total_amount: storedNet + storedTax, client_id: CLIENT, currency_code: 'USD',
    exchange_rate_basis_points: null, invoice_type: 'standard', billing_profile_id: null, tax_source: 'internal'
  }];
  harness.rows.invoice_charges = fixtures.map((f) => ({
    item_id: f.id, invoice_id: INVOICE,
    service_id: f.discount ? null : 'svc-1',
    description: f.discount ? 'Loyalty discount' : 'Consulting',
    quantity: 1, unit_price: f.net, total_price: f.net + f.tax, net_amount: f.net, tax_amount: f.tax,
    is_taxable: f.taxable ?? true, is_discount: Boolean(f.discount), tax_region: null,
    adjustment_source_kind: null, applies_to_item_id: null, applies_to_service_id: null,
    manual_line_metadata: null, is_manual: false
  }));
  harness.rows.clients = [{ client_id: CLIENT, client_name: 'Acme', billing_email: null, payment_terms: null }];
  harness.rows.tenant_external_entity_mappings = [{
    id: 'map-1', integration_type: adapterType, alga_entity_type: 'client', alga_entity_id: CLIENT,
    external_entity_id: 'ext-cust-1', external_realm_id: REALM, metadata: null
  }];
  return fixtures.map((f) => ({
    document_id: INVOICE, document_line_id: f.id, client_id: CLIENT, amount_cents: f.net, currency_code: 'USD'
  })) as AccountingExportLine[];
}

function context(adapterType: string, lines: AccountingExportLine[], extra: Record<string, unknown> = {}) {
  return {
    batch: {
      tenant: TENANT, batch_id: 'batch-1', adapter_type: adapterType, target_realm: REALM,
      export_type: 'invoice', status: 'pending', queued_at: NOW, created_at: NOW, updated_at: NOW
    } as any,
    lines: lines.map((line, index) => ({
      tenant: TENANT, line_id: `line-${index + 1}`, batch_id: 'batch-1', status: 'pending',
      created_at: NOW, updated_at: NOW, ...line
    })) as AccountingExportLine[],
    ...extra
  } as AccountingExportAdapterContext;
}

function astSimulator() {
  const sim = new QboSimulator({ automatedSalesTax: { defaultTaxCodeId: 'tc-10' } });
  sim.seedTaxRate({ id: 'r-10', name: 'Ten', ratePercent: 10 });
  sim.seedTaxCode({ id: 'tc-10', name: 'Ten percent', taxRateIds: ['r-10'] });
  sim.seedTaxCode({ id: 'TAX', name: 'TAX', pseudo: true });
  sim.seedTaxCode({ id: 'NON', name: 'NON', pseudo: true });
  return sim;
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.ast = false;
  for (const key of Object.keys(harness.rows)) delete harness.rows[key];
});

describe('QuickBooks Online export of a discounted invoice', () => {
  it('Alga authority: exports the stored tax and total, and flags tax after discount', async () => {
    const { QuickBooksOnlineAdapter } = await import('../src/adapters/accounting/quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();
    const lines = seed('quickbooks_online', DISCOUNTED_INVOICE);

    const result = await adapter.transform(context(adapter.type, lines));
    const invoice = (result.documents[0].payload as any).invoice;

    expect(invoice.ApplyTaxAfterDiscount).toBe(true);
    expect(invoice.TxnTaxDetail).toEqual({ TotalTax: 70 });
    const netSum = invoice.Line.reduce((sum: number, line: any) => sum + line.Amount, 0);
    expect(netSum).toBe(700);
    // Exported total (lines + tax) equals Alga's stored invoice total.
    expect(netSum + invoice.TxnTaxDetail.TotalTax).toBe(harness.rows.invoices[0].total_amount / 100);
  });

  it('Alga authority on an Automated Sales Tax company: QuickBooks lands on Alga\'s tax and total', async () => {
    flags.ast = true;
    const { QuickBooksOnlineAdapter } = await import('../src/adapters/accounting/quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();
    const lines = seed('quickbooks_online', DISCOUNTED_INVOICE);

    const result = await adapter.transform(context(adapter.type, lines));
    const sent = (result.documents[0].payload as any).invoice;
    const created: any = await astSimulator().client.create('Invoice', sent);

    expect(created.TxnTaxDetail.TotalTax).toBe(70);
    expect(created.TotalAmt).toBe(harness.rows.invoices[0].total_amount / 100);
  });

  it('delegated tax: QuickBooks taxes rate x (line - discount) and the imported per-line tax sums to it', async () => {
    flags.ast = true;
    const { QuickBooksOnlineAdapter } = await import('../src/adapters/accounting/quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();
    const lines = seed('quickbooks_online', DISCOUNTED_INVOICE);

    const result = await adapter.transform(context(adapter.type, lines, { taxDelegationMode: 'delegate' }));
    const sent = (result.documents[0].payload as any).invoice;
    expect(sent.TxnTaxDetail).toBeUndefined();
    expect(sent.ApplyTaxAfterDiscount).toBe(true);
    // The discount line must not be marked NON, or QuickBooks taxes the gross.
    const discountLine = sent.Line.find((line: any) => line.Amount < 0);
    expect(discountLine.SalesItemLineDetail.TaxCodeRef.value).toBe('TAX');

    const created: any = await astSimulator().client.create('Invoice', sent);
    // 10% x (1000.00 - 300.00)
    expect(created.TxnTaxDetail.TotalTax).toBe(70);

    // Import it back the way the tax-import job does.
    harness.qboRead.current = {
      ...created,
      Line: created.Line.map((line: any, index: number) => ({ ...line, Id: String(index + 1) }))
    };
    harness.rows.tenant_external_entity_mappings = [{
      integration_type: 'quickbooks_online', alga_entity_type: 'invoice', alga_entity_id: INVOICE,
      external_entity_id: created.Id, external_realm_id: REALM,
      metadata: { chargeLineMappings: [{ chargeId: 'goods', qboLineId: '1' }, { chargeId: 'disc', qboLineId: '2' }] }
    }];
    const imported = await adapter.fetchExternalInvoice(created.Id, REALM);
    expect(imported.success).toBe(true);
    const taxByLine = Object.fromEntries(imported.invoice!.charges.map((c) => [c.lineId, c.taxAmount]));
    expect(taxByLine).toEqual({ goods: 7000, disc: 0 });
  });

  it('without a discount the invoice is left as before (no ApplyTaxAfterDiscount)', async () => {
    const { QuickBooksOnlineAdapter } = await import('../src/adapters/accounting/quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();
    const lines = seed('quickbooks_online', [{ id: 'goods', net: 100000, tax: 10000 }]);
    const result = await adapter.transform(context(adapter.type, lines));
    expect((result.documents[0].payload as any).invoice.ApplyTaxAfterDiscount).toBeUndefined();
  });
});

describe('QuickBooks Automated Sales Tax emulator', () => {
  const invoice = (applyAfter: boolean) => ({
    CustomerRef: { value: 'c' },
    ...(applyAfter ? { ApplyTaxAfterDiscount: true } : {}),
    Line: [
      { Amount: 1000, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { TaxCodeRef: { value: 'TAX' } } },
      { Amount: 300, DetailType: 'DiscountLineDetail', DiscountLineDetail: { PercentBased: false, DiscountAmount: 300 } }
    ]
  });

  it('taxes before a DiscountLineDetail by default and after it with ApplyTaxAfterDiscount', async () => {
    const before: any = await astSimulator().client.create('Invoice', invoice(false));
    const after: any = await astSimulator().client.create('Invoice', invoice(true));
    expect(before.TxnTaxDetail.TotalTax).toBe(100);
    expect(after.TxnTaxDetail.TotalTax).toBe(70);
  });
});

describe('Xero export of a discounted invoice', () => {
  it('Alga authority: per-line TaxAmounts and net amounts sum to Alga\'s stored tax and total', async () => {
    const { XeroAdapter } = await import('../src/adapters/accounting/xeroAdapter');
    const adapter = new XeroAdapter();
    const lines = seed('xero', DISCOUNTED_INVOICE);

    const result = await adapter.transform(context(adapter.type, lines));
    const payload = (result.documents[0].payload as any).invoice;
    const net = payload.lines.reduce((sum: number, l: any) => sum + l.amountCents, 0);
    const tax = payload.lines.reduce((sum: number, l: any) => sum + (l.taxAmountCents ?? 0), 0);

    expect(tax).toBe(7000);
    expect(net + tax).toBe(harness.rows.invoices[0].total_amount);
    expect(payload.lines.find((l: any) => l.amountCents < 0).taxAmountCents).toBe(0);
  });

  it('delegated tax: the discount line takes the goods TaxType so Xero taxes the discounted base', async () => {
    const { XeroAdapter } = await import('../src/adapters/accounting/xeroAdapter');
    const adapter = new XeroAdapter();
    const lines = seed('xero', DISCOUNTED_INVOICE);

    const result = await adapter.transform(context(adapter.type, lines, { taxDelegationMode: 'delegate' }));
    const payload = (result.documents[0].payload as any).invoice;
    const goods = payload.lines.find((l: any) => l.amountCents > 0);
    const discount = payload.lines.find((l: any) => l.amountCents < 0);

    expect(goods.taxAmountCents ?? null).toBeNull();
    expect(discount.taxType).toBe(goods.taxType);
    expect(discount.taxType).toBe('OUTPUT');

    // Xero computes per line: rate(TaxType) x line amount. 10% for OUTPUT.
    const rateFor = (taxType?: string) => (taxType === 'OUTPUT' ? 0.1 : 0);
    const xeroTax = payload.lines.reduce(
      (sum: number, l: any) => sum + Math.round(l.amountCents * rateFor(l.taxType)),
      0
    );
    expect(xeroTax).toBe(7000);
  });
});
