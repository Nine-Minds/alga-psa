import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface SeatTrialSponsorEligibility {
  eligible: boolean;
  baseUntil: Date | null;
  reason: 'SPONSOR_NOT_ELIGIBLE' | null;
}

/**
 * The one rule for whether a sponsor can start a Seat trial: a hosted Pro PSA workspace on a
 * non-manual, non-suspended plan whose trial base is still running, and whose co-managed pool (when
 * it has one) is hosted. Both the trial offer and `prepareCoManagedSeatTrial` ask this, so the invite
 * button is never shown to a sponsor prepare would refuse. Prepare calls it inside its transaction.
 */
export async function readSeatTrialSponsorEligibility(db: Knex, tenant: string): Promise<SeatTrialSponsorEligibility> {
  const sponsor = tenantDb(db, tenant);
  const owner = await sponsor.table('tenants').first('product_code', 'plan', 'billing_source', 'suspended_at');
  const entitlement = await sponsor.table('co_managed_entitlements').first('source');
  const base = await sponsor.table('co_managed_trial_sponsors').where('base_until', '>', db.fn.now()).first('base_until');
  const eligible = Boolean(base) && owner?.product_code === 'psa' && owner.plan === 'pro' &&
    owner.billing_source !== 'manual' && !owner.suspended_at && !(entitlement && entitlement.source !== 'hosted');
  return { eligible, baseUntil: base?.base_until ?? null, reason: eligible ? null : 'SPONSOR_NOT_ELIGIBLE' };
}
