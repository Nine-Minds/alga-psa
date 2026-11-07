/**
 * CM L8b composed acceptance against the complete CE+EE migration overlay.
 * This exercises the real emulator checkout/webhook registry, L7a closure and archive finalizer,
 * and initializeIndependentPsa in the same database transaction. No application server is used.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { rm } from 'node:fs/promises';
import { createTestDbConnection } from '../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../server/test-utils/eeMigrations';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/capability', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Only release-gate participation is fixed for this isolated emulator case.
  // The checkout, payment dispatch, closure and PSA initializer are production implementations.
  admits: async () => ({ admitted: false }),
  serves: async () => ({ admitted: false, served: true }),
}));

import { EmulatorHost } from '../../../../../packages/emulators/host/src/index';
import stripeEmulator, { deliverEvent } from '../../../../../packages/emulators/stripe/src/index';
import { createClient, createUser } from '../../../../../server/test-utils/testDataFactory';
import { createIndependentPsaStripeClient } from '@ee/lib/stripe/coManagedIndependentEntitlement.js';
import { handleCoManagedUpgradePaymentEvent, purchaseCoManagedIndependentPsa, retryCoManagedIndependentPayment } from '@ee/lib/stripe/coManagedUpgradeCheckout.js';
import { createCoManagedPaymentHandlers } from '@ee/lib/stripe/coManagedPaymentEvents.js';
import { dispatchPaymentEvent } from '@ee/lib/stripe/paymentEventRegistry.js';
import { coManagedArchiveManifestHash } from '@alga-psa/co-managed';
import { upgradeCoManagedWorkspaceWithHostedSubscription } from '../../db/co-managed-hosted-upgrade.js';
import { seedBoundaryFixture } from '../../../../../server/src/test/integration/coManagedArchiveBoundaryCases';

let migrationsDir: string;
const SECRET = 'sk_test_l8b_composed';
const WEBHOOK_SECRET = 'whsec_l8b_composed';
const PRICE_ID = 'price_l8b_composed_month';
const uuid = () => randomUUID();

describe('independent upgrade composed real-path integration (CE+EE overlay)', () => {
  let db: Knex, host: EmulatorHost, sink: http.Server, base: string, control: string, core: any;
  let previousBase: string | undefined;
  let fixture: Awaited<ReturnType<typeof seedBoundaryFixture>>;
  let tenant: string, customerEmail: string;
  const captured: Stripe.Event[] = [];
  const log = { info() {}, warn() {}, error() {} } as any;
  const control$ = async (path: string, body: unknown = {}) => (await (await fetch(`${control}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json()) as any;

  const clients = new Map<string, any>();
  function shapeStripe(real: Stripe): Stripe {
    const sessions: any = Object.create(real.checkout.sessions);
    sessions.create = async (params: any, options: any) => {
      const session = await real.checkout.sessions.create(params, options);
      clients.set(session.id, params);
      return session;
    };
    sessions.retrieve = async (id: string, options: any) => {
      const session: any = await real.checkout.sessions.retrieve(id, options);
      const params = clients.get(id);
      return params ? { ...session, client_reference_id: params.client_reference_id,
        line_items: { data: params.line_items.map((item: any) => ({ price: { id: item.price }, quantity: item.quantity })) } } : session;
    };
    const subscriptions: any = Object.create(real.subscriptions);
    subscriptions.retrieve = async (id: string, options: any) => {
      const subscription: any = await real.subscriptions.retrieve(id, options);
      for (const item of subscription.items.data) {
        if (typeof item.price.product === 'string') item.price.product = await real.products.retrieve(item.price.product);
        item.price.recurring = { usage_type: 'licensed', interval_count: 1, ...(item.price.recurring ?? { interval: 'month' }) };
      }
      const invoice = subscription.latest_invoice;
      if (invoice && typeof invoice === 'object' && invoice.amount_remaining === undefined) {
        invoice.amount_paid = invoice.status === 'paid' ? invoice.amount_due : 0;
        invoice.amount_remaining = 0;
        (invoice as any).subscription = subscription.id;
      }
      return subscription;
    };
    return Object.create(real, { checkout: { value: { ...real.checkout, sessions } }, subscriptions: { value: subscriptions } });
  }
  const stripe = () => shapeStripe(createIndependentPsaStripeClient(SECRET));
  const dispatch = async (event: Stripe.Event) => {
    const handlers = createCoManagedPaymentHandlers({ priceId: () => undefined, sync: async () => {}, finalizeCheckout: async () => {},
      upgradePayment: (current, tenantId, database) => handleCoManagedUpgradePaymentEvent(database, stripe(), tenantId, current) });
    return dispatchPaymentEvent(handlers, { event, tenantId: tenant, knex: db });
  };

  beforeAll(async () => {
    migrationsDir = buildMergedEeMigrationsDir();
    db = await createTestDbConnection({ migrationsDir });
    for (const table of ['tenant_workflow_schedule', 'stripe_subscriptions', 'portable_workspace_activations']) {
      if (!await db.schema.hasTable(table)) throw new Error(`CM L8b full fixture is incomplete: missing ${table}`);
    }
    sink = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      captured.push(new Stripe(SECRET).webhooks.constructEvent(Buffer.concat(chunks).toString('utf8'),
        String(req.headers['stripe-signature']), WEBHOOK_SECRET));
      res.writeHead(200).end('{}');
    }).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => sink.once('listening', resolve));
    host = new EmulatorHost({ seed: Number.parseInt(uuid().slice(0, 8), 16), emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
    const started = await host.start();
    base = `http://127.0.0.1:${started.ports.stripe}`;
    control = `http://127.0.0.1:${started.controlPort}`;
    core = (host.instance('stripe') as any).core;
    await control$('/control/stripe/seed/config', { secretKey: SECRET, webhookSecret: WEBHOOK_SECRET, publishableKey: 'pk_test_l8b',
      webhookTarget: `http://127.0.0.1:${(sink.address() as any).port}/webhook` });
    await control$('/control/stripe/seed/product', { id: 'prod_l8b_composed', name: 'Alga PSA seat' });
    await control$('/control/stripe/seed/price', { id: PRICE_ID, unitAmount: 2900, currency: 'eur', interval: 'month', product: 'prod_l8b_composed' });
    previousBase = process.env.STRIPE_API_BASE_URL;
    process.env.STRIPE_API_BASE_URL = base;
  }, 600_000);

  afterAll(async () => {
    process.env.STRIPE_API_BASE_URL = previousBase;
    if (previousBase === undefined) delete process.env.STRIPE_API_BASE_URL;
    await host?.stop();
    if (sink) await new Promise(resolve => sink.close(resolve));
    await db?.destroy();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  });

  it('keeps a failed checkout quarantined, retries with a new checkout, then converts once with real L7a and PSA initialization', async () => {
    fixture = await seedBoundaryFixture(db);
    tenant = fixture.customer;
    customerEmail = (await db('tenants').where({ tenant }).first('email')).email;
    const actor = fixture.customerAdmin;
    const target = { customerTenant: tenant, relationshipId: fixture.relationshipId };
    const sessionId = uuid();
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: actor.userId, created_at: db.fn.now(),
      expires_at: db.raw("now() + interval '1 day'") });
    await createUser(db, tenant, { first_name: 'Grace', last_name: 'Technician' });
    const purchaseRequest = (operationId: string) => ({ operationId, quantity: 3, interval: 'month' as const });
    const customer = await stripe().customers.create({ email: customerEmail, name: 'Boundary Customer', metadata: { tenant_id: tenant } });
    await db('stripe_customers').insert({ tenant, stripe_customer_external_id: customer.id, email: customerEmail,
      name: 'Boundary Customer', metadata: { tenant_id: tenant } });
    const begin = async (operationId: string) => {
      const result = await purchaseCoManagedIndependentPsa(db, actor, purchaseRequest(operationId), {
        stripe: stripe(), publishableKey: 'pk_test_l8b', priceId: PRICE_ID, returnBaseUrl: 'https://localhost:3000',
      });
      const purchase = await db('co_managed_upgrade_purchases').where({ operation_id: operationId }).first();
      expect(result.kind).toBe('checkout');
      return { result, purchase };
    };

    // First checkout fails with a void initial invoice. Dispatch the signed-style event through the same
    // production registry and Stripe read/reconciliation adapter used by webhook processing.
    const failedOperation = uuid();
    const failed = await begin(failedOperation);
    const failedSubscription = core.createSubscription({ customer: customer.id, priceId: PRICE_ID, quantity: 3,
      status: 'incomplete', metadata: { tenant_id: tenant, operation_id: failedOperation, source: 'co_managed_independent_upgrade', billing_interval: 'month' },
      invoiceStatus: 'void' });
    const failedSession = core.sessions.get(failed.purchase.checkout_session_id) as any;
    failedSession.status = 'complete'; failedSession.payment_status = 'unpaid'; failedSession.subscription = failedSubscription.id;
    const failedEvent = core.emitEvent('checkout.session.async_payment_failed', failedSession) as Stripe.Event;
    const failedBefore = captured.length;
    await deliverEvent(core, failedEvent as any, host.env);
    const failedDeliveries = captured.slice(failedBefore);
    expect(failedDeliveries.map(event => event.type)).toEqual(['checkout.session.async_payment_failed']);
    const failedOutcome = await dispatch(failedDeliveries[0]);
    expect(failedOutcome.handledBy).toContain('co-managed-independent-upgrade');
    expect((await db('co_managed_upgrade_purchases').where({ operation_id: failedOperation }).first()).state).toBe('payment_failed');
    expect((await db('tenants').where({ tenant }).first()).product_code).toBe('co_managed');
    expect(await db('co_managed_relationship_closures').where({ relationship_id: fixture.relationshipId })).toHaveLength(0);
    expect(await db('co_managed_allocations').where({ relationship_id: fixture.relationshipId }).whereNull('released_at')).toHaveLength(1);

    await expect(retryCoManagedIndependentPayment(db, actor, failedOperation, stripe())).resolves.toEqual({ kind: 'expired' });
    expect((await db('co_managed_upgrade_purchases').where({ operation_id: failedOperation }).first()).state).toBe('expired');
    expect((await db('tenants').where({ tenant }).first()).product_code).toBe('co_managed');
    expect(await db('co_managed_relationship_closures').where({ relationship_id: fixture.relationshipId })).toHaveLength(0);
    expect(await db('co_managed_allocations').where({ relationship_id: fixture.relationshipId }).whereNull('released_at')).toHaveLength(1);

    // Representative customer-owned rows must survive the actual conversion.
    const clientId = await createClient(db, tenant, 'Upgrade retained customer');
    const boardId = uuid(), statusId = uuid(), ticketId = uuid(), fileId = uuid();
    await db('boards').insert({ tenant, board_id: boardId, board_name: 'Customer support' });
    await db('statuses').insert({ tenant, status_id: statusId, name: 'Open', status_type: 'ticket', item_type: 'ticket', order_number: 1,
      board_id: boardId, is_default: true });
    await db('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `L8B-${ticketId.slice(0, 8)}`, title: 'Retained customer ticket',
      client_id: clientId, board_id: boardId, status_id: statusId, entered_by: actor.userId });
    const fileRow = { tenant, file_id: fileId, file_name: 'customer-report.pdf', original_name: 'customer-report.pdf', mime_type: 'application/pdf',
      file_size: 23, storage_path: `${tenant}/${fileId}`, uploaded_by_id: actor.userId, is_deleted: false, deleted_at: null, deleted_by_id: null,
      metadata: { fixture: 'l8b-real-conversion' } };
    await db('external_files').insert(fileRow);
    const originalUsers = await db('users').where({ tenant }).select('user_id', 'email');

    // Retire the failed attempt, start a new provider checkout, then consume the actual emulator's
    // signed webhook deliveries through the payment-event registry.
    const successOperation = uuid();
    const success = await begin(successOperation);
    const before = captured.length;
    await control$('/control/stripe/actions/complete-session', { sessionId: success.purchase.checkout_session_id });
    const paymentEvents = captured.slice(before);
    expect(paymentEvents.map(event => event.type)).toEqual(['checkout.session.completed']);
    for (const event of paymentEvents) expect((await dispatch(event)).handledBy).toContain('co-managed-independent-upgrade');
    expect((await db('co_managed_upgrade_purchases').where({ operation_id: successOperation }).first()).state).toBe('paid');
    expect((await db('tenants').where({ tenant }).first()).product_code).toBe('co_managed');
    expect(await db('co_managed_relationship_closures').where({ relationship_id: fixture.relationshipId })).toHaveLength(0);
    expect(await db('co_managed_allocations').where({ relationship_id: fixture.relationshipId }).whereNull('released_at')).toHaveLength(1);

    const upgradeOperation = uuid();
    const upgradeRequest = { operationId: upgradeOperation,
      expectedRevision: Number((await db('co_management_relationships').where({ tenant, relationship_id: fixture.relationshipId }).first()).revision) };
    const real = stripe();
    const reader = {
      customers: { retrieve: (id: string) => real.customers.retrieve(id) },
      subscriptions: { retrieve: (id: string, options: { expand: string[] }) => real.subscriptions.retrieve(id, options) },
    };
    const beforeUsers = originalUsers;
    const upgraded = await upgradeCoManagedWorkspaceWithHostedSubscription(db, actor, target, upgradeRequest, log,
      { stripe: reader, prices: { month: PRICE_ID } });
    expect(upgraded).toMatchObject({ operationId: upgradeOperation, customerTenant: tenant, productCode: 'psa', seats: 3 });
    expect((await db('tenants').where({ tenant }).first()).product_code).toBe('psa');
    expect(await db('tickets').where({ tenant, ticket_id: ticketId }).first()).toMatchObject({ title: 'Retained customer ticket', client_id: clientId });
    expect(await db('external_files').where({ tenant, file_id: fileId }).first()).toMatchObject({ ...fileRow, file_size: String(fileRow.file_size) });
    expect(await db('users').where({ tenant }).select('user_id', 'email')).toEqual(expect.arrayContaining(beforeUsers));

    const relationship = await db('co_management_relationships').where({ tenant, relationship_id: fixture.relationshipId }).first();
    expect(relationship).toMatchObject({ state: 'terminated' });
    expect(relationship.ended_at).toBeTruthy();
    const closures = await db('co_managed_relationship_closures').where({ relationship_id: fixture.relationshipId });
    expect(closures).toHaveLength(1);
    expect(closures[0]).toMatchObject({ operation_id: upgradeOperation, reason: 'independent_upgrade', released_seats: 3 });
    const allocations = await db('co_managed_allocations').where({ relationship_id: fixture.relationshipId });
    expect(allocations).toHaveLength(1);
    expect(allocations[0].released_at).toBeTruthy();
    const manifests = await db('co_managed_archive_manifests').where({ relationship_id: fixture.relationshipId });
    expect(manifests).toHaveLength(1);
    expect(coManagedArchiveManifestHash({ tenant: manifests[0].tenant, customer_tenant: manifests[0].customer_tenant,
      relationship_id: manifests[0].relationship_id, operation_id: manifests[0].operation_id, cutoff_at: manifests[0].cutoff_at },
    manifests[0].manifest)).toBe(manifests[0].content_hash);

    const replay = await upgradeCoManagedWorkspaceWithHostedSubscription(db, actor, target, upgradeRequest, log,
      { stripe: reader, prices: { month: PRICE_ID } });
    expect(replay).toEqual(upgraded);
    for (const event of paymentEvents) await dispatch(event);
    expect(await db('co_managed_independent_upgrades').where({ tenant })).toHaveLength(1);
    expect(await db('co_managed_relationship_closures').where({ relationship_id: fixture.relationshipId })).toHaveLength(1);
    expect(await db('co_managed_allocations').where({ relationship_id: fixture.relationshipId }).whereNull('released_at')).toHaveLength(0);
  }, 240_000);
});
