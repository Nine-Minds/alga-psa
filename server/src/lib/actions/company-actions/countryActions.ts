'use server'

import { createTenantKnex } from 'server/src/lib/db';

export interface ICountry {
  code: string;
  name: string;
}

export async function getAllCountries(): Promise<ICountry[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Fetch active countries from reference table (shared across all tenants)
    const countries = await knex('countries')
      .select('code', 'name')
      .where('is_active', true)
      .orderBy('name');
    
    return countries;
  } catch (error) {
    console.error('Error fetching countries:', error);
    throw error;
  }
}