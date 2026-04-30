'use server';

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { Asset, IUserWithRoles } from '@alga-psa/types';

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

async function resolveClientId(
  trx: Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
): Promise<string> {
  if (user.user_type !== 'client') {
    throw new Error('Unauthorized: Invalid user type for client portal');
  }
  if (!user.contact_id) {
    throw new Error('Unauthorized: Contact information not found');
  }

  const contact = await trx('contacts')
    .where({ contact_name_id: user.contact_id, tenant })
    .select('client_id')
    .first();

  if (!contact) {
    throw new Error('Unauthorized: Client information not found');
  }
  return contact.client_id as string;
}

/**
 * Server-side paginated, searchable, filterable list of client-visible assets.
 */
export const listClientAssets = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  params: ListClientAssetsParams = {},
): Promise<ListClientAssetsResponse> => {
  const { knex } = await createTenantKnex();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
  const sortField = SORT_FIELDS[params.sort_by ?? 'updated_at'];
  const sortDirection = params.sort_direction === 'asc' ? 'asc' : 'desc';

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolveClientId(trx, user, tenant);

    const baseQuery = () => {
      const q = trx('assets').where({ tenant, client_id: clientId });
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
    // the entire client (so the summary tiles don't drift when the user paginates
    // or filters the table).
    const [filteredCount, statusCounts, typeRows] = await Promise.all([
      baseQuery().count<{ count: string }>('asset_id as count').first(),
      trx('assets')
        .where({ tenant, client_id: clientId })
        .select(
          trx.raw(`SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END)::int as inactive`),
          trx.raw(`SUM(CASE WHEN status <> 'inactive' OR status IS NULL THEN 1 ELSE 0 END)::int as active`),
        )
        .first<{ active: number | null; inactive: number | null }>(),
      trx('assets')
        .where({ tenant, client_id: clientId })
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
});

/** Backwards-compatible: returns all assets for small previews (dashboard widget). */
export const getClientAssets = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
): Promise<Asset[]> => {
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolveClientId(trx, user, tenant);
    const assets = await trx('assets')
      .where({ tenant, client_id: clientId })
      .orderBy('updated_at', 'desc');
    return assets.map(serializeAsset);
  });
});

/**
 * Returns a single asset by id, scoped to the requester's client.
 * Returns null if the asset doesn't exist or doesn't belong to this client —
 * the caller (e.g. ticket-details linked-asset pill) should treat that as
 * "asset no longer available".
 */
export const getClientAssetById = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  assetId: string,
): Promise<Asset | null> => {
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const clientId = await resolveClientId(trx, user, tenant);
    const row = await trx('assets')
      .where({ tenant, client_id: clientId, asset_id: assetId })
      .first();
    return row ? serializeAsset(row) : null;
  });
});
