'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import {
  countryDateFormat,
  SYSTEM_DATE_FORMAT,
  type CountryDateFormat,
} from '@alga-psa/core/i18n/countryDateFormat';
import { resolveDateFormatCountry, resolveTenantDefaultCountry } from '@alga-psa/tenancy/lib/tenantDefaultCountry';

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

/**
 * How dates are written for the caller: digit order, separator and clock.
 *
 * Layouts hand this to the DateFormatProvider and the mobile capabilities
 * endpoint returns it verbatim, so every surface agrees. Resolution failures
 * answer the fixed system default rather than throwing — a formatting
 * preference must never be able to fail a page render.
 */
export const getDateFormatPreference = withAuth(async (
  user,
  { tenant }
): Promise<CountryDateFormat> => {
  try {
    const { knex } = await createTenantKnex();
    const country = await resolveDateFormatCountry(knex, tenant, user);
    return countryDateFormat(country?.code ?? null);
  } catch (error) {
    console.error('Error resolving date format country:', error);
    return SYSTEM_DATE_FORMAT;
  }
});
