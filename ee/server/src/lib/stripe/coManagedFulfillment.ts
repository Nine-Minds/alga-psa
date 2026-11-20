/**
 * Platform side of appliance co-managed fulfillment (F010-F013).
 *
 * Flow: the licensing portal resolves the offer and creates a Nine Minds Stripe checkout, then
 * `bindPortalPurchase` persists checkout -> entitlement BEFORE payment. `reconcilePortalPurchase`
 * re-reads Stripe (never trusts an event body), verifies ownership, paid state and the billed
 * price by historical RECOGNITION, and queues exactly one fulfillment per (paid period, seats).
 * Delivery to the issuer goes through an outbox: an issuer outage leaves the fulfillment pending
 * and `deliverPendingFulfillments` retries it. Nothing here writes to Stripe, so a retry can never
 * charge again, and only verified payment ever produces a count above zero.
 * The purchase ledger and outbox are platform records for appliance entitlements. The storefront
 * uses master-tenant authorization and reconciliation verifies Stripe ownership and payment.
 */
import type { Knex } from 'knex';
import type Stripe from 'stripe';
import {
  coManagedFulfillmentProblems, decideCoManagedFulfillment, MAX_CO_MANAGED_FULFILLMENT_SEATS,
  type CoManagedFulfillmentRequest,
} from '@alga-psa/licensing';
import type { OfferCatalog } from './offerCatalog/catalog';
import { OfferTermsChangedError, UnmappedPriceError, type BillingInterval } from './offerCatalog/types';
import { billingPeriodEnd } from './coManagedSubscription';

const PURCHASES = 'co_managed_portal_purchases';
const FULFILLMENTS = 'co_managed_fulfillments';

export class PortalPurchaseOwnershipError extends Error {
  readonly code = 'PORTAL_PURCHASE_OWNERSHIP';
  constructor(detail: string) { super(`Portal purchase ownership does not match: ${detail}. Capacity was left unchanged.`); this.name = 'PortalPurchaseOwnershipError'; }
}

export interface PortalPurchaseRow {
  purchase_id: string; stripe_account: string; livemode: boolean; entitlement_id: string; license_tenant_id: string;
  offer_key: string; billing_interval: BillingInterval; offer_version_id: string; price_id: string; quantity: number;
  checkout_session_id: string; stripe_subscription_id: string | null; state: 'pending' | 'paid' | 'closed';
}

export interface FulfillmentRow {
  fulfillment_id: string; purchase_id: string; entitlement_id: string; stripe_subscription_id: string; sequence: string | number;
  paid_period_end: Date; co_managed_seats: number; idempotency_key: string; state: 'pending' | 'delivered' | 'superseded';
  attempts: number; last_error: string | null;
}

export type DeliverFulfillment = (request: CoManagedFulfillmentRequest) => Promise<{ result: 'applied' | 'duplicate' | 'stale' }>;

export interface FulfillmentDeps { db: Knex; stripe: Pick<Stripe, 'subscriptions' | 'checkout'>; catalog: OfferCatalog; deliver: DeliverFulfillment }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Persist the association between a portal checkout and the appliance entitlement it is for. The
 * reviewed offer must still be current (else a fresh review: OfferTermsChangedError). Repeating the
 * same binding is idempotent; the same checkout (or purchase id) for a different entitlement is refused.
 *
 * `purchaseId` is chosen by the storefront. Stripe fixes a Checkout session's subscription metadata when
 * the session is created, and reconciliation requires both the session and the subscription to name the
 * purchase (`portal_purchase_id`). So the storefront generates the id, creates the session carrying it,
 * then binds here before the customer pays. Without it the id would only exist after the session.
 */
