import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * FR-F2: the billing profile a ticket raised from an asset belongs to.
 *
 * The asset's own profile wins; otherwise the location's default, which is
 * where an MSP that bills per site has already said what it wants. Returning
 * null means "no opinion" — `TicketModel.resolveTicketBillingProfileId` then
 * falls through to the client default as it always has.
 *
 * In `shared/` because the alert ticket creator (workflow worker) needs it as
 * well as the MSP, portal and mobile ticket-from-asset surfaces.
 */
export async function resolveAssetBillingProfileId(
  conn: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<string | null> {
  const db = tenantDb(conn, tenant);

  const asset = await (db.table('assets') as Knex.QueryBuilder<any, any>)
    .where({ asset_id: assetId })
    .first<{ billing_profile_id?: string | null; location_id?: string | null }>(
      'billing_profile_id',
      'location_id'
    );
  if (!asset) return null;
  if (asset.billing_profile_id) return String(asset.billing_profile_id);
  if (!asset.location_id) return null;

  const location = await (db.table('client_locations') as Knex.QueryBuilder<any, any>)
    .where({ location_id: asset.location_id })
    .first<{ default_billing_profile_id?: string | null }>('default_billing_profile_id');

  return location?.default_billing_profile_id ? String(location.default_billing_profile_id) : null;
}

/**
 * FR-F3 for the surfaces that create a ticket *with* an asset rather than
 * *from* one (QuickAddTicket on the asset header, asset list, service history,
 * maintenance): the same inheritance, but the ticket's client is picked by the
 * user and may no longer be the asset's, so a profile that does not belong to
 * it is dropped instead of raising. Ticket creation is never blocked by billing
 * attribution.
 */
export async function resolveAssetBillingProfileIdForClient(
  conn: Knex | Knex.Transaction,
  tenant: string,
  assetId: string,
  clientId: string
): Promise<string | null> {
  const candidate = await resolveAssetBillingProfileId(conn, tenant, assetId);
  if (!candidate) return null;
  try {
    return await assertBillingProfileForClient(conn, tenant, clientId, candidate);
  } catch {
    return null;
  }
}

/**
 * FR-F1: the profile must belong to the row's client and be active. Returns
 * the id when valid, throws otherwise; `null` clears and is always allowed.
 */
export async function assertBillingProfileForClient(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  billingProfileId: string | null
): Promise<string | null> {
  if (!billingProfileId) return null;

  const profile = await (db(conn, tenant).table('client_billing_profiles') as Knex.QueryBuilder<any, any>)
    .where({ billing_profile_id: billingProfileId, client_id: clientId })
    .first<{ billing_profile_id: string; is_active?: boolean | null }>('billing_profile_id', 'is_active');

  if (!profile || profile.is_active === false) {
    throw new Error(ASSET_BILLING_PROFILE_UNAVAILABLE);
  }
  return String(profile.billing_profile_id);
}

export const ASSET_BILLING_PROFILE_UNAVAILABLE = 'Selected billing profile is not available for this client';

function db(conn: Knex | Knex.Transaction, tenant: string) {
  return tenantDb(conn, tenant);
}
