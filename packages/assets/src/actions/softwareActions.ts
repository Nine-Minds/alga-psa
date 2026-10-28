'use server';

/**
 * Software Inventory Actions
 *
 * Server actions for querying software inventory using the normalized tables.
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.4
 */

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  AssetSoftwareDisplayItem,
  AssetSoftwareListResponse,
  AssetSoftwareQueryParams,
  SoftwareSearchParams,
  SoftwareSearchResult,
  SoftwareSearchResponse,
  AssetSoftwareSummary,
  SoftwareCategory,
  SoftwareType,
  UpdateSoftwareCatalogRequest,
  ClientSoftwareSummaryParams,
  ClientSoftwareSummaryResponse,
  ClientSoftwareSummaryRow,
  CLIENT_SOFTWARE_PAGE_SIZE,
  CLIENT_SOFTWARE_ASSET_PREVIEW_LIMIT,
} from '@alga-psa/types';
import type { Knex } from 'knex';
import { assetActionErrorFrom, type AssetActionError } from './assetActionErrors';

function tenantScopedTable(knex: Knex, tenant: string, table: string): Knex.QueryBuilder<any, any> {
  return tenantDb(knex, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

/** ILIKE pattern that matches `term` literally (escapes %, _ and \\). */
function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * Get software installed on an asset. Requires asset:read.
 * Uses the normalized asset_software table with software_catalog join — the
 * same source as the client-level software view, so its drill lands on matching rows.
 */
export const getAssetSoftware = withAuth(async (
  user,
  { tenant },
  params: AssetSoftwareQueryParams
): Promise<AssetSoftwareListResponse | AssetActionError> => {
  const { knex } = await createTenantKnex();

  const {
    asset_id,
    include_uninstalled = false,
    category,
    software_type,
    search,
    page = 1,
    limit = 50,
  } = params;

  try {
    if (!await hasPermission(user, 'asset', 'read')) {
      throw new Error('Permission denied: Cannot read assets');
    }

    // Base query using the view for convenience
    let query = tenantScopedTable(knex, tenant, 'v_asset_software_details')
      .where('asset_id', asset_id);

    // Filter by current status
    if (!include_uninstalled) {
      query = query.where('is_current', true);
    }

    // Filter by category
    if (category) {
      query = query.where('category', category);
    }

    // Filter by software type
    if (software_type) {
      query = query.where('software_type', software_type);
    }

    // Search filter
    const term = search?.trim();
    if (term) {
      const pattern = containsPattern(term);
      query = query.where(function() {
        this.whereILike('software_name', pattern)
          .orWhereILike('publisher', pattern);
      });
    }

    // Get total count
    const countResult = await query.clone().count('* as count').first();
    const total = parseInt(String(countResult?.count || 0), 10);

    // Get paginated results
    const offset = (page - 1) * limit;
    const rows = await query
      .select(
        'software_id',
        'software_name as name',
        'publisher',
        'category',
        'software_type',
        'version',
        'install_date',
        'size_bytes',
        'first_seen_at',
        'is_current',
        'is_managed',
        'is_security_relevant'
      )
      .orderBy('software_name')
      .limit(limit)
      .offset(offset);

    const software: AssetSoftwareDisplayItem[] = rows.map((row: any) => ({
      software_id: row.software_id,
      name: row.name,
      publisher: row.publisher,
      category: row.category as SoftwareCategory,
      software_type: row.software_type as SoftwareType,
      version: row.version,
      install_date: row.install_date,
      size_bytes: row.size_bytes,
      first_seen_at: row.first_seen_at,
      is_current: row.is_current,
      is_managed: row.is_managed,
      is_security_relevant: row.is_security_relevant,
    }));

    return {
      software,
      total,
      page,
      limit,
    };
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error getting asset software:', error);
    throw error;
  }
});

/**
 * Get software summary statistics for an asset
 */
export const getAssetSoftwareSummary = withAuth(async (user, { tenant }, assetId: string): Promise<AssetSoftwareSummary | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    if (!await hasPermission(user, 'asset', 'read')) {
      throw new Error('Permission denied: Cannot read assets');
    }

    const baseQuery = () => tenantScopedTable(knex, tenant, 'v_asset_software_details')
      .where('asset_id', assetId)
      .where('is_current', true);

    // Total installed
    const totalResult = await baseQuery().count('* as count').first();
    const total_installed = parseInt(String(totalResult?.count || 0), 10);

    // By category
    const categoryStats = await baseQuery()
      .select('category')
      .count('* as count')
      .groupBy('category');

    const by_category: Record<string, number> = {};
    for (const row of categoryStats) {
      by_category[row.category || 'Uncategorized'] = parseInt(String(row.count), 10);
    }

    // By type
    const typeStats = await baseQuery()
      .select('software_type')
      .count('* as count')
      .groupBy('software_type');

    const by_type: Record<SoftwareType, number> = {
      application: 0,
      driver: 0,
      update: 0,
      system: 0,
    };
    for (const row of typeStats) {
      if (row.software_type in by_type) {
        by_type[row.software_type as SoftwareType] = parseInt(String(row.count), 10);
      }
    }

    // Security software count
    const securityResult = await baseQuery()
      .where('is_security_relevant', true)
      .count('* as count')
      .first();
    const security_software_count = parseInt(String(securityResult?.count || 0), 10);

    // Managed software count
    const managedResult = await baseQuery()
      .where('is_managed', true)
      .count('* as count')
      .first();
    const managed_software_count = parseInt(String(managedResult?.count || 0), 10);

    // Recently installed (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentResult = await baseQuery()
      .where('first_seen_at', '>=', thirtyDaysAgo.toISOString())
      .count('* as count')
      .first();
    const recently_installed_count = parseInt(String(recentResult?.count || 0), 10);

    return {
      total_installed,
      by_category,
      by_type,
      security_software_count,
      managed_software_count,
      recently_installed_count,
    };
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error getting asset software summary:', error);
    throw error;
  }
});

