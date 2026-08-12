/**
 * Cold-start regression for the draft-review defect:
 *
 *   "QBO paymentApplier and the alternative-payments route call
 *   recordExternalPayment without loading the EE PaymentService module that
 *   registers the sole in-memory terminal-status handler, so paid transitions
 *   can return with an active Stripe session unretired."
 *
 * Both callers reach `recordExternalPayment` (which calls
 * `notifyInvoiceTerminalStatus` on a paid transition) with NO prior import of
 * the EE payments module in the process. This suite proves the registry's lazy
 * load closes the gap: each test resets the module graph and forces the
 * `@enterprise/lib/payments` mock factory to run fresh (`vi.doMock` — a plain
 * file-level `vi.mock` factory is cached across `vi.resetModules`), so the only
 * way the EE module can be imported during the transition is the lazy load
 * inside `notifyInvoiceTerminalStatus`.
 *
 * The `eePaymentModuleImports` counter is the explicit guard against a false
 * pass: if any unrelated import had pre-registered the handler, the counter
 * would be 0 and the emulator session would stay open. A pass requires BOTH the
 * counter to be exactly 1 AND the session/link to be retired.
 *
 * This lives in its own file (not the shared journey suite) because
 * `vi.resetModules` invalidates module identity for the whole worker — the
 * journey suite's `instanceof PaymentLinkError` assertions depend on a stable
 * module graph. Its database is a separate disposable database so it never
 * races the journey suite's `invoice_payment_links_test` DROP/CREATE.
 */

import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import knex from 'knex';
import path from 'node:path';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';

import { tenantDb } from '@alga-psa/db';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '@alga-psa/emulator-stripe';
import { getSecret } from '../../../lib/utils/getSecret';

let db: Knex;
let tenantId: string;
let host: EmulatorHost;
let stripeBase: string;
let stripeControlUrl: string;

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__cold_start_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

// The billing payment-action layer and the terminal-status registry dynamically
// import the enterprise module; the production webpack alias maps @enterprise
// to ee/server/src when EDITION=ee, so point it at the real implementation for
// the test run. The factory is shared so each cold-start test can re-apply it
// via `vi.doMock`, forcing a fresh execution per fresh module graph. The
// counter proves the import that registers the handler happened exactly once,
// during the lazy load, and not from any other import in the graph.
const eePaymentModuleImports = vi.hoisted(() => ({ value: 0 }));
const eePaymentModuleFactory = vi.hoisted(() => async () => {
  eePaymentModuleImports.value += 1;
  const ee = await import('@ee/lib/payments');
  return {
    PaymentService: ee.PaymentService,
    createStripePaymentProvider: ee.createStripePaymentProvider,
  };
});
vi.mock('@enterprise/lib/payments', eePaymentModuleFactory);

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getConnection: vi.fn(async () => db),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

// PaymentService reads its connection through this seam.
vi.mock('server/src/lib/db/db', () => ({
  getConnection: vi.fn(async () => db),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

// The billing payment-action layer resolves the actor through the separate
// `@alga-psa/auth/getCurrentUser` specifier (see billing authHelpers); the
// global setup only mocks the `@alga-psa/auth` barrel.
vi.mock('@alga-psa/auth/getCurrentUser', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/auth/getCurrentUser')>('@alga-psa/auth/getCurrentUser');
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => ({
      user_id: 'cold-start-user',
      tenant: tenantId,
      roles: [{ role_name: 'Admin' }],
    })),
  };
});

// Emulator credentials are fixtures, not secrets; the tenant secret path is
// short-circuited so the provider initializes against the emulator.
vi.mock('@alga-psa/core/secrets', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/core/secrets')>('@alga-psa/core/secrets');
  return {
    ...actual,
    getSecretProviderInstance: vi.fn(async () => ({
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'stripe_payment_secret_key') return 'sk_test_algasim';
        if (key === 'stripe_payment_webhook_secret') return 'whsec_algasim';
        return undefined;
      }),
      getAppSecret: vi.fn(async (key: string) => {
        if (key === 'stripe_secret_key') return 'sk_test_algasim';
        if (key === 'stripe_payment_webhook_secret' || key === 'stripe_webhook_secret') return 'whsec_algasim';
        if (key === 'stripe_publishable_key') return 'pk_test_algasim';
        return undefined;
      }),
    })),
  };
});

