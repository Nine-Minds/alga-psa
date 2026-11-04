import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  createAssetReadContext,
  filterAssetsAllowedForAction,
  type AssetAuthUser,
} from './assetReadAuthorization';
import { AssetGroupError } from './assetGroups';

/** Authorize every asset a group mutation may change before the mutation writes anything. */
export async function assertAssetGroupAssetsUpdatable(
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  assetIds: readonly string[]
): Promise<void> {
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

  const context = await createAssetReadContext(trx, tenant, user);
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
  trx: Knex | Knex.Transaction,
  tenant: string,
  user: AssetAuthUser,
  groupId: string,
  assetId: string
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const membership = await db.table('asset_group_members').where({ group_id: groupId, asset_id: assetId }).first('asset_id');
  if (!membership) return;

  const asset = await db.table('assets').where({ asset_id: assetId }).first('asset_id');
  if (!asset) return;

  await assertAssetGroupAssetsUpdatable(trx, tenant, user, [assetId]);
}
