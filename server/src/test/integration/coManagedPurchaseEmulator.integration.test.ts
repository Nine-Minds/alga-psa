/**
 * Journey: hosted co-managed seat purchase and reconciliation against the
 * Stripe-like emulator. Exercises the real EE StripeService against the
 * emulator's subscription surface (prices, subscriptions, subscription-mode
 * Checkout, invoice preview) with the durable licensing purchase operation.
 *
 * This is the service-level companion to the component tests and the
 * migrated-database purchase-persistence suite; it is not a real Stripe
 * sandbox capture.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { getSecret } from '../../lib/utils/getSecret';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '@alga-psa/emulator-stripe';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState } from '../../../../packages/licensing/src/lib/co-managed-entitlements';
import { StripeService } from '@ee/lib/stripe/StripeService';

const holder = vi.hoisted(() => ({ db: null as unknown as Knex }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => holder.db }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => holder.db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => holder.db.transaction(work),
}));
vi.mock('@ee/lib/tenant-management/workflowClient', () => ({ startTenantDeletionWorkflow: vi.fn() }));
vi.mock('@alga-psa/core/secrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core/secrets')>();
  return {
    ...actual,
    getSecretProviderInstance: vi.fn(async () => ({
      getAppSecret: vi.fn(async () => undefined),
      getTenantSecret: vi.fn(async () => undefined),
    })),
  };
});

const require = createRequire(import.meta.url);
const previousProductMigration = require('../../../migrations/20260505140000_add_tenant_product_code.cjs');
const foundationMigration = require('../../../migrations/20260906010000_create_co_management_foundation.cjs');
const sourceVersionMigration = require('../../../migrations/20260906020000_add_co_managed_entitlement_source_version.cjs');
const purchaseMigration = require('../../../migrations/20260906030000_create_co_managed_purchase_operations.cjs');

const databaseName = `co_managed_stripe_${randomUUID().replaceAll('-', '')}`;
const CO_MANAGED_PRICE_ID = 'price_co_managed';
const PRO_PRICE_ID = 'price_pro';
const CUSTOMER_ID = 'cus_co_managed_sponsor';
const HOOK_TIMEOUT = 120_000;

let admin: Knex;
let db: Knex;
let created = false;
let host: EmulatorHost;
let controlUrl: string;

async function control(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${controlUrl}/control/stripe/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(response.ok, `control ${path}: ${response.status}`).toBe(true);
  return (await response.json()).result;
}

async function state(view: string): Promise<any[]> {
  const response = await fetch(`${controlUrl}/control/stripe/state/${view}`);
  return (await response.json()).result ?? [];
}

beforeAll(async () => {
  const connection = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN'),
  };
  admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' } });
  await admin.raw('CREATE DATABASE ??', [databaseName]);
  created = true;
  db = knex({ client: 'pg', connection: { ...connection, database: databaseName }, pool: { min: 0, max: 6 } });
  holder.db = db;

  await db.schema.createTable('tenants', (table) => {
    table.uuid('tenant').primary();
    table.text('plan').notNullable().defaultTo('pro');
    table.text('email');
    table.text('billing_source');
    table.text('client_name');
    table.timestamp('suspended_at', { useTz: true });
  });
  await db.schema.createTable('clients', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_id').notNullable();
    table.primary(['tenant', 'client_id']);
  });
  await db.schema.createTable('stripe_customers', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('stripe_customer_id').defaultTo(db.raw('gen_random_uuid()')).notNullable();
    table.text('stripe_customer_external_id').notNullable();
    table.text('email');
    table.jsonb('metadata');
    table.primary(['tenant', 'stripe_customer_id']);
    table.unique(['tenant', 'stripe_customer_external_id']);
  });
  await db.schema.createTable('stripe_subscriptions', (table) => {
    table.uuid('tenant').notNullable();
    table.text('stripe_subscription_external_id').notNullable();
    table.text('status');
    table.jsonb('metadata').defaultTo('{}');
    table.primary(['tenant', 'stripe_subscription_external_id']);
  });

  await previousProductMigration.up(db);
  await foundationMigration.up(db);
  await sourceVersionMigration.up(db);
  await purchaseMigration.up(db);

  host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
  const started = await host.start();
  controlUrl = `http://127.0.0.1:${started.controlPort}`;
  process.env.STRIPE_API_BASE_URL = `http://127.0.0.1:${started.ports.stripe}`;
  process.env.STRIPE_SECRET_KEY = 'sk_test_algasim';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_algasim';
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_algasim';
  process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = CO_MANAGED_PRICE_ID;
  process.env.STRIPE_PRO_PRICE_ID = PRO_PRICE_ID;
  process.env.MASTER_BILLING_TENANT_ID = randomUUID();
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
}, HOOK_TIMEOUT);

afterAll(async () => {
  await host?.stop();
  await db?.destroy();
  if (created) await admin.raw('DROP DATABASE ??', [databaseName]);
  await admin?.destroy();
}, HOOK_TIMEOUT);

async function sponsorFixture() {
  const tenant = randomUUID();
  const sponsor = tenantDb(db, tenant);
  await sponsor.table('tenants').insert({ tenant, product_code: 'psa', plan: 'pro', email: 'sponsor@example.test', billing_source: 'stripe' });
  await sponsor.table('stripe_customers').insert({ tenant, stripe_customer_external_id: CUSTOMER_ID, email: 'sponsor@example.test' });
  return { tenant, sponsor };
}

describe('co-managed purchase against the Stripe emulator', () => {
  it('previews, checks out, and reconciles co-managed capacity through the real StripeService', async () => {
    const { tenant, sponsor } = await sponsorFixture();
    await control('seed/customer', { id: CUSTOMER_ID, email: 'sponsor@example.test', name: 'Sponsor MSP' });
    await control('seed/price', { id: PRO_PRICE_ID, unitAmount: 2900, currency: 'usd', interval: 'month', product: 'prod_pro' });
    await control('seed/price', { id: CO_MANAGED_PRICE_ID, unitAmount: 1149, currency: 'usd', interval: 'month', product: 'prod_co_managed' });
    await control('seed/subscription', { customer: CUSTOMER_ID, priceId: PRO_PRICE_ID, quantity: 7, status: 'active' });

    const service = new StripeService();
    const preview = await service.previewCoManagedSeats(tenant, 3);
    expect(preview).toMatchObject({ unitAmount: 1149, monthlyTotal: 3447, amountDue: 3447, currency: 'usd' });

    const operationId = randomUUID();
    const started = await service.purchaseCoManagedSeats(tenant, 3, operationId);
    expect(started.kind).toBe('checkout');
    expect((await state('checkout-sessions'))[0]).toMatchObject({ mode: 'subscription', status: 'open' });

    // Complete the emulator's hosted Checkout; it creates the subscription and
    // emits the signed webhook, but capacity is only granted after verification.
    await control('actions/complete-session', { sessionId: (started as { sessionId: string }).sessionId });
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 0 });

    const recovered = await service.purchaseCoManagedSeats(tenant, 3, operationId);
    expect(recovered).toMatchObject({ kind: 'updated' });
    const entitlement = await getCoManagedEntitlementState(db, tenant);
    expect(entitlement).toMatchObject({ capacity: 3, available: 3 });
    const coManagedSubscriptions = (await state('subscriptions')).filter((subscription) => subscription.metadata?.subscription_kind === 'co_managed');
    expect(coManagedSubscriptions).toHaveLength(1);
    expect(coManagedSubscriptions[0]).toMatchObject({ metadata: { subscription_kind: 'co_managed', tenant_id: tenant } });

    // A repeated identical call is idempotent: one subscription, one completed operation.
    await service.purchaseCoManagedSeats(tenant, 3, operationId);
    expect((await state('subscriptions')).filter((subscription) => subscription.metadata?.subscription_kind === 'co_managed')).toHaveLength(1);
    expect(await sponsor.table('co_managed_purchase_operations').where({ operation_id: operationId }).first('state')).toMatchObject({ state: 'completed' });
  }, HOOK_TIMEOUT);
});
