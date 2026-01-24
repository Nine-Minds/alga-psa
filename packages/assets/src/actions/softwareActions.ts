'use server';

/**
 * Software Inventory Actions
 *
 * Server actions for querying software inventory using the normalized tables.
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.4
 */

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
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
} from '@alga-psa/types';

/**
 * Get software installed on an asset
 * Uses the normalized asset_software table with software_catalog join
 */
export const getAssetSoftware = withAuth(async (
  _user,
  { tenant },
  params: AssetSoftwareQueryParams
): Promise<AssetSoftwareListResponse> => {
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
    // Base query using the view for convenience
    let query = knex('v_asset_software_details')
      .where('tenant', tenant)
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
    if (search) {
      query = query.where(function() {
        this.whereILike('software_name', `%${search}%`)
          .orWhereILike('publisher', `%${search}%`);
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

    const software: AssetSoftwareDisplayItem[] = rows.map(row => ({
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
    console.error('Error getting asset software:', error);
    throw new Error('Failed to get asset software');
  }
});

/**
 * Get software summary statistics for an asset
 */
export const getAssetSoftwareSummary = withAuth(async (_user, { tenant }, assetId: string): Promise<AssetSoftwareSummary> => {
  const { knex } = await createTenantKnex();

  try {
    const baseQuery = () => knex('v_asset_software_details')
      .where('tenant', tenant)
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
    console.error('Error getting asset software summary:', error);
    throw new Error('Failed to get asset software summary');
  }
});

/**
 * Search for software across all assets (fleet-wide)
 */
export const searchSoftwareFleetWide = withAuth(async (
  _user,
  { tenant },
  params: SoftwareSearchParams
): Promise<SoftwareSearchResponse> => {
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
    let catalogQuery = knex('software_catalog as sc')
      .where('sc.tenant', tenant);

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
    let softwareQuery = catalogQuery.clone()
      .select(
        'sc.software_id',
        'sc.name',
        'sc.publisher',
        'sc.category',
        'sc.software_type',
        'sc.is_managed',
        'sc.is_security_relevant'
      )
      .leftJoin('asset_software as asw', function() {
        this.on('asw.tenant', '=', 'sc.tenant')
          .andOn('asw.software_id', '=', 'sc.software_id')
          .andOn('asw.is_current', '=', knex.raw('true'));
      });

    // Filter by client if specified
    if (client_id) {
      softwareQuery = softwareQuery
        .leftJoin('assets as a', function() {
          this.on('a.tenant', '=', 'asw.tenant')
            .andOn('a.asset_id', '=', 'asw.asset_id');
        })
        .where('a.client_id', client_id);
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
      let assetsQuery = knex('v_asset_software_details')
        .where('tenant', tenant)
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
        assets: assetRows.map(a => ({
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
    console.error('Error searching software fleet-wide:', error);
    throw new Error('Failed to search software');
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
): Promise<void> => {
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
      await knex('software_catalog')
        .where({ tenant, software_id: softwareId })
        .update(updateData);
    }
  } catch (error) {
    console.error('Error updating software catalog entry:', error);
    throw new Error('Failed to update software catalog entry');
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
}> => {
  const { knex } = await createTenantKnex();

  try {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // Recently installed
    const installed = await knex('v_asset_software_details')
      .where('tenant', tenant)
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
    const uninstalled = await knex('v_asset_software_details')
      .where('tenant', tenant)
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
      installed: installed.map(row => ({
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
      uninstalled: uninstalled.map(row => ({
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
    console.error('Error getting recent software changes:', error);
    throw new Error('Failed to get recent software changes');
  }
});
