/**
 * T045 (S35, F087): short pool capacity from the seat setup leads to the existing pool purchase review for the
 * NEW pool total, and the allocation completes without a second charge. Real Postgres (CE+EE migrations), the
 * real EE StripeService and the Stripe emulator; no application server and no browser.
 *
 * What this drives, in the order the seat setup drives it:
 *   1. the single capacity reading (`readCoManagedSeatEnableState`) says 4 purchased, 3 allocated, 1 available;
 *   2. a request for 3 seats is short by 2, so the decision is "review" at the absolute total 6 (purchased + shortfall);
 *   3. the review is priced from the Stripe price object: the preview carries the price's own currency (EUR here);
 *   4. one purchase, keyed by one operation id; capacity rises through reconciliation;
 *   5. capacity now covers the request, so the allocation (arrangement, board scope, invitation) is written;
 *   6. a reload, a second return and a late webhook replay the same operation and the same allocation:
 *      the emulator saw exactly one subscription update and nothing was written twice.
 *
 * What it does NOT drive: the React setup form and the browser's storage of the intent. Those are covered by
 * server/src/test/unit/co-managed/CoManagedSeatPurchaseResume.test.tsx (jsdom) and seatPurchaseResume.test.ts.
 * The server action wrapper (`enableCoManagedSeatArrangementAction`) needs a Next request context, so the domain
 * commands it calls are called here in its order. A Playwright run of the same journey would need the app server
 * started against the emulator (STRIPE_API_BASE_URL), which no existing e2e harness does.
 */
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '@alga-psa/emulator-stripe';
import { tenantDb } from '@alga-psa/db';
import {
  createCoManagedSeatArrangement, inviteCoManagedSeatTechnician, readCoManagedSeatArrangementPanel,
  readCoManagedSeatEnableState, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';
import { StripeService } from '@ee/lib/stripe/StripeService';
import { decideCoManagedSeatResume, planCoManagedSeatPurchase } from '../../components/co-managed/seatPurchaseResume';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../test-utils/eeMigrations';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createContact, createTenant } from '../../../test-utils/testDataFactory';

const holder = vi.hoisted(() => ({ db: null as unknown as Knex }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => holder.db }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => holder.db,
  withAdminTransactionRetryReadOnly: (work: (trx: Knex.Transaction) => Promise<unknown>) => holder.db.transaction(work),
}));
vi.mock('@ee/lib/tenant-management/workflowClient', () => ({ startTenantDeletionWorkflow: vi.fn() }));
vi.mock('@alga-psa/core/secrets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/core/secrets')>();
  return { ...actual, getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: vi.fn(async () => undefined), getTenantSecret: vi.fn(async () => undefined) })) };
});

const DAY = 86_400_000;
const CO_MANAGED_PRICE_ID = 'price_t045_co_managed';
const PRO_PRICE_ID = 'price_t045_pro';
const CUSTOMER_ID = 'cus_t045_sponsor';
const UNIT = 1149;
const HOOK_TIMEOUT = 300_000;
const describeDb = await describeWithDb();

