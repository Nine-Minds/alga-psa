'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { queryProductAvailability } from '../lib/availability';
import type { ProductAvailability } from '../lib/integrationTypes';

export type { ProductAvailability, ProductLocationAvailability } from '../lib/integrationTypes';

/**
 * Batch availability for tracked products (F005). Untracked products come back with
 * track_stock=false and zeroed totals so callers can render "not tracked" states.
 * Soft gate: callers without inventory:read get [] (advisory UI renders nothing).
 */
export const getProductAvailability = withAuth(async (
  user,
  { tenant },
  serviceIds: string[]
): Promise<ProductAvailability[]> => {
  if (!serviceIds?.length) return [];
  if (!(await hasPermission(user, 'inventory', 'read'))) return [];

  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) =>
    queryProductAvailability(trx, tenant, serviceIds),
  );
});
