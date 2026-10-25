import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';

// Guarded DB test for the invoice lifecycle (alga-2026-0002724):
//   - deleting a quote-converted draft releases the quote link
//   - deleteDraftInvoice refuses non-drafts with a validation error
//   - finalize / unfinalize / delete each write an invoice audit row
//   - a post-commit failure leaves the invoice finalized and reports a warning
//   - the history reader (used by GET /api/v1/invoices/{id}/history) returns the rows
// Run ONLY against an explicitly provided database with INVOICE_LIFECYCLE_DB_TESTS=1
// (INVOICE_LIFECYCLE_DB_HOST/PORT/USER/PASSWORD/NAME override the defaults). The suite
// creates an isolated tenant and removes it afterwards. Skipped by default.

const enabled = process.env.INVOICE_LIFECYCLE_DB_TESTS === '1';

const config = {
  host: process.env.INVOICE_LIFECYCLE_DB_HOST || '127.0.0.1',
  port: Number(process.env.INVOICE_LIFECYCLE_DB_PORT || 6472),
  user: process.env.INVOICE_LIFECYCLE_DB_USER || 'app_user',
  password: process.env.INVOICE_LIFECYCLE_DB_PASSWORD || '',
  database: process.env.INVOICE_LIFECYCLE_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;
let userId: string;
let failAutoExport = false;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: userId }, { tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db })),
  };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
// Tax-source validation is session/tax-configuration driven and out of scope here.
vi.mock('../src/actions/taxSourceActions', async () => {
  const actual = await vi.importActual<any>('../src/actions/taxSourceActions');
  return {
    ...actual,
    validateInvoiceFinalization: vi.fn(async () => ({ canFinalize: true })),
    validateInvoiceFinalizationInternal: vi.fn(async () => ({ canFinalize: true })),
  };
});
vi.mock('../src/services/accountingSync/syncProducers', async () => {
  const actual = await vi.importActual<any>('../src/services/accountingSync/syncProducers');
  return {
    ...actual,
    enqueueInvoiceAutoExport: vi.fn(async (...args: any[]) => {
      if (failAutoExport) throw new Error('forced auto-export failure');
      return (actual as any).enqueueInvoiceAutoExport(...args);
    }),
  };
});

