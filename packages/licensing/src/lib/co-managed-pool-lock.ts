import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Stable sponsor capacity lock. Unlike a row lock, this serializes pool writers before the
 * entitlement row exists (notably during a zero-capacity hosted trial). */
export async function lockCoManagedSponsorPool(trx: Knex.Transaction, sponsorTenant: string) {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['co_managed_sponsor_pool', sponsorTenant]);
  return tenantDb(trx, sponsorTenant).table('co_managed_entitlements').forUpdate().first();
}
