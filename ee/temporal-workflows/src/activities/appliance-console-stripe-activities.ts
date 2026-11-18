/**
 * Stripe activities for Appliance Console "billed" actions.
 *
 * Appliance subscriptions are shaped by nm-store checkout: an optional flat
 * base line plus a per-seat line whose price id is one of
 * STRIPE_PRICE_ID_APPLIANCE_PRO_USER_{MONTHLY,YEARLY}. Pro is the only paid
 * tier and is per-seat only. These activities change the per-seat line; C4 is updated afterwards by
 * the workflow so licensing never runs ahead of billing.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import Stripe from 'stripe';
import { createWorkerStripeClient } from '../config/stripeClient';

const logger = () => Context.current().log;

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw ApplicationFailure.nonRetryable('STRIPE_SECRET_KEY is not configured in the temporal worker', 'stripe_not_configured');
  }
  stripeClient = createWorkerStripeClient(secretKey);
  return stripeClient;
}

export type ApplianceInterval = 'month' | 'year';

/** nm-store's env naming for appliance per-seat prices. */
export function appliancePerSeatPriceId(interval: ApplianceInterval, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = `STRIPE_PRICE_ID_APPLIANCE_PRO_USER_${interval === 'year' ? 'YEARLY' : 'MONTHLY'}`;
  return env[key] || null;
}

export function appliancePerSeatPriceIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const ids = new Set<string>();
  for (const interval of ['month', 'year'] as const) {
    const id = appliancePerSeatPriceId(interval, env);
    if (id) ids.add(id);
  }
  return ids;
}

/** The per-seat line: matched by price id, else the only line on a single-line sub. */
export function findPerSeatItem(sub: Stripe.Subscription, env: NodeJS.ProcessEnv = process.env): Stripe.SubscriptionItem | null {
  const ids = appliancePerSeatPriceIds(env);
  const byPrice = sub.items.data.find((i) => ids.has(i.price.id));
  if (byPrice) return byPrice;
  return sub.items.data.length === 1 ? sub.items.data[0] : null;
}

function requirePerSeatItem(sub: Stripe.Subscription): Stripe.SubscriptionItem {
  const item = findPerSeatItem(sub);
  if (!item) {
    throw ApplicationFailure.nonRetryable(
      `Subscription ${sub.id} has no recognisable per-seat line (set STRIPE_PRICE_ID_APPLIANCE_*_USER_* on the worker)`,
      'no_per_seat_item',
    );
  }
  return item;
}

function guardActive(sub: Stripe.Subscription): void {
  if (sub.status !== 'active' && sub.status !== 'trialing' && sub.status !== 'past_due') {
    throw ApplicationFailure.nonRetryable(`Subscription ${sub.id} is ${sub.status}; billing changes need an active subscription`, 'subscription_not_active');
  }
}

export interface StripeUpdateSeatQuantityInput {
  stripeSubId: string;
  seats: number;
}

/**
 * How a seat change was billed. One rule for every surface that changes
 * appliance seats (customer portal in nm-store, this console), matching the
 * hosted seat-change rule in alga-psa StripeService:
 *   - charged_now: increase on a live subscription — the prorated amount is
 *     invoiced and collected immediately; a failed charge rejects the change
 *   - trial: any change while trialing — in place, no charge
 *   - credited_next_invoice: decrease — the unused remainder is credited on
 *     the next invoice
 *   - unchanged: same count, Stripe not touched
 */
export type SeatChangeBilling = 'charged_now' | 'trial' | 'credited_next_invoice' | 'unchanged';

export interface StripeSeatChangeResult {
  stripeSubId: string;
  itemId: string;
  priceId: string;
  seats: number;
  billing: SeatChangeBilling;
}

export interface SeatChangePlan {
  billing: SeatChangeBilling;
  params: Pick<Stripe.SubscriptionUpdateParams, 'proration_behavior' | 'payment_behavior'>;
}

