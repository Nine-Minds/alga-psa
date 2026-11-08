import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export class HostedPsaUpgradeAdmissionError extends Error {
  constructor(message: string) { super(message); this.name = 'HostedPsaUpgradeAdmissionError'; }
}

export interface HostedPsaUpgradeCandidate {
  tenant: string; subscriptionId: string; customerId: string; priceId: string; itemId: string;
  seats: number; validUntil: string; fingerprint: string;
}

/** Internal read after customer-admin admission. Catalog reads are limited to
 * the globally unique price FK of this tenant's own subscription. */
export async function retainHostedPsaUpgradeCandidate(trx: Knex.Transaction, tenant: string,
  proPriceIds: readonly string[]): Promise<HostedPsaUpgradeCandidate> {
  if (!trx.isTransaction || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant) || !proPriceIds.length) throw new Error('Invalid hosted PSA upgrade admission');
  if (await trx('license_state').first('id')) throw new HostedPsaUpgradeAdmissionError('A hosted subscription cannot replace self-host tenant licensing');
  const owner = tenantDb(trx, tenant);
  const candidates = await owner.table('stripe_subscriptions').where('status', 'active')
    .whereRaw("COALESCE(metadata->>'addon_key', '') = ''")
    .whereRaw("COALESCE(metadata->>'subscription_kind', '') <> 'co_managed'")
    .orderBy('stripe_subscription_id').forShare().select('stripe_subscription_id', 'stripe_subscription_external_id',
      'stripe_customer_id', 'stripe_price_id', 'stripe_subscription_item_id', 'quantity', 'status', 'current_period_end', 'metadata', 'updated_at');
  if (candidates.length !== 1) throw new HostedPsaUpgradeAdmissionError('Exactly one active customer PSA subscription is required');
  const subscription = candidates[0];
  const customer = await owner.table('stripe_customers').where('stripe_customer_id', subscription.stripe_customer_id)
    .forShare().first('stripe_customer_id', 'stripe_customer_external_id', 'updated_at');
  const price = await owner.unscoped('stripe_prices', 'resolve the global price FK of an admitted customer subscription')
    .where('stripe_price_id', subscription.stripe_price_id).forShare().first('stripe_price_id', 'stripe_price_external_id', 'updated_at');
  const seats = Number(subscription.quantity), end = new Date(subscription.current_period_end);
  const now = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
  if (!customer || !price || !proPriceIds.includes(price.stripe_price_external_id) || !subscription.stripe_subscription_item_id ||
      !Number.isSafeInteger(seats) || seats < 1 || seats > 2147483647 || !Number.isFinite(end.getTime()) || end <= now ||
      subscription.metadata?.tenant_id !== tenant) throw new HostedPsaUpgradeAdmissionError('The customer subscription is not a current PSA seat entitlement');
  return { tenant, subscriptionId: subscription.stripe_subscription_external_id, customerId: customer.stripe_customer_external_id,
    priceId: price.stripe_price_external_id, itemId: subscription.stripe_subscription_item_id, seats, validUntil: end.toISOString(),
    fingerprint: createHash('sha256').update(JSON.stringify([tenant, subscription, customer, price])).digest('hex') };
}
