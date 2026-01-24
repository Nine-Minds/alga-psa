'use server';

import type { ITaxRegion } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

export const getTaxRegions = withAuth(async (_user, { tenant }): Promise<ITaxRegion[]> => {
  const { knex } = await createTenantKnex();

  return knex<ITaxRegion>('tax_regions')
    .select('*')
    .where('tenant', tenant)
    .orderBy('region_name', 'asc');
});

