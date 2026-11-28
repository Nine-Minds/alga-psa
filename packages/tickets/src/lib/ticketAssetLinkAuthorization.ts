import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import { tenantDb } from '@alga-psa/db';
import {
  assetDenialsConcealed,
  authorizeAssetsForAction,
  createAssetReadContext,
  type AssetAuthUser,
} from '@alga-psa/authorization/assetReadAuthorization';

// NOTE: deliberately does not import `@alga-psa/assets` (it depends on this package; that would be a cycle).
const tenantScopedTable = (trx: Knex | Knex.Transaction, table: string, tenant: string) =>
  tenantDb(trx, tenant).table(table);

/**
 * The gate for linking assets to a ticket that is being created. Run inside the create transaction,
 * after the ticket insert, with the PERSISTED ticket client id. Throws (so the create rolls back) unless:
 *  - the actor is an internal user holding `asset:update`;
 *  - every asset exists in the tenant (otherwise "Invalid asset: … was not found");
 *  - every asset has a client equal to the ticket's client (a null on either side is refused);
 *  - the per-record kernel decision allows `update` on every asset. Where read denials are concealed for the
 *    actor, a denied asset answers as "not found", the same convention as the asset read path.
 * Ids are deduplicated and empties dropped; with none left this does nothing.
 * LEVERAGE: pattern ticket-asset-link-authorization — assetActions.createAssetAssociation (existing tickets) still has its own checks
 */
export async function assertTicketAssetLinksAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser & { user_type?: string },
  params: { ticketClientId: string | null | undefined; assetIds: Array<string | null | undefined> },
): Promise<void> {
  const assetIds = Array.from(new Set(params.assetIds.filter((id): id is string => Boolean(id))));
  if (assetIds.length === 0) return;

  if (user.user_type !== 'internal') {
    throw new Error('Permission denied: operation not available in client portal');
  }
  if (!await hasPermission(user as any, 'asset', 'update', trx)) {
    throw new Error('Permission denied: Cannot link assets to tickets');
  }

  const rows: Array<{ asset_id: string; client_id: string | null }> = await tenantScopedTable(trx, 'assets', tenant)
    .whereIn('asset_id', assetIds)
    .select('asset_id', 'client_id');
  const byId = new Map(rows.map((row) => [row.asset_id, row]));
  for (const assetId of assetIds) {
    if (!byId.has(assetId)) {
      throw new Error(`Invalid asset: ${assetId} was not found`);
    }
  }

  const ticketClientId = params.ticketClientId || null;
  for (const assetId of assetIds) {
    const assetClientId = byId.get(assetId)!.client_id;
    if (!ticketClientId || !assetClientId || assetClientId !== ticketClientId) {
      throw new Error(`Invalid asset: ${assetId} does not belong to the selected client`);
    }
  }

  const context = await createAssetReadContext(trx, tenant, user);
  const assets = assetIds.map((assetId) => byId.get(assetId)!);
  const decisions = await authorizeAssetsForAction(trx, tenant, context, assets, 'update');
  const denied = assets.findIndex((_, index) => !decisions[index].allowed);
  if (denied !== -1) {
    if (assetDenialsConcealed(context.subject)) {
      throw new Error(`Invalid asset: ${assets[denied].asset_id} was not found`);
    }
    throw new Error('Permission denied: Cannot link assets to tickets');
  }
}