// PaymentService publishes workflow events and records transactions on its own
// paths; the cold-start transitions record through recordExternalPayment, so
// keep these seams inert.
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('server/src/lib/utils/transactionUtils', () => ({
  recordTransaction: vi.fn(async () => ({ transaction_id: uuidv4() })),
}));

const HOOK_TIMEOUT = 240_000;

describe('cold-start terminal-status handler registration (draft-review regression)', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.NODE_ENV = 'test';
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.EMAIL_FROM = 'billing@msp.test';

    db = await bootstrapDb('cold_start_payment_links_test');
    tenantId = await ensureTenant(db);

    host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
    const { controlPort, ports } = await host.start();
    stripeControlUrl = `http://127.0.0.1:${controlPort}`;
    stripeBase = `http://127.0.0.1:${ports.stripe}`;
    process.env.STRIPE_API_BASE_URL = stripeBase;
    process.env.STRIPE_SECRET_KEY = 'sk_test_algasim';
    process.env.STRIPE_PAYMENT_WEBHOOK_SECRET = 'whsec_algasim';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_algasim';
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await host?.stop();
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('QBO paymentApplier retires an active link on a paid transition from a cold module graph', async () => {
    await resetSharedState();
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    await seedClientWithBillingContact(db, tenantId, clientId, `cold-qbo-${uuidv4().slice(0, 8)}@acme.test`);
    await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 32000);
    await upsertProviderConfig(db, tenantId);

    // Create the live session and its DB link row directly — the email-send
    // path would import the EE module and defeat the cold-start premise.
    const session = await createEmulatorCheckoutSession(invoiceId, clientId);
    await tenantTable(db, tenantId, 'invoice_payment_links').insert({
      link_id: uuidv4(),
      tenant: tenantId,
      invoice_id: invoiceId,
      provider_type: 'stripe',
      external_link_id: session.id,
      url: session.url,
      amount: 32000,
      currency: 'USD',
      status: 'active',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      metadata: JSON.stringify({ stripe_customer_id: session.customer }),
      created_at: db.fn.now(),
    });

    // Fresh module graph: baseline the import counter and force the EE mock
    // factory to run fresh in this test's graph. `vi.doMock` overrides the
    // file-level mock for the next import, which `vi.resetModules` alone would
    // not re-execute.
    eePaymentModuleImports.value = 0;
    vi.doMock('@enterprise/lib/payments', eePaymentModuleFactory);
    vi.resetModules();

    const { applyExternalPaymentChange } = await import(
      '@alga-psa/billing/services/accountingSync/paymentApplier'
    );
    const { emptyCycleStats } = await import(
      '@alga-psa/billing/services/accountingSync/accountingSync.types'
    );

    const invoiceMapping = {
      id: `imap-${uuidv4().slice(0, 8)}`,
      alga_entity_id: invoiceId,
      external_entity_id: 'qbo-inv-ext-cold',
      sync_status: 'synced',
      metadata: {},
    };
    const ledger = makeColdStartLedger(invoiceMapping);
    const stats = emptyCycleStats();

    await applyExternalPaymentChange(
      {
        knex: db,
        tenantId,
        adapterType: 'quickbooks_online',
        targetRealm: 'realm-cold',
        ledger: ledger as any,
        exceptions: { createOrUpdate: async () => ({ created: false }) } as any,
        stats,
      },
      {
        entityType: 'Payment',
        externalId: 'qbo-pay-cold-1',
        syncToken: '1',
        deleted: false,
        payload: {
          PaymentRefNum: 'REF-COLD',
          TotalAmt: 320.0,
          UnappliedAmt: 0,
          Line: [{ Amount: 320.0, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'qbo-inv-ext-cold' }] }],
        },
      }
    );

    // The transition imported the EE module exactly once — the lazy load — and
    // it was the mechanism that retired the link. If any other import had
    // pre-registered the handler, the counter would be 0 and this fails.
    expect(eePaymentModuleImports.value).toBe(1);

    const invoice = await tenantTable(db, tenantId, 'invoices').where({ invoice_id: invoiceId }).first();
    expect(invoice.status).toBe('paid');

    const links = await tenantTable(db, tenantId, 'invoice_payment_links').where({ invoice_id: invoiceId });
    expect(links).toHaveLength(1);
    expect(links[0].status).toBe('expired');
    expect(links[0].metadata).toMatchObject({
      invoice_not_payable: true,
      invoice_status: 'paid',
    });

    const sessions = await emulatorState('checkout-sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('expired');
  }, HOOK_TIMEOUT);

  it('alternative-payments webhook retires an active link on a paid transition from a cold module graph', async () => {
    await resetSharedState();
    process.env.ALTERNATIVE_PAYMENTS_WEBHOOK_SECRET = 'cold-start-test-secret';
    const clientId = uuidv4();
    const invoiceId = uuidv4();
    await seedClientWithBillingContact(db, tenantId, clientId, `cold-alt-${uuidv4().slice(0, 8)}@acme.test`);
    await seedFinalizedInvoice(db, tenantId, clientId, invoiceId, 32000);
    await upsertProviderConfig(db, tenantId);

    const session = await createEmulatorCheckoutSession(invoiceId, clientId);
    await tenantTable(db, tenantId, 'invoice_payment_links').insert({
      link_id: uuidv4(),
      tenant: tenantId,
      invoice_id: invoiceId,
      provider_type: 'stripe',
      external_link_id: session.id,
      url: session.url,
      amount: 32000,
      currency: 'USD',
      status: 'active',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      metadata: JSON.stringify({ stripe_customer_id: session.customer }),
      created_at: db.fn.now(),
    });

    // Same cold-start mechanics as the QBO case: baseline the counter and
    // force the EE mock factory to run fresh in this test's graph.
    eePaymentModuleImports.value = 0;
    vi.doMock('@enterprise/lib/payments', eePaymentModuleFactory);
    vi.resetModules();

    const { POST } = await import('server/src/app/api/webhooks/alternative-payments/route');

    const eventId = `evt_cold_${uuidv4().slice(0, 8)}`;
    const payload = {
      tenant_id: tenantId,
      event_id: eventId,
      event_type: 'payment.updated',
      status: 'paid',
      invoice_id: invoiceId,
      amount_cents: 32000,
      currency: 'USD',
      payment_id: `alt-pay-${uuidv4().slice(0, 8)}`,
    };
    const body = JSON.stringify(payload);
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', process.env.ALTERNATIVE_PAYMENTS_WEBHOOK_SECRET!).update(body).digest('hex');

    const req = new NextRequest('http://localhost/api/webhooks/alternative-payments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-alternative-payments-signature': signature,
      },
      body,
    });

    const res = await POST(req);
    const result = await res.json();
    expect(result, JSON.stringify(result)).toMatchObject({ received: true, processed: true });
    expect(result.paymentRecorded).toBe(true);

    // Exactly one EE import during the whole route handling: the lazy load. A
    // pre-registered handler would make this 0 and the session would stay open.
    expect(eePaymentModuleImports.value).toBe(1);

    const invoice = await tenantTable(db, tenantId, 'invoices').where({ invoice_id: invoiceId }).first();
    expect(invoice.status).toBe('paid');

    const links = await tenantTable(db, tenantId, 'invoice_payment_links').where({ invoice_id: invoiceId });
    expect(links).toHaveLength(1);
    expect(links[0].status).toBe('expired');
    expect(links[0].metadata).toMatchObject({
      invoice_not_payable: true,
      invoice_status: 'paid',
    });

    const sessions = await emulatorState('checkout-sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('expired');
  }, HOOK_TIMEOUT);

  async function emulatorState(view: string): Promise<any[]> {
    const response = await fetch(`${stripeControlUrl}/control/stripe/state/${view}`);
    const body = await response.json();
    return body.result ?? [];
  }

  async function controlPost(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${stripeControlUrl}/control/stripe/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok, `control ${path}: ${response.status}`).toBe(true);
  }

  async function resetSharedState(): Promise<void> {
    await controlPost('reset', {});
  }

  /**
   * Creates an open emulator Checkout session directly, without going through
   * any code path that imports the EE payments module. Using the email-send
   * path would pre-register the terminal-status handler and defeat the
   * cold-start premise.
   */
  async function createEmulatorCheckoutSession(invoiceId: string, clientId: string, amountCents = 32000): Promise<any> {
    const response = await fetch(`${stripeBase}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Bearer sk_test_algasim',
      },
      body: new URLSearchParams({
        mode: 'payment',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][price_data][product_data][name]': 'Invoice cold-start',
        'line_items[0][quantity]': '1',
        success_url: `http://localhost:3000/client-portal/billing/invoices/${invoiceId}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `http://localhost:3000/client-portal/billing?tab=invoices&invoiceId=${invoiceId}`,
        'metadata[invoice_id]': invoiceId,
        'metadata[tenant_id]': tenantId,
        'metadata[client_id]': clientId,
      }),
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    const session = await response.json();
    expect(session.status).toBe('open');
    return session;
  }
});