export async function bindPortalPurchase(deps: Pick<FulfillmentDeps, 'db' | 'catalog'>, input: {
  entitlementId: string; licenseTenantId: string; offerKey: string; interval: BillingInterval; offerRef?: string;
  quantity: number; checkoutSessionId: string; purchaseId?: string;
}): Promise<PortalPurchaseRow> {
  if (!input.entitlementId || !input.licenseTenantId || !input.checkoutSessionId) throw new Error('entitlementId, licenseTenantId and checkoutSessionId are required');
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_CO_MANAGED_FULFILLMENT_SEATS) throw new Error('Invalid co-managed seat quantity');
  if (input.purchaseId !== undefined && !UUID.test(input.purchaseId)) throw new Error('purchaseId must be a UUID');
  const offer = await deps.catalog.resolveCurrentOffer(input.offerKey, input.interval);
  const ref = offer.versionId ?? `price:${offer.priceId}`;
  if (input.offerRef && input.offerRef !== ref) throw new OfferTermsChangedError(input.offerRef, offer);
  if (!offer.versionId) throw new Error('Appliance purchases require a managed catalog offer');
  const existing: PortalPurchaseRow | undefined = await deps.db(PURCHASES)
    .where({ checkout_session_id: input.checkoutSessionId })
    .modify((q: Knex.QueryBuilder) => { if (input.purchaseId) q.orWhere({ purchase_id: input.purchaseId }); })
    .first();
  if (existing) {
    if (existing.entitlement_id !== input.entitlementId || existing.license_tenant_id !== input.licenseTenantId) throw new PortalPurchaseOwnershipError('checkout is bound to another entitlement');
    if (existing.checkout_session_id !== input.checkoutSessionId || (input.purchaseId && existing.purchase_id !== input.purchaseId.toLowerCase())) {
      throw new PortalPurchaseOwnershipError('purchase id and checkout session are bound to different purchases');
    }
    return existing; // pinned terms stay as first recorded
  }
  // write-admission: exempt — the authenticated storefront records a platform checkout binding for an appliance entitlement.
  const [row] = await deps.db(PURCHASES).insert({
    ...(input.purchaseId ? { purchase_id: input.purchaseId.toLowerCase() } : {}),
    stripe_account: offer.scope.stripeAccount, livemode: offer.scope.livemode, entitlement_id: input.entitlementId,
    license_tenant_id: input.licenseTenantId, offer_key: input.offerKey, billing_interval: input.interval,
    offer_version_id: offer.versionId, price_id: offer.priceId, quantity: input.quantity, checkout_session_id: input.checkoutSessionId,
  }).returning('*');
  return row;
}

const idOf = (value: string | { id: string } | null | undefined): string | undefined => (typeof value === 'string' ? value : value?.id);

export type ReconcileOutcome =
  | { kind: 'noop'; reason: 'checkout_incomplete' | 'unpaid' | 'nothing_to_remove' }
  | { kind: 'stale' }
  | { kind: 'queued' | 'duplicate'; fulfillment: FulfillmentRow; delivery: 'delivered' | 'pending' | 'superseded' };

/**
 * Reconcile ONE portal purchase from current Stripe state. Unmapped or foreign facts throw (capacity
 * unchanged, actionable message); unpaid state is a no-op, never a grant.
 */
