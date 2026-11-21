/**
 * Platform half of appliance fulfillment against the migrated EE Postgres database
 * (T006 replay matrix, T004 old-price renewal recognition).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { createOfferCatalog, CO_MANAGED_SEAT_OFFER_KEY as KEY, OfferTermsChangedError, UnmappedPriceError } from '../../lib/stripe/offerCatalog';
import { bindPortalPurchase, deliverPendingFulfillments, handlePortalPurchaseEvent, reconcilePortalPurchase, PortalFulfillmentRetryableError, PortalPurchaseOwnershipError } from '../../lib/stripe/coManagedFulfillment';

const MASTER = '00000000-0000-4000-8000-0000000000aa';
const operator = { tenantId: MASTER, userId: 'op@nineminds.test' };
const price = (id: string) => ({ id, active: true, livemode: false, type: 'recurring', billing_scheme: 'per_unit', currency: 'eur', unit_amount: 1100,
  product: 'prod_seat', transform_quantity: null, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } });
const PERIOD_1 = 1796000000, PERIOD_2 = 1798600000;
const portalStripe = (priceId: string) => ({ checkout: { sessions: { retrieve: async () => ({ id: 'checkout', line_items: { data: [{ price: { id: priceId } }] } }) } } } as any);

describe('co-managed portal fulfillment (postgres)', () => {
  let db: Knex;
  let sub: any, session: any;
  let writes: string[];
  const deliver = vi.fn();
  let catalog: ReturnType<typeof createOfferCatalog>;
  const deps = () => ({ db, catalog, deliver, stripe: {
    subscriptions: { retrieve: async () => sub, create: async () => { writes.push('subscriptions.create'); }, update: async () => { writes.push('subscriptions.update'); } },
    checkout: { sessions: { retrieve: async () => session } },
  } as any });
  const subscription = (over: any = {}) => ({ id: 'sub_portal', status: 'active', current_period_end: PERIOD_1, latest_invoice: { status: 'paid' },
    metadata: { portal_purchase_id: purchaseId, entitlement_id: 'ent_1' }, items: { data: [{ id: 'si', quantity: 5, price: price('price_a') }] }, ...over });
  let purchaseId: string;

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'co_managed_portal_fulfillment_test', runSeeds: false });
    const require = createRequire(import.meta.url);
    await require(path.resolve(__dirname, '../../../migrations/20261118090000_create_stripe_offer_catalog.cjs')).up(db);
    await require(path.resolve(__dirname, '../../../migrations/20261120120000_add_stripe_catalog_account_settings.cjs')).up(db);
  });
  afterAll(async () => { await db?.destroy(); });
  beforeEach(async () => {
    await db.raw('TRUNCATE co_managed_fulfillments, co_managed_portal_purchases, stripe_offer_publications, stripe_offer_versions CASCADE');
    writes = []; deliver.mockReset().mockResolvedValue({ result: 'applied' });
    const prices: Record<string, any> = { price_a: price('price_a'), price_b: price('price_b') };
    catalog = createOfferCatalog({ db, scope: async () => ({ stripeAccount: 'acct_1', livemode: false }), env: { MASTER_BILLING_TENANT_ID: MASTER },
      stripe: { prices: { retrieve: async (id: string) => prices[id] } } as any });
    await catalog.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_a', expectedCurrentVersionId: null, productId: 'prod_seat' });
    const row = await bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') }, { entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_1' });
    purchaseId = row.purchase_id;
    sub = subscription();
    session = { id: 'cs_1', status: 'complete', subscription: 'sub_portal', metadata: { portal_purchase_id: purchaseId, entitlement_id: 'ent_1' } };
  });

  it('binds checkout to entitlement before payment, idempotently, and refuses another entitlement; a rotated review needs a fresh review', async () => {
    const again = await bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') }, { entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_1' });
    expect(again.purchase_id).toBe(purchaseId);
    await expect(bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') }, { entitlementId: 'ent_other', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_1' })).rejects.toBeInstanceOf(PortalPurchaseOwnershipError);
    const current = await catalog.inspect(KEY, 'month');
    await catalog.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_b', expectedCurrentVersionId: current.current!.version_id });
    // An existing binding keeps its original price and merchant even after current terms rotate.
    expect(await bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') }, { entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY,
      interval: 'month', quantity: 5, checkoutSessionId: 'cs_1', offerRef: current.current!.version_id })).toMatchObject({ price_id: 'price_a', stripe_account: 'acct_1' });
    await expect(bindPortalPurchase({ db, catalog, stripe: portalStripe('price_b') as any }, { entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_2', offerRef: current.current!.version_id })).rejects.toBeInstanceOf(OfferTermsChangedError);
  });

  it('serializes portal checkout binding with an account switch lock', async () => {
    let entered!: () => void;
    let release!: () => void;
    const insideStripeRead = new Promise<void>((resolve) => { entered = resolve; });
    const holdStripeRead = new Promise<void>((resolve) => { release = resolve; });
    const stripe = { checkout: { sessions: { retrieve: async () => {
      entered(); await holdStripeRead;
      return { id: 'cs_racing', line_items: { data: [{ price: { id: 'price_a' } }] } };
    } } } };
    const binding = bindPortalPurchase({ db, catalog, stripe: stripe as any }, { entitlementId: 'ent_race', licenseTenantId: 'appliance-tenant',
      offerKey: KEY, interval: 'month', quantity: 1, checkoutSessionId: 'cs_racing' });
    await insideStripeRead;
    let switched = false;
    const switching = db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', ['stripe-billing-catalog:test']);
      switched = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(switched).toBe(false);
    release();
    await binding;
    await switching;
    expect(switched).toBe(true);
  });

  it('binds with a storefront-chosen purchase id, so the Checkout session can carry it from creation (Stripe ordering)', async () => {
    // The storefront picks the id, creates the session with portal_purchase_id in metadata and
    // subscription_data.metadata, then binds before the customer pays.
    const chosen = '5d8f1a2e-7c3b-4e9a-9b1f-0a2b3c4d5e6f';
    const row = await bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') as any }, { purchaseId: chosen, entitlementId: 'ent_2', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 3, checkoutSessionId: 'cs_chosen' });
    expect(row.purchase_id).toBe(chosen);
    const again = await bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') as any }, { purchaseId: chosen.toUpperCase(), entitlementId: 'ent_2', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 3, checkoutSessionId: 'cs_chosen' });
    expect(again.purchase_id).toBe(chosen);
    // The same id cannot be re-bound to another checkout or another entitlement.
    await expect(bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') as any }, { purchaseId: chosen, entitlementId: 'ent_2', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 3, checkoutSessionId: 'cs_other' })).rejects.toBeInstanceOf(PortalPurchaseOwnershipError);
    await expect(bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') as any }, { purchaseId: chosen, entitlementId: 'ent_other', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 3, checkoutSessionId: 'cs_other2' })).rejects.toBeInstanceOf(PortalPurchaseOwnershipError);
    // Nor can an already-bound checkout be claimed under a new id.
    await expect(bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') as any }, { purchaseId: '6e9a2b3f-8d4c-4fab-8c2a-1b3c4d5e6f70', entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_1' })).rejects.toBeInstanceOf(PortalPurchaseOwnershipError);
    await expect(bindPortalPurchase({ db, catalog, stripe: portalStripe('price_a') }, { purchaseId: 'not-a-uuid', entitlementId: 'ent_2', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 3, checkoutSessionId: 'cs_x' })).rejects.toThrow('purchaseId must be a UUID');
    expect(await db('co_managed_portal_purchases').where({ entitlement_id: 'ent_2' })).toHaveLength(1);
  });

  it('T006: paid payment queues one absolute count and delivers it; replays are duplicates', async () => {
    const first = await reconcilePortalPurchase(deps(), purchaseId);
    expect(first).toMatchObject({ kind: 'queued', delivery: 'delivered' });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toMatchObject({ entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', coManagedSeats: 5, sequence: 1 });
    for (let i = 0; i < 3; i++) expect(await reconcilePortalPurchase(deps(), purchaseId)).toMatchObject({ kind: 'duplicate' });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await db('co_managed_fulfillments')).toHaveLength(1);
    expect(writes).toEqual([]); // never writes to Stripe: nothing can be charged
  });

  it('T006: unpaid, incomplete and wrong-owner facts grant nothing', async () => {
    sub = subscription({ latest_invoice: { status: 'open' }, status: 'incomplete' });
    expect(await reconcilePortalPurchase(deps(), purchaseId)).toEqual({ kind: 'noop', reason: 'unpaid' });
    sub = subscription({ metadata: { portal_purchase_id: purchaseId, entitlement_id: 'ent_other' } });
    await expect(reconcilePortalPurchase(deps(), purchaseId)).rejects.toBeInstanceOf(PortalPurchaseOwnershipError);
    sub = subscription({ metadata: { portal_purchase_id: 'someone-else', entitlement_id: 'ent_1' } });
    await expect(reconcilePortalPurchase(deps(), purchaseId)).rejects.toBeInstanceOf(PortalPurchaseOwnershipError);
    sub = subscription({ items: { data: [{ id: 'si', quantity: 5, price: price('price_unknown') }] } });
    await expect(reconcilePortalPurchase(deps(), purchaseId)).rejects.toBeInstanceOf(UnmappedPriceError);
    session = { ...session, status: 'open', subscription: null };
    await db('co_managed_portal_purchases').update({ stripe_subscription_id: null });
    expect(await reconcilePortalPurchase(deps(), purchaseId)).toEqual({ kind: 'noop', reason: 'checkout_incomplete' });
    expect(await db('co_managed_fulfillments')).toHaveLength(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('T006: issuer outage leaves it pending; retry after recovery delivers once without touching Stripe', async () => {
    deliver.mockRejectedValueOnce(new Error('licensing service unavailable'));
    const queued = await reconcilePortalPurchase(deps(), purchaseId);
    expect(queued).toMatchObject({ kind: 'queued', delivery: 'pending' });
    expect(await db('co_managed_fulfillments').first()).toMatchObject({ state: 'pending', attempts: 1, last_error: 'licensing service unavailable' });
    expect(await deliverPendingFulfillments(deps())).toEqual({ delivered: 1, failed: 0, superseded: 0 });
    expect(await deliverPendingFulfillments(deps())).toEqual({ delivered: 0, failed: 0, superseded: 0 });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[1][0].idempotencyKey).toBe(deliver.mock.calls[0][0].idempotencyKey);
    expect(writes).toEqual([]);
  });

  it('T006: stale paid-period facts are rejected; a later period and a reduction supersede in order', async () => {
    await reconcilePortalPurchase(deps(), purchaseId);
    sub = subscription({ current_period_end: PERIOD_2 });
    expect(await reconcilePortalPurchase(deps(), purchaseId)).toMatchObject({ kind: 'queued' }); // renewal
    sub = subscription({ current_period_end: PERIOD_1 }); // a delayed replay of the earlier period
    expect(await reconcilePortalPurchase(deps(), purchaseId)).toEqual({ kind: 'stale' });
    sub = subscription({ current_period_end: PERIOD_2, items: { data: [{ id: 'si', quantity: 2, price: price('price_a') }] } });
    expect(await reconcilePortalPurchase(deps(), purchaseId)).toMatchObject({ kind: 'queued' }); // reduction
    sub = subscription({ current_period_end: PERIOD_2, status: 'canceled', latest_invoice: { status: 'paid' } });
    expect(await reconcilePortalPurchase(deps(), purchaseId)).toMatchObject({ kind: 'queued' }); // cancellation
    expect(deliver.mock.calls.map((c) => [c[0].sequence, c[0].coManagedSeats])).toEqual([[1, 5], [2, 5], [3, 2], [4, 0]]);
  });

  it('T004: a renewal billed on a retired price still reconciles after a rotation', async () => {
    const current = await catalog.inspect(KEY, 'month');
    await catalog.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_b', expectedCurrentVersionId: current.current!.version_id });
    sub = subscription({ items: { data: [{ id: 'si', quantity: 5, price: price('price_a') }] } });
    expect(await reconcilePortalPurchase(deps(), purchaseId)).toMatchObject({ kind: 'queued', delivery: 'delivered' });
  });

  describe('F009: webhook entry (no hosted tenant; the event body is only a pointer)', () => {
    const event = (type: string, object: any) => ({ id: `evt_${type}`, type, data: { object } }) as any;

    it('reconciles from invoice, subscription and checkout events without the browser return', async () => {
      const paid = await handlePortalPurchaseEvent(deps(), event('invoice.paid', { subscription_details: { metadata: { portal_purchase_id: purchaseId } } }));
      expect(paid).toMatchObject({ handled: true, purchaseId, outcome: { kind: 'queued', delivery: 'delivered' } });
      for (const e of [event('customer.subscription.updated', sub), event('checkout.session.completed', session)]) {
        expect(await handlePortalPurchaseEvent(deps(), e)).toMatchObject({ handled: true, outcome: { kind: 'duplicate' } });
      }
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(writes).toEqual([]);
    });

    it('ignores events without our marker (hosted and appliance-base events continue on their own paths)', async () => {
      expect(await handlePortalPurchaseEvent(deps(), event('invoice.paid', { subscription_details: { metadata: { tenant_id: 't' } } }))).toEqual({ handled: false });
      expect(await handlePortalPurchaseEvent(deps(), event('customer.created', { metadata: { portal_purchase_id: purchaseId } }))).toEqual({ handled: false });
    });

    it('consumes forged or unmapped facts without granting capacity', async () => {
      expect(await handlePortalPurchaseEvent(deps(), event('customer.subscription.updated', { metadata: { portal_purchase_id: '99999999-9999-4999-8999-999999999999' } })))
        .toMatchObject({ handled: true, outcome: { kind: 'rejected', code: 'PORTAL_PURCHASE_OWNERSHIP' } });
      sub = subscription({ metadata: { portal_purchase_id: purchaseId, entitlement_id: 'ent_other' } });
      expect(await handlePortalPurchaseEvent(deps(), event('customer.subscription.updated', sub))).toMatchObject({ outcome: { kind: 'rejected', code: 'PORTAL_PURCHASE_OWNERSHIP' } });
      sub = subscription({ items: { data: [{ id: 'si', quantity: 5, price: price('price_unknown') }] } });
      expect(await handlePortalPurchaseEvent(deps(), event('customer.subscription.updated', sub))).toMatchObject({ outcome: { kind: 'rejected', code: 'UNMAPPED_PRICE' } });
      expect(await db('co_managed_fulfillments')).toHaveLength(0);
      expect(deliver).not.toHaveBeenCalled();
    });

    it('answers retryable while the issuer is down; the redelivered event delivers once', async () => {
      deliver.mockRejectedValueOnce(new Error('licensing service unavailable'));
      const e = event('invoice.paid', { subscription_details: { metadata: { portal_purchase_id: purchaseId } } });
      const failure = await handlePortalPurchaseEvent(deps(), e).catch((error) => error);
      expect(failure).toBeInstanceOf(PortalFulfillmentRetryableError);
      expect(failure.retryable).toBe(true);
      expect(await handlePortalPurchaseEvent(deps(), e)).toMatchObject({ outcome: { kind: 'duplicate', delivery: 'delivered' } });
      expect(deliver).toHaveBeenCalledTimes(2);
      expect(await db('co_managed_fulfillments')).toHaveLength(1);
      expect(writes).toEqual([]);
    });

    it('answers retryable when Stripe cannot be read', async () => {
      const broken = { ...deps(), stripe: { subscriptions: { retrieve: async () => { throw new Error('stripe down'); } }, checkout: { sessions: { retrieve: async () => session } } } as any };
      await expect(handlePortalPurchaseEvent(broken, event('customer.subscription.updated', sub))).rejects.toBeInstanceOf(PortalFulfillmentRetryableError);
    });
  });
});
