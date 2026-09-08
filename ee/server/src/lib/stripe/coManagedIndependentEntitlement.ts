import Stripe from 'stripe';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type { HostedPsaUpgradeCandidate } from '@alga-psa/licensing';
import { CoManagedIndependentUpgradeError } from '@alga-psa/co-managed';
export interface HostedUpgradePrices { month?: string; year?: string }

export async function createIndependentPsaStripeReader(): Promise<Stripe> {
  const secrets = await getSecretProviderInstance();
  const key = await secrets.getAppSecret('stripe_secret_key') || process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is required for independent PSA verification');
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' as any, typescript: true });
}
const referenceId = (value: unknown): string | undefined => typeof value === 'string' ? value
  : value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : undefined;

/** Convert freshly retrieved provider objects to an independent paid entitlement.
 * These inputs are produced by the platform Stripe client, never browser data. */
export function paidPsaUpgradeFromStripe(candidate: HostedPsaUpgradeCandidate, customer: Stripe.Customer | Stripe.DeletedCustomer,
  subscription: Stripe.Subscription, prices: HostedUpgradePrices, now = new Date()) {
  const invoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;
  const item = subscription.items?.data?.[0];
  const interval = item?.price.recurring?.interval;
  const invoiceSubscription = referenceId((invoice as any)?.subscription ?? (invoice as any)?.parent?.subscription_details?.subscription);
  const period = (subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end ?? item?.current_period_end;
  const remoteEnd = typeof period === 'number' ? period * 1000 : NaN;
  const end = Math.min(remoteEnd, new Date(candidate.validUntil).getTime(),
    subscription.cancel_at ? subscription.cancel_at * 1000 : Infinity);
  if (customer.deleted || customer.id !== candidate.customerId || customer.metadata?.tenant_id !== candidate.tenant ||
      subscription.id !== candidate.subscriptionId || referenceId(subscription.customer) !== candidate.customerId ||
      subscription.metadata?.tenant_id !== candidate.tenant || subscription.metadata?.addon_key ||
      subscription.metadata?.subscription_kind === 'co_managed' || subscription.status !== 'active' || subscription.ended_at ||
      subscription.items.data.length !== 1 || !item || item.id !== candidate.itemId || item.quantity !== candidate.seats ||
      item.price.id !== candidate.priceId || (interval !== 'month' && interval !== 'year') || prices[interval] !== item.price.id ||
      item.price.recurring?.interval_count !== 1 || item.price.recurring?.usage_type !== 'licensed' ||
      !invoice || 'deleted' in invoice || invoice.status !== 'paid' || referenceId(invoice.customer) !== candidate.customerId ||
      invoiceSubscription !== candidate.subscriptionId || invoice.amount_remaining !== 0 || invoice.currency !== item.price.currency ||
      !Number.isFinite(end) || end <= now.getTime()) throw new CoManagedIndependentUpgradeError('PAID_ENTITLEMENT_REQUIRED');
  return { source: 'stripe' as const, reference: subscription.id, seats: candidate.seats, validUntil: new Date(end) };
}
