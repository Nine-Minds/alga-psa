'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { Asset, IUserWithRoles } from '@alga-psa/types';
import { applyAssetVisibilityFilter, type ContactVisibilityContext } from '@alga-psa/authorization/portal/visibility';
import { getClientContactVisibilityContext } from './visibilityResolver';
import { clientPortalActionErrorFrom, type ClientPortalActionError } from './clientPortalActionErrors';

export type ClientAssetType =
  | 'workstation'
  | 'network_device'
  | 'server'
  | 'mobile_device'
  | 'printer'
  | 'unknown';

export type ClientAssetSortField = 'name' | 'asset_type' | 'status' | 'updated_at';

export interface ListClientAssetsParams {
  page?: number;
  limit?: number;
  search?: string;
  asset_type?: ClientAssetType;
  /** "active" => status != 'inactive', "inactive" => status == 'inactive', undefined => all */
  status?: 'active' | 'inactive';
  sort_by?: ClientAssetSortField;
  sort_direction?: 'asc' | 'desc';
}

export interface ListClientAssetsResponse {
  assets: Asset[];
  total: number;
  active: number;
  inactive: number;
  /** Per-type counts across the entire client (not bound to the current page). */
  by_type: Record<ClientAssetType, number>;
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const SORT_FIELDS: Record<ClientAssetSortField, string> = {
  name: 'name',
  asset_type: 'asset_type',
  status: 'status',
  updated_at: 'updated_at',
};

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function serializeAsset(asset: Asset & Record<string, unknown>): Asset {
  const toIso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : (v as string | undefined);
  return {
    ...asset,
    created_at: toIso(asset.created_at) as string,
    updated_at: toIso(asset.updated_at) as string,
    purchase_date: toIso(asset.purchase_date) as string | undefined,
    warranty_end_date: toIso(asset.warranty_end_date) as string | undefined,
  };
}

/**
 * The portal user's visibility context. Assets are scoped by the group's
 * `asset_scope` (client-wide, or only devices assigned to the contact and
 * their reports), so every read below goes through `scopedAssets`.
 */
async function resolveAssetVisibility(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
): Promise<ContactVisibilityContext> {
  if (user.user_type !== 'client') {
    throw new Error('Unauthorized: Invalid user type for client portal');
  }
  if (!user.contact_id) {
    throw new Error('Unauthorized: Contact information not found');
  }
  return getClientContactVisibilityContext(trx, tenant, user.contact_id);
}

/** Assets of the user's client, narrowed by their asset scope. The only way this module reads `assets`. */
function scopedAssets(
  trx: Knex.Transaction,
  tenant: string,
  visibility: ContactVisibilityContext,
): Knex.QueryBuilder {
  return applyAssetVisibilityFilter(tenantScopedTable(trx, 'assets', tenant), visibility, {
    clientColumn: 'assets.client_id',
    contactColumn: 'assets.contact_name_id',
  });
}

/**
 * Server-side paginated, searchable, filterable list of client-visible assets.
 */
export const listClientAssets = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  params: ListClientAssetsParams = {},
): Promise<ListClientAssetsResponse | ClientPortalActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const sortField = SORT_FIELDS[params.sort_by ?? 'updated_at'];
    const sortDirection = params.sort_direction === 'asc' ? 'asc' : 'desc';

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const visibility = await resolveAssetVisibility(trx, user, tenant);

      const baseQuery = () => {
        const q = scopedAssets(trx, tenant, visibility);
        if (params.asset_type) q.where('asset_type', params.asset_type);
        if (params.status === 'active') q.whereNot('status', 'inactive');
        if (params.status === 'inactive') q.where('status', 'inactive');
        if (params.search) {
          const term = `%${params.search.trim().toLowerCase()}%`;
          q.where((b) => {
            b.whereRaw('LOWER(name) LIKE ?', [term])
              .orWhereRaw('LOWER(asset_tag) LIKE ?', [term])
              .orWhereRaw('LOWER(serial_number) LIKE ?', [term]);
          });
        }
        return q;
      };

    // Counts: filtered total, plus active/inactive and per-type counts across
    // everything this user may see (so the summary tiles don't drift when the
    // user paginates or filters the table, and always match the list).
    const [filteredCount, statusCounts, typeRows] = await Promise.all([
      baseQuery().count<{ count: string }>('asset_id as count').first(),
      scopedAssets(trx, tenant, visibility)
        .select(
          trx.raw(`SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END)::int as inactive`),
          trx.raw(`SUM(CASE WHEN status <> 'inactive' OR status IS NULL THEN 1 ELSE 0 END)::int as active`),
        )
        .first<{ active: number | null; inactive: number | null }>(),
      scopedAssets(trx, tenant, visibility)
        .groupBy('asset_type')
        .select<Array<{ asset_type: string | null; count: string }>>(
          'asset_type',
          trx.raw('count(*) as count'),
        ),
    ]);

    const byType: Record<ClientAssetType, number> = {
      workstation: 0,
      network_device: 0,
      server: 0,
      mobile_device: 0,
      printer: 0,
      unknown: 0,
    };
    for (const row of typeRows) {
      const key = (row.asset_type ?? 'unknown') as ClientAssetType;
      if (key in byType) {
        byType[key] += Number(row.count ?? 0);
      } else {
        // Unknown / non-enum asset_type values bucket into 'unknown'.
        byType.unknown += Number(row.count ?? 0);
      }
    }

    const offset = (page - 1) * limit;
    const rows = await baseQuery()
      .orderBy(sortField, sortDirection)
      .limit(limit)
      .offset(offset);

      return {
        assets: rows.map(serializeAsset),
        total: Number(filteredCount?.count ?? 0),
        active: Number(statusCounts?.active ?? 0),
        inactive: Number(statusCounts?.inactive ?? 0),
        by_type: byType,
        page,
        limit,
      };
    });
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/** Backwards-compatible: returns all assets for small previews (dashboard widget). */
export const getClientAssets = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
): Promise<Asset[] | ClientPortalActionError> => {
  try {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const visibility = await resolveAssetVisibility(trx, user, tenant);
      const assets = await scopedAssets(trx, tenant, visibility)
        .orderBy('updated_at', 'desc');
      return assets.map(serializeAsset);
    });
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Returns a single asset by id, scoped to what the requester may see.
 * Returns null if the asset doesn't exist or isn't visible to this user —
 * the caller (e.g. ticket-details linked-asset pill) should treat that as
 * "asset no longer available".
 */
export const getClientAssetById = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  assetId: string,
): Promise<Asset | null | ClientPortalActionError> => {
  try {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const visibility = await resolveAssetVisibility(trx, user, tenant);
      const row = await scopedAssets(trx, tenant, visibility)
        .where('assets.asset_id', assetId)
        .first();
      return row ? serializeAsset(row) : null;
    });
  } catch (error) {
    const expected = clientPortalActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
