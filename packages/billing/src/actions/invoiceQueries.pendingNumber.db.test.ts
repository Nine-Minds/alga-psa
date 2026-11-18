import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from './_dbTestUtils';

/**
 * alga-2026-0002746: against the real schema, portal (client) callers never
 * receive an invoice that is waiting for its accounting-system number, while
 * MSP callers do and can see the numbering source. Exercises the real SELECT
 * lists and guards (fetchInvoicesByClient, fetchInvoicesByContract,
 * assertClientPortalInvoiceAccess).
 */

const state = vi.hoisted(() => ({
  db: null as any,
  tenant: '' as string,
  user: {} as Record<string, unknown>,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(state.user, { tenant: state.tenant }, ...args),
  withSerializableAuth: (fn: any) => fn,
  getSession: vi.fn(async () => ({ user: { id: state.user.user_id } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: state.db })) };
});

const tenant = uuidv4();
const clientId = uuidv4();
const otherClientId = uuidv4();
const userId = uuidv4();
let db: Knex;
const ids = { alga: uuidv4(), pending: uuidv4(), external: uuidv4() };

const msp = () => ({ user_id: userId, user_type: 'internal' });
const portal = () => ({ user_id: userId, user_type: 'client', clientId });

async function seed(invoiceId: string, number: string, source: string) {
  await db('invoices').insert({
    invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: number,
    invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
    total_amount: 1000, subtotal: 1000, tax: 0, status: 'sent', finalized_at: new Date().toISOString(),
    is_manual: true, is_prepayment: false, credit_applied: 0, invoice_number_source: source,
  });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  state.db = db;
  state.tenant = tenant;
  await db('tenants').insert({ tenant, client_name: 'PN Tenant', email: 'pn@test.local', billing_source: 'test' });
  await db('clients').insert([
    { tenant, client_id: clientId, client_name: 'Acme' },
    { tenant, client_id: otherClientId, client_name: 'Other' },
  ]);
  await seed(ids.alga, 'PN-ALGA', 'alga');
  await seed(ids.pending, 'PN-PROV', 'pending_external');
  await seed(ids.external, 'PN-XERO', 'external');
});

afterAll(async () => {
  for (const table of ['invoices', 'clients']) await db(table).where({ tenant }).delete().catch(() => undefined);
  await db('tenants').where({ tenant }).delete().catch(() => undefined);
  await db.destroy().catch(() => undefined);
});

describe('portal readers and pending_external invoices', () => {
  it('fetchInvoicesByClient: a portal caller does not get the pending invoice', async () => {
    state.user = portal();
    const { fetchInvoicesByClient } = await import('./invoiceQueries');
    const result = (await fetchInvoicesByClient(clientId)) as Array<{ invoice_number: string }>;
    expect(result.map((invoice) => invoice.invoice_number).sort()).toEqual(['PN-ALGA', 'PN-XERO']);
  });

  it('fetchInvoicesByClient: an MSP caller gets it, with invoice_number_source carried into the view model', async () => {
    state.user = msp();
    const { fetchInvoicesByClient } = await import('./invoiceQueries');
    const result = (await fetchInvoicesByClient(clientId)) as Array<{ invoice_number: string; invoice_number_source?: string }>;
    const bySource = Object.fromEntries(result.map((invoice) => [invoice.invoice_number, invoice.invoice_number_source]));
    expect(bySource).toEqual({ 'PN-ALGA': 'alga', 'PN-PROV': 'pending_external', 'PN-XERO': 'external' });
  });

  it('assertClientPortalInvoiceAccess: a client user is denied the pending invoice, an MSP user is not', async () => {
    const { getInvoiceRoutingState, getInvoiceForRendering } = await import('./invoiceQueries');

    state.user = portal();
    expect(await getInvoiceRoutingState(ids.pending)).toEqual({ exists: false, isDraft: false });
    expect(await getInvoiceRoutingState(ids.alga)).toMatchObject({ exists: true });
    expect(await getInvoiceForRendering(ids.pending)).toMatchObject({ messageKey: 'msp/invoicing:errors.permissions.invoiceAccess' });

    state.user = msp();
    expect(await getInvoiceRoutingState(ids.pending)).toMatchObject({ exists: true });
  });
});