describeDb('pool purchase review and resume from the seat setup (T045)', { shuffle: false }, () => {
  let db: Knex;
  let host: EmulatorHost;
  let core: any;
  let controlUrl: string;
  let migrationsDir: string;
  const previous: Record<string, string | undefined> = {};
  const envKeys = ['STRIPE_API_BASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_CO_MANAGED_USER_PRICE_ID', 'STRIPE_ACCOUNT_ID', 'STRIPE_PRO_PRICE_ID', 'MASTER_BILLING_TENANT_ID', 'NEXT_PUBLIC_APP_URL', 'FORCE_CAPABILITIES'];

  const control = async (path: string, body: unknown): Promise<any> => {
    const response = await fetch(`${controlUrl}/control/stripe/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.ok, `control ${path}: ${response.status}`).toBe(true);
    return (await response.json()).result;
  };
  const view = async (name: string): Promise<any[]> => (await (await fetch(`${controlUrl}/control/stripe/state/${name}`)).json()).result ?? [];

  beforeAll(async () => {
    for (const key of envKeys) previous[key] = process.env[key];
    migrationsDir = buildMergedEeMigrationsDir();
    db = await createTestDbConnection({ databaseName: 's35_pool_purchase_resume_test', migrationsDir });
    holder.db = db;
    host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
    const started = await host.start();
    core = (host.instance('stripe') as any).core;
    controlUrl = `http://127.0.0.1:${started.controlPort}`;
    process.env.STRIPE_API_BASE_URL = `http://127.0.0.1:${started.ports.stripe}`;
    process.env.STRIPE_SECRET_KEY = 'sk_test_algasim';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_algasim';
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_algasim';
    process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = CO_MANAGED_PRICE_ID; // legacy binding: the offer is unmanaged here
    process.env.STRIPE_ACCOUNT_ID = 'acct_algasim'; // catalog scope; the emulator has no accounts endpoint
    process.env.STRIPE_PRO_PRICE_ID = PRO_PRICE_ID;
    process.env.MASTER_BILLING_TENANT_ID = randomUUID();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.FORCE_CAPABILITIES = 'co-managed:on,co-managed-seat:on';
    await control('seed/customer', { id: CUSTOMER_ID, email: 'sponsor@example.test', name: 'Sponsor MSP' });
    await control('seed/price', { id: PRO_PRICE_ID, unitAmount: 2900, currency: 'usd', interval: 'month', product: 'prod_pro' });
    await control('seed/price', { id: CO_MANAGED_PRICE_ID, unitAmount: UNIT, currency: 'eur', interval: 'month', product: 'prod_co_managed' });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await host?.stop();
    await db?.destroy();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
    for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }, HOOK_TIMEOUT);

  it('reviews the new total, buys it once, completes the allocation, and a repeat return changes nothing', async () => {
    // A hosted Pro sponsor with a paid pool of 4 seats, 3 of them already allocated to another client.
    const tenant = await createTenant(db, `Sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    const sponsor = tenantDb(db, tenant);
    await sponsor.table('tenants').update({ plan: 'pro', billing_source: 'stripe', email: 'sponsor@example.test' });
    await sponsor.table('stripe_customers').insert({ tenant, stripe_customer_external_id: CUSTOMER_ID, email: 'sponsor@example.test' });
    await control('seed/subscription', { customer: CUSTOMER_ID, priceId: PRO_PRICE_ID, quantity: 7, status: 'active' });
    const pool = await control('seed/subscription', { customer: CUSTOMER_ID, priceId: CO_MANAGED_PRICE_ID, quantity: 4, status: 'active',
      metadata: { tenant_id: tenant, subscription_kind: 'co_managed' } });
    await sponsor.table('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: pool.id, capacity: 4,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: await createClient(db, tenant, 'Existing client'), operationId: randomUUID(), seats: 3 });

    const clientId = await createClient(db, tenant, 'Acme');
    const contactId = await createContact(db, tenant, clientId, { fullName: 'Dana Reyes', email: `dana.${randomUUID().slice(0, 8)}@client.example` });
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: 'Service desk', is_default: false });

    // 1-2. The one capacity reading, and the decision for a request of 3 seats.
    const requested = 3;
    const reading = await readCoManagedSeatEnableState(db, { sponsorTenant: tenant, clientId });
    expect(reading).toMatchObject({ capacity: { purchased: 4, allocated: 3, available: 1 } });
    const capacity = { purchased: reading.capacity.purchased, available: reading.capacity.available };
    expect(planCoManagedSeatPurchase(requested, capacity)).toEqual({ short: true, shortfall: 2, newTotal: 6 });
    const first = decideCoManagedSeatResume({ requested, capacity, pending: null, intentPurchase: null });
    expect(first).toEqual({ kind: 'review', quantity: 6 });

    // 3. The review: priced by the configured price, in its currency, for the new TOTAL (not the 2 extra seats).
    const service = new StripeService();
    const quote = await service.previewCoManagedSeats(tenant, first.kind === 'review' ? first.quantity : 0);
    expect(quote).toMatchObject({ unitAmount: UNIT, monthlyTotal: 6 * UNIT, amountDue: 2 * UNIT, currency: 'eur' });

    // 4. One purchase, one operation id. Count what reaches the emulator.
    const updates = vi.spyOn(core, 'updateSubscription');
    const operationId = randomUUID();
    const bought = await service.purchaseCoManagedSeats(tenant, 6, operationId);
    expect(bought).toMatchObject({ kind: 'updated', subscriptionId: pool.id });
    expect(updates).toHaveBeenCalledTimes(1);
    expect(updates.mock.calls[0][1]).toMatchObject({ quantity: 6 });
    expect(await sponsor.table('co_managed_purchase_operations').where({ operation_id: operationId }).first()).toMatchObject({ state: 'completed', quantity: 6 });

    // 5. Capacity now covers the request: the decision is "complete" whatever the purchase reported.
    const after = await readCoManagedSeatEnableState(db, { sponsorTenant: tenant, clientId });
    expect(after.capacity).toEqual({ purchased: 6, allocated: 3, available: 3 });
    expect(decideCoManagedSeatResume({ requested, capacity: { purchased: 6, available: 3 }, pending: null,
      intentPurchase: { operationId, quantity: 6 } })).toEqual({ kind: 'complete' });
    // Before reconciliation had landed, the same intent would have replayed its own operation, not bought again.
    expect(decideCoManagedSeatResume({ requested, capacity, pending: null, intentPurchase: { operationId, quantity: 6 } }))
      .toEqual({ kind: 'reconcile', operationId, quantity: 6 });

    // The allocation, in the order `enableCoManagedSeatArrangementAction` runs it. The allocation's own operation id is kept.
    const allocationOperation = randomUUID();
    const complete = async () => {
      const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: allocationOperation, seats: requested });
      await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: true }] });
      const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, contactId });
      return { arrangement, invitation };
    };
    const done = await complete();
    const panel = await readCoManagedSeatArrangementPanel(db, { sponsorTenant: tenant, clientId });
    expect(panel).toMatchObject({ arrangementId: done.arrangement.arrangement_id, seats: 3, usedSeats: 1, boardScope: [{ boardId, canCreate: true }] });
    expect(panel?.technicians).toEqual([expect.objectContaining({ name: 'Dana Reyes', state: 'invited' })]);
    expect(await db('co_managed_allocations').where({ tenant, sponsor_client_id: clientId }).whereNot('state', 'released')).toHaveLength(1);

    // 6. A reload, a second return and a late webhook: same operation, same allocation, no second charge.
    const eventsBefore = (await view('events')).length;
    expect(await service.purchaseCoManagedSeats(tenant, 6, operationId)).toMatchObject({ kind: 'updated', subscriptionId: pool.id });
    expect(await service.purchaseCoManagedSeats(tenant, 6, operationId)).toMatchObject({ kind: 'updated', subscriptionId: pool.id });
    const subscription = (await view('subscriptions')).find((entry) => entry.id === pool.id);
    await service.handleWebhookEvent({ id: `evt_${randomUUID()}`, object: 'event', type: 'customer.subscription.updated', created: Math.floor(Date.now() / 1000),
      data: { object: subscription } } as any);
    const again = await complete();
    expect(again.arrangement.arrangement_id).toBe(done.arrangement.arrangement_id);
    expect(done.invitation.created).toBe(true);
    expect(again.invitation).toMatchObject({ created: false, assignment_id: done.invitation.assignment_id });   // a replay, not a second invitation

    expect(updates).toHaveBeenCalledTimes(1);                        // the emulator saw exactly one subscription update
    expect((await view('events')).length).toBe(eventsBefore);        // and the replays emitted nothing
    expect((await view('checkout-sessions')).filter((session) => session.metadata?.operation_id === operationId)).toHaveLength(0);
    expect((await view('subscriptions')).filter((entry) => entry.metadata?.subscription_kind === 'co_managed' && entry.metadata?.tenant_id === tenant)).toHaveLength(1);
    expect(subscription.items.data[0].quantity).toBe(6);
    expect(await sponsor.table('co_managed_purchase_operations')).toHaveLength(1);
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 6, allocated: 6, available: 0 });
    expect(await sponsor.table('co_managed_seat_arrangements').where({ client_id: clientId })).toHaveLength(1);
    expect(await sponsor.table('co_managed_seat_assignments').where({ arrangement_id: done.arrangement.arrangement_id }).whereNot('state', 'revoked')).toHaveLength(1);
    updates.mockRestore();
  }, HOOK_TIMEOUT);
});
