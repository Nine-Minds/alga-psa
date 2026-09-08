import Stripe from 'stripe';
import type { Knex } from 'knex';
import { retainHostedPsaUpgradeCandidate, type HostedPsaUpgradeCandidate } from '@alga-psa/licensing';
import { prepareCoManagedIndependentUpgrade, upgradeCoManagedRelationship, snapshotCoManagedSessionActor,
  CoManagedIndependentUpgradeError, type CoManagedSessionActor, type CoManagedPolicyTarget,
  type CoManagedIndependentUpgradeRequest } from '@alga-psa/co-managed';
import { backfillPsaSeeds, applyRbacDelta, backfillClientTaxDefaults, ensureSlaParity } from './product-upgrade-operations.js';
import type { SeedRunLog } from './onboarding-seeds-operations.js';

export interface HostedUpgradeStripeReader {
  customers: { retrieve(id: string): Promise<Stripe.Customer | Stripe.DeletedCustomer> };
  subscriptions: { retrieve(id: string, options: { expand: string[] }): Promise<Stripe.Subscription> };
}
export interface HostedUpgradePrices { month?: string; year?: string }
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

function runtimeStripeReader(): HostedUpgradeStripeReader {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is required for hosted PSA upgrade verification');
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' as any, typescript: true });
}

/** Provider reads happen after authenticated preparation and outside database
 * transactions. Completion rechecks the same records and actual session; retries
 * of a completed command do not contact Stripe or re-run setup/closure. */
export async function upgradeCoManagedWorkspaceWithHostedSubscription(db: Knex, inputActor: CoManagedSessionActor,
  inputTarget: CoManagedPolicyTarget, input: CoManagedIndependentUpgradeRequest, log: SeedRunLog,
  dependencies: { stripe?: HostedUpgradeStripeReader; prices?: HostedUpgradePrices } = {}) {
  if (db.isTransaction) throw new Error('Hosted upgrade provider reads require a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor), target = { ...inputTarget }, request = { ...input };
  const prices = { ...(dependencies.prices ?? { month: process.env.STRIPE_ALGAPSA_USER_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID,
    year: process.env.STRIPE_ALGAPSA_USER_ANNUAL_PRICE_ID || process.env.STRIPE_PRO_ANNUAL_PRICE_ID }) };
  const ids = Object.values(prices).filter((id): id is string => typeof id === 'string' && Boolean(id));
  const prepared = await prepareCoManagedIndependentUpgrade(db, actor, target, request,
    (trx, tenant) => retainHostedPsaUpgradeCandidate(trx, tenant, ids));
  if (prepared.kind === 'completed') return prepared.receipt;
  const candidate = prepared.value, stripe = dependencies.stripe ?? runtimeStripeReader();
  const [customer, subscription] = await Promise.all([
    stripe.customers.retrieve(candidate.customerId), stripe.subscriptions.retrieve(candidate.subscriptionId, { expand: ['latest_invoice'] }),
  ]);
  const paid = paidPsaUpgradeFromStripe(candidate, customer, subscription, prices);
  return upgradeCoManagedRelationship(db, actor, target, request, async (trx, tenant) => {
    const current = await retainHostedPsaUpgradeCandidate(trx, tenant, ids);
    if (current.fingerprint !== candidate.fingerprint) throw new CoManagedIndependentUpgradeError('UPGRADE_CHANGED');
    // LEVERAGE: pattern independent-psa-backfills — both paid adapters retain the same PSA setup sequence.
    await backfillPsaSeeds(tenant, log, trx);
    await applyRbacDelta(tenant, log, trx);
    await backfillClientTaxDefaults(tenant, log, trx);
    await ensureSlaParity(tenant, log, trx);
    return paid;
  });
}
