import type { Knex } from 'knex';
import type { AssetGroup } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  createAssetReadContext,
  filterAssetsAllowedForAction,
  isAssetClientReadAllowed,
  type AssetAuthUser,
} from './assetReadAuthorization';
import {
  AssetGroupError,
  listGroupMemberIds,
  lockAssetGroupForMutation,
} from './assetGroups';

/** Authorize the group's client even when no member assets will be changed. */
export async function lockAndAuthorizeAssetGroupClient(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  groupId: string
): Promise<AssetGroup> {
  const group = await lockAssetGroupForMutation(trx, tenant, groupId);
  await assertAssetGroupAssetsUpdatable(trx, tenant, user, group.client_id, []);
  return group;
}

/** Authorize the stable member set while holding the group's mutation lock. */
export async function lockAndAuthorizeAssetGroupMembers(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  groupId: string
): Promise<string[]> {
  const group = await lockAssetGroupForMutation(trx, tenant, groupId);
  const memberIds = await listGroupMemberIds(trx, tenant, groupId);
  await assertAssetGroupAssetsUpdatable(trx, tenant, user, group.client_id, memberIds);
  return memberIds;
}

/** Authorize every asset a group mutation may change before the mutation writes anything. */
export async function assertAssetGroupAssetsUpdatable(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  clientId: string,
  assetIds: readonly string[]
): Promise<void> {
  const context = await createAssetReadContext(trx, tenant, user);
  if (!await isAssetClientReadAllowed(trx, context, clientId)) {
    throw new AssetGroupError(
      'permission_denied',
      `Permission denied: Cannot update asset group for client ${clientId}`,
      { clientId }
    );
  }
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;

  const assets = await tenantDb(trx, tenant)
    .table('assets')
    .whereIn('asset_id', ids)
    .select<Array<{ asset_id: string; client_id: string }>>('asset_id', 'client_id');
  const foundIds = new Set(assets.map((asset) => asset.asset_id));
  const missingIds = ids.filter((assetId) => !foundIds.has(assetId));
  if (missingIds.length) {
    throw new AssetGroupError('not_found', 'Asset not found', { assetIds: missingIds });
  }

  const allowed = await filterAssetsAllowedForAction(trx, tenant, context, assets, 'update');
  const allowedIds = new Set(allowed.map((asset) => asset.asset_id));
  const deniedIds = ids.filter((assetId) => !allowedIds.has(assetId));
  if (deniedIds.length) {
    throw new AssetGroupError(
      'permission_denied',
      `Permission denied: Cannot update assets ${deniedIds.join(', ')}`,
      { assetIds: deniedIds }
    );
  }
}

/**
 * Removing a missing or stale member is an existing no-op/cleanup behavior. Authorize only when the
 * requested group membership points at a real asset whose record is part of the mutation boundary.
 */
export async function assertAssetGroupMemberUpdatableIfPresent(
  trx: Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  groupId: string,
  assetId: string
): Promise<void> {
  const group = await lockAndAuthorizeAssetGroupClient(trx, tenant, user, groupId);
  const db = tenantDb(trx, tenant);
  const membership = await db.table('asset_group_members').where({ group_id: groupId, asset_id: assetId }).first('asset_id');
  if (!membership) return;

  const asset = await db.table('assets').where({ asset_id: assetId }).first('asset_id');
  if (!asset) return;

  await assertAssetGroupAssetsUpdatable(trx, tenant, user, group.client_id, [assetId]);
}
