import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IRmaCase } from '@alga-psa/types';
import { createAssetReadContext, filterReadableAssets } from '@alga-psa/assets/lib/assetReadAuthorization';
import { isAssetTracked } from './stateMachine';

/**
 * Read gate for RMA rows. RBAC: `warranty:read` OR the legacy `inventory:read`. A caller with only the warranty
 * grant sees client-asset claims only (stock-unit RMAs are inventory data). Every row that references an asset
 * is then dropped unless the caller passes the asset's record-level read check, so a link or scan the user cannot
 * open reveals nothing — not even that the RMA exists.
 */
export async function resolveRmaReadScope(user: any): Promise<{ allowed: boolean; unitCases: boolean }> {
  const inventory = await hasPermission(user, 'inventory', 'read');
  const warranty = inventory ? true : await hasPermission(user, 'warranty', 'read');
  return { allowed: inventory || warranty, unitCases: inventory };
}

export async function filterReadableRmaCases<T extends Pick<IRmaCase, 'asset_id' | 'client_id' | 'returned_unit_id'>>(
  trx: Knex.Transaction,
  tenant: string,
  user: any,
  rows: readonly T[],
  scope: { unitCases: boolean }
): Promise<T[]> {
  const scoped = rows.filter((row) => scope.unitCases || isAssetTracked(row));
  const withAsset = scoped.filter((row) => row.asset_id);
  if (withAsset.length === 0) return [...scoped];
  const ctx = await createAssetReadContext(trx, tenant, user);
  const readable = await filterReadableAssets(
    trx, tenant, ctx,
    withAsset.map((row) => ({ asset_id: row.asset_id as string, client_id: row.client_id ?? null }))
  );
  const ok = new Set(readable.map((a) => a.asset_id));
  return scoped.filter((row) => !row.asset_id || ok.has(row.asset_id));
}
