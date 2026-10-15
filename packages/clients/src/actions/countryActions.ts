'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import {
  countryDateFormat,
  SYSTEM_DATE_FORMAT,
  type CountryDateFormat,
} from '@alga-psa/core/i18n/countryDateFormat';
import {
  resolveClientCountry,
  resolveDateFormatCountry,
  resolveTenantDefaultCountry,
} from '@alga-psa/tenancy/lib/tenantDefaultCountry';

export interface ICountry {
  code: string;
  name: string;
  phone_code?: string;
  flag_emoji?: string;
}

/** Everything a client's country decides, for the Settings → General preview. */
export interface IClientCountryDefaultsPreview {
  country: ICountry | null;
  dateFormat: CountryDateFormat;
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
 * What picking a given client as "your company" would settle: the country new
 * client, contact and location forms preselect, the dial code that comes with
 * it, and the date shape every MSP surface then renders.
 *
 * Settings → General asks this for the current default and for the one being
 * considered, so an admin can see the change before confirming it — the date
 * format has no setting of its own, it follows this country.
 */
export const getClientCountryDefaultsPreview = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientCountryDefaultsPreview> => {
  const { knex } = await createTenantKnex();

  try {
    const resolved = await resolveClientCountry(knex, tenant, clientId);
    if (!resolved) {
      return { country: null, dateFormat: countryDateFormat(null) };
    }

    // resolveClientCountry answers code and name; the dial code lives on the
    // same reference row.
    const reference = await tenantDb(knex, tenant).table<ICountry>('countries')
      .where({ code: resolved.code })
      .first('code', 'name', 'phone_code');

    return {
      country: {
        code: resolved.code,
        name: resolved.name,
        phone_code: reference?.phone_code ?? undefined,
      },
      dateFormat: countryDateFormat(resolved.code),
    };
  } catch (error) {
    console.error('Error resolving client country defaults preview:', error);
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
