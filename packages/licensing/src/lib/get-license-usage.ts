import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface LicenseUsage {
  limit: number | null;
  used: number;
  remaining: number | null;
}

/**
 * Get the license usage for a tenant.
 */
export async function getLicenseUsage(
  tenantId: string,
  trx?: Knex.Transaction
): Promise<LicenseUsage> {
  const knex = trx || (await createTenantKnex(tenantId)).knex;
  const db = tenantDb(knex, tenantId);

  const tenant = await db.table('tenants')
    .first('licensed_user_count');

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const usedResult = await db.table('users')
    .where({
      user_type: 'internal',
      is_inactive: false
    })
    .count('* as count');

  const used = parseInt((usedResult as Array<{ count: string }>)[0].count, 10);
  const limit = tenant.licensed_user_count;
  const remaining = limit !== null ? Math.max(0, limit - used) : null;

  return {
    limit,
    used,
    remaining,
  };
}
