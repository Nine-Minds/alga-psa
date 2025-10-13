'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';

// Returns all plan bundles for the current tenant
export async function getPlanBundles(): Promise<IPlanBundle[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = await trx<IPlanBundle>('plan_bundles')
      .where({ tenant })
      .select('*')
      .orderBy('updated_at', 'desc');
    return rows;
  });
}

// Backwards-compat alias some code expects
export const getBundlePlans = getPlanBundles;

