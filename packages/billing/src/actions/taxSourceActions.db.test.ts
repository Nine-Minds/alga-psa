import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from './_dbTestUtils';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

import { changeInvoiceTaxSourceInternal } from './taxSourceActions';

// Ticket alga-2026-0002886, second report: two finalized invoices carried
// internal tax after the tenant switched to accounting-system tax, and nothing
// could move them to delegation. A finalized invoice may now make exactly that
// move, as long as it has never been exported, and keeps its amounts for the
// tax import to replace.

const tenant = uuidv4();
const clientId = uuidv4();
let db: Knex;

async function seedInvoice(opts: {
  status: string;
  taxSource?: string;
  finalized?: boolean;
}): Promise<string> {
  const invoiceId = uuidv4();
  await db('invoices').insert({
    tenant,
    invoice_id: invoiceId,
    client_id: clientId,
    invoice_number: `TAXSRC-${invoiceId.slice(0, 8)}`,
    invoice_date: '2026-10-26',
    due_date: '2026-11-25',
    status: opts.status,
    tax_source: opts.taxSource ?? 'internal',
    subtotal: 242374,
    tax: 18784,
    total_amount: 261158,
    credit_applied: 0,
    is_manual: true,
    finalized_at: opts.finalized === false ? null : '2026-10-26T00:00:00Z',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('invoice_charges').insert({
    tenant,
    item_id: uuidv4(),
    invoice_id: invoiceId,
    description: 'Dell Pro 16 Laptop',
    quantity: 1,
    unit_price: 242374,
    total_price: 261158,
    net_amount: 242374,
    tax_amount: 18784,
    tax_rate: 7.75,
    tax_region: 'GA-FUL',
    is_taxable: true,
    is_manual: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return invoiceId;
}

async function invoiceRow(invoiceId: string) {
  return db('invoices').where({ tenant, invoice_id: invoiceId }).first();
}

async function change(invoiceId: string, to: 'internal' | 'external' | 'pending_external') {
  return db.transaction((trx) => changeInvoiceTaxSourceInternal(trx, tenant, invoiceId, to));
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  await db('tenants').insert({
    tenant,
    client_name: `Tax Source ${tenant.slice(0, 8)}`,
    email: `tax-source-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('clients').insert({
    tenant,
    client_id: clientId,
    client_name: 'XOGENT test client',
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}, 300_000);

afterAll(async () => {
  if (!db) return;
  await db('tenant_external_entity_mappings').where({ tenant }).del();
  await db('invoice_charges').where({ tenant }).del();
  await db('invoices').where({ tenant }).del();
  await db('clients').where({ tenant }).del();
  await db('tenants').where({ tenant }).del();
  await db.destroy().catch(() => undefined);
});

describe('changeInvoiceTaxSourceInternal on finalized invoices', () => {
  it('moves a paid internal-tax invoice to pending delegation without touching its amounts', async () => {
    const invoiceId = await seedInvoice({ status: 'paid' });

    expect(await change(invoiceId, 'pending_external')).toEqual({ success: true });

    const row = await invoiceRow(invoiceId);
    expect(row.tax_source).toBe('pending_external');
    expect(Number(row.subtotal)).toBe(242374);
    expect(Number(row.tax)).toBe(18784);
    expect(Number(row.total_amount)).toBe(261158);
    const [charge] = await db('invoice_charges').where({ tenant, invoice_id: invoiceId });
    expect(Number(charge.tax_amount)).toBe(18784);
    expect(await db('transactions').where({ tenant, invoice_id: invoiceId })).toHaveLength(0);
  });

  it('moves a sent invoice the same way, and a repeat is a no-op', async () => {
    const invoiceId = await seedInvoice({ status: 'sent' });
    expect(await change(invoiceId, 'pending_external')).toEqual({ success: true });
    expect(await change(invoiceId, 'pending_external')).toEqual({ success: true });
    expect((await invoiceRow(invoiceId)).tax_source).toBe('pending_external');
  });

  it('refuses every other move on a finalized invoice', async () => {
    const pending = await seedInvoice({ status: 'sent', taxSource: 'pending_external' });
    expect(await change(pending, 'internal')).toMatchObject({
      success: false,
      error: expect.stringMatching(/finalized invoice can only be switched/i),
    });
    expect((await invoiceRow(pending)).tax_source).toBe('pending_external');

    const internal = await seedInvoice({ status: 'sent' });
    expect(await change(internal, 'external')).toMatchObject({ success: false });
    expect((await invoiceRow(internal)).tax_source).toBe('internal');

    const cancelled = await seedInvoice({ status: 'cancelled' });
    expect(await change(cancelled, 'pending_external')).toMatchObject({
      success: false,
      error: expect.stringMatching(/cancelled/i),
    });
  });

  it('refuses an invoice that already reached the accounting system', async () => {
    const invoiceId = await seedInvoice({ status: 'sent' });
    await db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
      external_entity_id: 'qbo-1',
      external_realm_id: 'realm-1',
      sync_status: 'synced',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    expect(await change(invoiceId, 'pending_external')).toMatchObject({
      success: false,
      error: expect.stringMatching(/synced to an accounting system/i),
    });
    expect((await invoiceRow(invoiceId)).tax_source).toBe('internal');
  });

  it('reports a missing invoice', async () => {
    expect(await change(uuidv4(), 'pending_external')).toEqual({ success: false, error: 'Invoice not found' });
  });
});
