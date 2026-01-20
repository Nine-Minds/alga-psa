'use server';

import type { ITaxRegion } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';

export async function getTaxRegions(): Promise<ITaxRegion[]> {
  const { knex, tenant } = await createTenantKnex();

  return knex<ITaxRegion>('tax_regions')
    .select('*')
    .where('tenant', tenant)
    .orderBy('region_name', 'asc');
}