/**
 * Minimal ledger for the cold-start QBO path: the invoice mapping resolves the
 * linked external invoice, the payment mapping lookup reports "new payment",
 * and insert/update are inert. Mirrors the fake in the billing paymentApplier
 * unit tests, but against the real transaction the applier runs inside.
 */
function makeColdStartLedger(invoiceMapping: any): any {
  const ledger: any = {
    findByExternalId: vi.fn(async (entityType?: string) => {
      if (entityType === 'credit_application') return null;
      if (entityType === 'invoice') return invoiceMapping;
      return null;
    }),
    findByAlgaId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn(),
  };
  ledger.withKnex.mockImplementation(() => ({
    insert: ledger.insert,
    update: ledger.update,
    findByExternalId: ledger.findByExternalId,
    findByAlgaId: ledger.findByAlgaId,
    withKnex: ledger.withKnex,
  }));
  return ledger;
}

async function upsertProviderConfig(db: Knex, tenantId: string): Promise<void> {
  await tenantTable(db, tenantId, 'payment_provider_configs')
    .insert({
      config_id: uuidv4(),
      tenant: tenantId,
      provider_type: 'stripe',
      is_enabled: true,
      is_default: true,
      configuration: JSON.stringify({ publishable_key: 'pk_test_algasim' }),
      credentials_vault_path: 'secrets/stripe',
      settings: JSON.stringify({
        paymentLinkExpirationHours: 24,
        paymentLinksInEmails: true,
        sendPaymentConfirmations: true,
      }),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .onConflict(['tenant', 'provider_type'])
    .merge(['configuration', 'credentials_vault_path', 'settings', 'updated_at']);
}

async function seedClientWithBillingContact(
  db: Knex,
  tenantId: string,
  clientId: string,
  contactEmail: string
): Promise<void> {
  await tenantTable(db, tenantId, 'clients').insert({
    client_id: clientId,
    tenant: tenantId,
    client_name: `Acme Corporation ${clientId.slice(0, 8)}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(db, tenantId, 'client_locations').insert({
    location_id: uuidv4(),
    tenant: tenantId,
    client_id: clientId,
    location_name: 'Billing',
    address_line1: '1 Billing Way',
    city: 'Testville',
    country_code: 'US',
    country_name: 'United States',
    is_billing_address: true,
    is_default: true,
    is_active: true,
    email: `location-${uuidv4().slice(0, 8)}@acme.test`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  const contactId = uuidv4();
  await tenantTable(db, tenantId, 'contacts').insert({
    contact_name_id: contactId,
    tenant: tenantId,
    full_name: 'Jane Billing',
    email: contactEmail,
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await tenantTable(db, tenantId, 'clients')
    .where({ client_id: clientId })
    .update({ billing_contact_id: contactId });
}

async function seedFinalizedInvoice(
  db: Knex,
  tenantId: string,
  clientId: string,
  invoiceId: string,
  totalAmountCents: number
): Promise<void> {
  await tenantTable(db, tenantId, 'invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantId,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 8).toUpperCase()}`,
    total_amount: totalAmountCents,
    credit_applied: 0,
    currency_code: 'USD',
    status: 'sent',
    invoice_type: 'invoice',
    invoice_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    due_date: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
    finalized_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

/**
 * Bootstraps a disposable database through ONE Knex migrator over the combined
 * CE + EE migration chains (as the admin role), then seeds it. Mirrors the
 * journey suite's bootstrap; uses its own database name so the suites never
 * race each other's DROP/CREATE.
 */
async function bootstrapDb(databaseName: string): Promise<Knex> {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const adminUser = process.env.DB_USER_ADMIN || 'postgres';
  const adminPassword = await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123');
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = await getSecret('db_password_server', 'DB_PASSWORD_SERVER', 'postpass123');

  const repoRoot = path.resolve(__dirname, '../../../../..');

  const adminConnection = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: 'postgres',
    },
  });

  try {
    await adminConnection.raw(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()',
      [databaseName]
    );
    await adminConnection.raw(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminConnection.raw(`CREATE DATABASE "${databaseName}"`);
    await adminConnection.raw(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
          CREATE ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        ELSE
          ALTER ROLE ${appUser} WITH LOGIN PASSWORD '${appPassword}';
        END IF;
      END;
    $$;`);
    await adminConnection.raw(`ALTER DATABASE "${databaseName}" OWNER TO ${appUser}`);
    await adminConnection.raw(`GRANT ALL PRIVILEGES ON DATABASE "${databaseName}" TO ${appUser}`);
    if (adminUser !== appUser) {
      await adminConnection.raw(`GRANT ${adminUser} TO ${appUser}`);
    }
  } finally {
    await adminConnection.destroy().catch(() => undefined);
  }

  const db = knex({
    client: 'pg',
    connection: {
      host: dbHost,
      port: dbPort,
      user: adminUser,
      password: adminPassword,
      database: databaseName,
    },
    migrations: {
      directory: path.join(repoRoot, 'server', 'migrations'),
    },
    seeds: {
      directory: path.join(repoRoot, 'server', 'seeds', 'dev'),
    },
  });

  await db.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await db.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  // Citus-distribution probes run inside dozens of migrations; on plain
  // Postgres each one errors server-side before its try/catch concludes "not
  // Citus". An empty stand-in catalog makes every probe succeed.
  await db.raw('CREATE TABLE IF NOT EXISTS public.pg_dist_partition (logicalrelid regclass)');

  await db.migrate.latest({
    directory: [
      path.join(repoRoot, 'server', 'migrations'),
      path.join(repoRoot, 'ee', 'server', 'migrations'),
    ],
    loadExtensions: ['.cjs', '.js'],
  });
  await db.seed.run({
    directory: path.join(repoRoot, 'server', 'seeds', 'dev'),
    loadExtensions: ['.cjs', '.js'],
  });

  const safeAppUser = appUser.replace(/[^a-zA-Z0-9_]/g, '');
  await db.raw(`ALTER ROLE ${safeAppUser} RESET idle_in_transaction_session_timeout`);
  await db.raw(`ALTER ROLE ${safeAppUser} RESET lock_timeout`);

  return db;
}

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  const defaultClientId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Cold Start Tenant',
    email: 'cold-start@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  await tenantTable(connection, newTenantId, 'clients').insert({
    client_id: defaultClientId,
    tenant: newTenantId,
    client_name: 'Cold Start Tenant',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  await tenantTable(connection, newTenantId, 'tenant_companies').insert({
    tenant: newTenantId,
    client_id: defaultClientId,
    is_default: true,
  });
  return newTenantId;
}
