import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// The runner owns a migrated, seeded disposable database. Route the resolver's
// tenant connection to that database while keeping the REAL resolver and the
// REAL client-portal invoice access assertion under test. Only authentication
// (withAuth) and the coarse billing:read gate are supplied by the harness;
// query results and assertClientPortalInvoiceAccess are never mocked.
const context = vi.hoisted(() => ({
  tenant: '',
  db: undefined as Knex.Transaction | undefined,
  user: {} as any,
  billingRead: true,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));

vi.mock('@alga-psa/auth', () => ({
  getSession: async () => ({ user: { ...context.user, id: context.user.user_id } }),
  withOptionalAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) =>
    fn(context.user, { tenant: context.tenant }, ...args),
  withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) =>
    fn(context.user, { tenant: context.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async () => context.billingRead,
}));

import { getResolvedInvoiceTemplateId } from '@alga-psa/billing/actions/invoiceQueries';

let knex: Knex;

async function seedClient(
  trx: Knex.Transaction,
  tenant: string,
  invoiceTemplateId: string | null
): Promise<string> {
  const clientId = randomUUID();
  await trx('clients').insert({
    tenant,
    client_id: clientId,
    client_name: `Template fixture ${clientId.slice(0, 8)}`,
    invoice_template_id: invoiceTemplateId,
  });
  return clientId;
}

async function seedCustomTemplate(
  trx: Knex.Transaction,
  tenant: string,
  name: string
): Promise<string> {
  const templateId = randomUUID();
  await trx('invoice_templates').insert({
    tenant,
    template_id: templateId,
    name,
    version: 1,
    is_default: false,
    templateAst: { kind: 'invoice', blocks: [] },
  });
  return templateId;
}

async function seedInvoice(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  status: string
): Promise<string> {
  const invoiceId = randomUUID();
  await trx('invoices').insert({
    tenant,
    invoice_id: invoiceId,
    invoice_number: `INV-${invoiceId.slice(0, 8)}`,
    invoice_date: '2026-02-01',
    due_date: '2026-02-15',
    total_amount: 0,
    status,
    client_id: clientId,
  });
  return invoiceId;
}

async function assignTenantDefault(
  trx: Knex.Transaction,
  tenant: string,
  templateId: string
): Promise<void> {
  await trx('invoice_template_assignments').insert({
    tenant,
    scope_type: 'tenant',
    scope_id: null,
    template_source: 'custom',
    standard_invoice_template_code: null,
    invoice_template_id: templateId,
  });
}

describe('getResolvedInvoiceTemplateId client-portal resolution', () => {
  let tenant: string;
  let foreignTenant: string;
  let clientId: string;
  let foreignClientId: string;
  let trx: Knex.Transaction;

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex?.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    trx = await knex.transaction();
    tenant = randomUUID();
    foreignTenant = randomUUID();
    await trx('tenants').insert([
      { tenant, client_name: 'Template resolution fixture', email: `t-${tenant.slice(0, 8)}@example.test` },
      { tenant: foreignTenant, client_name: 'Foreign fixture', email: `t-${foreignTenant.slice(0, 8)}@example.test` },
    ]);
    clientId = await seedClient(trx, tenant, null);
    foreignClientId = await seedClient(trx, foreignTenant, null);

    context.db = trx;
    context.tenant = tenant;
    context.billingRead = true;
    context.user = { user_id: randomUUID(), user_type: 'client', clientId };
  });

  afterEach(async () => {
    await trx?.rollback();
  });

  it('T003: returns the client override over a distinct tenant assignment', async () => {
    const tenantDefault = await seedCustomTemplate(trx, tenant, 'Tenant default');
    const clientOverride = await seedCustomTemplate(trx, tenant, 'Client override');
    await assignTenantDefault(trx, tenant, tenantDefault);
    await trx('clients').where({ tenant, client_id: clientId }).update({ invoice_template_id: clientOverride });
    const invoiceId = await seedInvoice(trx, tenant, clientId, 'finalized');

    await expect(getResolvedInvoiceTemplateId(invoiceId)).resolves.toBe(clientOverride);
  });

  it('T003: falls back to the invoice_template_assignments default after the override is cleared', async () => {
    const tenantDefault = await seedCustomTemplate(trx, tenant, 'Tenant default');
    const clientOverride = await seedCustomTemplate(trx, tenant, 'Client override');
    await assignTenantDefault(trx, tenant, tenantDefault);
    await trx('clients').where({ tenant, client_id: clientId }).update({ invoice_template_id: clientOverride });
    const invoiceId = await seedInvoice(trx, tenant, clientId, 'finalized');

    await trx('clients').where({ tenant, client_id: clientId }).update({ invoice_template_id: null });

    await expect(getResolvedInvoiceTemplateId(invoiceId)).resolves.toBe(tenantDefault);
  });

  it('T003: returns null for another client\'s invoice in the same tenant', async () => {
    const otherClientId = await seedClient(trx, tenant, null);
    const invoiceId = await seedInvoice(trx, tenant, otherClientId, 'finalized');

    await expect(getResolvedInvoiceTemplateId(invoiceId)).resolves.toBeNull();
  });

  it('T003: returns null for a draft invoice', async () => {
    const invoiceId = await seedInvoice(trx, tenant, clientId, 'draft');

    await expect(getResolvedInvoiceTemplateId(invoiceId)).resolves.toBeNull();
  });

  it('T003: returns null for an invoice outside the authenticated tenant', async () => {
    const foreignInvoiceId = await seedInvoice(trx, foreignTenant, foreignClientId, 'finalized');

    await expect(getResolvedInvoiceTemplateId(foreignInvoiceId)).resolves.toBeNull();
  });

  it('T003: returns null when the caller lacks billing read permission', async () => {
    context.billingRead = false;
    const invoiceId = await seedInvoice(trx, tenant, clientId, 'finalized');

    await expect(getResolvedInvoiceTemplateId(invoiceId)).resolves.toBeNull();
  });
});
