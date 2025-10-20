import { getConnection } from '@alga-psa/shared/db/connection';
import type { Knex } from 'knex';

export interface LicenseUsage {
  limit: number | null;
  used: number;
  remaining: number | null;
}

/**
 * Get the license usage for a tenant
 * @param tenantId - The tenant ID to check
 * @param trx - Optional transaction to use
 * @returns License usage information
 */
export async function getLicenseUsage(
  tenantId: string,
  trx?: Knex.Transaction
): Promise<LicenseUsage> {
  const knex = trx || (await getConnection());

  // Get the tenant's license limit
  const tenant = await knex('tenants')
    .where({ tenant: tenantId })
    .first('licensed_user_count');

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  // Count active  MSP (internal) users
  const usedResult = await knex('users')
    .where({
      tenant: tenantId,
      user_type: 'internal',
      is_inactive: false
    })
    .count('* as count');

  const used = parseInt(usedResult[0].count as string, 10);
  const limit = tenant.licensed_user_count;
  const remaining = limit !== null ? Math.max(0, limit - used) : null;

  return {
    limit,
    used,
    remaining,
  };
}
