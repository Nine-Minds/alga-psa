/**
 * CM L8b — the independent-upgrade flow against the real Stripe emulator and a real, migrated Postgres.
 *
 * Needs L8B_TEST_DATABASE_URL: a disposable database with the L8b migrations applied and one
 * `co_managed` customer tenant that has an internal user holding co_management:manage and a
 * relationship row (any CM L7a test database qualifies). The EE stripe_* tables are created on demand.
 *
 * Real here: the Stripe SDK talking HTTP to `@alga-psa/emulator-stripe` (routed through
 * `stripeApiOverride`), the emulator's signed webhook deliveries, `createCoManagedPaymentHandlers` +
 * `dispatchPaymentEvent`, every table, CHECK and index, and the whole purchase/upgrade domain.
 * Faked (and why): the L7a closure (not on main) — a recording `CoManagedUpgradeClosure`; PSA seed
 * initialisation (`initializeIndependentPsa`, needs the full seed catalogue); the `co-managed`
 * capability gate (`serves` open, `admits` closed: a customer has no sponsor entitlement). `sessionShape` below adapts three
 * response-shape gaps in the emulator, listed on that function.
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import knexFactory, { type Knex } from 'knex';
import Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/capability', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The paying tenant is the co-managed CUSTOMER: it serves (participates) but has no sponsor entitlement,
  // so `admits` is closed. The webhook handler must be gated on `serves`, not `admits`.
  admits: async () => ({ admitted: false }),
  serves: async () => ({ admitted: true }),
}));
const seeded: string[] = [];
vi.mock('../../db/product-upgrade-operations.js', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  initializeIndependentPsa: async (tenant: string) => { seeded.push(tenant); },
}));

import { EmulatorHost } from '../../../../../packages/emulators/host/src/index';
import stripeEmulator from '../../../../../packages/emulators/stripe/src/index';
import { createIndependentPsaStripeClient } from '@ee/lib/stripe/coManagedIndependentEntitlement.js';
import { handleCoManagedUpgradePaymentEvent, purchaseCoManagedIndependentPsa } from '@ee/lib/stripe/coManagedUpgradeCheckout.js';
import { createCoManagedPaymentHandlers } from '@ee/lib/stripe/coManagedPaymentEvents.js';
import { dispatchPaymentEvent } from '@ee/lib/stripe/paymentEventRegistry.js';
import { coManagedUpgradeClosure } from '@alga-psa/co-managed';
import { upgradeCoManagedWorkspaceWithHostedSubscription } from '../../db/co-managed-hosted-upgrade.js';

const url = process.env.L8B_TEST_DATABASE_URL;
const SECRET = 'sk_test_l8b_emulator';
const WEBHOOK_SECRET = 'whsec_l8b';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const root = createRequire(import.meta.url);

describe.skipIf(!url)('independent upgrade against the Stripe emulator and a real database', () => {
  let db: Knex, host: EmulatorHost, sink: http.Server, core: any, base: string, control: string;
  let tenant: string, userId: string, relationship: any, customerEmail: string;
  let priceId: string, previousBase: string | undefined;
  const events: Stripe.Event[] = [];
  const log = { info() {}, warn() {}, error() {} } as any;
  const sessionId = uuid(7001);
  const actor = () => ({ kind: 'session' as const, tenant, userId, sessionId });
  const control$ = async (path: string, body: unknown = {}) => (await (await fetch(`${control}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()) as any;

  /** The emulator, driven through the real SDK. Three response-shape gaps are adapted here and nowhere else:
   *  (1) checkout.sessions.retrieve does not echo `client_reference_id` or return `line_items.data[].price.id`
   *      (real Stripe does; assertSession relies on both) — restored from the request that created the session;
   *  (2) subscriptions.retrieve returns `price.product` as an id and omits `recurring.usage_type` /
   *      `interval_count` and the invoice's `amount_paid` / `amount_remaining` — the product is fetched from the
   *      emulator, the licensed-monthly defaults are filled and the amounts derived from the invoice status;
   *  (3) customers.search is not implemented, so the customer is created up front and found by id. */
  const created = new Map<string, any>();   // shared: the webhook path builds its own client
  function sessionShape(real: Stripe): Stripe {
    const sessions: any = Object.create(real.checkout.sessions);
    sessions.create = async (params: any, options: any) => { const s = await real.checkout.sessions.create(params, options); created.set(s.id, params); return s; };
    sessions.retrieve = async (id: string, options: any) => {
      const s: any = await real.checkout.sessions.retrieve(id, options), params = created.get(id);
      return params ? { ...s, client_reference_id: params.client_reference_id,
        line_items: { data: params.line_items.map((item: any) => ({ price: { id: item.price }, quantity: item.quantity })) } } : s;
    };
    const subscriptions: any = Object.create(real.subscriptions);
    subscriptions.retrieve = async (id: string, options: any) => {
      const s: any = await real.subscriptions.retrieve(id, options);
      for (const item of s.items.data) {
        if (typeof item.price.product === 'string') item.price.product = await real.products.retrieve(item.price.product);
        item.price.recurring = { usage_type: 'licensed', interval_count: 1, ...(item.price.recurring ?? { interval: 'month' }) };
      }
      const invoice = s.latest_invoice;
      if (invoice && typeof invoice === 'object' && invoice.amount_remaining === undefined) {
        invoice.amount_paid = invoice.status === 'paid' ? invoice.amount_due : 0; invoice.amount_remaining = 0;
      }
      return s;
    };
    return Object.create(real, { checkout: { value: { ...real.checkout, sessions } }, subscriptions: { value: subscriptions } });
  }
  const client = () => sessionShape(createIndependentPsaStripeClient(SECRET));

  const deliver = async (event: Stripe.Event) => {
    const handlers = createCoManagedPaymentHandlers({ priceId: () => undefined, sync: async () => {}, finalizeCheckout: async () => {},
      upgradePayment: (e, t, d) => handleCoManagedUpgradePaymentEvent(d, client(), t, e) });
    return dispatchPaymentEvent(handlers, { event, tenantId: tenant, knex: db });
  };
  const newEvents = (from: number) => events.slice(from);

  beforeAll(async () => {
    db = knexFactory({ client: 'pg', connection: url });
    if (!await db.schema.hasTable('stripe_customers')) {
      for (const f of ['ee/server/migrations/20251014120000_create_stripe_integration_tables.cjs', 'ee/server/migrations/20260305200000_add_base_item_to_stripe_subscriptions.cjs',
        'ee/server/migrations/20260309200000_add_billing_interval_to_stripe_subscriptions.cjs', 'ee/server/migrations/20260309100000_add_fk_stripe_base_price_id.cjs',
        'server/migrations/20261027090100_add_stripe_subscription_item_id.cjs']) await root(`../../../../../${f}`).up(db);
    }
    const found = await db('tenants').where('product_code', 'co_managed').first();
    if (!found) throw new Error('L8B_TEST_DATABASE_URL needs a co_managed customer tenant fixture');
    tenant = found.tenant; customerEmail = found.email;
    relationship = await db('co_management_relationships').where('tenant', tenant).first();
    const permitted = await db('users').join('user_roles', 'users.user_id', 'user_roles.user_id').join('role_permissions', 'user_roles.role_id', 'role_permissions.role_id')
      .join('permissions', 'role_permissions.permission_id', 'permissions.permission_id')
      .where({ 'users.tenant': tenant, 'users.user_type': 'internal', 'users.is_inactive': false, 'permissions.resource': 'co_management', 'permissions.action': 'manage' }).first('users.user_id');
    if (!permitted) throw new Error('fixture tenant needs a user with co_management:manage');
    userId = permitted.user_id;

    sink = http.createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      events.push(new Stripe(SECRET).webhooks.constructEvent(Buffer.concat(chunks).toString('utf8'), String(req.headers['stripe-signature']), WEBHOOK_SECRET));
      res.writeHead(200).end('{}');
    }).listen(0, '127.0.0.1');
    await new Promise<void>(r => sink.once('listening', r));
    host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
    const { controlPort, ports } = await host.start();
    base = `http://127.0.0.1:${ports.stripe}`; control = `http://127.0.0.1:${controlPort}`;
    core = (host.instance('stripe') as any).core;
    await control$('/control/stripe/seed/config', { secretKey: SECRET, webhookSecret: WEBHOOK_SECRET,
      publishableKey: 'pk_test_l8b', webhookTarget: `http://127.0.0.1:${(sink.address() as any).port}/webhook` });
    await control$('/control/stripe/seed/product', { id: 'prod_l8b_psa', name: 'Alga PSA seat' });
    priceId = 'price_l8b_month';
    await control$('/control/stripe/seed/price', { id: priceId, unitAmount: 2900, currency: 'eur', interval: 'month', product: 'prod_l8b_psa' });
    previousBase = process.env.STRIPE_API_BASE_URL;
    process.env.STRIPE_API_BASE_URL = base;   // the ONLY thing routing the SDK to the emulator
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600_000) });
  });

  const reset = async () => {
    await db('co_managed_independent_upgrades').where('tenant', tenant).delete();
    await db('co_managed_upgrade_purchases').where('tenant', tenant).delete();
    await db('stripe_subscriptions').where('tenant', tenant).delete();
    await db('stripe_customers').where('tenant', tenant).delete();
    await db('tenants').where('tenant', tenant).update({ product_code: 'co_managed' });
    await db('co_management_relationships').where({ tenant, relationship_id: relationship.relationship_id })
      .update({ state: 'active', ended_at: null, revision: relationship.revision });
    seeded.length = 0;
  };
  afterEach(reset);
  afterAll(async () => {
    process.env.STRIPE_API_BASE_URL = previousBase; if (previousBase === undefined) delete process.env.STRIPE_API_BASE_URL;
    await db('sessions').where('session_id', sessionId).delete();
    await db('co_management_relationships').where({ tenant, relationship_id: relationship.relationship_id })
      .update({ state: relationship.state, ended_at: relationship.ended_at, revision: relationship.revision });
    await host.stop(); await new Promise(r => sink.close(r)); await db.destroy();
  });

  /** Customer created in the emulator with our ownership metadata, and recorded locally (the "existing customer" path). */
  async function startPurchase(operationId: string) {
    await reset();
    const customer = await createIndependentPsaStripeClient(SECRET).customers.create({ email: customerEmail, name: 'Boundary Customer', metadata: { tenant_id: tenant } });
    await db('stripe_customers').insert({ tenant, stripe_customer_external_id: customer.id, email: customerEmail, name: 'Boundary Customer', metadata: { tenant_id: tenant } });
    const result = await purchaseCoManagedIndependentPsa(db, actor(), { operationId, quantity: 3, interval: 'month' },
      { stripe: client(), publishableKey: 'pk_test_l8b', priceId, returnBaseUrl: 'https://localhost:3000' });
    const purchase = await db('co_managed_upgrade_purchases').where('operation_id', operationId).first();
    return { customer, result, purchase };
  }

  it('routes the clients through the emulator only when the override env says so', async () => {
    expect((await createIndependentPsaStripeClient(SECRET).prices.retrieve(priceId)).unit_amount).toBe(2900);
  });

  it('happy path: purchase row + emulator checkout -> signed webhook through the registry -> paid -> one upgrade -> idempotent retry', async () => {
    const operationId = uuid(1001), upgradeOperationId = uuid(1002), before = events.length;
    const { result, purchase } = await startPurchase(operationId);
    expect(result.kind).toBe('checkout');
    expect(purchase).toMatchObject({ state: 'checkout', quantity: 3, billing_interval: 'month', price_id: priceId });
    expect(purchase.checkout_session_id).toMatch(/^cs_/);
    expect(core.sessions.get(purchase.checkout_session_id).metadata).toMatchObject({ tenant_id: tenant, source: 'co_managed_independent_upgrade', operation_id: operationId });

    // The emulator completes the payment and delivers signed webhooks; each goes through the registry.
    await control$('/control/stripe/actions/complete-session', { sessionId: purchase.checkout_session_id });
    const delivered = newEvents(before);
    expect(delivered.map(e => e.type)).toEqual(['checkout.session.completed']);   // the emulator delivers only the session event
    for (const event of delivered) await deliver(event);
    const paid = await db('co_managed_upgrade_purchases').where('operation_id', operationId).first();
    expect(paid.state).toBe('paid');
    expect(paid.subscription_id).toMatch(/^sub_/);
    expect(await db('stripe_subscriptions').where({ tenant, stripe_subscription_external_id: paid.subscription_id }).first()).toMatchObject({ status: 'active', quantity: 3 });
    expect((await db('tenants').where('tenant', tenant).first()).product_code).toBe('co_managed');   // payment alone never converts

    // Upgrade: recording fake for L7a's closure; every Stripe read goes to the emulator and is counted.
    let stripeCalls = 0;
    const real = client(), counted = {
      customers: { retrieve: (id: string) => { stripeCalls += 1; return real.customers.retrieve(id); } },
      subscriptions: { retrieve: (id: string, o: { expand: string[] }) => { stripeCalls += 1; return real.subscriptions.retrieve(id, o); } },
    };
    const closeAndArchive = vi.spyOn(coManagedUpgradeClosure, 'closeAndArchive').mockImplementation(async (_t, _a, _g, request) => ({ operationId: request.operationId }));
    const target = { customerTenant: tenant, relationshipId: relationship.relationship_id };
    const request = { operationId: upgradeOperationId, expectedRevision: relationship.revision };
    const first = await upgradeCoManagedWorkspaceWithHostedSubscription(db, actor(), target, request, log, { stripe: counted, prices: { month: priceId } });
    expect(closeAndArchive).toHaveBeenCalledTimes(1);
    expect(closeAndArchive.mock.calls[0][3]).toMatchObject({ operationId: upgradeOperationId, reason: 'independent_upgrade' });
    expect((await db('tenants').where('tenant', tenant).first()).product_code).toBe('psa');
    expect(await db('co_managed_independent_upgrades').where('tenant', tenant)).toHaveLength(1);
    expect(first).toMatchObject({ operationId: upgradeOperationId, customerTenant: tenant, productCode: 'psa', seats: 3, closureOperationId: upgradeOperationId });
    expect(await db('co_managed_independent_upgrades').where('tenant', tenant).first()).toMatchObject({ entitlement_source: 'stripe', entitlement_reference: paid.subscription_id, seats: 3 });
    expect(stripeCalls).toBe(2);
    expect(seeded).toEqual([tenant]);

    const second = await upgradeCoManagedWorkspaceWithHostedSubscription(db, actor(), target, request, log, { stripe: counted, prices: { month: priceId } });
    expect(second).toEqual(first);
    expect(closeAndArchive).toHaveBeenCalledTimes(1);   // no further closure call
    expect(stripeCalls).toBe(2);                         // and no further Stripe call
    expect(await db('co_managed_independent_upgrades').where('tenant', tenant)).toHaveLength(1);
    expect(seeded).toEqual([tenant]);
    closeAndArchive.mockRestore();
  });

  it('failure path: an expired checkout and a declined payment leave the tenant co_managed and never convert', async () => {
    const operationId = uuid(2001), before = events.length;
    const { purchase } = await startPurchase(operationId);
    await control$('/control/stripe/actions/fail-session', { sessionId: purchase.checkout_session_id });   // payment_intent.payment_failed
    await control$('/control/stripe/actions/expire-session', { sessionId: purchase.checkout_session_id }); // checkout.session.expired
    const delivered = newEvents(before);
    expect(delivered.map(e => e.type)).toEqual(expect.arrayContaining(['payment_intent.payment_failed', 'checkout.session.expired']));
    const outcomes = [];
    for (const event of delivered) outcomes.push(await deliver(event));
    // The declined-payment event carries no independent-upgrade marker: the handler does not claim it.
    expect(outcomes[0].handledBy).toEqual([]);
    expect((await db('co_managed_upgrade_purchases').where('operation_id', operationId).first()).state).toBe('expired');
    expect((await db('tenants').where('tenant', tenant).first()).product_code).toBe('co_managed');
    expect(await db('co_managed_independent_upgrades').where('tenant', tenant)).toHaveLength(0);
  });

  it('failure path: payment_failed is written to the real table (the reference CHECK rejected it)', async () => {
    const operationId = uuid(3001);
    const { customer, purchase } = await startPurchase(operationId);
    // The emulator's subscription checkout cannot decline a payment: its sessions have no unpaid-subscription
    // state. So the subscription and its VOID invoice are created in the emulator (core.createSubscription with
    // invoiceStatus 'void', exactly what Stripe leaves for an abandoned first invoice), and only the *session*
    // is presented as complete/unpaid pointing at it.
    const subscription = core.createSubscription({ customer: customer.id, priceId, quantity: 3, status: 'incomplete',
      metadata: { tenant_id: tenant, operation_id: operationId, source: 'co_managed_independent_upgrade', billing_interval: 'month' }, invoiceStatus: 'void' });
    const real = client();
    const stripe: any = Object.create(real, { checkout: { value: { sessions: Object.assign(Object.create((real.checkout as any).sessions), {
      retrieve: async (id: string, o: any) => ({ ...(await (real.checkout as any).sessions.retrieve(id, o)), status: 'complete', payment_status: 'unpaid', subscription: subscription.id }) }) } } });
    const event = { id: 'evt_l8b_failed', type: 'checkout.session.async_payment_failed', data: { object: { id: purchase.checkout_session_id,
      customer: customer.id, metadata: subscription.metadata } } } as unknown as Stripe.Event;
    expect(await handleCoManagedUpgradePaymentEvent(db, stripe, tenant, event)).toBe(true);
    expect((await db('co_managed_upgrade_purchases').where('operation_id', operationId).first()).state).toBe('payment_failed');
    expect((await db('tenants').where('tenant', tenant).first()).product_code).toBe('co_managed');
    expect(purchase.state).toBe('checkout');
    expect(await db('co_managed_independent_upgrades').where('tenant', tenant)).toHaveLength(0);
  });
});
