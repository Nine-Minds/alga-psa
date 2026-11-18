import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from './_dbTestUtils';

/**
 * alga-2026-0002746: finalize records invoices.invoice_number_source, unfinalize
 * resets only `pending_external`, toggling the setting never touches existing
 * rows, and autopay waits for the Xero number.
 */

const refs = vi.hoisted(() => ({
  db: null as any,
  tenant: '' as string,
  userId: '' as string,
  integration: null as null | { adapterType: string; targetRealm: string },
  connections: {} as Record<string, { xeroTenantId: string }>,
}));
const autopaySpy = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: refs.userId }, { tenant: refs.tenant }, ...args),
  getSession: vi.fn(async () => ({ user: { id: refs.userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: refs.db })) };
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
vi.mock('./taxSourceActions', async () => {
  const actual = await vi.importActual<any>('./taxSourceActions');
  return {
    ...actual,
    validateInvoiceFinalization: vi.fn(async () => ({ canFinalize: true })),
    validateInvoiceFinalizationInternal: vi.fn(async () => ({ canFinalize: true })),
  };
});
vi.mock('../services/accountingSync/syncProducers', async () => {
  const actual = await vi.importActual<any>('../services/accountingSync/syncProducers');
  return { ...actual, enqueueInvoiceAutoExport: vi.fn(async () => undefined) };
});
vi.mock('../services/autopayBridge', async () => {
  const actual = await vi.importActual<any>('../services/autopayBridge');
  return { ...actual, startInvoiceAutopay: (...args: unknown[]) => (autopaySpy as any)(...args) };
});
vi.mock('../services/accountingSync/connectedAccountingIntegration', async () => {
  const actual = await vi.importActual<any>('../services/accountingSync/connectedAccountingIntegration');
  return { ...actual, resolveConnectedAccountingIntegration: vi.fn(async () => refs.integration) };
});
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: vi.fn(async () => refs.connections),
}));

const tenant = uuidv4();
const userId = uuidv4();
const clientId = uuidv4();
const XERO_ORG = 'xero-org-111';
const XERO_CONNECTION = 'conn-aaa';

let db: Knex;

async function setRealms(realms: string[]) {
  const { setXeroAssignedNumbering } = await import('@alga-psa/integrations/lib/xero/xeroInvoiceNumberingSettings');
  for (const realm of ['xero-org-111', 'other-org']) {
    await setXeroAssignedNumbering(db, tenant, realm, realms.includes(realm));
  }
}

async function seedDraft(label: string, extra: Record<string, unknown> = {}) {
  const invoiceId = uuidv4();
  await db('invoices').insert({
    invoice_id: invoiceId, tenant, client_id: clientId, invoice_number: `NS-${label}-${invoiceId.slice(0, 6)}`,
    invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
    total_amount: 1000, subtotal: 1000, tax: 0, status: 'draft', is_manual: true, is_prepayment: false, credit_applied: 0,
    ...extra,
  });
  await db('invoice_charges').insert({
    tenant, item_id: uuidv4(), invoice_id: invoiceId, description: 'Charge', quantity: 1, unit_price: 1000,
    total_price: 1000, tax_rate: 0, is_manual: true,
  });
  return invoiceId;
}

const sourceOf = async (invoiceId: string) =>
  (await db('invoices').where({ tenant, invoice_id: invoiceId }).first()).invoice_number_source as string;