/** Pure billing decision for a seat change. */
export function planSeatChange(status: Stripe.Subscription.Status, current: number, next: number): SeatChangePlan {
  if (next === current) return { billing: 'unchanged', params: {} };
  if (status === 'trialing') return { billing: 'trial', params: { proration_behavior: 'none' } };
  if (next > current) {
    return {
      billing: 'charged_now',
      params: { proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' },
    };
  }
  return { billing: 'credited_next_invoice', params: { proration_behavior: 'create_prorations' } };
}

function isPaymentFailure(err: unknown): err is { type?: string; code?: string; decline_code?: string } {
  const e = err as { type?: string; code?: string; decline_code?: string } | null;
  return !!e && (e.type === 'StripeCardError' || !!e.decline_code || /^(invoice_)?payment_intent_/.test(e.code ?? ''));
}

/** Change the per-seat quantity, billed per `planSeatChange`. */
export async function stripeUpdateSeatQuantity(input: StripeUpdateSeatQuantityInput): Promise<StripeSeatChangeResult> {
  const stripe = getStripe();
  logger().info('stripeUpdateSeatQuantity', { stripeSubId: input.stripeSubId, seats: input.seats });
  const sub = await stripe.subscriptions.retrieve(input.stripeSubId);
  guardActive(sub);
  const item = requirePerSeatItem(sub);
  const plan = planSeatChange(sub.status, item.quantity ?? 0, input.seats);
  if (plan.billing === 'unchanged') {
    return { stripeSubId: sub.id, itemId: item.id, priceId: item.price.id, seats: input.seats, billing: plan.billing };
  }
  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, quantity: input.seats }],
      ...plan.params,
    });
  } catch (err) {
    // error_if_incomplete: the immediate charge failed and Stripe rolled the
    // update back. Not retryable — the payment method has to change first.
    if (isPaymentFailure(err)) {
      throw ApplicationFailure.nonRetryable(
        `Payment for the added seats failed (${err.code ?? err.decline_code ?? 'card error'}); Stripe left the subscription unchanged`,
        'seat_payment_failed',
      );
    }
    throw err;
  }
  const after = findPerSeatItem(updated) ?? item;
  return { stripeSubId: updated.id, itemId: after.id, priceId: after.price.id, seats: after.quantity ?? input.seats, billing: plan.billing };
}

export type PauseCollectionBehavior = 'void' | 'keep_as_draft' | 'mark_uncollectible';

export interface StripePauseCollectionInput {
  stripeSubId: string;
  behavior: PauseCollectionBehavior;
  /** Unix seconds; omitted = indefinite. */
  resumesAt?: number | null;
}

export interface StripePauseCollectionResult {
  stripeSubId: string;
  paused: boolean;
  behavior: PauseCollectionBehavior | null;
  resumesAt: number | null;
}

/** Pause payment collection: the subscription stays active and the license keeps rolling. */
export async function stripePauseCollection(input: StripePauseCollectionInput): Promise<StripePauseCollectionResult> {
  const stripe = getStripe();
  logger().info('stripePauseCollection', { stripeSubId: input.stripeSubId, behavior: input.behavior, resumesAt: input.resumesAt });
  const updated = await stripe.subscriptions.update(input.stripeSubId, {
    pause_collection: {
      behavior: input.behavior,
      ...(input.resumesAt ? { resumes_at: input.resumesAt } : {}),
    },
  });
  return {
    stripeSubId: updated.id,
    paused: !!updated.pause_collection,
    behavior: (updated.pause_collection?.behavior as PauseCollectionBehavior | undefined) ?? null,
    resumesAt: updated.pause_collection?.resumes_at ?? null,
  };
}

/** Resume payment collection (draft invoices, if any, are left for the operator to finalise). */
export async function stripeResumeCollection(input: { stripeSubId: string }): Promise<StripePauseCollectionResult> {
  const stripe = getStripe();
  logger().info('stripeResumeCollection', { stripeSubId: input.stripeSubId });
  const updated = await stripe.subscriptions.update(input.stripeSubId, { pause_collection: '' });
  return {
    stripeSubId: updated.id,
    paused: !!updated.pause_collection,
    behavior: null,
    resumesAt: null,
  };
}
