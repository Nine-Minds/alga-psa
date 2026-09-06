import type Stripe from 'stripe';
import type { HostedCoManagedSnapshot } from '@alga-psa/licensing';

export const CO_MANAGED_SUBSCRIPTION_KIND = 'co_managed';
export const CO_MANAGED_MONTHLY_SEAT_CENTS = 1149;

export function isCoManagedSubscription(subscription: Stripe.Subscription, priceId?: string): boolean {
  return subscription.metadata?.subscription_kind === CO_MANAGED_SUBSCRIPTION_KIND ||
    Boolean(priceId && subscription.items?.data.some((item) => item.price.id === priceId));
}

function customerId(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
}

function billingPeriodEnd(subscription: Stripe.Subscription): number {
  // The platform's pinned Stripe API exposes the subscription-level field;
  // newer SDK/API versions expose periods on each subscription item instead.
  const legacy = (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  if (typeof legacy === 'number') return legacy * 1000;
  if (!subscription.items.data.length) return NaN;
  return Math.min(...subscription.items.data.map((item) => item.current_period_end * 1000));
}

export function assertCoManagedPrice(price: Stripe.Price, priceId: string): void {
  if (!priceId || price.id !== priceId || price.currency !== 'usd' ||
      price.unit_amount !== CO_MANAGED_MONTHLY_SEAT_CENTS || price.recurring?.interval !== 'month' ||
      price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed') {
    throw new Error('Co-managed seats require the configured USD monthly licensed price');
  }
}

export function currentProSubscriptionExpiry(subscriptions: Stripe.Subscription[], customer: string,
  proPriceIds: string[], coManagedPriceId: string, now = new Date()): Date | null {
  const base = subscriptions.filter((candidate) =>
    customerId(candidate) === customer && !isCoManagedSubscription(candidate, coManagedPriceId) && !candidate.metadata?.addon_key &&
    ['active', 'trialing'].includes(candidate.status) &&
    candidate.items.data.some((item) => proPriceIds.includes(item.price.id)) && billingPeriodEnd(candidate) > now.getTime());
  return base.length ? new Date(Math.max(...base.map(billingPeriodEnd))) : null;
}

/** Converts live Stripe data to capacity after validating its owner and SKU.
 * The caller obtains this data with the platform Stripe credential, never from
 * browser fields or a webhook's potentially stale embedded subscription. */
export function coManagedSnapshotFromStripe(input: {
  subscription: Stripe.Subscription;
  baseSubscriptions: Stripe.Subscription[];
  sponsorTenant: string;
  customerId: string;
  coManagedPriceId: string;
  proPriceIds: string[];
  now?: Date;
}): HostedCoManagedSnapshot {
  const { subscription, sponsorTenant } = input;
  const now = input.now ?? new Date();
  if (!input.coManagedPriceId || customerId(subscription) !== input.customerId ||
      subscription.metadata?.tenant_id !== sponsorTenant ||
      subscription.metadata?.subscription_kind !== CO_MANAGED_SUBSCRIPTION_KIND ||
      subscription.items.data.length !== 1) {
    throw new Error('Co-managed subscription owner or SKU does not match');
  }
  const item = subscription.items.data[0];
  const price = item.price;
  assertCoManagedPrice(price, input.coManagedPriceId);
  if (!Number.isSafeInteger(item.quantity) || (item.quantity ?? 0) < 1) {
    throw new Error('Co-managed seats require the configured USD monthly licensed price');
  }
  const baseExpiry = currentProSubscriptionExpiry(input.baseSubscriptions, input.customerId, input.proPriceIds, input.coManagedPriceId, now);
  const latestInvoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;
  const paid = latestInvoice && !('deleted' in latestInvoice) && latestInvoice.status === 'paid';
  const active = subscription.status === 'active' && Boolean(paid) && baseExpiry !== null;
  const periodEnd = billingPeriodEnd(subscription);
  if (!Number.isFinite(periodEnd)) throw new Error('Co-managed subscription has no valid billing period');
  return {
    capacity: item.quantity!, active,
    validUntil: new Date(Math.min(periodEnd, baseExpiry?.getTime() ?? now.getTime())),
    ...(subscription.ended_at ? { lapseSince: new Date(subscription.ended_at * 1000) } : {}),
  };
}