/**
 * Search for software across all assets (fleet-wide)
 */
export const searchSoftwareFleetWide = withAuth(async (
  _user,
  { tenant },
  params: SoftwareSearchParams
): Promise<SoftwareSearchResponse | AssetActionError> => {
  const { knex } = await createTenantKnex();

  const {
    search,
    category,
    software_type,
    is_managed,
    is_security_relevant,
    client_id,
    page = 1,
    limit = 50,
  } = params;

  try {
    // Build base query for software catalog
    const db = tenantDb(knex, tenant);
    let catalogQuery = db.table('software_catalog as sc');

    // Apply filters
    if (search) {
      catalogQuery = catalogQuery.where(function() {
        this.whereILike('sc.name', `%${search}%`)
          .orWhereILike('sc.publisher', `%${search}%`);
      });
    }

    if (category) {
      catalogQuery = catalogQuery.where('sc.category', category);
    }

    if (software_type) {
      catalogQuery = catalogQuery.where('sc.software_type', software_type);
    }

    if (is_managed !== undefined) {
      catalogQuery = catalogQuery.where('sc.is_managed', is_managed);
    }

    if (is_security_relevant !== undefined) {
      catalogQuery = catalogQuery.where('sc.is_security_relevant', is_security_relevant);
    }

    // Get count of matching software entries
    const countResult = await catalogQuery.clone().countDistinct('sc.software_id as count').first();
    const total = parseInt(String(countResult?.count || 0), 10);

    // Get paginated software entries with install counts
    const offset = (page - 1) * limit;
    const currentAssetSoftware = db.table('asset_software')
      .select('tenant', 'software_id', 'asset_id')
      .where('is_current', true)
      .as('asw');
    let softwareQuery = catalogQuery.clone()
      .select(
        'sc.software_id',
        'sc.name',
        'sc.publisher',
        'sc.category',
        'sc.software_type',
        'sc.is_managed',
        'sc.is_security_relevant'
      );
    db.tenantJoinSubquery(softwareQuery, currentAssetSoftware, 'asw.software_id', 'sc.software_id', {
      type: 'left',
      rootTenantColumn: 'sc.tenant',
      joinedTenantColumn: 'asw.tenant',
    });

    // Filter by client if specified
    if (client_id) {
      const tenantAssets = db.table('assets')
        .select('tenant', 'asset_id', 'client_id')
        .as('a');
      db.tenantJoinSubquery(softwareQuery, tenantAssets, 'a.asset_id', 'asw.asset_id', {
        type: 'left',
        rootTenantColumn: 'asw.tenant',
        joinedTenantColumn: 'a.tenant',
      });
      softwareQuery = softwareQuery.where('a.client_id', client_id);
    }

    const softwareRows = await softwareQuery
      .count('asw.asset_id as install_count')
      .groupBy('sc.software_id', 'sc.name', 'sc.publisher', 'sc.category', 'sc.software_type', 'sc.is_managed', 'sc.is_security_relevant')
      .orderBy('install_count', 'desc')
      .limit(limit)
      .offset(offset);

    // For each software, get the assets that have it installed
    const results: SoftwareSearchResult[] = [];
    for (const sw of softwareRows) {
      let assetsQuery = tenantScopedTable(knex, tenant, 'v_asset_software_details')
        .where('software_id', sw.software_id)
        .where('is_current', true);

      if (client_id) {
        assetsQuery = assetsQuery.where('client_id', client_id);
      }

      const assetRows = await assetsQuery
        .select(
          'asset_id',
          'asset_name',
          'asset_type',
          'client_id',
          'client_name',
          'version',
          'install_date'
        )
        .limit(10); // Limit assets per software to avoid huge responses

      results.push({
        software_id: String(sw.software_id),
        name: String(sw.name),
        publisher: sw.publisher ? String(sw.publisher) : null,
        category: sw.category as SoftwareCategory,
        software_type: sw.software_type as SoftwareType,
        is_managed: Boolean(sw.is_managed),
        is_security_relevant: Boolean(sw.is_security_relevant),
        install_count: parseInt(String(sw.install_count), 10),
        assets: assetRows.map((a: any) => ({
          asset_id: a.asset_id,
          asset_name: a.asset_name,
          asset_type: a.asset_type,
          client_id: a.client_id,
          client_name: a.client_name,
          version: a.version,
          install_date: a.install_date,
        })),
      });
    }

    return {
      results,
      total,
      page,
      limit,
    };
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error searching software fleet-wide:', error);
    throw error;
  }
});

