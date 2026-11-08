import type Stripe from 'stripe';
import type { Knex } from 'knex';
import { retainHostedPsaUpgradeCandidate } from '@alga-psa/licensing';
import { prepareCoManagedIndependentUpgrade, upgradeCoManagedRelationship, snapshotCoManagedSessionActor,
  CoManagedIndependentUpgradeError, type CoManagedSessionActor, type CoManagedPolicyTarget,
  type CoManagedIndependentUpgradeRequest } from '@alga-psa/co-managed';
import { initializeIndependentPsa } from './product-upgrade-operations.js';
import type { SeedRunLog } from './onboarding-seeds-operations.js';

export interface HostedUpgradeStripeReader {
  customers: { retrieve(id: string): Promise<Stripe.Customer | Stripe.DeletedCustomer> };
  subscriptions: { retrieve(id: string, options: { expand: string[] }): Promise<Stripe.Subscription> };
}
export interface HostedUpgradePrices { month?: string; year?: string }
import { paidPsaUpgradeFromStripe, createIndependentPsaStripeReader } from '@ee/lib/stripe/coManagedIndependentEntitlement.js';
export { paidPsaUpgradeFromStripe } from '@ee/lib/stripe/coManagedIndependentEntitlement.js';

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
  const candidate = prepared.value, stripe = dependencies.stripe ?? await createIndependentPsaStripeReader();
  const [customer, subscription] = await Promise.all([
    stripe.customers.retrieve(candidate.customerId), stripe.subscriptions.retrieve(candidate.subscriptionId, { expand: ['latest_invoice'] }),
  ]);
  const paid = paidPsaUpgradeFromStripe(candidate, customer, subscription, prices);
  return upgradeCoManagedRelationship(db, actor, target, request, async (trx, tenant) => {
    const current = await retainHostedPsaUpgradeCandidate(trx, tenant, ids);
    if (current.fingerprint !== candidate.fingerprint) throw new CoManagedIndependentUpgradeError('UPGRADE_CHANGED');
    await initializeIndependentPsa(tenant, log, trx);
    return paid;
  });
}
