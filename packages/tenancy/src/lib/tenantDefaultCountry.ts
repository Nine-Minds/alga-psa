import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { COUNTRY_CODE_PLACEHOLDER } from '@alga-psa/core/formatters';

export interface TenantDefaultCountry {
  code: string;
  name: string;
}

/** The country on a client's own location, validated against the reference table. */
async function resolveLocationCountry(
  db: { table: (name: string) => Knex.QueryBuilder },
  clientId: string
): Promise<TenantDefaultCountry | null> {
  const location = await db.table('client_locations')
    .where({ client_id: clientId, is_active: true })
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

/**
 * The MSP's own default client location, used as the tenant-wide country default
 * for new records and for the date pattern every surface renders. It lives in
 * tenancy beside the tenant locale actions so every consumer — clients,
 * billing's document renderer, telephony — shares one query instead of
 * mirroring the SQL. A placeholder code ('XX') or one the reference table does
 * not carry yields null, so callers keep their own fallback instead of
 * preselecting a country the tenant never entered.
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

  return resolveLocationCountry(db, tenantClient.client_id);
}

/**
 * A specific client's own country. The client portal formats dates the way the
 * *client* writes them, not the way their MSP does, so a UK client of a US MSP
 * keeps reading 22/11/2033 in their own portal.
 */
export async function resolveClientCountry(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<TenantDefaultCountry | null> {
  if (!clientId) return null;
  return resolveLocationCountry(tenantDb(conn, tenant), clientId);
}

/** The client a portal user belongs to, via their contact. */
async function resolveUserClientId(
  conn: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string | null> {
  const db = tenantDb(conn, tenant);

  const user = await db.table('users').where({ user_id: userId }).first('contact_id');
  if (!user?.contact_id) return null;

  const contact = await db.table('contacts')
    .where({ contact_name_id: user.contact_id })
    .first('client_id');

  return contact?.client_id ?? null;
}

/**
 * Whose country decides how dates are written for this user.
 *
 * A client-portal user reads their own client's country, falling back to the
 * tenant's when that client never entered one; MSP staff always read the
 * tenant's. Null all the way down means the fixed system default applies —
 * see countryDateFormat.
 */
export async function resolveDateFormatCountry(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: { user_id: string; user_type?: string | null }
): Promise<TenantDefaultCountry | null> {
  if (user?.user_type === 'client') {
    const clientId = await resolveUserClientId(conn, tenant, user.user_id);
    if (clientId) {
      const clientCountry = await resolveClientCountry(conn, tenant, clientId);
      if (clientCountry) return clientCountry;
    }
  }

  return resolveTenantDefaultCountry(conn, tenant);
}
