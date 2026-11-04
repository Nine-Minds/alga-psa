import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  createAssetReadContext,
  isAssetActionAllowed,
  type AssetAuthUser,
} from './assetReadAuthorization';

type GroupScope = { client_id: string; group_id: string };
type AssetScope = { asset_id: string; client_id: string | null };

/**
 * Authorize a group as one record: its client and every member must be in scope.
 * A mixed-scope group is denied as a whole so neither its existence nor its
 * accessible subset can be used to reveal the restricted members.
 */
export async function isAssetGroupOperationAllowed(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  input: {
    action: 'read' | 'update';
    groupId?: string;
    clientId?: string;
    assetIds?: readonly string[];
  }
): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  let group: GroupScope | undefined;
  let clientId = input.clientId;

  if (input.groupId) {
    group = await db.table('asset_groups')
      .where({ group_id: input.groupId })
      .first<GroupScope>('group_id', 'client_id');
    if (!group) return false;
    clientId = group.client_id;
  }
  if (!clientId) return false;

  // Verify the caller-supplied client is tenant-local before using it as the
  // record scope for a group that does not exist yet.
  const client = await db.table('clients').where({ client_id: clientId }).first('client_id');
  if (!client) return false;

  const memberIds = group
    ? await db.table('asset_group_members').where({ group_id: group.group_id }).pluck('asset_id') as string[]
    : [];
  const allAssetIds = Array.from(new Set([...memberIds, ...(input.assetIds ?? [])]));
  let assets: AssetScope[] = [];
  if (allAssetIds.length > 0) {
    assets = await db.table('assets')
      .whereIn('asset_id', allAssetIds)
      .select<AssetScope[]>('asset_id', 'client_id');
    // Unknown IDs and assets from another client are rejected before writes.
    if (assets.length !== allAssetIds.length || assets.some((asset) => asset.client_id !== clientId)) return false;
  }

  const context = await createAssetReadContext(trx, tenant, user);
  const can = (asset: { asset_id: string; client_id: string | null }) =>
    isAssetActionAllowed(trx, tenant, context, asset, input.action);
  const canRead = (asset: { asset_id: string; client_id: string | null }) =>
    isAssetActionAllowed(trx, tenant, context, asset, 'read');

  // The synthetic subject makes client scope explicit even for empty groups.
  const clientScope = { asset_id: `asset-group-client:${clientId}`, client_id: clientId };
  if (!(await canRead(clientScope)) || (input.action !== 'read' && !(await can(clientScope)))) return false;
  for (const asset of assets) {
    if (!(await canRead(asset)) || (input.action !== 'read' && !(await can(asset)))) return false;
  }
  return true;
}