describe.runIf(enabled)('invoice lifecycle: quote release, audit trail, post-commit warnings', () => {
  let clientId: string;

  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
    tenant = uuidv4();
    userId = uuidv4();
    clientId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'Lifecycle Tenant', email: 'lifecycle@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'Lifecycle Client' });
    await db('users').insert({
      tenant, user_id: userId, username: `lifecycle-${userId.slice(0, 8)}`, first_name: 'Lena', last_name: 'Lifecycle',
      email: `lifecycle-${userId.slice(0, 8)}@test.local`, hashed_password: 'x', user_type: 'internal', is_inactive: false,
    });
  });

  afterEach(() => {
    failAutoExport = false;
  });

  afterAll(async () => {
    if (db) {
      for (const table of [
        'audit_logs', 'quote_activities', 'quotes', 'invoice_charges', 'invoices', 'users', 'clients',
      ]) {
        await db(table).where({ tenant }).delete().catch(() => undefined);
      }
      await db('tenants').where({ tenant }).delete().catch(() => undefined);
      await db.destroy();
    }
  });

  async function seedDraft(label: string) {
    const invoiceId = uuidv4();
    await db('invoices').insert({
      invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: `LC-${label}-${invoiceId.slice(0, 6)}`,
      invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
      total_amount: 1000, subtotal: 1000, tax: 0, status: 'draft', is_manual: true, is_prepayment: false, credit_applied: 0,
    });
    await db('invoice_charges').insert({
      tenant, item_id: uuidv4(), invoice_id: invoiceId, description: 'Lifecycle charge',
      quantity: 1, unit_price: 1000, total_price: 1000, tax_rate: 0, is_manual: true,
    });
    return invoiceId;
  }

  async function seedQuoteConverted(invoiceId: string, status = 'accepted') {
    const quoteId = uuidv4();
    await db('quotes').insert({
      tenant, quote_id: quoteId, client_id: clientId, title: 'Converted quote', status,
      converted_invoice_id: invoiceId, subtotal: 1000, discount_total: 0, tax: 0, total_amount: 1000,
      currency_code: 'USD', is_template: false, version: 1, tax_source: 'internal',
    });
    return quoteId;
  }

  const auditRows = (invoiceId: string) =>
    db('audit_logs').where({ tenant, table_name: 'invoices', record_id: invoiceId }).orderBy('timestamp', 'asc');

  it('deletes a quote-converted draft, unlinks the quote and records a quote activity', async () => {
    const invoiceId = await seedDraft('QDEL');
    const quoteId = await seedQuoteConverted(invoiceId);

    const { deleteDraftInvoice } = await import('../src/actions/invoiceModification');
    const result = await deleteDraftInvoice(invoiceId);
    expect(result).toEqual({ success: true });

    expect(await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).toBeUndefined();

    const quote = await db('quotes').where({ tenant, quote_id: quoteId }).first();
    expect(quote.converted_invoice_id).toBeNull();
    expect(quote.status).toBe('accepted');

    const activity = await db('quote_activities')
      .where({ tenant, quote_id: quoteId, activity_type: 'converted_invoice_deleted' })
      .first();
    expect(activity).toBeTruthy();
    expect(activity.performed_by).toBe(userId);
    expect(activity.metadata).toMatchObject({ invoice_id: invoiceId });
  });

  it('reverts a quote left in "converted" (no contract) back to accepted when its invoice is deleted', async () => {
    const invoiceId = await seedDraft('QREV');
    const quoteId = await seedQuoteConverted(invoiceId, 'converted');

    const { deleteDraftInvoice } = await import('../src/actions/invoiceModification');
    expect(await deleteDraftInvoice(invoiceId)).toEqual({ success: true });

    const quote = await db('quotes').where({ tenant, quote_id: quoteId }).first();
    expect(quote.converted_invoice_id).toBeNull();
    expect(quote.status).toBe('accepted');
    expect(quote.converted_at).toBeNull();
  });

  it('refuses deleteDraftInvoice on a finalized invoice with a validation error, not a throw', async () => {
    const invoiceId = await seedDraft('NOTDRAFT');
    await db('invoices').where({ tenant, invoice_id: invoiceId }).update({
      status: 'sent', finalized_at: new Date().toISOString(),
    });

    const { deleteDraftInvoice } = await import('../src/actions/invoiceModification');
    const result: any = await deleteDraftInvoice(invoiceId);

    expect(result).toHaveProperty('actionError');
    expect(result.i18nKey ?? result.actionErrorKey ?? JSON.stringify(result)).toContain('deleteNotDraft');
    expect(await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).toBeTruthy();
    expect(await auditRows(invoiceId)).toHaveLength(0);
  });

  it('writes audit rows with user and before/after status for finalize, unfinalize and delete', async () => {
    const invoiceId = await seedDraft('AUDIT');
    const { finalizeInvoice, unfinalizeInvoice, deleteDraftInvoice } = await import('../src/actions/invoiceModification');

    // A clean finalize keeps the pre-warnings contract: exactly { success: true }.
    expect(await finalizeInvoice(invoiceId)).toEqual({ success: true });
    expect(await unfinalizeInvoice(invoiceId)).toEqual({ success: true });
    expect(await deleteDraftInvoice(invoiceId)).toEqual({ success: true });

    const rows = await auditRows(invoiceId);
    expect(rows.map((r: any) => r.operation)).toEqual(['invoice_finalized', 'invoice_unfinalized', 'invoice_deleted']);
    for (const row of rows) {
      expect(row.user_id).toBe(userId);
      expect(row.details.before).toHaveProperty('status');
      expect(row.details.after).toHaveProperty('status');
    }
    expect(rows[0].details.before.status).toBe('draft');
    expect(rows[0].details.after.status).not.toBe('draft');
    expect(rows[1].details.before.status).toBe(rows[0].details.after.status);
    expect(rows[1].details.after.status).toBe('draft');
    expect(rows[2].details.before.status).toBe('draft');

    // The history reader backing GET /api/v1/invoices/{id}/history returns the same rows.
    const { listInvoiceAuditHistory } = await import('@alga-psa/db');
    const history = await listInvoiceAuditHistory(db, tenant, invoiceId);
    expect(history.map((h) => h.operation)).toEqual(['invoice_finalized', 'invoice_unfinalized', 'invoice_deleted']);
    expect(history[0]).toMatchObject({ user_id: userId, actor_name: expect.stringContaining('Lena') });
    expect(history[0].before.status).toBe('draft');
  });

  it('keeps the invoice finalized, returns success and names the step when a post-commit step throws', async () => {
    const invoiceId = await seedDraft('WARN');
    failAutoExport = true;

    const { finalizeInvoice } = await import('../src/actions/invoiceModification');
    const result: any = await finalizeInvoice(invoiceId);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ step: 'accounting_export', message: expect.stringContaining('forced auto-export failure') }),
    ]);

    const invoice = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
    expect(invoice.finalized_at).toBeTruthy();
    expect(invoice.status).not.toBe('draft');

    const rows = await auditRows(invoiceId);
    expect(rows.map((r: any) => r.operation)).toEqual(['invoice_finalized']);

    const history = (await import('@alga-psa/db')).listInvoiceAuditHistory;
    expect((await history(db, tenant, invoiceId)).map((h) => h.operation)).toEqual(['invoice_finalized']);
  });
});