/**
 * Update a software catalog entry (e.g., set category, managed flag)
 */
export const updateSoftwareCatalogEntry = withAuth(async (
  _user,
  { tenant },
  softwareId: string,
  updates: UpdateSoftwareCatalogRequest
): Promise<void | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    const updateData: Record<string, unknown> = {};

    if (updates.category !== undefined) {
      updateData.category = updates.category;
    }
    if (updates.is_managed !== undefined) {
      updateData.is_managed = updates.is_managed;
    }
    if (updates.is_security_relevant !== undefined) {
      updateData.is_security_relevant = updates.is_security_relevant;
    }

    if (Object.keys(updateData).length > 0) {
      await tenantScopedTable(knex, tenant, 'software_catalog')
        .where({ software_id: softwareId })
        .update(updateData);
    }
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error updating software catalog entry:', error);
    throw error;
  }
});

/**
 * Get recently changed software (installs/uninstalls) for an asset
 */
export const getRecentSoftwareChanges = withAuth(async (
  _user,
  { tenant },
  assetId: string,
  days: number = 30
): Promise<{
  installed: AssetSoftwareDisplayItem[];
  uninstalled: AssetSoftwareDisplayItem[];
} | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // Recently installed
    const installed = await tenantScopedTable(knex, tenant, 'v_asset_software_details')
      .where('asset_id', assetId)
      .where('is_current', true)
      .where('first_seen_at', '>=', sinceDate.toISOString())
      .select(
        'software_id',
        'software_name as name',
        'publisher',
        'category',
        'software_type',
        'version',
        'install_date',
        'size_bytes',
        'first_seen_at',
        'is_current',
        'is_managed',
        'is_security_relevant'
      )
      .orderBy('first_seen_at', 'desc');

    // Recently uninstalled
    const uninstalled = await tenantScopedTable(knex, tenant, 'v_asset_software_details')
      .where('asset_id', assetId)
      .where('is_current', false)
      .where('uninstalled_at', '>=', sinceDate.toISOString())
      .select(
        'software_id',
        'software_name as name',
        'publisher',
        'category',
        'software_type',
        'version',
        'install_date',
        'size_bytes',
        'first_seen_at',
        'is_current',
        'is_managed',
        'is_security_relevant'
      )
      .orderBy('uninstalled_at', 'desc');

    return {
      installed: installed.map((row: any) => ({
        software_id: row.software_id,
        name: row.name,
        publisher: row.publisher,
        category: row.category as SoftwareCategory,
        software_type: row.software_type as SoftwareType,
        version: row.version,
        install_date: row.install_date,
        size_bytes: row.size_bytes,
        first_seen_at: row.first_seen_at,
        is_current: row.is_current,
        is_managed: row.is_managed,
        is_security_relevant: row.is_security_relevant,
      })),
      uninstalled: uninstalled.map((row: any) => ({
        software_id: row.software_id,
        name: row.name,
        publisher: row.publisher,
        category: row.category as SoftwareCategory,
        software_type: row.software_type as SoftwareType,
        version: row.version,
        install_date: row.install_date,
        size_bytes: row.size_bytes,
        first_seen_at: row.first_seen_at,
        is_current: row.is_current,
        is_managed: row.is_managed,
        is_security_relevant: row.is_security_relevant,
      })),
    };
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error getting recent software changes:', error);
    throw error;
  }
});

