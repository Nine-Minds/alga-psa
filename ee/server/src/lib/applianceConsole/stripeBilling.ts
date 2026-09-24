/**
 * Read-only Stripe view for the Appliance Console Licensing tab.
 *
 * Appliance subscriptions are created by nm-store checkout, so they are not in
 * the master tenant's `stripe_subscriptions` table; this reads Stripe directly
 * by subscription id and puts the answer next to the C4 entitlement so drift
 * (seats, active-vs-cancelled) is visible to operators.
 */

import Stripe from 'stripe';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

export interface ApplianceBillingView {
  subscription_id: string;
  status: string;
  current_period_end: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  pause_collection: { behavior: string; resumes_at: number | null } | null;
  seat_quantity: number | null;
  per_seat_item_id: string | null;
  price_id: string | null;
  interval: 'month' | 'year' | null;
  customer_id: string | null;
  dashboard_subscription_url: string;
  dashboard_customer_url: string | null;
  livemode: boolean;
}

export interface ApplianceBillingDrift {
  seats_mismatch: boolean;
  status_mismatch: boolean;
}

export interface ApplianceBillingResponse {
  billing: ApplianceBillingView | null;
  entitlement_seats: number | null;
  drift: ApplianceBillingDrift;
}

let stripeClient: Stripe | null = null;

async function getStripe(): Promise<Stripe> {
  if (stripeClient) return stripeClient;
  const secretProvider = await getSecretProviderInstance();
  let secretKey = await secretProvider.getAppSecret('stripe_secret_key');
  if (!secretKey && process.env.STRIPE_SECRET_KEY) secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not found in secrets or environment');
  stripeClient = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' as any, typescript: true });
  return stripeClient;
}

/** All configured appliance per-seat price ids (both editions × intervals), as nm-store defines them. */
export function appliancePerSeatPriceIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const ids = new Set<string>();
  for (const edition of ['PRO', 'PREMIUM']) {
    for (const interval of ['MONTHLY', 'YEARLY']) {
      const id = env[`STRIPE_PRICE_ID_APPLIANCE_${edition}_USER_${interval}`];
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** Locate the per-seat line on the subscription (the one whose quantity is seats). */
export function findPerSeatItem(
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): Stripe.SubscriptionItem | null {
  const perSeatIds = appliancePerSeatPriceIds(env);
  const byPrice = sub.items.data.find((i) => perSeatIds.has(i.price.id));
  if (byPrice) return byPrice;
  return sub.items.data.length === 1 ? sub.items.data[0] : null;
}

export function dashboardUrl(livemode: boolean, path: string): string {
  return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}${path}`;
}

export function toBillingView(sub: Stripe.Subscription, env: NodeJS.ProcessEnv = process.env): ApplianceBillingView {
  const item = findPerSeatItem(sub, env);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const interval = item?.price?.recurring?.interval;
  return {
    subscription_id: sub.id,
    status: sub.status,
    current_period_end: (sub as any).current_period_end ?? item?.current_period_end ?? null,
    cancel_at: sub.cancel_at ?? null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    pause_collection: sub.pause_collection
      ? { behavior: sub.pause_collection.behavior, resumes_at: sub.pause_collection.resumes_at ?? null }
      : null,
    seat_quantity: item?.quantity ?? null,
    per_seat_item_id: item?.id ?? null,
    price_id: item?.price?.id ?? null,
    interval: interval === 'month' || interval === 'year' ? interval : null,
    customer_id: customerId,
    dashboard_subscription_url: dashboardUrl(sub.livemode, `subscriptions/${sub.id}`),
    dashboard_customer_url: customerId ? dashboardUrl(sub.livemode, `customers/${customerId}`) : null,
    livemode: sub.livemode,
  };
}

/** Pure: does the Stripe view disagree with what C4 licenses? */
export function computeDrift(
  billing: ApplianceBillingView | null,
  entitlement: { seats: number | null; active: boolean } | null,
): ApplianceBillingDrift {
  if (!billing || !entitlement) return { seats_mismatch: false, status_mismatch: false };
  const seatsMismatch =
    billing.seat_quantity != null && entitlement.seats != null && billing.seat_quantity !== entitlement.seats;
  const stripeLive = billing.status === 'active' || billing.status === 'trialing' || billing.status === 'past_due';
  return { seats_mismatch: seatsMismatch, status_mismatch: stripeLive !== entitlement.active };
}

/** Fetch the subscription behind a C4 entitlement and compare it. */
export async function getApplianceBilling(
  stripeSubId: string,
  entitlement: { seats: number | null; active: boolean },
): Promise<ApplianceBillingResponse> {
  const stripe = await getStripe();
  const sub = await stripe.subscriptions.retrieve(stripeSubId);
  const billing = toBillingView(sub);
  return { billing, entitlement_seats: entitlement.seats, drift: computeDrift(billing, entitlement) };
}
