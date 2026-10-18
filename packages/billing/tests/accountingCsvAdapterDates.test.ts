import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolver } = vi.hoisted(() => ({ resolver: {
  resolveDiscountMapping: vi.fn(async () => null),
  resolveServiceMapping: vi.fn(async () => ({ external_entity_id: 'SERVICE', metadata: { itemCode: 'ITEM', accountCode: '400', taxType: 'NONE' } })),
  resolveTaxCodeMapping: vi.fn(async () => null),
  resolvePaymentTermMapping: vi.fn(async () => null),
  resolveClientMapping: vi.fn(async () => null)
} }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: vi.fn(),
  withTransaction: vi.fn()
}));
vi.mock('../src/services/accountingExportChargeExpansion', () => ({
  expandAccountingExportCharges: vi.fn(async (_knex, _tenant, charges, lines) => ({ charges, lines }))
}));
vi.mock('../src/services/accountingMappingResolver', () => ({
  AccountingMappingResolver: { create: vi.fn(async () => resolver) }
}));

import { QuickBooksCSVAdapter } from '../src/adapters/accounting/quickBooksCSVAdapter';
import { XeroCsvAdapter } from '../src/adapters/accounting/xeroCsvAdapter';

const invoice = (invoice_date: Date | string, due_date: Date | string) => ({
  invoice_id: 'invoice-1', invoice_number: 'INV-1', invoice_date, due_date,
  total_amount: 1250, client_id: 'client-1', currency_code: 'USD'
});

const context = (adapter_type: string, adapterSettings?: Record<string, unknown>) => ({
  batch: { batch_id: 'batch-1', tenant: 'tenant-1', target_realm: 'realm-1', adapter_type, status: 'ready' },
  lines: [{ line_id: 'line-1', batch_id: 'batch-1', document_id: 'invoice-1', document_line_id: 'charge-1', client_id: 'client-1', amount_cents: 1250, currency_code: 'USD', status: 'ready' }],
  adapterSettings
}) as any;

async function exportBytes(adapter: QuickBooksCSVAdapter | XeroCsvAdapter, dates: ReturnType<typeof invoice>, ctx: any) {
  const source = adapter as any;
  source.loadInvoices = vi.fn(async () => new Map([['invoice-1', dates]]));
  source.loadCharges = vi.fn(async () => new Map([['charge-1', {
    item_id: 'charge-1', invoice_id: 'invoice-1', service_id: 'service-1', description: 'Support',
    quantity: 1, unit_price: 1250, total_price: 1250, net_amount: 1250, tax_amount: 0
  }]]));
  source.loadClients = vi.fn(async () => adapter instanceof QuickBooksCSVAdapter
    ? new Map([['client-1', { client_id: 'client-1', client_name: 'Customer', payment_terms: 'net_30' }]])
    : { clients: new Map([['client-1', { client_id: 'client-1', client_name: 'Customer', billing_email: '' }]]), mappings: new Map() });

  const transformed = await adapter.transform(ctx);
  const delivered = await adapter.deliver(transformed, ctx);
  if (adapter instanceof QuickBooksCSVAdapter) {
    return (delivered.metadata as any).files[0].content as string;
  }
  return (delivered.artifacts as any).file.content as string;
}

beforeEach(() => vi.clearAllMocks());

describe('accounting CSV adapter date artifacts', () => {
  it.each([
    ['PostgreSQL Date values', new Date('2026-09-30T00:00:00.000Z'), new Date('2026-10-23T00:00:00.000Z'), '09/30/2026', '10/23/2026'],
    ['date-only and UTC timestamp strings', '2026-12-31', '2027-01-01T00:00:00Z', '12/31/2026', '01/01/2027'],
    ['UTC timestamp strings', '2026-09-30T00:00:00Z', '2026-10-23T00:00:00Z', '09/30/2026', '10/23/2026']
  ])('%s flows through QuickBooks transform and delivery to CSV bytes', async (_label, start, end, expectedStart, expectedEnd) => {
    const ctx = context('quickbooks_csv');
    const csv = await exportBytes(new QuickBooksCSVAdapter(), invoice(start as Date | string, end as Date | string), ctx);
    expect(csv).toContain(`INV-1,Customer,${expectedStart},${expectedEnd},`);
  });

  it.each([
    ['PostgreSQL Date values', new Date('2026-09-30T00:00:00.000Z'), new Date('2026-10-23T00:00:00.000Z'), '09/30/2026', '10/23/2026'],
    ['date-only and UTC timestamp strings', '2026-12-31', '2027-01-01T00:00:00Z', '12/31/2026', '01/01/2027'],
    ['UTC timestamp strings', '2026-09-30T00:00:00Z', '2026-10-23T00:00:00Z', '09/30/2026', '10/23/2026']
  ])('%s flows through Xero transform and delivery to CSV bytes in MM/DD/YYYY', async (_label, start, end, expectedStart, expectedEnd) => {
    const ctx = context('xero_csv', { dateFormat: 'MM/DD/YYYY' });
    const csv = await exportBytes(new XeroCsvAdapter(), invoice(start as Date | string, end as Date | string), ctx);
    expect(csv).toContain(`INV-1,invoice-1,${expectedStart},${expectedEnd},`);
  });

  it('Xero DD/MM/YYYY format preserves distinct invoice and due dates in delivered bytes', async () => {
    const ctx = context('xero_csv', { dateFormat: 'DD/MM/YYYY' });
    const csv = await exportBytes(new XeroCsvAdapter(), invoice(new Date('2026-09-30T00:00:00Z'), '2026-10-23'), ctx);
    expect(csv).toContain('INV-1,invoice-1,30/09/2026,23/10/2026,');
  });
});
