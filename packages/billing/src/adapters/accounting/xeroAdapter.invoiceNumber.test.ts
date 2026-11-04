import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingExportAdapterContext, AccountingExportLine } from '@alga-psa/types';

/**
 * alga-2026-0002806: the Xero payload carries the plain Alga invoice number in
 * `invoiceNumber` while `reference` keeps the PO-suffixed value. Same in-memory
 * tenant-facade harness as exportCurrencyScaling.test.ts.
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
  AccountingMappingResolver: class {
    resolveServiceMapping = vi.fn(async () => ({
        external_entity_id: 'item-1',
        metadata: { name: 'Consulting', itemCode: 'CONS', accountCode: '200', taxType: 'OUTPUT' }
      }));
    resolveDiscountMapping = vi.fn(async () => ({
      external_entity_id: 'discount-1',
      metadata: { name: 'Discount', accountCode: '200', taxType: 'NONE' }
    }));
    resolveTaxCodeMapping = vi.fn(async () => null);
    resolvePaymentTermMapping = vi.fn(async () => null);
    resolveClientMapping = vi.fn(async () => null);
    ensureCompanyMapping = vi.fn(async () => null);
    static create = vi.fn(async () => new this());
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
const NOW = '2026-01-01T00:00:00.000Z';

function seed(invoiceNumber: string | null, poNumber: string | null): Array<Partial<AccountingExportLine>> {
  harness.rows.invoices = [{
    invoice_id: INVOICE, invoice_number: invoiceNumber, po_number: poNumber,
    invoice_date: '2026-01-05', due_date: '2026-02-04', total_amount: 1000,
    client_id: CLIENT, currency_code: 'USD', exchange_rate_basis_points: null,
    invoice_type: 'standard', billing_profile_id: null, tax_source: 'internal'
  }];
  harness.rows.invoice_charges = [{
    item_id: CHARGE, invoice_id: INVOICE, service_id: 'svc-1', description: 'Consulting',
    quantity: 1, unit_price: 1000, total_price: 1000, net_amount: 1000, tax_amount: 0,
    is_taxable: true, is_discount: false, tax_region: null
  }];
  harness.rows.clients = [{ client_id: CLIENT, client_name: 'Acme', billing_email: null, payment_terms: null }];
  harness.rows.tenant_external_entity_mappings = [{
    id: 'map-1', integration_type: 'xero', alga_entity_type: 'client', alga_entity_id: CLIENT,
    external_entity_id: 'xero-contact-1', external_realm_id: REALM, metadata: null
  }];
  return [{
    document_id: INVOICE, document_line_id: CHARGE, client_id: CLIENT, amount_cents: 1000, currency_code: 'USD'
  }];
}

function context(lines: Array<Partial<AccountingExportLine>>): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: TENANT, batch_id: 'batch-1', adapter_type: 'xero', target_realm: REALM,
      export_type: 'invoice', status: 'pending', queued_at: NOW, created_at: NOW, updated_at: NOW
    } as any,
    lines: lines.map((line, index) => ({
      tenant: TENANT, line_id: `line-${index + 1}`, batch_id: 'batch-1', status: 'pending',
      created_at: NOW, updated_at: NOW, ...line
    })) as AccountingExportLine[]
  };
}

async function invoicePayload(invoiceNumber: string | null, poNumber: string | null) {
  const { XeroAdapter } = await import('./xeroAdapter');
  const adapter = new XeroAdapter();
  const result = await adapter.transform(context(seed(invoiceNumber, poNumber)));
  return (result.documents[0].payload as any).invoice;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(harness.rows)) delete harness.rows[key];
});

describe('XeroAdapter invoice payload number vs reference', () => {
  it('keeps invoiceNumber plain while reference carries the PO', async () => {
    const invoice = await invoicePayload('INV-000123', '4567');
    expect(invoice.invoiceNumber).toBe('INV-000123');
    expect(invoice.reference).toBe('INV-000123 | PO 4567');
  });

  it('uses the plain number for both when there is no PO', async () => {
    const invoice = await invoicePayload('INV-000123', null);
    expect(invoice.invoiceNumber).toBe('INV-000123');
    expect(invoice.reference).toBe('INV-000123');
  });

  it('leaves invoiceNumber empty (not the UUID) when the invoice has no number', async () => {
    const invoice = await invoicePayload(null, null);
    expect(invoice.invoiceNumber).toBeNull();
    expect(invoice.invoiceNumber).not.toBe(INVOICE);
  });
});
