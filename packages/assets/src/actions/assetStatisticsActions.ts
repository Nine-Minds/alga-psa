'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { validateData } from '@alga-psa/validation';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { assetTypeCountSchema } from '../lib/schemas/asset.schema';
import {
  applyAssetListFilters,
  joinAssetListRelations,
  type AssetListFilterParams,
} from '../lib/assetListFilters';

/** Filters the by-type breakdown respects. See `assetTypeCountSchema`. */
export type AssetTypeCountParams = AssetListFilterParams;

/**
 * F313: asset counts keyed by asset_type slug (built-in or custom registry
 * slug). Label resolution happens on the client via the registry so the
 * dashboard breakdown can show registry names.
 *
 * The counts are a **facet** of the asset dashboard: they reflect every active
 * list filter *except* `asset_type` itself, so selecting a bubble never zeroes
 * out the others. Passing the filters the grid uses makes each bubble answer
 * "how many of this type match what I'm looking at"; passing nothing keeps the
 * original tenant-wide totals.
 *
 * Like the previous tenant-wide version, this counts rows the caller may read
 * at the table level (`asset:read`) and does not apply the grid's per-record
 * co-management authorization — a bubble is a coarse indicator; the grid stays
 * the authoritative access-filtered view.
 */
export const getAssetCountsByType = withAuth(async (
  user,
  { tenant },
  params: AssetTypeCountParams = {},
): Promise<Record<string, number> | ActionPermissionError> => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }

  const validatedParams = validateData(assetTypeCountSchema, params ?? {});

  const rows = await withTransaction(knex, async (trx) => {
    // The search predicate reads clients.client_name, so the count query needs
    // the same left joins the list builds — another reason both share one
    // builder. Left joins keep unassigned assets, so an unfiltered count still
    // matches the old tenant-wide totals exactly.
    const query = joinAssetListRelations(trx, tenant);
    applyAssetListFilters(query, { trx, tenant, params: validatedParams, exclude: 'asset_type' });

    return query
      .groupBy('assets.asset_type')
      .select('assets.asset_type')
      .count<Array<{ asset_type: string | null; count: string | number }>>('assets.asset_id as count');
  });

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.asset_type ?? 'unknown'] = Number(row.count);
    return acc;
  }, {});
});
