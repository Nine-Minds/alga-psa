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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { getSecret } from '../../lib/utils/getSecret';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '@alga-psa/emulator-stripe';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState } from '../../../../packages/licensing/src/lib/co-managed-entitlements';
import { runCoManagedPurchase } from '../../../../packages/licensing/src/lib/co-managed-purchases';
import { reconcileHostedCoManagedEntitlement } from '../../../../packages/licensing/src/lib/co-managed-hosted-reconcile';
import { isCoManagedPurchaseSurfaceOpen } from '../../../../packages/licensing/src/lib/co-managed-purchase-surface';
import { hasCoManagedEntitlement, coManagedParticipants } from '../../../../packages/co-managed/src/capability';
import { isCoManagedSeatEligible } from '../../../../packages/co-managed/src/seatCapability';
import { readCoManagedFirstPurchasePhase } from '../../../../packages/licensing/src/lib/co-managed-first-purchase';
import { admits } from '../../../../packages/core/src/lib/capability';
import { registerFeatureFlagChecker } from '../../../../packages/core/src/lib/features';
import React from 'react';
import { getStripeService, StripeService } from '@ee/lib/stripe/StripeService';

const holder = vi.hoisted(() => ({ db: null as unknown as Knex, flag: true as boolean | 'unavailable', user: { tenant: '', user_type: 'internal' } }));
// The hosted page and its actions share the fixture's signed-in account admin. The catalog,
// tenant data, surface gate, licensing operations and Stripe adapter all run normally.
vi.mock('@alga-psa/auth', () => ({
  getCurrentUser: async () => holder.user,
  getSession: async () => ({ user: holder.user }),
  withAuth: (work: (...args: any[]) => unknown) => (...args: unknown[]) => work(holder.user, { tenant: holder.user.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: holder.db }),
}));
vi.mock('@alga-psa/licensing', async (original) => ({
  ...await original<typeof import('@alga-psa/licensing')>(), getLicenseStateRow: async () => null,
}));
vi.mock('@enterprise/components/co-managed/CoManagedPurchaseOverview', async () => import('@ee/components/co-managed/CoManagedPurchaseOverview'));
vi.mock('@enterprise/lib/co-managed/purchaseDiscovery', async () => import('@ee/lib/co-managed/purchaseDiscovery'));
vi.mock('@/lib/productAccess', () => ({ getCurrentTenantProduct: async () => 'psa' }));
vi.mock('@/components/co-managed/CoManagedOverview', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedCustomerHome', () => ({ default: () => null }));
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
const foundationMigration = require('../../../migrations/20261028130000_create_co_management_foundation.cjs');
const purchaseMigration = require('../../../migrations/20261029120000_create_co_managed_purchase_operations.cjs');
const pinMigration = require('../../../migrations/20261118090100_pin_co_managed_purchase_offer_terms.cjs');
const offerCatalogMigration = require('../../../../ee/server/migrations/20261118090000_create_stripe_offer_catalog.cjs');
const catalogAccountMigration = require('../../../../ee/server/migrations/20261120120000_add_stripe_catalog_account_settings.cjs');
const allocationKindMigration = require('../../../migrations/20261111100000_add_co_managed_allocation_kind.cjs');
const subscriptionItemMigration = require('../../../migrations/20261027090100_add_stripe_subscription_item_id.cjs');
const stripeMigrations = [
  '20251014120000_create_stripe_integration_tables.cjs',
  '20260305200000_add_base_item_to_stripe_subscriptions.cjs',
  '20260309100000_add_fk_stripe_base_price_id.cjs',
  '20260309200000_add_billing_interval_to_stripe_subscriptions.cjs',
].map((file) => require(`../../../../ee/server/migrations/${file}`));

const databaseName = `co_managed_stripe_${randomUUID().replaceAll('-', '')}`;
/** A second database that never receives any co-managed table (webhook neutrality). */
const plainDatabaseName = `${databaseName}_plain`;
const CO_MANAGED_PRICE_ID = 'price_co_managed';
const PRO_PRICE_ID = 'price_pro';
const CUSTOMER_ID = 'cus_co_managed_sponsor';
const HOOK_TIMEOUT = 120_000;

let admin: Knex;
let db: Knex;
let plainDb: Knex;
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
  // Replace the provider at its registration boundary so both the boolean purchase-surface
  // check and the status-aware capability gate exercise the real feature-flag API.
  registerFeatureFlagChecker(async () => holder.flag === 'unavailable'
    ? { status: 'unavailable', enabled: false }
    : holder.flag);
  const connection = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN'),
  };
  admin = knex({ client: 'pg', connection: { ...connection, database: 'postgres' } });
  // The Stripe migrations below GRANT to DB_USER_SERVER, and roles are
  // cluster-wide: this suite only passed when some earlier suite happened to
  // create the role first. Create it here, as the other self-bootstrapping
  // suites do, so migrations succeed whatever order the files run in. Never
  // ALTER an existing role — a concurrent suite may rely on its password.
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  const appPassword = process.env.DB_PASSWORD_SERVER || connection.password;
  await admin.raw(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser.replace(/'/g, "''")}') THEN
        CREATE ROLE "${appUser.replace(/"/g, '""')}" WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}';
      END IF;
    END;
  $$;`);
  await admin.raw('CREATE DATABASE ??', [databaseName]);
  created = true;
  db = knex({ client: 'pg', connection: { ...connection, database: databaseName }, pool: { min: 0, max: 6 } });
  holder.db = db;
  await admin.raw('CREATE DATABASE ??', [plainDatabaseName]);
  plainDb = knex({ client: 'pg', connection: { ...connection, database: plainDatabaseName }, pool: { min: 0, max: 4 } });

  for (const target of [db, plainDb]) {
    await target.schema.createTable('tenants', (table) => {
      table.uuid('tenant').primary();
      table.text('plan').notNullable().defaultTo('pro');
      table.text('email');
      table.text('billing_source');
      table.text('client_name');
      table.integer('licensed_user_count');
      table.timestamp('suspended_at', { useTz: true });
    });
    await target.schema.createTable('clients', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('client_id').notNullable();
      table.primary(['tenant', 'client_id']);
    });
    await previousProductMigration.up(target);
    for (const migration of stripeMigrations) await migration.up(target);
    await subscriptionItemMigration.up(target);
    await target.schema.alterTable('stripe_subscriptions', t => t.timestamp('trial_end', { useTz: true }));
    // StripeService writes cancel_at, which no checked-in migration creates (production schema drift).
    await target.raw('ALTER TABLE stripe_subscriptions ADD COLUMN IF NOT EXISTS cancel_at timestamptz');
  }
  await foundationMigration.up(db);
  await purchaseMigration.up(db);
  await pinMigration.up(db); // reviewed offer version and price pinned on the operation
  await offerCatalogMigration.up(db);
  await catalogAccountMigration.up(db);
  // The pool is read per allocation kind, so this hand-picked schema needs the kind column too.
  await allocationKindMigration.up(db);
  await require('../../../migrations/20261119100000_add_co_managed_allocation_funding_source.cjs').up(db);

  await require('../../../migrations/20261119100200_co_managed_funding_views.cjs').up(db);

  host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
  const started = await host.start();
  controlUrl = `http://127.0.0.1:${started.controlPort}`;
  process.env.STRIPE_API_BASE_URL = `http://127.0.0.1:${started.ports.stripe}`;
  process.env.STRIPE_SECRET_KEY = 'sk_test_algasim';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_algasim';
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_algasim';
  process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = CO_MANAGED_PRICE_ID; // legacy binding: the offer is unmanaged here
  process.env.STRIPE_ACCOUNT_ID = 'acct_algasim'; // catalog scope; the emulator has no accounts endpoint
  process.env.STRIPE_PRO_PRICE_ID = PRO_PRICE_ID;
  process.env.MASTER_BILLING_TENANT_ID = randomUUID();
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  await control('seed/customer', { id: CUSTOMER_ID, email: 'sponsor@example.test', name: 'Sponsor MSP' });
  await control('seed/price', { id: PRO_PRICE_ID, unitAmount: 2900, currency: 'usd', interval: 'month', product: 'prod_pro' });
  await control('seed/price', { id: CO_MANAGED_PRICE_ID, unitAmount: 1149, currency: 'eur', interval: 'month', product: 'prod_co_managed' });
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
}, HOOK_TIMEOUT);

