import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { countCoManagedCommittedSeats, resolveSelfHostTier, verifyLicense, retainHostedPsaUpgradeCandidate, HostedPsaUpgradeAdmissionError } from '@alga-psa/licensing';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';

/** Advisory customer-owned screen. It grants no authority to the worker and
 * remains readable through license lapse and explicit departure. */
export async function getCoManagedIndependentUpgradeScreen(db: Knex, input: CoManagedSessionActor,
  hostedPriceIds: readonly string[] = []) {
  const actor = snapshotCoManagedSessionActor(input);
  return withTransaction(db, async trx => {
    const own = tenantDb(trx, actor.tenant);
    const owner = await own.table('tenants').forShare().first('product_code');
    await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedSharedWorkError();
    await assertCoManagedSessionUnexpired(trx, actor);
    const previous = await own.table('co_managed_independent_upgrades').first('operation_id');
    if (owner?.product_code === 'psa' && previous) {
      await assertCoManagedSessionUnexpired(trx, actor);
      return { state: 'completed' as const, operationId: previous.operation_id as string };
    }
    if (owner?.product_code !== 'co_managed') throw new CoManagedSharedWorkError();
    const relationship = await own.table('co_management_relationships').whereIn('state', ['active', 'terminated']).first('relationship_id', 'revision', 'state');
    if (!relationship) throw new CoManagedSharedWorkError();
    const seatsRequired = Math.max(1, await countCoManagedCommittedSeats(trx, actor.tenant));
    const selfHosted = Boolean(await trx('license_state').first('id'));
    let entitlementReady = false, paidSeats: number | null = null;
    if (selfHosted) {
      const license = await own.table('tenant_license_state').first('license_token');
      const resolved = resolveSelfHostTier({ edition_choice: 'ee', trial_started_at: null,
        license_scope: 'tenant', license_token: license?.license_token ?? null }, actor.tenant);
      const signed = license?.license_token ? verifyLicense(license.license_token) : null;
      entitlementReady = resolved?.state === 'licensed' && resolved.tier === 'pro' && signed?.valid === true &&
        (signed.claims.seats === undefined || signed.claims.seats >= seatsRequired);
    } else if (hostedPriceIds.length) {
      try { paidSeats = (await retainHostedPsaUpgradeCandidate(trx, actor.tenant, hostedPriceIds)).seats; entitlementReady = paidSeats >= seatsRequired; }
      catch (error) { if (!(error instanceof HostedPsaUpgradeAdmissionError)) throw error; }
    }
    const pending = selfHosted ? undefined : await own.table('co_managed_upgrade_purchases').whereIn('state', ['preparing', 'checkout', 'payment_failed'])
      .first('operation_id', 'quantity', 'billing_interval', 'state');
    const pendingPurchase = pending ? { operationId: pending.operation_id as string, quantity: Number(pending.quantity),
      interval: pending.billing_interval as 'month' | 'year', paymentFailed: pending.state === 'payment_failed' } : null;
    const hasOwnBilling = !selfHosted && Boolean(await own.table('stripe_customers').first('stripe_customer_id'));
    if (pending?.state === 'payment_failed') entitlementReady = false;
    await assertCoManagedSessionUnexpired(trx, actor);
    return { state: 'eligible' as const, relationshipId: relationship.relationship_id as string,
      revision: Number(relationship.revision), departed: relationship.state === 'terminated', selfHosted, seatsRequired, entitlementReady, pendingPurchase, hasOwnBilling, paidSeats };
  });
}
