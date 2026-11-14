import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingExportAdapterContext, AccountingExportLine } from '@alga-psa/types';

/**
 * alga-2026-0003122: a fixed-plan charge is one serviceless parent plus one
 * allocation row per plan service, and expansion refuses to export unless the
 * allocation tax sums to the parent tax. When tax is delegated to the accounting
 * system both levels read 0 (pending_external) or carry the imported amount
 * split across the allocations (external), so the exported child lines stay
 * consistent with the parent either way.
 *
 * Same in-memory tenant-facade harness as exportCurrencyScaling.test.ts.
 */

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
    qb.update = async () => 1;
    qb.first = async () => selected[0] ?? null;
    qb.then = (resolve: any, reject?: any) => Promise.resolve(selected).then(resolve, reject);
    return qb;
  };
  const knex: any = (expr: string) => builder(rows[tableName(expr)] ?? []);
  knex.table = knex;
  // Charge expansion probes for the mid-period adjustments table before it
  // projects contract-change descriptions; these fixtures carry none.
  knex.schema = { hasTable: async () => false };
  const tenantDb = () => ({
    table: (expr: string) => builder(rows[tableName(expr)] ?? []),
    // The fake resolves joined tables by name, so a tenant join is a no-op here.
    tenantJoin: () => undefined
  });
  return { rows, knex, tenantDb };
});

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: harness.knex, tenant: 'tenant-x' })),
  tenantDb: vi.fn(() => harness.tenantDb()),
  withTransaction: vi.fn(async (knex: any, cb: (trx: any) => Promise<unknown>) => cb(knex))
}));

vi.mock('../../services/accountingMappingResolver', () => ({
  AccountingMappingResolver: class {
    resolveServiceMapping = vi.fn(async ({ serviceId }: { serviceId: string }) => ({
      external_entity_id: `item-${serviceId}`,
      metadata: { name: 'Managed service', itemCode: `CODE-${serviceId}`, accountCode: '200', taxType: 'OUTPUT' }
    }));
    resolveDiscountMapping = vi.fn(async () => null);
    resolveTaxCodeMapping = vi.fn(async () => null);
    resolvePaymentTermMapping = vi.fn(async () => null);
    resolveClientMapping = vi.fn(async () => null);
    ensureCompanyMapping = vi.fn(async () => null);
    static create = vi.fn(async () => new this());
  }
}));

