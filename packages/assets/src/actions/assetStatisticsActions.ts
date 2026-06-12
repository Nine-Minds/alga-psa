'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

/**
 * F313: tenant-wide asset counts keyed by asset_type slug (built-in or
 * custom registry slug). Label resolution happens on the client via the
 * registry so the dashboard breakdown can show registry names.
 */
export const getAssetCountsByType = withAuth(async (user, { tenant }): Promise<Record<string, number>> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'read')) {
    throw new Error('Permission denied: Cannot read assets');
  }

  const rows = await knex('assets')
    .where({ tenant })
    .groupBy('asset_type')
    .select('asset_type')
    .count<Array<{ asset_type: string | null; count: string | number }>>('asset_id as count');

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.asset_type ?? 'unknown'] = Number(row.count);
    return acc;
  }, {});
});
