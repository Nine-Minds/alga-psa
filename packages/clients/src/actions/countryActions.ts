'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { resolveTenantDefaultCountry } from '../lib/tenantDefaultCountry';

export interface ICountry {
  code: string;
  name: string;
  phone_code?: string;
  flag_emoji?: string;
}

export const getAllCountries = withAuth(async (
  _user,
  { tenant }
): Promise<ICountry[]> => {
  // Countries are global reference data (not tenant-scoped).
  const { knex } = await createTenantKnex(null);

  try {
    // Fetch active countries from reference table (shared across all tenants)
    const countries = await tenantDb(knex, tenant).table<ICountry>('countries')
      .select('code', 'name', 'phone_code')
      .where('is_active', true)
      .orderBy('name');

    return countries;
  } catch (error) {
    console.error('Error fetching countries:', error);
    throw error;
  }
});

/**
 * The tenant's own country, for preselecting country fields on new records.
 * Null when the MSP's default client carries no usable country, so forms keep
 * their existing default.
 */
export const getTenantDefaultCountry = withAuth(async (
  _user,
  { tenant }
): Promise<ICountry | null> => {
  const { knex } = await createTenantKnex();

  try {
    return await resolveTenantDefaultCountry(knex, tenant);
  } catch (error) {
    console.error('Error resolving tenant default country:', error);
    throw error;
  }
});
