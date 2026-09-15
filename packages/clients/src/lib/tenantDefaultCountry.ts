import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { COUNTRY_CODE_PLACEHOLDER } from '@alga-psa/core/formatters';

export interface TenantDefaultCountry {
  code: string;
  name: string;
}

/**
 * The MSP's own default client location, used as the tenant-wide country default
 * for new records. Mirrors resolveTenantPhoneCountryCode (telephony) rather than
 * importing it. A placeholder code ('XX') or one the reference table does not
 * carry yields null, so callers keep their own fallback instead of preselecting
 * a country the tenant never entered.
 */
export async function resolveTenantDefaultCountry(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<TenantDefaultCountry | null> {
  const db = tenantDb(conn, tenant);

  const tenantClient = await db.table('tenant_companies')
    .where({ is_default: true, deleted_at: null })
    .first('client_id');
  if (!tenantClient?.client_id) {
    return null;
  }

  const location = await db.table('client_locations')
    .where({ client_id: tenantClient.client_id, is_active: true })
    .orderBy('is_default', 'desc')
    .orderBy('is_billing_address', 'desc')
    .first('country_code');

  const code = typeof location?.country_code === 'string'
    ? location.country_code.trim().toUpperCase()
    : '';
  if (!code || code === COUNTRY_CODE_PLACEHOLDER) {
    return null;
  }

  const country = await db.table('countries')
    .where({ code, is_active: true })
    .first('code', 'name');

  return country ? { code: country.code, name: country.name } : null;
}
