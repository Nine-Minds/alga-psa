import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { createAssetReadContext, isAssetActionAllowed, isAssetReadAllowed } from '@alga-psa/authorization/assetReadAuthorization';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

/** Authorize an asset association mutation while its owning transaction is still open. */
export async function authorizeAssetAssociationWrite(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  assetId: string,
): Promise<ActionPermissionError | null> {
  const asset = await tenantDb(trx, tenant).table('assets')
    .where({ asset_id: assetId })
    .select('asset_id', 'client_id')
    .first() as { asset_id: string; client_id?: string | null } | undefined;

  if (!asset) {
    return permissionError('Asset not found');
  }

  const context = await createAssetReadContext(trx, tenant, user);
  if (!await isAssetReadAllowed(trx, tenant, context, asset)) {
    // Conceal unreadable assets in the same way as a missing asset.
    return permissionError('Asset not found');
  }
  if (!await isAssetActionAllowed(trx, tenant, context, asset, 'update')) {
    return permissionError('Permission denied: Cannot update assets');
  }
  return null;
}
