/**
 * DB-backed coverage for the payment confirmation subscriber, closing the two
 * gaps the unit suite (which mocks the database and the link builder) cannot:
 *
 *  1. The "View Invoice" link comes from the REAL `buildPortalInvoiceUrl`
 *     → `getPortalDomainStatusForTenant` → `portal_domains` row. A tenant with
 *     an active custom domain gets that host; a tenant without one gets the
 *     configured public base URL.
 *  2. Duplicate prevention rests on the REAL (tenant, payment_id) primary key
 *     of `payment_confirmation_emails` (migration 20261021050000): the
 *     constraint rejects a duplicate row, and replayed/concurrent deliveries
 *     of one PAYMENT_RECORDED send exactly one email.
 *
 * Only the database handle seam and the mail transport (`sendEventEmail`) are
 * substituted; the builder, recipient resolution, setting read and claim run
 * for real against a migrated scratch database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

const state = vi.hoisted(() => ({
  db: null as unknown as import('knex').Knex,
  sent: [] as Array<{ to: string; template: string; context: any }>,
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async (tenant?: string) => ({ knex: state.db, tenant: tenant ?? null })),
    getConnection: vi.fn(async () => state.db),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
  };
});

// Event-bus wiring is not under test (the handler is invoked directly).
vi.mock('server/src/lib/eventBus/index', () => ({
  getEventBus: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
}));

// Mail transport only: capture what would be sent.
vi.mock('server/src/lib/notifications/sendEventEmail', () => ({
  sendEventEmail: vi.fn(async (params: { to: string; template: string; context: any }) => {
    state.sent.push({ to: params.to, template: params.template, context: params.context });
  }),
}));

import { handlePaymentRecordedEvent } from 'server/src/lib/eventBus/subscribers/paymentConfirmationSubscriber';

const FALLBACK_BASE_URL = 'https://app.fallback.test';
const HOOK_TIMEOUT = 240_000;

let db: Knex;

function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}

async function createTenant(): Promise<string> {
  const tenant = uuidv4();
  await db('tenants').insert({
    tenant,
    client_name: `Confirm Tenant ${tenant.slice(0, 8)}`,
    email: `owner-${tenant.slice(0, 8)}@tenant.test`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table(tenant, 'payment_provider_configs').insert({
    tenant,
    provider_type: 'stripe',
    is_enabled: true,
    is_default: true,
    settings: JSON.stringify({ sendPaymentConfirmations: true }),
  });
  return tenant;
}

async function seedPayment(tenant: string): Promise<{ paymentId: string; invoiceId: string; email: string }> {
  const clientId = uuidv4();
  const invoiceId = uuidv4();
  const email = `billing-${clientId.slice(0, 8)}@acme.test`;
  await table(tenant, 'clients').insert({
    client_id: clientId,
    tenant,
    client_name: `Acme ${clientId.slice(0, 8)}`,
    billing_email: email,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table(tenant, 'invoices').insert({
    invoice_id: invoiceId,
    tenant,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 8).toUpperCase()}`,
    total_amount: 12500,
    credit_applied: 0,
    currency_code: 'USD',
    status: 'sent',
    invoice_date: new Date().toISOString(),
    due_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const [row] = await table(tenant, 'invoice_payments')
    .insert({
      tenant,
      invoice_id: invoiceId,
      amount: 12500,
      payment_method: 'stripe',
      payment_date: new Date(),
      reference_number: `pi_${uuidv4().slice(0, 12)}`,
    })
    .returning('payment_id');
  return { paymentId: (row as { payment_id: string }).payment_id, invoiceId, email };
}

function paymentRecordedEvent(tenant: string, paymentId: string) {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    eventType: 'PAYMENT_RECORDED',
    timestamp: now,
    payload: {
      tenantId: tenant,
      occurredAt: now,
      actor: { actorType: 'SYSTEM' },
      paymentId,
      amount: '12500',
      currency: 'USD',
      method: 'stripe',
      source: 'online_payment',
    },
  };
}

describe('payment confirmation subscriber (database-backed)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'payment_confirmation_emails_test', runSeeds: false });
    state.db = db;
    // payment_provider_configs is an EE table; apply its (self-contained) migration.
    const requireCjs = createRequire(import.meta.url);
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const eeMigration = requireCjs(
      path.join(repoRoot, 'ee/server/migrations/20251124120000_create_payment_provider_tables.cjs')
    );
    await eeMigration.up(db);
    process.env.NEXT_PUBLIC_BASE_URL = FALLBACK_BASE_URL;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(() => {
    state.sent = [];
  });

  describe('confirmation link host (real buildPortalInvoiceUrl)', () => {
    it('uses the tenant\'s active custom portal domain', async () => {
      const tenant = await createTenant();
      await table(tenant, 'portal_domains').insert({
        tenant,
        domain: 'portal.acme-msp.test',
        canonical_host: `${tenant.slice(0, 7)}.portal.algapsa.com`,
        status: 'active',
        verification_method: 'cname',
        verification_details: JSON.stringify({}),
      });
      const { paymentId, invoiceId, email } = await seedPayment(tenant);

      await handlePaymentRecordedEvent(paymentRecordedEvent(tenant, paymentId));

      expect(state.sent).toHaveLength(1);
      expect(state.sent[0].to).toBe(email);
      expect(state.sent[0].template).toBe('payment-received');
      const link = new URL(state.sent[0].context.invoice.url);
      expect(link.host).toBe('portal.acme-msp.test');
      expect(link.protocol).toBe('https:');
      expect(link.pathname).toBe('/client-portal/billing');
      expect(link.searchParams.get('invoiceId')).toBe(invoiceId);
    });

    it('falls back to the configured public base URL when the tenant has no custom domain', async () => {
      const tenant = await createTenant();
      const { paymentId, invoiceId } = await seedPayment(tenant);

      await handlePaymentRecordedEvent(paymentRecordedEvent(tenant, paymentId));

      expect(state.sent).toHaveLength(1);
      const link = new URL(state.sent[0].context.invoice.url);
      expect(link.host).toBe(new URL(FALLBACK_BASE_URL).host);
      expect(link.searchParams.get('invoiceId')).toBe(invoiceId);
    });

    it('falls back when the tenant\'s custom domain is not active', async () => {
      const tenant = await createTenant();
      await table(tenant, 'portal_domains').insert({
        tenant,
        domain: 'pending.acme-msp.test',
        canonical_host: `${tenant.slice(0, 7)}.portal.algapsa.com`,
        status: 'pending_dns',
        verification_method: 'cname',
        verification_details: JSON.stringify({}),
      });
      const { paymentId } = await seedPayment(tenant);

      await handlePaymentRecordedEvent(paymentRecordedEvent(tenant, paymentId));

      expect(state.sent).toHaveLength(1);
      expect(new URL(state.sent[0].context.invoice.url).host).toBe(new URL(FALLBACK_BASE_URL).host);
    });
  });

  describe('duplicate prevention (real payment_confirmation_emails primary key)', () => {
    it('the (tenant, payment_id) key rejects a duplicate claim row', async () => {
      const tenant = await createTenant();
      const paymentId = uuidv4();
      await table(tenant, 'payment_confirmation_emails').insert({ tenant, payment_id: paymentId });

      await expect(
        table(tenant, 'payment_confirmation_emails').insert({ tenant, payment_id: paymentId })
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('a replayed PAYMENT_RECORDED sends exactly one email', async () => {
      const tenant = await createTenant();
      const { paymentId, email } = await seedPayment(tenant);
      const event = paymentRecordedEvent(tenant, paymentId);

      await handlePaymentRecordedEvent(event);
      await handlePaymentRecordedEvent(event);
      await handlePaymentRecordedEvent({ ...event, id: uuidv4() });

      expect(state.sent).toHaveLength(1);
      const claims = await table(tenant, 'payment_confirmation_emails').where({ payment_id: paymentId });
      expect(claims).toHaveLength(1);
      expect(claims[0].recipient_email).toBe(email);
    });

    it('concurrent deliveries of the same payment send exactly one email', async () => {
      const tenant = await createTenant();
      const { paymentId } = await seedPayment(tenant);

      await Promise.all(
        Array.from({ length: 5 }, () => handlePaymentRecordedEvent(paymentRecordedEvent(tenant, paymentId)))
      );

      expect(state.sent).toHaveLength(1);
      const claims = await table(tenant, 'payment_confirmation_emails').where({ payment_id: paymentId });
      expect(claims).toHaveLength(1);
    });

    it('sends nothing and claims nothing when the tenant turned the setting off', async () => {
      const tenant = await createTenant();
      await table(tenant, 'payment_provider_configs')
        .where({ provider_type: 'stripe' })
        .update({ settings: JSON.stringify({ sendPaymentConfirmations: false }) });
      const { paymentId } = await seedPayment(tenant);

      await handlePaymentRecordedEvent(paymentRecordedEvent(tenant, paymentId));

      expect(state.sent).toHaveLength(0);
      const claims = await table(tenant, 'payment_confirmation_emails').where({ payment_id: paymentId });
      expect(claims).toHaveLength(0);
    });
  });
});
