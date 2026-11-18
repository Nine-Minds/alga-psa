import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb, withTransaction, writeInvoiceAudit } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// alga-2026-0002724: history endpoint service path (GET /api/v1/invoices/{id}/history)
// and REST finalize parity (caller-supplied finalized_at, recurring-provenance slot).
vi.mock('../../../lib/eventBus/publishers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    publishEvent: vi.fn().mockResolvedValue(undefined),
    publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
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

import { InvoiceService } from '@/lib/api/services/InvoiceService';

let db: Knex;
const tenants = new Set<string>();

const t = (tenant: string, table: string) => tenantDb(db, tenant).table(table);
const tenantRows = () => tenantDb(db, '__fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function fixture() {
  const tenant = uuidv4();
  const clientId = uuidv4();
  const invoiceId = uuidv4();
  const userId = uuidv4();
  tenants.add(tenant);
  await tenantRows().insert({ tenant, client_name: `Hist ${tenant.slice(0, 8)}`, email: `h-${tenant.slice(0, 8)}@example.com` });
  await t(tenant, 'clients').insert({ tenant, client_id: clientId, client_name: 'Hist Client' });
  await t(tenant, 'users').insert({
    tenant, user_id: userId, username: `h-${userId.slice(0, 8)}`, first_name: 'Hana', last_name: 'History',
    email: `h-${userId.slice(0, 8)}@example.com`, hashed_password: 'x', user_type: 'internal', is_inactive: false,
  });
  await t(tenant, 'invoices').insert({
    tenant, invoice_id: invoiceId, invoice_number: `H-${invoiceId.slice(0, 6)}`, client_id: clientId, status: 'draft',
    invoice_date: '2026-08-06T00:00:00.000Z', due_date: '2026-09-05T00:00:00.000Z',
    subtotal: 1000, tax: 0, total_amount: 1000, is_manual: true, is_prepayment: false, credit_applied: 0,
  });
  await t(tenant, 'invoice_charges').insert({
    tenant, item_id: uuidv4(), invoice_id: invoiceId, description: 'Line', quantity: 1, unit_price: 1000,
    total_price: 1000, tax_rate: 0, is_manual: true,
  });
  const service = new InvoiceService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db });
  vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
  const context = { tenant, userId } as any;
  return { tenant, invoiceId, userId, service, context };
}

describe('InvoiceService history + REST finalize parity', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterEach(async () => {
    for (const tenant of tenants) {
      for (const table of ['audit_logs', 'invoice_charges', 'invoices', 'users', 'clients']) {
        await t(tenant, table).del().catch(() => undefined);
      }
      await tenantRows().where({ tenant }).del().catch(() => undefined);
    }
    tenants.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('throws NotFoundError (404) for an unknown invoice id', async () => {
    const { service, context } = await fixture();
    await expect(service.getInvoiceHistory(uuidv4(), context)).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('returns an empty list for a real invoice without history, and does not leak other tenants', async () => {
    const a = await fixture();
    const b = await fixture();
    expect(await a.service.getInvoiceHistory(a.invoiceId, a.context)).toEqual([]);
    // Same id queried under another tenant is a 404, not b's or a's rows.
    await expect(b.service.getInvoiceHistory(a.invoiceId, b.context)).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('returns audit rows with actor and before/after for a real invoice', async () => {
    const { tenant, invoiceId, userId, service, context } = await fixture();
    await withTransaction(db, (trx) =>
      writeInvoiceAudit(trx, tenant, 'invoice_finalized', {
        invoiceId, userId, invoiceNumber: 'H-1',
        before: { status: 'draft', finalized_at: null },
        after: { status: 'sent', finalized_at: '2026-08-06' },
      }),
    );
    const history = await service.getInvoiceHistory(invoiceId, context);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      operation: 'invoice_finalized', user_id: userId, actor_name: expect.stringContaining('Hana'),
      before: { status: 'draft' }, after: { status: 'sent' },
    });
  });

  it('REST finalize honours a caller-supplied finalized_at and records it in the audit row', async () => {
    const { tenant, invoiceId, service, context } = await fixture();
    await service.finalizeInvoice({ invoice_id: invoiceId, finalized_at: '2026-07-15' } as any, context);

    const row = await t(tenant, 'invoices').where({ invoice_id: invoiceId }).first();
    expect(new Date(row.finalized_at).getUTCMonth()).toBe(6);
    expect(new Date(row.finalized_at).getUTCDate()).toBe(15);

    const history = await service.getInvoiceHistory(invoiceId, context);
    expect(history.map((h) => h.operation)).toEqual(['invoice_finalized']);
    expect(String(history[0].after.finalized_at).slice(0, 10)).toBe('2026-07-15');
  });
});