export async function reconcilePortalPurchase(deps: FulfillmentDeps, purchaseId: string): Promise<ReconcileOutcome> {
  const purchase: PortalPurchaseRow | undefined = await deps.db(PURCHASES).where({ purchase_id: purchaseId }).first();
  if (!purchase) throw new PortalPurchaseOwnershipError('unknown purchase');

  let subscriptionId = purchase.stripe_subscription_id;
  if (!subscriptionId) {
    const session = await deps.stripe.checkout.sessions.retrieve(purchase.checkout_session_id);
    if (session.id !== purchase.checkout_session_id || session.metadata?.portal_purchase_id !== purchase.purchase_id ||
        session.metadata?.entitlement_id !== purchase.entitlement_id) throw new PortalPurchaseOwnershipError('checkout metadata names a different purchase or entitlement');
    if (session.status !== 'complete' || !session.subscription) return { kind: 'noop', reason: 'checkout_incomplete' };
    subscriptionId = idOf(session.subscription)!;
  }
  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
  if (subscription.metadata?.portal_purchase_id !== purchase.purchase_id || subscription.metadata?.entitlement_id !== purchase.entitlement_id) {
    throw new PortalPurchaseOwnershipError('subscription metadata names a different purchase or entitlement');
  }
  if (subscription.items.data.length !== 1) throw new PortalPurchaseOwnershipError('subscription does not have exactly one seat item');
  const item = subscription.items.data[0];
  // RECOGNITION: the billed price must be an offer version of the purchase's own offer (retired included).
  const scope = await deps.catalog.scope();
  const classified = await deps.catalog.classifyPrice(scope, item.price.id);
  if (!classified) throw new UnmappedPriceError(item.price.id);
  if (classified.offerKey !== purchase.offer_key || classified.interval !== purchase.billing_interval) throw new PortalPurchaseOwnershipError(`price ${item.price.id} belongs to ${classified.offerKey}/${classified.interval}`);
  if (!Number.isSafeInteger(item.quantity) || (item.quantity ?? 0) < 1) throw new PortalPurchaseOwnershipError('invalid billed quantity');

  const invoice = typeof subscription.latest_invoice === 'object' && subscription.latest_invoice && !('deleted' in subscription.latest_invoice) ? subscription.latest_invoice : null;
  const paid = subscription.status === 'active' && invoice?.status === 'paid';
  const ended = ['canceled', 'incomplete_expired'].includes(subscription.status);
  if (!paid && !ended) return { kind: 'noop', reason: 'unpaid' };
  const seats = paid ? item.quantity! : 0;
  const periodMs = billingPeriodEnd(subscription);
  if (!Number.isFinite(periodMs)) throw new PortalPurchaseOwnershipError('subscription has no valid billing period');

  const queued = await deps.db.transaction(async (trx) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [purchase.entitlement_id]);
    if (!purchase.stripe_subscription_id) {
      // Bind the subscription once; a different subscription for the same purchase is foreign.
      // write-admission: exempt — Stripe-verified subscription binding updates the platform purchase ledger under the entitlement lock.
      await trx(PURCHASES).where({ purchase_id: purchase.purchase_id }).whereNull('stripe_subscription_id')
        .update({ stripe_subscription_id: subscription.id, state: 'paid', updated_at: trx.fn.now() });
    }
    const latest: FulfillmentRow | undefined = await trx(FULFILLMENTS).where({ entitlement_id: purchase.entitlement_id }).orderBy('sequence', 'desc').first();
    if (ended && !latest) return { kind: 'noop' as const, reason: 'nothing_to_remove' as const };
    const latestEnd = latest ? latest.paid_period_end.getTime() : 0;
    const paidPeriodEnd = new Date(ended ? Math.max(periodMs, latestEnd) : periodMs);
    const sequence = latest ? Number(latest.sequence) + 1 : 1;
    const base = `cm-fulfil:${purchase.purchase_id}:${Math.floor(paidPeriodEnd.getTime() / 1000)}:${seats}`;
    const decision = decideCoManagedFulfillment(
      { lastSequence: latest ? Number(latest.sequence) : null, lastPaidPeriodEnd: latest?.paid_period_end.toISOString() ?? null, lastIdempotencyKey: latest?.idempotency_key ?? null },
      { idempotencyKey: base, entitlementId: purchase.entitlement_id, licenseTenantId: purchase.license_tenant_id, purchaseId: purchase.purchase_id,
        stripeSubscriptionId: subscription.id, sequence, paidPeriodEnd: paidPeriodEnd.toISOString(), coManagedSeats: seats });
    if (decision.kind === 'stale') return { kind: 'stale' as const };
    if (decision.kind === 'duplicate') return { kind: 'duplicate' as const, fulfillment: latest! };
    const reused = await trx(FULFILLMENTS).where({ idempotency_key: base }).first('fulfillment_id');
    // write-admission: exempt — Stripe reconciliation queues an appliance entitlement change in the platform outbox under the entitlement lock.
    const [row] = await trx(FULFILLMENTS).insert({
      purchase_id: purchase.purchase_id, entitlement_id: purchase.entitlement_id, stripe_subscription_id: subscription.id, sequence,
      paid_period_end: paidPeriodEnd, co_managed_seats: seats, idempotency_key: reused ? `${base}:s${sequence}` : base,
    }).returning('*');
    return { kind: 'queued' as const, fulfillment: row as FulfillmentRow };
  });
  if (queued.kind === 'noop' || queued.kind === 'stale') return queued;
  await deliverPendingFulfillments(deps, purchase.entitlement_id);
  const settled: FulfillmentRow = await deps.db(FULFILLMENTS).where({ fulfillment_id: queued.fulfillment.fulfillment_id }).first();
  return { kind: queued.kind, fulfillment: settled, delivery: settled.state };
}

const PORTAL_EVENT_TYPES = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed',
]);

/**
 * Pure payload test: the portal purchase a Stripe event is about, from OUR metadata marker
 * (`portal_purchase_id`, set by the licensing portal on the checkout session and the subscription).
 * The id is only a pointer: reconciliation re-reads Stripe and verifies ownership itself.
 */
export function portalPurchaseIdOfEvent(event: Pick<Stripe.Event, 'type' | 'data'>): string | null {
  if (!PORTAL_EVENT_TYPES.has(event.type)) return null;
  const object = event.data.object as any;
  const metadata = event.type.startsWith('invoice.')
    ? (object.subscription_details ?? object.parent?.subscription_details)?.metadata
    : object.metadata;
  const id = metadata?.portal_purchase_id;
  return typeof id === 'string' && id.length > 0 && id.length <= 100 ? id : null;
}

/** A portal-purchase webhook could not be settled now; the webhook answers 5xx so Stripe redelivers. */
export class PortalFulfillmentRetryableError extends Error {
  readonly retryable = true as const;
  constructor(message: string, readonly cause?: unknown) { super(message); this.name = 'PortalFulfillmentRetryableError'; }
}

