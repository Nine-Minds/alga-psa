'use server'

import { createTenantKnex } from '@alga-psa/db';

export interface ICountry {
  code: string;
  name: string;
  phone_code?: string;
  flag_emoji?: string;
}

export async function getAllCountries(): Promise<ICountry[]> {
  // Countries are global reference data (not tenant-scoped).
  const { knex } = await createTenantKnex(null);

  try {
    // Fetch active countries from reference table (shared across all tenants)
    const countries = await knex('countries')
      .select('code', 'name', 'phone_code')
      .where('is_active', true)
      .orderBy('name');
    
    return countries;
  } catch (error) {
    console.error('Error fetching countries:', error);
    throw error;
  }
}