async function finalize(invoiceId: string) {
  const { finalizeInvoiceWithKnex } = await import('./invoiceModification');
  return finalizeInvoiceWithKnex(invoiceId, db, tenant, userId, { internalValidation: true });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  refs.db = db;
  refs.tenant = tenant;
  refs.userId = userId;
  await db('tenants').insert({ tenant, client_name: 'Numbering Source Tenant', email: 'ns@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'Acme' });
  await db('users').insert({
    tenant, user_id: userId, username: `ns-${userId.slice(0, 8)}`, first_name: 'N', last_name: 'S',
    email: `ns-${userId.slice(0, 8)}@test.local`, hashed_password: 'x', user_type: 'internal', is_inactive: false,
  });
});

beforeEach(async () => {
  autopaySpy.mockClear();
  refs.integration = { adapterType: 'xero', targetRealm: XERO_CONNECTION };
  refs.connections = { [XERO_CONNECTION]: { xeroTenantId: XERO_ORG } };
  await setRealms([XERO_ORG]);
});

afterAll(async () => {
  for (const table of ['audit_logs', 'invoice_charges', 'invoices', 'users', 'clients', 'tenant_settings']) {
    await db(table).where({ tenant }).delete().catch(() => undefined);
  }
  await db('tenants').where({ tenant }).delete().catch(() => undefined);
  await db.destroy().catch(() => undefined);
});

describe('invoice_number_source at finalize / unfinalize', () => {
  it('defaults to alga on a new row', async () => {
    expect(await sourceOf(await seedDraft('DEF'))).toBe('alga');
  });

  it('finalize with the mode on for the resolved Xero organisation sets pending_external and defers autopay', async () => {
    const invoiceId = await seedDraft('ON');
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('pending_external');
    expect(autopaySpy).not.toHaveBeenCalled();
  });

  it('also matches when the list holds the connection id', async () => {
    await setRealms([]);
    const { setXeroAssignedNumbering } = await import('@alga-psa/integrations/lib/xero/xeroInvoiceNumberingSettings');
    await setXeroAssignedNumbering(db, tenant, XERO_CONNECTION, true);
    const invoiceId = await seedDraft('CONN');
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('pending_external');
    await setXeroAssignedNumbering(db, tenant, XERO_CONNECTION, false);
  });

  it('finalize with the mode off stays alga and starts autopay', async () => {
    await setRealms([]);
    const invoiceId = await seedDraft('OFF');
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('alga');
    expect(autopaySpy).toHaveBeenCalledTimes(1);
  });

  it('finalize with QuickBooks resolved stays alga even when the Xero mode is on', async () => {
    refs.integration = { adapterType: 'quickbooks_online', targetRealm: XERO_ORG };
    const invoiceId = await seedDraft('QBO');
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('alga');
  });

  it('an unlisted Xero organisation stays alga', async () => {
    refs.connections = { [XERO_CONNECTION]: { xeroTenantId: 'some-other-org' } };
    const invoiceId = await seedDraft('UNLISTED');
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('alga');
  });

  it('credit notes and prepayments never become pending_external', async () => {
    const { resolveInitialInvoiceNumberSource } = await import('../services/accountingSync/invoiceNumberSource');
    expect(await resolveInitialInvoiceNumberSource(db, tenant, { invoice_type: 'credit_note' }, null)).toBe('alga');
    expect(await resolveInitialInvoiceNumberSource(db, tenant, { invoice_type: 'standard' }, 'negative_total')).toBe('alga');
    expect(await resolveInitialInvoiceNumberSource(db, tenant, { invoice_type: 'prepayment' }, 'prepayment')).toBe('alga');
    expect(await resolveInitialInvoiceNumberSource(db, tenant, { invoice_type: 'standard', is_prepayment: true }, null)).toBe('alga');
    expect(await resolveInitialInvoiceNumberSource(db, tenant, { invoice_type: 'standard' }, null)).toBe('pending_external');
  });

  it('turning the setting off does not change existing rows', async () => {
    const invoiceId = await seedDraft('KEEP');
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('pending_external');
    await setRealms([]);
    expect(await sourceOf(invoiceId)).toBe('pending_external');
  });

  it('unfinalize resets pending_external to alga and a re-finalize decides afresh', async () => {
    const invoiceId = await seedDraft('UNF');
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('pending_external');

    const { unfinalizeInvoice } = await import('./invoiceModification');
    const result = await unfinalizeInvoice(invoiceId);
    expect((result as any)?.success).toBe(true);
    expect(await sourceOf(invoiceId)).toBe('alga');

    await setRealms([]);
    await finalize(invoiceId);
    expect(await sourceOf(invoiceId)).toBe('alga');
  });

  it('unfinalize leaves an external invoice external', async () => {
    const invoiceId = await seedDraft('EXT');
    await finalize(invoiceId);
    await db('invoices').where({ tenant, invoice_id: invoiceId }).update({ invoice_number_source: 'external' });

    const { unfinalizeInvoice } = await import('./invoiceModification');
    const result = await unfinalizeInvoice(invoiceId);
    expect((result as any)?.success).toBe(true);
    expect(await sourceOf(invoiceId)).toBe('external');
  });
});