vi.mock('../../services/accountingSync/accountingSyncSettings', () => ({
  getAccountingSyncSettings: vi.fn(async () => ({
    defaultExpenseAccountRef: null,
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
const PARENT = 'charge-fixed-1';
/** EQUIT-shaped plan: a 25000 line plus an evenly split 68000 bundle. */
const ALLOCATIONS = [
  { detailId: 'detail-1', serviceId: 'svc-1', allocated: 25_000 },
  { detailId: 'detail-2', serviceId: 'svc-2', allocated: 34_000 },
  { detailId: 'detail-3', serviceId: 'svc-3', allocated: 34_000 }
];
const NET_TOTAL = ALLOCATIONS.reduce((sum, allocation) => sum + allocation.allocated, 0);
const NOW = '2026-01-01T00:00:00.000Z';

function seedFixedPlanInvoice(
  adapterType: string,
  taxSource: 'pending_external' | 'external',
  parentTax: number,
  detailTaxes: number[]
): Array<Partial<AccountingExportLine>> {
  harness.rows.invoices = [{
    invoice_id: INVOICE, invoice_number: 'INV-000013', po_number: null,
    invoice_date: '2026-01-05', due_date: '2026-02-04', total_amount: NET_TOTAL + parentTax,
    client_id: CLIENT, currency_code: 'AUD', exchange_rate_basis_points: null,
    invoice_type: 'standard', billing_profile_id: null, tax_source: taxSource
  }];
  harness.rows.invoice_charges = [{
    item_id: PARENT, invoice_id: INVOICE, service_id: null, description: 'Managed Services Plan',
    quantity: 1, unit_price: NET_TOTAL, total_price: NET_TOTAL + parentTax, net_amount: NET_TOTAL,
    tax_amount: parentTax, is_taxable: true, is_discount: false, is_manual: false, tax_region: null
  }];
  // One row per allocation; the fake joins by table name, so the detail and
  // fixed-detail columns the expansion selects live on the same row.
  harness.rows.invoice_charge_details = ALLOCATIONS.map((allocation, index) => ({
    item_id: PARENT, item_detail_id: allocation.detailId, service_id: allocation.serviceId,
    allocated_amount: allocation.allocated, tax_amount: detailTaxes[index]
  }));
  harness.rows.clients = [{ client_id: CLIENT, client_name: 'Equit Pty Ltd', billing_email: null, payment_terms: null }];
  harness.rows.tenant_external_entity_mappings = [{
    id: 'map-1', integration_type: adapterType, alga_entity_type: 'client', alga_entity_id: CLIENT,
    external_entity_id: 'external-contact-1', external_realm_id: REALM, metadata: null
  }];
  return [{
    document_id: INVOICE, document_line_id: PARENT, client_id: CLIENT,
    amount_cents: NET_TOTAL + parentTax, currency_code: 'AUD'
  }];
}

function context(
  adapterType: string,
  lines: Array<Partial<AccountingExportLine>>,
  delegated: boolean
): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: TENANT, batch_id: 'batch-1', adapter_type: adapterType, target_realm: REALM,
      export_type: 'invoice', status: 'pending', queued_at: NOW, created_at: NOW, updated_at: NOW
    } as any,
    lines: lines.map((line, index) => ({
      tenant: TENANT, line_id: `line-${index + 1}`, batch_id: 'batch-1', status: 'pending',
      created_at: NOW, updated_at: NOW, ...line
    })) as AccountingExportLine[],
    // accountingExportService maps pending_external -> 'delegate' (tax excluded)
    // and external -> 'import_pending' (Alga's imported tax is authoritative).
    taxDelegationMode: delegated ? 'delegate' : 'import_pending',
    excludeTaxFromExport: delegated
  } as AccountingExportAdapterContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(harness.rows)) delete harness.rows[key];
});

describe('Xero export of a fixed-plan invoice with delegated tax', () => {
  it('sends net-only child lines while tax is pending in Xero', async () => {
    const { XeroAdapter } = await import('./xeroAdapter');
    const adapter = new XeroAdapter();
    const lines = seedFixedPlanInvoice('xero', 'pending_external', 0, [0, 0, 0]);

    const result = await adapter.transform(context('xero', lines, true));
    const payload = result.documents[0].payload as any;

    expect(payload.invoice.lines.map((line: any) => line.amountCents)).toEqual([25_000, 34_000, 34_000]);
    expect(payload.invoice.lines.every((line: any) => line.taxAmountCents === null)).toBe(true);
    expect(payload.invoice.lines.every((line: any) => line.taxComponents === null)).toBe(true);
    // Xero still learns which tax to apply itself.
    expect(payload.invoice.lines.every((line: any) => line.taxType === 'OUTPUT')).toBe(true);
    expect(payload.invoice.amountCents).toBe(NET_TOTAL);
    expect(payload.chargeIds).toEqual(['detail-1', 'detail-2', 'detail-3']);
    expect(payload.chargeLineage.every((entry: any) => entry.parentChargeId === PARENT)).toBe(true);
    expect(result.metadata?.taxExcluded).toBe(true);
  });

  it('sends each allocation its share of the imported tax once tax is external', async () => {
    const { XeroAdapter } = await import('./xeroAdapter');
    const adapter = new XeroAdapter();
    // Shares written by distributeExternalTaxToFixedDetails for an odd total.
    const lines = seedFixedPlanInvoice('xero', 'external', 2_501, [672, 914, 915]);

    const result = await adapter.transform(context('xero', lines, false));
    const payload = result.documents[0].payload as any;

    expect(payload.invoice.lines.map((line: any) => line.taxAmountCents)).toEqual([672, 914, 915]);
    const exportedTax = payload.invoice.lines.reduce((sum: number, line: any) => sum + line.taxAmountCents, 0);
    expect(exportedTax).toBe(2_501);
    expect(payload.invoice.amountCents).toBe(NET_TOTAL);
  });
});

describe('QuickBooks Online export of a fixed-plan invoice with delegated tax', () => {
  it('omits the tax total while tax is pending in QuickBooks', async () => {
    const { QuickBooksOnlineAdapter } = await import('./quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();
    const lines = seedFixedPlanInvoice('quickbooks_online', 'pending_external', 0, [0, 0, 0]);

    const result = await adapter.transform(context('quickbooks_online', lines, true));
    const invoice = (result.documents[0].payload as any).invoice;

    expect(invoice.Line.map((line: any) => line.Amount)).toEqual([250, 340, 340]);
    expect(invoice.TxnTaxDetail).toBeUndefined();
    expect(invoice.Line.map((line: any) => line.SalesItemLineDetail.ItemRef.value))
      .toEqual(['item-svc-1', 'item-svc-2', 'item-svc-3']);
  });

  it('reports the imported tax total as the sum of the allocation shares', async () => {
    const { QuickBooksOnlineAdapter } = await import('./quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();
    const lines = seedFixedPlanInvoice('quickbooks_online', 'external', 2_501, [672, 914, 915]);

    const result = await adapter.transform(context('quickbooks_online', lines, false));
    const invoice = (result.documents[0].payload as any).invoice;

    expect(invoice.Line.map((line: any) => line.Amount)).toEqual([250, 340, 340]);
    expect(invoice.TxnTaxDetail).toEqual({ TotalTax: 25.01 });
  });

  it('refuses the export when the allocations disagree with the parent', async () => {
    const { QuickBooksOnlineAdapter } = await import('./quickBooksOnlineAdapter');
    const adapter = new QuickBooksOnlineAdapter();
    // The pre-fix state: parent zeroed for pending external tax, allocations
    // still carrying the billing engine's 10% GST.
    const lines = seedFixedPlanInvoice('quickbooks_online', 'pending_external', 0, [2_500, 3_400, 3_400]);

    await expect(adapter.transform(context('quickbooks_online', lines, true))).rejects.toThrow(
      `Fixed-plan allocation totals do not match charge ${PARENT} on invoice INV-000013: `
      + `parent net ${NET_TOTAL} / tax 0, allocations net ${NET_TOTAL} / tax 9300; repair the invoice before export.`
    );
  });
});
