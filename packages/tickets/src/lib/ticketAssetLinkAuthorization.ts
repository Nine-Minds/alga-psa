import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  authorizeAssetsForAction,
  createAssetReadContext,
  type AssetAuthUser,
} from '@alga-psa/authorization/assetReadAuthorization';

// NOTE: deliberately does not import `@alga-psa/assets` (it depends on this package; that would be a cycle).
const tenantScopedTable = (trx: Knex | Knex.Transaction, table: string, tenant: string) =>
  tenantDb(trx, tenant).table(table);

/**
 * The record-level gate for linking assets to a ticket that is being created. Run inside the create transaction,
 * after the ticket insert, with the PERSISTED ticket client id. Throws (so the create rolls back) unless:
 *  - every asset exists in the tenant and the actor may READ it at record level (same rule as
 *    assetActions.linkAssetToTicket). Missing and unreadable assets both answer "Invalid asset: <id> was not found",
 *    and this runs first so a denied asset never confirms its existence through the client check;
 *  - every asset has a client equal to the ticket's client (a null or empty ticket client, or asset client, is refused).
 * Ids are deduplicated and empties dropped; with none left this does nothing.
 * Coarse gates (internal-only, `asset:update`) belong to the call sites, which differ.
 * LEVERAGE: pattern ticket-asset-link-authorization — assetActions.createAssetAssociation (existing tickets) still has its own checks
 */
export async function assertTicketAssetLinksAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  params: { ticketClientId: string | null | undefined; assetIds: Array<string | null | undefined> },
): Promise<void> {
  const assetIds = Array.from(new Set(params.assetIds.filter((id): id is string => Boolean(id))));
  if (assetIds.length === 0) return;

  const rows: Array<{ asset_id: string; client_id: string | null }> = await tenantScopedTable(trx, 'assets', tenant)
    .whereIn('asset_id', assetIds)
    .select('asset_id', 'client_id');
  const byId = new Map(rows.map((row) => [row.asset_id, row]));
  const assets = assetIds.map((assetId) => byId.get(assetId));
  const missing = assetIds.find((assetId) => !byId.has(assetId));
  if (missing) {
    throw new Error(`Invalid asset: ${missing} was not found`);
  }

  const found = assets as Array<{ asset_id: string; client_id: string | null }>;
  const context = await createAssetReadContext(trx, tenant, user);
  const decisions = await authorizeAssetsForAction(trx, tenant, context, found, 'read');
  const denied = found.findIndex((_, index) => !decisions[index].allowed);
  if (denied !== -1) {
    throw new Error(`Invalid asset: ${found[denied].asset_id} was not found`);
  }

  const ticketClientId = params.ticketClientId || null;
  for (const asset of found) {
    if (!ticketClientId || !asset.client_id || asset.client_id !== ticketClientId) {
      throw new Error(`Invalid asset: ${asset.asset_id} does not belong to the selected client`);
    }
  }
}
