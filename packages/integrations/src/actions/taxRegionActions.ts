'use server';

import type { ITaxRegion } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

export const getTaxRegions = withAuth(async (_user, { tenant }): Promise<ITaxRegion[]> => {
  const { knex } = await createTenantKnex();

  return tenantDb(knex, tenant).table<ITaxRegion>('tax_regions')
    .select('*')
    .orderBy('region_name', 'asc');
});
