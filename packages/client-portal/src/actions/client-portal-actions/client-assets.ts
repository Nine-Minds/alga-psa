'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal asset actions intentionally compose asset feature APIs for client-facing read views. */

import { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { Asset, AssetStatus, AssetStatusKind, IUserWithRoles } from '@alga-psa/types';
import { isClientUserType } from '@alga-psa/types';
import { applyAssetVisibilityFilter, type ContactVisibilityContext } from '@alga-psa/authorization/portal/visibility';
import {
  assetStatusKindForSlug,
  assetStatusLabelForSlug,
  listAssetStatusRows,
} from '@alga-psa/assets/lib/assetStatusRegistry';
import {
  getAssetGroupSummariesForAssets,
  getAssetGroupSummary,
} from '@alga-psa/assets/lib/assetGroups';
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
  /** A status slug from `by_status` (FR-B5); undefined => every status. */
  status?: string;
  sort_by?: ClientAssetSortField;
  sort_direction?: 'asc' | 'desc';
}

/** One status the client's visible devices are actually in (FR-B5). */
export interface ClientAssetStatusSummary {
  slug: string;
  /** The tenant's label for the slug; the portal still localizes the builtins. */
  label: string;
  kind: AssetStatusKind;
  count: number;
}

export interface ListClientAssetsResponse {
  assets: Asset[];
  total: number;
  /**
   * Statuses in use across the entire client with their counts, in registry
   * order. Feeds the status filter and the banner, which reads "active" as the
   * `deployable` kind rather than as "anything but inactive".
   */
  by_status: ClientAssetStatusSummary[];
  /** Per-type counts across the entire client (not bound to the current page). */
  by_type: Record<ClientAssetType, number>;
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

// Qualified: row reads join `contacts`, which carries its own `updated_at`.
const SORT_FIELDS: Record<ClientAssetSortField, string> = {
  name: 'assets.name',
  asset_type: 'assets.asset_type',
  status: 'assets.status',
  updated_at: 'assets.updated_at',
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
  if (!isClientUserType(user.user_type)) {
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
    // FR-E7 / FR-E7b: a shared-workspace member is visible to its users.
    sharedWorkspace: { assetIdColumn: 'assets.asset_id', tenantColumn: 'assets.tenant' },
  });
}

/**
 * What a client user may see of a device.
 *
 * An allow-list rather than `assets.*`: the MSP's commercial columns —
 * purchase cost and currency, supplier, order number, billing profile — sit on
 * the same row, and `select *` shipped every one of them to the browser. Add a
 * column here only when the portal is meant to show it.
 */
const PORTAL_ASSET_COLUMNS = [
  'assets.asset_id',
  'assets.tenant',
  'assets.client_id',
  'assets.asset_type',
  'assets.asset_tag',
  'assets.serial_number',
  'assets.name',
  'assets.status',
  'assets.location_id',
  'assets.location',
  'assets.purchase_date',
  'assets.warranty_end_date',
  'assets.created_at',
  'assets.updated_at',
] as const;

/**
 * FR-C6: the portal names the person a device is assigned to, and `assets`
 * stores only the contact id — so every row read joins `contacts`. Counts never
 * need the join, which is why it lives here and not in `scopedAssets`.
 */
function withAssigneeName(
  trx: Knex.Transaction,
  tenant: string,
  query: Knex.QueryBuilder,
): Knex.QueryBuilder {
  tenantDb(trx, tenant).tenantJoin(
    query,
    'contacts',
    'contacts.contact_name_id',
    'assets.contact_name_id',
    { type: 'left' },
  );
  return query.select(...PORTAL_ASSET_COLUMNS, 'contacts.full_name as contact_name');
}

/**
 * FR-E7b: a shared-workspace member reads as its workspace rather than as one
 * person, so the group summary travels with every asset the portal returns.
 */
async function serializeWithGroups(
  trx: Knex.Transaction,
  tenant: string,
  rows: Array<Asset & Record<string, unknown>>,
): Promise<Asset[]> {
  const summaries = await getAssetGroupSummariesForAssets(
    trx,
    tenant,
    rows.map((row) => row.asset_id),
  );
  return rows.map((row) => ({
    ...serializeAsset(row),
    group: summaries.get(row.asset_id) ?? null,
  }));
}

/**
 * The statuses the client's devices are in, in the tenant's display order, with
 * a row's own label and kind resolved from the registry. Only statuses actually
 * in use are returned: the filter then offers exactly the statuses a portal
 * user can find, and the tenant's wider taxonomy stays the MSP's business.
 */
function buildStatusSummary(
  statusRows: AssetStatus[],
  counts: Array<{ status: string | null; count: string | number }>,
): ClientAssetStatusSummary[] {
  const countBySlug = new Map<string, number>();
  for (const row of counts) {
    const slug = String(row.status ?? '').trim();
    if (!slug) continue;
    countBySlug.set(slug, (countBySlug.get(slug) ?? 0) + Number(row.count ?? 0));
  }

  const summaries: ClientAssetStatusSummary[] = statusRows
    .filter((row) => countBySlug.has(row.slug))
    .map((row) => ({
      slug: row.slug,
      label: row.label,
      kind: row.kind,
      count: countBySlug.get(row.slug) ?? 0,
    }));

  // A slug no registry row claims still has to read as something.
  for (const [slug, count] of countBySlug) {
    if (summaries.some((summary) => summary.slug === slug)) continue;
    summaries.push({
      slug,
      label: assetStatusLabelForSlug(slug, statusRows),
      kind: assetStatusKindForSlug(slug, statusRows),
      count,
    });
  }

  return summaries;
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
        if (params.status) q.where('status', params.status);
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

    // Counts: filtered total, plus per-status and per-type counts across
    // everything this user may see (so the summary tiles don't drift when the
    // user paginates or filters the table, and always match the list).
    const [filteredCount, statusRows, statusCounts, typeRows] = await Promise.all([
      baseQuery().count<{ count: string }>('asset_id as count').first(),
      // Archived statuses included: a device can still be sitting on one.
      listAssetStatusRows(trx, tenant, { includeArchived: true }),
      scopedAssets(trx, tenant, visibility)
        .groupBy('status')
        .select<Array<{ status: string | null; count: string }>>(
          'status',
          trx.raw('count(*) as count'),
        ),
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
    const rows = await withAssigneeName(trx, tenant, baseQuery())
      .orderBy(sortField, sortDirection)
      .limit(limit)
      .offset(offset);

      return {
        assets: await serializeWithGroups(trx, tenant, rows),
        total: Number(filteredCount?.count ?? 0),
        by_status: buildStatusSummary(statusRows, statusCounts),
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
      const assets = await withAssigneeName(trx, tenant, scopedAssets(trx, tenant, visibility))
        .orderBy('assets.updated_at', 'desc');
      return serializeWithGroups(trx, tenant, assets);
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
      const row = await withAssigneeName(trx, tenant, scopedAssets(trx, tenant, visibility))
        .where('assets.asset_id', assetId)
        .first();
      if (!row) return null;
      return {
        ...serializeAsset(row),
        group: await getAssetGroupSummary(trx, tenant, assetId),
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
