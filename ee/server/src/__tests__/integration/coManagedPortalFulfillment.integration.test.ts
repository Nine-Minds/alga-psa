/**
 * Platform half of appliance fulfillment against a real Postgres (T006 replay matrix, T004 old-price
 * renewal recognition). Set OFFER_CATALOG_TEST_DATABASE_URL; skipped otherwise.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createOfferCatalog, CO_MANAGED_SEAT_OFFER_KEY as KEY, OfferTermsChangedError, UnmappedPriceError } from '../../lib/stripe/offerCatalog';
import { bindPortalPurchase, deliverPendingFulfillments, reconcilePortalPurchase, PortalPurchaseOwnershipError } from '../../lib/stripe/coManagedFulfillment';

const url = process.env.OFFER_CATALOG_TEST_DATABASE_URL;
const MASTER = '00000000-0000-4000-8000-0000000000aa';
const operator = { tenantId: MASTER, userId: 'op@nineminds.test' };
const price = (id: string) => ({ id, active: true, livemode: false, type: 'recurring', billing_scheme: 'per_unit', currency: 'eur', unit_amount: 1100,
  product: 'prod_seat', transform_quantity: null, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } });
const PERIOD_1 = 1796000000, PERIOD_2 = 1798600000;

describe.skipIf(!url)('co-managed portal fulfillment (postgres)', () => {
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
    db = knexFactory({ client: 'pg', connection: url });
    const migration = createRequire(import.meta.url)(path.resolve(__dirname, '../../../migrations/20261118090000_create_stripe_offer_catalog.cjs'));
    await migration.up(db);
  });
  afterAll(async () => { await db?.destroy(); });
  beforeEach(async () => {
    await db.raw('TRUNCATE co_managed_fulfillments, co_managed_portal_purchases, stripe_offer_publications, stripe_offer_versions CASCADE');
    writes = []; deliver.mockReset().mockResolvedValue({ result: 'applied' });
    const prices: Record<string, any> = { price_a: price('price_a'), price_b: price('price_b') };
    catalog = createOfferCatalog({ db, scope: async () => ({ stripeAccount: 'acct_1', livemode: false }), env: { MASTER_BILLING_TENANT_ID: MASTER },
      stripe: { prices: { retrieve: async (id: string) => prices[id] } } as any });
    await catalog.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_a', expectedCurrentVersionId: null, productId: 'prod_seat' });
    const row = await bindPortalPurchase({ db, catalog }, { entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_1' });
    purchaseId = row.purchase_id;
    sub = subscription();
    session = { id: 'cs_1', status: 'complete', subscription: 'sub_portal', metadata: { portal_purchase_id: purchaseId, entitlement_id: 'ent_1' } };
  });

  it('binds checkout to entitlement before payment, idempotently, and refuses another entitlement; a rotated review needs a fresh review', async () => {
    const again = await bindPortalPurchase({ db, catalog }, { entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_1' });
    expect(again.purchase_id).toBe(purchaseId);
    await expect(bindPortalPurchase({ db, catalog }, { entitlementId: 'ent_other', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_1' })).rejects.toBeInstanceOf(PortalPurchaseOwnershipError);
    const current = await catalog.inspect(KEY, 'month');
    await catalog.publishBinding({ actor: operator, offerKey: KEY, interval: 'month', priceId: 'price_b', expectedCurrentVersionId: current.current!.version_id });
    await expect(bindPortalPurchase({ db, catalog }, { entitlementId: 'ent_1', licenseTenantId: 'appliance-tenant', offerKey: KEY, interval: 'month', quantity: 5, checkoutSessionId: 'cs_2', offerRef: current.current!.version_id })).rejects.toBeInstanceOf(OfferTermsChangedError);
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
});