// Tests run in shuffled order. Each starts with its own catalog state in the suite's temporary database.
beforeEach(async () => {
  await db('stripe_offer_publications').delete();
  await db('stripe_offer_catalog_settings').delete();
  await db('stripe_offer_versions').delete();
});

afterAll(async () => {
  await host?.stop();
  await db?.destroy();
  await plainDb?.destroy();
  if (created) {
    await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]);
    await admin.raw('DROP DATABASE IF EXISTS ??', [plainDatabaseName]);
  }
  await admin?.destroy();
}, HOOK_TIMEOUT);

async function sponsorFixture(customerId: string = CUSTOMER_ID) {
  const tenant = randomUUID();
  const sponsor = tenantDb(db, tenant);
  await sponsor.table('tenants').insert({ tenant, product_code: 'psa', plan: 'pro', email: 'sponsor@example.test', billing_source: 'stripe' });
  await sponsor.table('stripe_customers').insert({ tenant, stripe_customer_external_id: customerId, email: 'sponsor@example.test' });
  return { tenant, sponsor };
}

const entitlementRow = (tenant: string) => tenantDb(db, tenant).table('co_managed_entitlements').first();
const operationRow = (tenant: string, operationId: string) =>
  tenantDb(db, tenant).table('co_managed_purchase_operations').where({ operation_id: operationId }).first();

/** Deliver emulator events to the real webhook entry point, in emission order. */
async function deliver(service: StripeService, events: any[]): Promise<void> {
  for (const event of events) await service.handleWebhookEvent(event);
}

