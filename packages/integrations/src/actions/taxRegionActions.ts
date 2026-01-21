'use server';

import type { ITaxRegion } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

export async function getTaxRegions(): Promise<ITaxRegion[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('Unauthorized');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);

  return knex<ITaxRegion>('tax_regions')
    .select('*')
    .where('tenant', tenant)
    .orderBy('region_name', 'asc');
}

