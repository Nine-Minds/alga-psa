import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface CompletedSyncUserCountProjection {
  tenantId: string;
  managedTenantId: string;
  status: string;
  isDryRun?: boolean;
  eligibleUserCount?: number;
}

/**
 * Replace the count projection only when a real tenant sync completed.
 *
 * Failed runs and previews deliberately leave the last successful observation
 * intact. `undefined` means no complete directory observation; zero is valid.
 */
export async function projectCompletedSyncUserCount(
  knex: Knex,
  input: CompletedSyncUserCountProjection
): Promise<boolean> {
  if (
    input.status !== 'completed' ||
    input.isDryRun ||
    input.eligibleUserCount === undefined
  ) {
    return false;
  }

  if (!Number.isInteger(input.eligibleUserCount) || input.eligibleUserCount < 0) {
    throw new Error(
      `Completed Entra sync for ${input.managedTenantId} returned an invalid eligible-user count.`
    );
  }

  const now = knex.fn.now();
  const updated = await tenantDb(knex, input.tenantId).table('entra_managed_tenants')
    .where({
      managed_tenant_id: input.managedTenantId,
    })
    .update({
      last_successful_sync_user_count: input.eligibleUserCount,
      last_successful_sync_at: now,
      updated_at: now,
    });

  if (updated !== 1) {
    throw new Error(
      `Completed Entra sync could not update managed tenant ${input.managedTenantId}.`
    );
  }

  return true;
}