export type PortalWebhookOutcome =
  | { handled: false }
  | { handled: true; purchaseId: string; outcome: ReconcileOutcome | { kind: 'rejected'; code: string; message: string } };

/**
 * Webhook entry for portal (appliance) co-managed purchases, which have no hosted tenant (F009).
 * Same path as the reconcile endpoint: the event body is never trusted, Stripe is re-read.
 *  - unknown purchase, foreign ownership or an unmapped price: consumed, capacity unchanged, logged
 *    for an operator (a redelivery cannot fix it; after the fix, call the reconcile endpoint);
 *  - a fulfillment the issuer has not accepted yet, or any transient failure: retryable, so Stripe
 *    redelivers and the outbox retries delivery (no Stripe write, so never a second charge).
 */
export async function handlePortalPurchaseEvent(deps: FulfillmentDeps, event: Pick<Stripe.Event, 'id' | 'type' | 'data'>): Promise<PortalWebhookOutcome> {
  const purchaseId = portalPurchaseIdOfEvent(event);
  if (!purchaseId) return { handled: false };
  let outcome: ReconcileOutcome;
  try {
    outcome = await reconcilePortalPurchase(deps, purchaseId);
  } catch (error) {
    if (error instanceof PortalPurchaseOwnershipError || error instanceof UnmappedPriceError) {
      return { handled: true, purchaseId, outcome: { kind: 'rejected', code: error.code, message: error.message } };
    }
    throw new PortalFulfillmentRetryableError(`Portal purchase ${purchaseId} reconciliation failed for ${event.id}: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  if ('delivery' in outcome && outcome.delivery === 'pending') {
    throw new PortalFulfillmentRetryableError(`Portal purchase ${purchaseId}: fulfillment ${outcome.fulfillment.fulfillment_id} is queued but the licensing service has not accepted it yet (${outcome.fulfillment.last_error ?? 'no error recorded'}).`);
  }
  return { handled: true, purchaseId, outcome };
}

/**
 * Deliver the newest pending fulfillment per entitlement (absolute counts: older pending ones are
 * superseded, never replayed out of order). An issuer failure leaves the row pending with the error
 * recorded; a later call retries. Safe to run from a repair job.
 */
export async function deliverPendingFulfillments(deps: Pick<FulfillmentDeps, 'db' | 'deliver'>, entitlementId?: string): Promise<{ delivered: number; failed: number; superseded: number }> {
  const totals = { delivered: 0, failed: 0, superseded: 0 };
  const pending: FulfillmentRow[] = await deps.db(FULFILLMENTS).where({ state: 'pending' }).modify((q: Knex.QueryBuilder) => { if (entitlementId) q.where({ entitlement_id: entitlementId }); }).orderBy('sequence', 'desc');
  const seen = new Set<string>();
  for (const row of pending) {
    if (seen.has(row.entitlement_id)) {
      // write-admission: exempt — the platform outbox retires an older delivery after selecting a newer one for the appliance entitlement.
      await deps.db(FULFILLMENTS).where({ fulfillment_id: row.fulfillment_id }).update({ state: 'superseded' });
      totals.superseded += 1;
      continue;
    }
    seen.add(row.entitlement_id);
    const purchase: PortalPurchaseRow = await deps.db(PURCHASES).where({ purchase_id: row.purchase_id }).first();
    const request: CoManagedFulfillmentRequest = {
      idempotencyKey: row.idempotency_key, entitlementId: row.entitlement_id, licenseTenantId: purchase.license_tenant_id, purchaseId: row.purchase_id,
      stripeSubscriptionId: row.stripe_subscription_id, sequence: Number(row.sequence), paidPeriodEnd: row.paid_period_end.toISOString(), coManagedSeats: row.co_managed_seats,
    };
    const problems = coManagedFulfillmentProblems(request);
    try {
      if (problems.length) throw new Error(`Invalid fulfillment: ${problems.join('; ')}`);
      const ack = await deps.deliver(request);
      // write-admission: exempt — record the licensing issuer's acknowledgement in the platform outbox.
      await deps.db(FULFILLMENTS).where({ fulfillment_id: row.fulfillment_id })
        .update({ state: ack.result === 'stale' ? 'superseded' : 'delivered', delivered_at: deps.db.fn.now(), attempts: row.attempts + 1, last_error: null });
      totals[ack.result === 'stale' ? 'superseded' : 'delivered'] += 1;
    } catch (error) {
      // write-admission: exempt — record a failed attempt so the platform outbox can retry delivery.
      await deps.db(FULFILLMENTS).where({ fulfillment_id: row.fulfillment_id })
        .update({ attempts: row.attempts + 1, last_error: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
      totals.failed += 1;
    }
  }
  return totals;
}