/**
 * Shared query builder for the client-level software summary (grid + export).
 * Only is_current installs count. Every table root and join carries the tenant
 * predicate via tenantDb; assets are filtered to the client.
 */
function buildClientSoftwareQuery(
  knex: Knex,
  tenant: string,
  clientId: string,
  search?: string
): Knex.QueryBuilder<any, any> {
  const db = tenantDb(knex, tenant);
  let query = db.table('asset_software as asw');
  query = db.tenantJoin(query, 'assets as a', 'a.asset_id', 'asw.asset_id');
  query = db.tenantJoin(query, 'software_catalog as sc', 'sc.software_id', 'asw.software_id');
  query = query.where('a.client_id', clientId).where('asw.is_current', true);

  const term = search?.trim();
  if (term) {
    query = query.whereILike('sc.name', containsPattern(term));
  }
  return query;
}

/**
 * Software installed across all of one client's assets, grouped by catalog
 * software_id (never the raw title). MSP-side, read-only, requires asset:read.
 *
 * "Installs" is intentionally not returned: asset_software is keyed on
 * (tenant, asset_id, software_id), so installs always equals asset_count.
 */
export const getClientSoftwareSummary = withAuth(async (
  user,
  { tenant },
  params: ClientSoftwareSummaryParams
): Promise<ClientSoftwareSummaryResponse | AssetActionError> => {
  const { knex } = await createTenantKnex();
  const { clientId, search, page = 1, sortBy = 'title', sortDir } = params;

  try {
    if (!await hasPermission(user, 'asset', 'read')) {
      throw new Error('Permission denied: Cannot read assets');
    }

    const client = await tenantScopedTable(knex, tenant, 'clients')
      .where({ client_id: clientId })
      .first('client_id');
    if (!client) {
      throw new Error('Client not found');
    }

    const countRow = await buildClientSoftwareQuery(knex, tenant, clientId, search)
      .countDistinct('sc.software_id as count')
      .first();
    const total = parseInt(String(countRow?.count || 0), 10);

    const direction = (sortDir ?? (sortBy === 'assets' ? 'desc' : 'asc')) === 'desc' ? 'desc' : 'asc';
    let rowsQuery = buildClientSoftwareQuery(knex, tenant, clientId, search)
      .select('sc.software_id', 'sc.name as title')
      .select(
        knex.raw('array_remove(array_agg(DISTINCT asw.version), NULL) as versions'),
        knex.raw('count(DISTINCT asw.asset_id) as asset_count'),
        knex.raw(
          `(array_agg(jsonb_build_object('asset_id', a.asset_id, 'name', a.name) ORDER BY a.name, a.asset_id))[1:${CLIENT_SOFTWARE_ASSET_PREVIEW_LIMIT}] as assets`
        ),
        knex.raw('max(asw.last_seen_at) as last_seen')
      )
      .groupBy('sc.software_id', 'sc.name');

    rowsQuery = sortBy === 'assets'
      ? rowsQuery.orderByRaw(`count(DISTINCT asw.asset_id) ${direction}`).orderBy('sc.name', 'asc')
      : rowsQuery.orderBy('sc.name', direction);
    rowsQuery = rowsQuery.orderBy('sc.software_id', 'asc');

    if (page !== 'all') {
      const safePage = Math.max(1, Math.floor(page) || 1);
      rowsQuery = rowsQuery.limit(CLIENT_SOFTWARE_PAGE_SIZE).offset((safePage - 1) * CLIENT_SOFTWARE_PAGE_SIZE);
    }

    const rows = await rowsQuery;
    const mapped: ClientSoftwareSummaryRow[] = rows.map((row: any) => ({
      software_id: String(row.software_id),
      title: String(row.title),
      versions: ((row.versions ?? []) as string[]).slice().sort(),
      asset_count: parseInt(String(row.asset_count), 10),
      assets: ((row.assets ?? []) as Array<{ asset_id: string; name: string }>).map((asset) => ({
        asset_id: asset.asset_id,
        name: asset.name,
      })),
      last_seen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
    }));

    return {
      rows: mapped,
      total,
      page: page === 'all' ? 'all' : Math.max(1, Math.floor(page) || 1),
      limit: page === 'all' ? total : CLIENT_SOFTWARE_PAGE_SIZE,
    };
  } catch (error) {
    const expected = assetActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error getting client software summary:', error);
    throw error;
  }
});