async function setStripeQuantity(subscription: any, quantity: number): Promise<void> {
  const response = await fetch(`${process.env.STRIPE_API_BASE_URL}/v1/subscriptions/${subscription.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    body: JSON.stringify({ items: [{ id: subscription.items.data[0].id, quantity }] }),
  });
  expect(response.ok, `update subscription: ${response.status}`).toBe(true);
}

describe('co-managed purchase against the Stripe emulator', () => {
  it('buys capacity, raises it only through delivered webhooks, and is admitted by the capability gate', async ({ onTestFinished }) => {
    holder.flag = true;
    delete process.env.FORCE_CAPABILITIES;
    const { tenant, sponsor } = await sponsorFixture();
    await control('seed/subscription', { customer: CUSTOMER_ID, priceId: PRO_PRICE_ID, quantity: 7, status: 'active' });

    // Before any purchase the sponsor has no entitlement, so the gate refuses even with the flag on.
    expect(await hasCoManagedEntitlement(tenant, db)).toBe(false);
    expect((await admits('co-managed', tenant)).admitted).toBe(false);
    expect(await isCoManagedPurchaseSurfaceOpen(tenant)).toBe(true);

    const service = new StripeService();
    // The emulator lacks the Stripe account endpoint. Simulate only that response while
    // preview, confirmation, the merchant locks and checkout use the real adapters.
    await service.getOfferCatalog();
    const accountRead = vi.spyOn(service['stripe'].accounts, 'retrieve').mockResolvedValue({
      id: 'acct_algasim',
    } as Awaited<ReturnType<typeof service['stripe']['accounts']['retrieve']>>);
    vi.stubEnv('STRIPE_ACCOUNT_ID', undefined);
    onTestFinished(() => { vi.unstubAllEnvs(); accountRead.mockRestore(); });
    const preview = await service.previewCoManagedSeats(tenant, 3);
    // R1: amount and currency are whatever the configured price object says (a non-USD price here).
    expect(preview).toMatchObject({ unitAmount: 1149, monthlyTotal: 3447, amountDue: 3447, currency: 'eur' });

    const operationId = randomUUID();
    const started = await service.purchaseCoManagedSeats(tenant, 3, operationId, preview.offerRef);
    expect(accountRead).toHaveBeenCalled();
    expect(started.kind).toBe('checkout');
    expect(await operationRow(tenant, operationId)).toMatchObject({ stripe_account: 'acct_algasim', livemode: false, price_id: CO_MANAGED_PRICE_ID });
    expect((await state('checkout-sessions'))[0]).toMatchObject({ mode: 'subscription', status: 'open' });

    vi.unstubAllEnvs();

    // Complete the emulator's hosted Checkout. The emulator emits the events; capture them but do not
    // deliver yet: completing a checkout grants nothing.
    const eventsBefore = (await state('events')).length;
    await control('actions/complete-session', { sessionId: (started as { sessionId: string }).sessionId });
    const emitted = (await state('events')).slice(eventsBefore);
    expect(emitted.map((event) => event.type)).toEqual(expect.arrayContaining(
      ['checkout.session.completed', 'customer.subscription.created', 'invoice.paid']));
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 0 });
    expect(await hasCoManagedEntitlement(tenant, db)).toBe(false);

    // A2: capacity goes 0 -> 3 through webhook reconciliation alone: no second purchase call.
    await deliver(service, [emitted[0]]);
    const subscriptionId = emitted.find((event: any) => event.type === 'customer.subscription.created')?.data.object.id;
    expect(await operationRow(tenant, operationId)).toMatchObject({ state: 'completed', provider_reference: subscriptionId,
      stripe_account: 'acct_algasim', livemode: false });
    await deliver(service, emitted.slice(1));
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 3, available: 3 });
    expect(await operationRow(tenant, operationId)).toMatchObject({ state: 'completed', quantity: 3 });
    const coManagedSubscriptions = (await state('subscriptions')).filter((subscription) => subscription.metadata?.subscription_kind === 'co_managed');
    expect(coManagedSubscriptions).toHaveLength(1);
    expect(coManagedSubscriptions[0]).toMatchObject({ metadata: { subscription_kind: 'co_managed', tenant_id: tenant } });
    // A3: the co-managed item never carries the base-Pro price.
    expect(coManagedSubscriptions[0].items.data.map((item: any) => item.price.id)).toEqual([CO_MANAGED_PRICE_ID]);
    expect(await sponsor.table('co_managed_entitlements').first()).toMatchObject({ source: 'hosted', source_reference: coManagedSubscriptions[0].id });

    // The reviewer's question: the purchase became an entitlement the capability gate accepts.
    expect(await hasCoManagedEntitlement(tenant, db)).toBe(true);
    expect(await admits('co-managed', tenant)).toMatchObject({ admitted: true, reasons: { admitted: 'open' } });
    holder.flag = false;
    expect(await isCoManagedPurchaseSurfaceOpen(tenant)).toBe(false);
    expect(await admits('co-managed', tenant)).toMatchObject({ admitted: false, reasons: { admitted: 'flag-off' } });
    holder.flag = 'unavailable';
    expect(await isCoManagedPurchaseSurfaceOpen(tenant)).toBe(false);
    expect(await admits('co-managed', tenant)).toMatchObject({ admitted: false, reasons: { admitted: 'flag-unavailable' } });
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 3, available: 3 });
    holder.flag = true;
    expect(await isCoManagedPurchaseSurfaceOpen(tenant)).toBe(true);
    expect(await admits('co-managed', tenant)).toMatchObject({ admitted: true, reasons: { admitted: 'open' } });
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    expect((await admits('co-managed', tenant)).admitted).toBe(true);
    delete process.env.FORCE_CAPABILITIES;

    // A1: redelivering the same signed events is a no-op: capacity, entitlement revision and the
    // operation row are unchanged (the receipt short-circuits every delivery).
    const before = { entitlement: await entitlementRow(tenant), operation: await operationRow(tenant, operationId) };
    await deliver(service, emitted);
    await deliver(service, emitted);
    expect(await entitlementRow(tenant)).toEqual(before.entitlement);
    expect(await operationRow(tenant, operationId)).toEqual(before.operation);
    // ...and even without the receipt, reconciling the same observation is idempotent.
    await tenantDb(db, tenant).table('stripe_webhook_events').delete();
    await deliver(service, emitted);
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 3 });
    expect(await operationRow(tenant, operationId)).toEqual(before.operation);

    // Kill switch: with FORCE_CAPABILITIES=co-managed:off a delivered co-managed event is consumed
    // as a no-op (capacity unchanged, event NOT handled as an MSP seat change) and purchasing is closed.
    const subscription = coManagedSubscriptions[0];
    await setStripeQuantity(subscription, 5);
    const created = emitted.find((event) => event.type === 'customer.subscription.created');
    const update = () => ({ ...created, id: `evt_${randomUUID()}`, type: 'customer.subscription.updated' });
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    expect(await isCoManagedPurchaseSurfaceOpen(tenant)).toBe(false);
    const mspBefore = await sponsor.table('tenants').first('licensed_user_count', 'plan');
    const killed = update();
    await service.handleWebhookEvent(killed);
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 3 });
    expect(await sponsor.table('stripe_webhook_events').where({ stripe_event_id: killed.id }).first()).toMatchObject({ processed: true });
    expect(await sponsor.table('tenants').first('licensed_user_count', 'plan')).toEqual(mspBefore);
    expect(await sponsor.table('stripe_subscriptions').where({ stripe_subscription_external_id: subscription.id })).toHaveLength(0);
    // Reopened, the same kind of event reconciles the new Stripe quantity.
    delete process.env.FORCE_CAPABILITIES;
    expect(await isCoManagedPurchaseSurfaceOpen(tenant)).toBe(true);
    await service.handleWebhookEvent(update());
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 5 });
  }, HOOK_TIMEOUT);

  it('admits the server-rendered first-purchase page and quotes and confirms the database offer with both overrides unset', async ({ onTestFinished }) => {
    vi.stubEnv('STRIPE_ACCOUNT_ID', undefined);
    vi.stubEnv('STRIPE_CO_MANAGED_USER_PRICE_ID', undefined);
    vi.stubGlobal('React', React);
    onTestFinished(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
    const customerId = 'cus_database_only';
    const { tenant } = await sponsorFixture(customerId);
    holder.user.tenant = tenant;
    await control('seed/customer', { id: customerId, email: 'admin@example.test', name: 'Database Sponsor' });
    await control('seed/subscription', { customer: customerId, priceId: PRO_PRICE_ID, quantity: 1, status: 'active' });

    const service = getStripeService();
    const catalog = await service.getOfferCatalog();
    const accountRead = vi.spyOn(service['stripe'].accounts, 'retrieve').mockRejectedValue(new Error('account reads denied'));
    onTestFinished(() => accountRead.mockRestore());
    await db('stripe_offer_versions').insert({ stripe_account: 'acct_algasim', livemode: false,
      offer_key: 'co_managed_technician_seat', billing_interval: 'month', version_number: 1,
      price_id: CO_MANAGED_PRICE_ID, product_id: 'prod_co_managed', is_current: true, published_by: 'fixture' });
    await db('stripe_offer_catalog_settings').insert({ stripe_account: 'acct_algasim', livemode: false,
      price_id: CO_MANAGED_PRICE_ID, updated_by: 'fixture' });
    const { default: Page } = await import('../../app/msp/co-managed/page');
    const { default: PurchaseOverview } = await import('@enterprise/components/co-managed/CoManagedPurchaseOverview');
    const { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } = await import('@ee/lib/actions/coManagedBillingActions');
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 0, allocated: 0 });
    holder.user.user_type = 'client';
    try {
      await expect(Page({})).rejects.toThrow(/404/);
      await expect(previewCoManagedSeatsAction(1)).rejects.toThrow('Permission denied');
    } finally {
      holder.user.user_type = 'internal';
    }
    expect((await Page({})).type).toBe(PurchaseOverview);
    const quote = await previewCoManagedSeatsAction(2);
    expect(quote).toMatchObject({ unitAmount: 1149, monthlyTotal: 2298, currency: 'eur' });
    const operationId = randomUUID();
    expect(await purchaseCoManagedSeatsAction({ operationId, quantity: 2, offerRef: quote.offerRef })).toMatchObject({ kind: 'checkout' });
    expect(await operationRow(tenant, operationId)).toMatchObject({ price_id: CO_MANAGED_PRICE_ID, stripe_account: 'acct_algasim' });
    const key = 'co_managed_technician_seat';
    const actor = { userId: 'operator', tenantId: process.env.MASTER_BILLING_TENANT_ID! };
    await catalog.pauseSales({ actor, offerKey: key, interval: 'month', expectedCurrentVersionId: quote.offerRef });
    await expect(Page({})).rejects.toThrow(/404/);
    await expect(previewCoManagedSeatsAction(2)).rejects.toThrow('not available');
    await expect(purchaseCoManagedSeatsAction({ operationId: randomUUID(), quantity: 2, offerRef: quote.offerRef }))
      .rejects.toThrow('not available');
    expect(await tenantDb(db, tenant).table('co_managed_purchase_operations')).toHaveLength(1);
    expect(accountRead).not.toHaveBeenCalled();
  }, HOOK_TIMEOUT);

  it('recovers a missing merchant pin from the operation Price under the real retry lock and retries in that scope', async () => {
    const customerId = 'cus_co_managed_retry';
    const { tenant, sponsor } = await sponsorFixture(customerId);
    await control('seed/customer', { id: customerId, email: 'retry@example.test', name: 'Retry Sponsor' });
    await control('seed/subscription', { customer: customerId, priceId: PRO_PRICE_ID, quantity: 7, status: 'active' });
    const oldPriceId = 'price_co_managed_retired';
    await control('seed/price', { id: oldPriceId, unitAmount: 999, currency: 'eur', interval: 'month', product: 'prod_co_managed' });
    await db('stripe_offer_versions').insert({ stripe_account: 'acct_algasim', livemode: false,
      offer_key: 'co_managed_technician_seat', billing_interval: 'month', version_number: 1, price_id: CO_MANAGED_PRICE_ID,
      product_id: 'prod_co_managed', is_current: true, published_by: 'test-fixture' }).onConflict(['stripe_account', 'livemode', 'price_id']).ignore();
    const currentVersion = await db('stripe_offer_versions').where({ stripe_account: 'acct_algasim', livemode: false, price_id: CO_MANAGED_PRICE_ID }).first();
    const [oldVersion] = await db('stripe_offer_versions').insert({ stripe_account: 'acct_algasim', livemode: false,
      offer_key: 'co_managed_technician_seat', billing_interval: 'month', version_number: 2, price_id: oldPriceId,
      product_id: 'prod_co_managed', is_current: false, published_by: 'test-fixture' }).returning('*');
    const operationId = randomUUID();
    await sponsor.table('co_managed_purchase_operations').insert({ tenant, operation_id: operationId, quantity: 2, state: 'preparing',
      offer_version_id: oldVersion.version_id, price_id: oldPriceId, stripe_account: null, livemode: null });

    const result = await new StripeService().purchaseCoManagedSeats(tenant, 2, operationId);
    expect(result.kind).toBe('checkout');
    expect(await operationRow(tenant, operationId)).toMatchObject({ state: 'checkout', offer_version_id: oldVersion.version_id,
      price_id: oldPriceId, stripe_account: 'acct_algasim', livemode: false });
    expect((await state('checkout-sessions')).at(-1)).toMatchObject({ line_items: [{ price: { unit_amount: 999 }, quantity: 2 }] });
    expect(currentVersion.is_current).toBe(true);
  }, HOOK_TIMEOUT);

  it('scopes operation completion to the subscription it proves (a base renewal cannot close another purchase)', async () => {
    const { tenant, sponsor } = await sponsorFixture();
    const operationId = randomUUID();
    const pending = async () => ({ kind: 'checkout' as const, sessionId: 'cs_inflight', clientSecret: 'secret' });
    await runCoManagedPurchase(db, { sponsorTenant: tenant, operationId, quantity: 8 }, pending);
    const snapshot = (overrides: Record<string, unknown>) => async () => ({
      capacity: 3, active: true, validUntil: new Date(Date.now() + 86_400_000), ...overrides,
    });
    // An active reconciliation of some other subscription / quantity leaves the in-flight purchase open.
    await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_unrelated', snapshot({}));
    expect(await operationRow(tenant, operationId)).toMatchObject({ state: 'checkout', provider_reference: 'cs_inflight' });
    // Same operation id but a different quantity than was bought: still open.
    await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_unrelated', snapshot({ capacity: 5, operationId }));
    expect(await operationRow(tenant, operationId)).toMatchObject({ state: 'checkout' });
    // The subscription that carries this operation's id at the purchased quantity completes it.
    await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_unrelated', snapshot({ capacity: 8, operationId }));
    expect(await operationRow(tenant, operationId)).toMatchObject({ state: 'completed', provider_reference: 'sub_unrelated' });
    expect(await sponsor.table('co_managed_entitlements').first('capacity')).toMatchObject({ capacity: 8 });
  }, HOOK_TIMEOUT);

  it('does not start a grace clock for a pool that was never paid for', async () => {
    const { tenant, sponsor } = await sponsorFixture();
    const unpaid = async () => ({ capacity: 3, active: false, validUntil: new Date(Date.now() + 86_400_000) });
    const state = await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_never_paid', unpaid);
    expect(state).toMatchObject({ capacity: 0, available: 0, canGrow: false, isReadOnly: false, graceEndsAt: null });
    expect(await sponsor.table('co_managed_entitlements').first()).toMatchObject({ lapse_started_at: null, read_only_after: null });
    // Reading (and re-reconciling) later does not invent one either.
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 0, isReadOnly: false, graceEndsAt: null });
    await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_never_paid', unpaid);
    expect(await sponsor.table('co_managed_entitlements').first()).toMatchObject({ lapse_started_at: null, read_only_after: null });
    // Once paid it opens; a pool that WAS active and then lapses still gets its grace deadline.
    expect(await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_never_paid',
      async () => ({ capacity: 3, active: true, validUntil: new Date(Date.now() + 86_400_000) }))).toMatchObject({ capacity: 3 });
    const lapsed = await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_never_paid',
      async () => ({ capacity: 3, active: false, validUntil: new Date(Date.now() + 86_400_000), lapseSince: new Date() }));
    expect(lapsed.graceEndsAt).not.toBeNull();
    expect(await sponsor.table('co_managed_entitlements').first('lapse_started_at')).not.toMatchObject({ lapse_started_at: null });
  }, HOOK_TIMEOUT);

  it('refuses a reduction below allocated seats, a second in-flight purchase, and a changed quantity (A5)', async () => {
    const { tenant, sponsor } = await sponsorFixture();
    await sponsor.table('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: 'sub_seed', capacity: 6,
      verified_at: new Date(), valid_until: new Date(Date.now() + 3600_000) });
    await sponsor.table('co_managed_allocations').insert({ tenant, allocation_id: randomUUID(), operation_id: randomUUID(),
      request_fingerprint: 'a'.repeat(64), customer_tenant: randomUUID(), relationship_id: randomUUID(), seats: 4, state: 'active' });

    const never = async () => { throw new Error('provider must not be called'); };
    await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: randomUUID(), quantity: 3 }, never))
      .rejects.toMatchObject({ code: 'ALLOCATED_CAPACITY_REQUIRED' });

    const first = randomUUID();
    const pending = async () => ({ kind: 'checkout' as const, sessionId: 'cs_pending', clientSecret: 'secret' });
    await runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: first, quantity: 8 }, pending);
    await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: randomUUID(), quantity: 9 }, never))
      .rejects.toMatchObject({ code: 'PURCHASE_IN_PROGRESS' });
    await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: first, quantity: 9 }, never))
      .rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    // Nothing above raised capacity: only verified reconciliation does.
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 6, allocated: 4 });
  }, HOOK_TIMEOUT);

  describe.each([
    ['price id unset', undefined, true],
    ['price id set, release flag off', CO_MANAGED_PRICE_ID, false],
  ])('webhook neutrality on a database without co-managed tables (%s)', (_name, priceId, flag) => {
    it('runs the MSP seat handler and issues no SQL touching co_managed_*', async () => {
      const previous = { price: process.env.STRIPE_CO_MANAGED_USER_PRICE_ID, db: holder.db, flag: holder.flag };
      if (priceId) process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = priceId; else delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
      holder.db = plainDb;
      holder.flag = flag;
      delete process.env.FORCE_CAPABILITIES;
      const statements: string[] = [];
      const listener = (query: { sql: string }) => statements.push(query.sql);
      plainDb.on('query', listener);
      try {
        expect(await plainDb.schema.hasTable('co_managed_entitlements')).toBe(false);
        expect(await plainDb.schema.hasTable('co_managed_purchase_operations')).toBe(false);
        const tenant = randomUUID();
        const customer = `cus_plain_${tenant.slice(0, 8)}`;
        await control('seed/customer', { id: customer, email: 'plain@example.test', name: 'Plain MSP' });
        const seeded = await control('seed/subscription', { customer, priceId: PRO_PRICE_ID, quantity: 5, status: 'active' });
        const subscriptionId: string = seeded.id;
        const plain = tenantDb(plainDb, tenant);
        await plain.table('tenants').insert({ tenant, product_code: 'psa', plan: 'pro', email: 'plain@example.test', billing_source: 'stripe', licensed_user_count: 2 });
        await plain.table('stripe_customers').insert({ tenant, stripe_customer_external_id: customer, email: 'plain@example.test' });
        const [product] = await plain.table('stripe_products').insert({ tenant, stripe_product_external_id: 'prod_pro', name: 'Pro', product_type: 'license' }).returning('stripe_product_id');
        const [priceRow] = await plain.table('stripe_prices').insert({ tenant, stripe_price_external_id: PRO_PRICE_ID, stripe_product_id: product.stripe_product_id, unit_amount: 2900 }).returning('stripe_price_id');
        await plain.table('stripe_subscriptions').insert({ tenant, stripe_subscription_external_id: subscriptionId,
          stripe_customer_id: (await plain.table('stripe_customers').first('stripe_customer_id')).stripe_customer_id,
          stripe_price_id: priceRow.stripe_price_id, status: 'trialing', quantity: 2,
          current_period_start: new Date(), current_period_end: new Date(Date.now() + 86_400_000) });
        statements.length = 0;

        const now = Math.floor(Date.now() / 1000);
        const subscription = { id: subscriptionId, object: 'subscription', customer, status: 'past_due', metadata: { tenant_id: tenant },
          current_period_start: now, current_period_end: now + 2_592_000,
          items: { data: [{ id: 'si_plain', quantity: 5, price: { id: PRO_PRICE_ID, object: 'price', recurring: { interval: 'month' }, product: 'prod_pro' } }] } };
        const event = (type: string, object: unknown) => ({ id: `evt_${randomUUID()}`, object: 'event', type, created: now, data: { object } }) as any;
        const service = new StripeService() as any;
        await service.ensureInitialized();
        // The emulator has no products API; hand the MSP handler the expanded price it would get from Stripe.
        service.stripe.prices.retrieve = async () => ({ id: PRO_PRICE_ID, object: 'price', active: true, currency: 'usd', unit_amount: 2900, metadata: {},
          recurring: { interval: 'month', interval_count: 1 }, product: { id: 'prod_pro', name: 'Pro', active: true, metadata: {} } });
        await service.handleWebhookEvent(event('customer.subscription.updated', subscription));
        await service.handleWebhookEvent(event('invoice.paid', { id: 'in_plain', object: 'invoice', customer, subscription: subscriptionId, status: 'paid',
          lines: { data: [{ price: { id: PRO_PRICE_ID } }] } }));

        // The MSP's own handling ran: the subscription row followed the event.
        expect(await plain.table('stripe_subscriptions').where({ stripe_subscription_external_id: subscriptionId }).first()).toMatchObject({ status: 'past_due', quantity: 5 });
        expect(await plain.table('stripe_webhook_events').where({ processed: true })).toHaveLength(2);
        expect(statements.length).toBeGreaterThan(0);
        expect(statements.filter((sql) => /co_managed_/i.test(sql))).toEqual([]);
      } finally {
        plainDb.removeListener('query', listener);
        holder.db = previous.db;
        holder.flag = previous.flag;
        if (previous.price) process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = previous.price; else delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
      }
    }, HOOK_TIMEOUT);
  });

  describe('first purchase: discovery, awaiting verification and operational authority', () => {
    const paid = (capacity: number) => async () => ({ capacity, active: true, validUntil: new Date(Date.now() + 86_400_000) });
    const unpaid = async () => ({ capacity: 3, active: false, validUntil: new Date(Date.now() + 86_400_000) });
    const never = async () => { throw new Error('provider must not be called'); };
    const operational = async (tenant: string) => ({
      admits: (await admits('co-managed', tenant)).admitted,
      eligible: await hasCoManagedEntitlement(tenant, db),
      participates: (await coManagedParticipants([tenant], db)).has(tenant),
      seatEligible: await isCoManagedSeatEligible(tenant, db),
    });

    it('T003: in-flight, unpaid zero row, completed-but-unverified, then verified once; no second first charge in between', async () => {
      holder.flag = true;
      delete process.env.FORCE_CAPABILITIES;
      // Its own Stripe customer: the emulator's subscriptions outlive a single test.
      const customer = `cus_first_${randomUUID().slice(0, 8)}`;
      await control('seed/customer', { id: customer, email: 'first@example.test', name: 'First Purchase MSP' });
      const { tenant, sponsor } = await sponsorFixture(customer);
      await control('seed/subscription', { customer, priceId: PRO_PRICE_ID, quantity: 7, status: 'active' });
      const service = new StripeService();
      expect(await readCoManagedFirstPurchasePhase(db, tenant)).toEqual({ phase: 'none' });

      // A first purchase needs a positive pool: a zero target is refused before anything is persisted.
      await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: randomUUID(), quantity: 0 }, never))
        .rejects.toMatchObject({ code: 'INVALID_PURCHASE' });
      expect(await sponsor.table('co_managed_purchase_operations')).toHaveLength(0);

      // In flight; a refresh or an ambiguous response resumes the SAME operation and charges once.
      const operationId = randomUUID();
      const started = await service.purchaseCoManagedSeats(tenant, 3, operationId);
      expect(started.kind).toBe('checkout');
      expect(await readCoManagedFirstPurchasePhase(db, tenant)).toEqual({ phase: 'in_flight', operationId, quantity: 3 });
      const resumed = await service.purchaseCoManagedSeats(tenant, 3, operationId);
      expect(resumed).toMatchObject({ kind: 'checkout' });
      expect(await sponsor.table('co_managed_purchase_operations')).toHaveLength(1);
      await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: randomUUID(), quantity: 3 }, never))
        .rejects.toMatchObject({ code: 'PURCHASE_IN_PROGRESS' });

      // An unpaid observation creates a zero-capacity hosted row. It is no purchase and no authority.
      await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_first', unpaid);
      expect(await entitlementRow(tenant)).toMatchObject({ source: 'hosted', source_reference: 'sub_first' });
      expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 0, available: 0 });
      expect(await operational(tenant)).toEqual({ admits: false, eligible: false, participates: false, seatEligible: false });
      expect(await readCoManagedFirstPurchasePhase(db, tenant)).toMatchObject({ phase: 'in_flight', operationId });

      // The request completes at the provider (inline update) but no paid reconciliation has arrived.
      await sponsor.table('co_managed_purchase_operations').where({ operation_id: operationId }).delete();
      const completed = randomUUID();
      await runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: completed, quantity: 3 },
        async () => ({ kind: 'updated' as const, subscriptionId: 'sub_first' }));
      expect(await operationRow(tenant, completed)).toMatchObject({ state: 'completed', quantity: 3, provider_reference: 'sub_first' });
      expect(await readCoManagedFirstPurchasePhase(db, tenant)).toEqual({ phase: 'awaiting_verification', operationId: completed, quantity: 3 });
      // The operation status alone raised nothing, and a second first charge cannot start.
      expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 0 });
      expect(await operational(tenant)).toEqual({ admits: false, eligible: false, participates: false, seatEligible: false });
      await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: randomUUID(), quantity: 5 }, never))
        .rejects.toMatchObject({ code: 'PURCHASE_AWAITING_VERIFICATION' });
      expect(await sponsor.table('co_managed_purchase_operations')).toHaveLength(1);
      // Replaying the completed operation is still answered from it.
      await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: completed, quantity: 3 }, never))
        .resolves.toMatchObject({ kind: 'updated', subscriptionId: 'sub_first' });

      // The matching paid event, delivered (and replayed) with no browser involved, verifies it once.
      await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_first', paid(3));
      await reconcileHostedCoManagedEntitlement(db, tenant, 'sub_first', paid(3));
      expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 3, allocated: 0, available: 3 });
      expect(await sponsor.table('co_managed_entitlements')).toHaveLength(1);
      expect(await operational(tenant)).toEqual({ admits: true, eligible: true, participates: true, seatEligible: true });
      expect(await readCoManagedFirstPurchasePhase(db, tenant)).toEqual({ phase: 'established' });
      // Buying seats created no client arrangement and assigned no seat.
      expect(await sponsor.table('co_managed_allocations')).toHaveLength(0);
      expect(await sponsor.table('co_management_relationships')).toHaveLength(0);
    }, HOOK_TIMEOUT);

    it('an awaiting record older than the verification window is history: a legitimate retry is not stranded', async () => {
      const { tenant, sponsor } = await sponsorFixture();
      const stale = randomUUID();
      await runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: stale, quantity: 2 },
        async () => ({ kind: 'updated' as const, subscriptionId: 'sub_stale' }));
      expect(await readCoManagedFirstPurchasePhase(db, tenant)).toMatchObject({ phase: 'awaiting_verification' });
      await sponsor.table('co_managed_purchase_operations').where({ operation_id: stale })
        .update({ updated_at: new Date(Date.now() - 73 * 3_600_000) });
      expect(await readCoManagedFirstPurchasePhase(db, tenant)).toEqual({ phase: 'none' });
      const retry = randomUUID();
      await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: retry, quantity: 2 },
        async () => ({ kind: 'checkout' as const, sessionId: 'cs_retry', clientSecret: 'secret' }))).resolves.toMatchObject({ kind: 'checkout' });
      // An expired operation is likewise no obstacle.
      await sponsor.table('co_managed_purchase_operations').where({ operation_id: retry }).update({ state: 'expired' });
      await expect(runCoManagedPurchase(db, { sponsorTenant: tenant, operationId: randomUUID(), quantity: 2 },
        async () => ({ kind: 'checkout' as const, sessionId: 'cs_again', clientSecret: 'secret' }))).resolves.toMatchObject({ kind: 'checkout' });
    }, HOOK_TIMEOUT);

    it('T004: every read and refusal is the current sponsor tenant\'s own (operation ids and pending state do not cross)', async () => {
      const a = await sponsorFixture();
      const b = await sponsorFixture();
      const bOperation = randomUUID();
      await runCoManagedPurchase(db, { sponsorTenant: b.tenant, operationId: bOperation, quantity: 9 },
        async () => ({ kind: 'checkout' as const, sessionId: 'cs_b', clientSecret: 'secret_b' }));
      expect(await readCoManagedFirstPurchasePhase(db, b.tenant)).toEqual({ phase: 'in_flight', operationId: bOperation, quantity: 9 });
      // Sponsor A sees none of it, and may start its own purchase even when it presents B's operation id.
      expect(await readCoManagedFirstPurchasePhase(db, a.tenant)).toEqual({ phase: 'none' });
      const calls: string[] = [];
      await runCoManagedPurchase(db, { sponsorTenant: a.tenant, operationId: bOperation, quantity: 2 },
        async (operation) => { calls.push(operation.operation_id); return { kind: 'checkout' as const, sessionId: 'cs_a', clientSecret: 'secret_a' }; });
      expect(await operationRow(a.tenant, bOperation)).toMatchObject({ quantity: 2, provider_reference: 'cs_a' });
      expect(await operationRow(b.tenant, bOperation)).toMatchObject({ quantity: 9, provider_reference: 'cs_b', state: 'checkout' });
      expect(await a.sponsor.table('co_managed_entitlements')).toHaveLength(0);
      expect(await b.sponsor.table('co_managed_entitlements')).toHaveLength(0);
      // The unverified pending purchase of one sponsor makes neither sponsor operational.
      expect(await operational(a.tenant)).toEqual({ admits: false, eligible: false, participates: false, seatEligible: false });
      expect(await operational(b.tenant)).toEqual({ admits: false, eligible: false, participates: false, seatEligible: false });
    }, HOOK_TIMEOUT);

    it('a lapsed sponsor with history stays operational; a never-paid zero row does not', async () => {
      const lapsed = await sponsorFixture();
      await reconcileHostedCoManagedEntitlement(db, lapsed.tenant, 'sub_lapse', paid(4));
      await reconcileHostedCoManagedEntitlement(db, lapsed.tenant, 'sub_lapse',
        async () => ({ capacity: 4, active: false, validUntil: new Date(Date.now() + 86_400_000), lapseSince: new Date() }));
      expect(await getCoManagedEntitlementState(db, lapsed.tenant)).toMatchObject({ capacity: 0 });
      expect(await operational(lapsed.tenant)).toMatchObject({ admits: true, eligible: true, participates: true });
      expect(await readCoManagedFirstPurchasePhase(db, lapsed.tenant)).toEqual({ phase: 'established' });
      const pending = await sponsorFixture();
      await reconcileHostedCoManagedEntitlement(db, pending.tenant, 'sub_pending', unpaid);
      expect(await operational(pending.tenant)).toEqual({ admits: false, eligible: false, participates: false, seatEligible: false });
    }, HOOK_TIMEOUT);
  });
});
