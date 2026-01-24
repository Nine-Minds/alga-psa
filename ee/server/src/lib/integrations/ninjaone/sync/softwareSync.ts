/**
 * NinjaOne Software Inventory Sync
 *
 * Synchronizes software inventory from NinjaOne to Alga PSA assets.
 * Uses normalized tables (software_catalog + asset_software) for better
 * querying, deduplication, and change tracking.
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.3.3
 */

import logger from '@alga-psa/core/logger';
import axios from 'axios';
import { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { createNinjaOneClient } from '../ninjaOneClient';
import type { NinjaOneSoftware } from '../../../../interfaces/ninjaone.interfaces';
import type {
  SoftwareCatalogEntry,
  SoftwareCategory,
  SoftwareType,
} from '@/interfaces/software.interfaces';

/**
 * Extract safe error info for logging (avoids circular reference issues with axios errors)
 */
function extractErrorInfo(error: unknown): object {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}

export interface SoftwareSyncOptions {
  /** Only sync software for specific asset IDs */
  assetIds?: string[];
  /** Maximum number of devices to sync in one batch */
  batchSize?: number;
  /** User ID who triggered the sync */
  performedBy?: string;
  /** Track changes in asset history */
  trackChanges?: boolean;
}

export interface SoftwareSyncResult {
  success: boolean;
  assetsProcessed: number;
  assetsUpdated: number;
  assetsFailed: number;
  totalSoftwareItems: number;
  softwareInstalled: number;
  softwareUninstalled: number;
  catalogEntriesCreated: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
}

export interface SoftwareItem {
  name: string;
  version?: string;
  publisher?: string;
  installDate?: string;
  size?: number;
  location?: string;
}

/**
 * Normalize software name for matching
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Infer software category from name (heuristic)
 */
function inferSoftwareCategory(name: string): SoftwareCategory {
  const lower = name.toLowerCase();
  if (/chrome|firefox|safari|edge|opera|brave|browser/.test(lower)) return 'Browser';
  if (/office|word|excel|powerpoint|outlook|teams|onenote/.test(lower)) return 'Productivity';
  if (/visual studio|vscode|intellij|xcode|android studio|eclipse|jetbrains|rider|webstorm|phpstorm|pycharm/.test(lower)) return 'Development';
  if (/antivirus|defender|norton|mcafee|sentinelone|crowdstrike|sophos|bitdefender|kaspersky|malwarebytes|firewall|security/.test(lower)) return 'Security';
  if (/zoom|teams|slack|discord|skype|webex/.test(lower)) return 'Communication';
  if (/adobe|photoshop|illustrator|acrobat|premiere|lightroom|indesign|creative/.test(lower)) return 'Creative';
  if (/node|python|java|dotnet|\.net|runtime|framework|sdk|jdk|jre/.test(lower)) return 'Runtime';
  if (/driver|nvidia|amd|intel|realtek/.test(lower)) return 'Driver';
  return null;
}

/**
 * Infer software type from name
 */
function inferSoftwareType(name: string): SoftwareType {
  const lower = name.toLowerCase();
  if (/driver/.test(lower)) return 'driver';
  if (/update|hotfix|kb\d+|patch/.test(lower)) return 'update';
  if (/runtime|framework|redistributable/.test(lower)) return 'system';
  return 'application';
}

/**
 * Check if software is security-relevant
 */
function isSecurityRelevant(name: string): boolean {
  const lower = name.toLowerCase();
  return /antivirus|security|defender|firewall|malware|endpoint|protection/.test(lower);
}

/**
 * Transform NinjaOne software data to our format
 */
function transformSoftware(ninjaSoftware: NinjaOneSoftware[]): SoftwareItem[] {
  return ninjaSoftware
    .filter(sw => sw.name) // Filter out items without names
    .map(sw => ({
      name: sw.name || 'Unknown',
      version: sw.version,
      publisher: sw.publisher,
      installDate: sw.installDate,
      size: sw.size,
      location: sw.location,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
}

/**
 * Find or create a software catalog entry
 * Uses normalized name + publisher for deduplication
 */
async function findOrCreateSoftwareCatalogEntry(
  knex: Knex,
  tenant: string,
  software: { name: string; publisher?: string }
): Promise<string> {
  const normalizedName = normalizeName(software.name);
  const publisher = software.publisher?.trim() || null;

  // Try to find existing entry
  const existing = await knex('software_catalog')
    .where({
      tenant,
      normalized_name: normalizedName,
      publisher,
    })
    .first();

  if (existing) {
    return existing.software_id;
  }

  // Create new entry
  const [entry] = await knex('software_catalog')
    .insert({
      tenant,
      name: software.name.trim(),
      normalized_name: normalizedName,
      publisher,
      category: inferSoftwareCategory(software.name),
      software_type: inferSoftwareType(software.name),
      is_managed: false,
      is_security_relevant: isSecurityRelevant(software.name),
    })
    .returning('software_id');

  return entry.software_id;
}

/**
 * Sync asset software to normalized tables
 * Handles upsert for existing software and soft-delete for uninstalled software
 */
async function syncAssetSoftwareToNormalizedTables(
  knex: Knex,
  tenant: string,
  assetId: string,
  softwareList: SoftwareItem[],
  syncTimestamp: Date
): Promise<{ installed: number; uninstalled: number; catalogCreated: number }> {
  const stats = { installed: 0, uninstalled: 0, catalogCreated: 0 };

  // Get current software IDs for this asset
  const currentSoftware = await knex('asset_software')
    .where({ tenant, asset_id: assetId, is_current: true })
    .select('software_id');
  const currentSoftwareIds = new Set(currentSoftware.map(s => s.software_id));

  // Track which software we see in this sync
  const seenSoftwareIds = new Set<string>();

  // Process each software item from RMM
  for (const sw of softwareList) {
    if (!sw.name) continue;

    // Find or create catalog entry
    const softwareId = await findOrCreateSoftwareCatalogEntry(knex, tenant, {
      name: sw.name,
      publisher: sw.publisher,
    });

    seenSoftwareIds.add(softwareId);

    // Check if already exists for this asset
    const existing = await knex('asset_software')
      .where({ tenant, asset_id: assetId, software_id: softwareId })
      .first();

    if (existing) {
      // Update last_seen_at and potentially re-install if it was uninstalled
      const updateData: Record<string, unknown> = {
        last_seen_at: syncTimestamp,
        version: sw.version || existing.version,
        install_path: sw.location || existing.install_path,
        size_bytes: sw.size || existing.size_bytes,
      };

      // If it was previously uninstalled, mark as re-installed
      if (!existing.is_current) {
        updateData.is_current = true;
        updateData.uninstalled_at = null;
        stats.installed++;
      }

      await knex('asset_software')
        .where({ tenant, asset_id: assetId, software_id: softwareId })
        .update(updateData);
    } else {
      // New software installation
      await knex('asset_software').insert({
        tenant,
        asset_id: assetId,
        software_id: softwareId,
        version: sw.version || null,
        install_date: sw.installDate ? new Date(sw.installDate) : null,
        install_path: sw.location || null,
        size_bytes: sw.size || null,
        first_seen_at: syncTimestamp,
        last_seen_at: syncTimestamp,
        is_current: true,
      });
      stats.installed++;
      stats.catalogCreated++;
    }
  }

  // Mark software that's no longer present as uninstalled (soft delete)
  for (const softwareId of currentSoftwareIds) {
    if (!seenSoftwareIds.has(softwareId)) {
      await knex('asset_software')
        .where({ tenant, asset_id: assetId, software_id: softwareId, is_current: true })
        .update({
          is_current: false,
          uninstalled_at: syncTimestamp,
        });
      stats.uninstalled++;
    }
  }

  return stats;
}

/**
 * Sync software inventory for all RMM-managed devices or a specific set
 * Now uses normalized tables (software_catalog + asset_software)
 */
export async function syncSoftwareInventory(
  tenantId: string,
  integrationId: string,
  options: SoftwareSyncOptions = {}
): Promise<SoftwareSyncResult> {
  const startTime = new Date().toISOString();
  const result: SoftwareSyncResult = {
    success: true,
    assetsProcessed: 0,
    assetsUpdated: 0,
    assetsFailed: 0,
    totalSoftwareItems: 0,
    softwareInstalled: 0,
    softwareUninstalled: 0,
    catalogEntriesCreated: 0,
    errors: [],
    startedAt: startTime,
    completedAt: '',
  };

  const { batchSize = 25, assetIds, performedBy, trackChanges = false } = options;

  try {
    logger.info('[SoftwareSync] Starting software inventory sync (normalized tables)', {
      tenantId,
      integrationId,
      assetIds: assetIds?.length,
      batchSize,
    });

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    const client = await createNinjaOneClient(tenantId, undefined, { integrationId });

    // Build query for assets to sync
    let assetsQuery = knex('assets')
      .where({ tenant })
      .where('rmm_provider', 'ninjaone')
      .whereNotNull('rmm_device_id')
      .whereIn('asset_type', ['workstation', 'server']);

    if (assetIds && assetIds.length > 0) {
      assetsQuery = assetsQuery.whereIn('asset_id', assetIds);
    }

    const assets = await assetsQuery.select('asset_id', 'asset_type', 'rmm_device_id', 'name');

    logger.info('[SoftwareSync] Found assets to sync', { count: assets.length });

    const syncTimestamp = new Date();

    // Process in batches (smaller batches since software data is larger)
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (asset) => {
          result.assetsProcessed++;

          try {
            const deviceId = parseInt(asset.rmm_device_id, 10);
            if (isNaN(deviceId)) {
              throw new Error(`Invalid device ID: ${asset.rmm_device_id}`);
            }

            // Fetch software from NinjaOne
            const ninjaSoftware = await client.getDeviceSoftware(deviceId) as NinjaOneSoftware[];
            const software = transformSoftware(ninjaSoftware);

            result.totalSoftwareItems += software.length;

            // Sync to normalized tables
            const stats = await syncAssetSoftwareToNormalizedTables(
              knex,
              tenant,
              asset.asset_id,
              software,
              syncTimestamp
            );

            result.softwareInstalled += stats.installed;
            result.softwareUninstalled += stats.uninstalled;
            result.catalogEntriesCreated += stats.catalogCreated;

            // Also update the JSONB column for backwards compatibility
            // This can be removed once frontend migrates to normalized tables
            const extensionTable = asset.asset_type === 'workstation'
              ? 'workstation_assets'
              : 'server_assets';

            await knex(extensionTable)
              .where({ tenant, asset_id: asset.asset_id })
              .update({
                installed_software: JSON.stringify(software),
              });

            // Update the main asset's last sync timestamp
            await knex('assets')
              .where({ tenant, asset_id: asset.asset_id })
              .update({
                last_rmm_sync_at: syncTimestamp.toISOString(),
              });

            // Track changes in asset history if enabled
            if (trackChanges && (stats.installed > 0 || stats.uninstalled > 0)) {
              await knex('asset_history').insert({
                tenant,
                asset_id: asset.asset_id,
                changed_by: performedBy || 'system',
                change_type: 'software_update',
                changes: JSON.stringify({
                  installed: stats.installed,
                  uninstalled: stats.uninstalled,
                  source: 'ninjaone_sync',
                }),
                changed_at: syncTimestamp.toISOString(),
              });
            }

            result.assetsUpdated++;

            logger.debug('[SoftwareSync] Updated software inventory for asset', {
              assetId: asset.asset_id,
              assetName: asset.name,
              softwareCount: software.length,
              installed: stats.installed,
              uninstalled: stats.uninstalled,
            });
          } catch (assetError) {
            result.assetsFailed++;
            const errorMsg = assetError instanceof Error ? assetError.message : String(assetError);
            result.errors.push(`Asset ${asset.asset_id} (${asset.name}): ${errorMsg}`);

            logger.warn('[SoftwareSync] Failed to sync software for asset', {
              assetId: asset.asset_id,
              error: errorMsg,
            });
          }
        })
      );

      // Longer delay between batches for software sync (more data)
      if (i + batchSize < assets.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    result.completedAt = new Date().toISOString();
    result.success = result.assetsFailed === 0;

    logger.info('[SoftwareSync] Software inventory sync completed', {
      tenantId,
      processed: result.assetsProcessed,
      updated: result.assetsUpdated,
      failed: result.assetsFailed,
      totalSoftware: result.totalSoftwareItems,
      installed: result.softwareInstalled,
      uninstalled: result.softwareUninstalled,
      catalogCreated: result.catalogEntriesCreated,
      duration: Date.now() - new Date(startTime).getTime(),
    });

    return result;
  } catch (error) {
    result.completedAt = new Date().toISOString();
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));

    logger.error('[SoftwareSync] Software inventory sync failed', { tenantId, error: extractErrorInfo(error) });

    return result;
  }
}

/**
 * Sync software inventory for a single device
 * Now uses normalized tables
 */
export async function syncDeviceSoftware(
  tenantId: string,
  assetId: string
): Promise<{
  success: boolean;
  softwareCount?: number;
  installed?: number;
  uninstalled?: number;
  error?: string;
}> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Get the asset
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .first();

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.rmm_provider !== 'ninjaone' || !asset.rmm_device_id) {
      throw new Error('Asset is not managed by NinjaOne');
    }

    if (asset.asset_type !== 'workstation' && asset.asset_type !== 'server') {
      throw new Error('Software inventory only available for workstations and servers');
    }

    const client = await createNinjaOneClient(tenantId, undefined, { integrationId });
    const deviceId = parseInt(asset.rmm_device_id, 10);
    const ninjaSoftware = await client.getDeviceSoftware(deviceId) as NinjaOneSoftware[];
    const software = transformSoftware(ninjaSoftware);

    const syncTimestamp = new Date();

    // Sync to normalized tables
    const stats = await syncAssetSoftwareToNormalizedTables(
      knex,
      tenant,
      assetId,
      software,
      syncTimestamp
    );

    // Also update the JSONB column for backwards compatibility
    const extensionTable = asset.asset_type === 'workstation'
      ? 'workstation_assets'
      : 'server_assets';

    await knex(extensionTable)
      .where({ tenant, asset_id: assetId })
      .update({
        installed_software: JSON.stringify(software),
      });

    // Update main asset
    await knex('assets')
      .where({ tenant, asset_id: assetId })
      .update({
        last_rmm_sync_at: syncTimestamp.toISOString(),
      });

    return {
      success: true,
      softwareCount: software.length,
      installed: stats.installed,
      uninstalled: stats.uninstalled,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[SoftwareSync] Failed to sync device software', { assetId, error: extractErrorInfo(error) });
    return { success: false, error: errorMessage };
  }
}

/**
 * Calculate differences between two software lists
 */
function calculateSoftwareChanges(
  previous: SoftwareItem[],
  current: SoftwareItem[]
): {
  added: SoftwareItem[];
  removed: SoftwareItem[];
  updated: SoftwareItem[];
} {
  const previousNames = new Set(previous.map(s => s.name.toLowerCase()));
  const currentNames = new Set(current.map(s => s.name.toLowerCase()));

  const added = current.filter(s => !previousNames.has(s.name.toLowerCase()));
  const removed = previous.filter(s => !currentNames.has(s.name.toLowerCase()));

  // Find version changes
  const updated: SoftwareItem[] = [];
  const previousMap = new Map(previous.map(s => [s.name.toLowerCase(), s]));

  current.forEach(sw => {
    const prev = previousMap.get(sw.name.toLowerCase());
    if (prev && prev.version !== sw.version) {
      updated.push(sw);
    }
  });

  return { added, removed, updated };
}

/**
 * Search for software across all assets using normalized tables
 * Uses v_asset_software_details view for efficient querying
 */
export async function searchSoftwareAcrossAssets(
  tenantId: string,
  searchTerm: string,
  options: {
    companyId?: string;
    category?: string;
    limit?: number;
  } = {}
): Promise<Array<{
  assetId: string;
  assetName: string;
  companyId: string;
  clientName: string;
  software: {
    softwareId: string;
    name: string;
    version: string | null;
    publisher: string | null;
    category: string | null;
    installDate: string | null;
  };
}>> {
  const { companyId, category, limit = 100 } = options;

  try {
    const { knex, tenant } = await createTenantKnex();

    // Use the view for efficient querying
    let query = knex('v_asset_software_details')
      .where('tenant', tenant)
      .where('is_current', true)
      .where(function() {
        this.whereILike('software_name', `%${searchTerm}%`)
          .orWhereILike('publisher', `%${searchTerm}%`);
      })
      .select(
        'asset_id',
        'asset_name',
        'client_id',
        'client_name',
        'software_id',
        'software_name',
        'version',
        'publisher',
        'category',
        'install_date'
      )
      .orderBy('software_name')
      .limit(limit);

    if (companyId) {
      query = query.where('client_id', companyId);
    }

    if (category) {
      query = query.where('category', category);
    }

    const rows = await query;

    return rows.map(row => ({
      assetId: row.asset_id,
      assetName: row.asset_name,
      companyId: row.client_id,
      clientName: row.client_name,
      software: {
        softwareId: row.software_id,
        name: row.software_name,
        version: row.version,
        publisher: row.publisher,
        category: row.category,
        installDate: row.install_date,
      },
    }));
  } catch (error) {
    logger.error('[SoftwareSync] Failed to search software across assets', { error: extractErrorInfo(error) });
    throw error;
  }
}

/**
 * Get software summary for fleet (aggregate stats)
 */
export async function getFleetSoftwareSummary(
  tenantId: string,
  options: { companyId?: string } = {}
): Promise<{
  totalUniqueSoftware: number;
  totalInstallations: number;
  byCategory: Record<string, number>;
  topInstalled: Array<{ name: string; publisher: string | null; count: number }>;
}> {
  const { companyId } = options;

  try {
    const { knex, tenant } = await createTenantKnex();

    // Base query for current software
    const baseQuery = () => {
      let q = knex('v_asset_software_details')
        .where('tenant', tenant)
        .where('is_current', true);
      if (companyId) {
        q = q.where('client_id', companyId);
      }
      return q;
    };

    // Total unique software
    const uniqueCount = await baseQuery()
      .countDistinct('software_id as count')
      .first();

    // Total installations
    const totalCount = await baseQuery()
      .count('* as count')
      .first();

    // By category
    const categoryStats = await baseQuery()
      .select('category')
      .count('* as count')
      .groupBy('category');

    const byCategory: Record<string, number> = {};
    for (const row of categoryStats) {
      byCategory[row.category || 'Uncategorized'] = parseInt(String(row.count), 10);
    }

    // Top installed software
    const topInstalled = await baseQuery()
      .select('software_name as name', 'publisher')
      .count('* as count')
      .groupBy('software_name', 'publisher')
      .orderBy('count', 'desc')
      .limit(10);

    return {
      totalUniqueSoftware: parseInt(String(uniqueCount?.count || 0), 10),
      totalInstallations: parseInt(String(totalCount?.count || 0), 10),
      byCategory,
      topInstalled: topInstalled.map(row => ({
        name: String(row.name),
        publisher: row.publisher ? String(row.publisher) : null,
        count: parseInt(String(row.count), 10),
      })),
    };
  } catch (error) {
    logger.error('[SoftwareSync] Failed to get fleet software summary', { error: extractErrorInfo(error) });
    throw error;
  }
}

export default {
  syncSoftwareInventory,
  syncDeviceSoftware,
  searchSoftwareAcrossAssets,
  getFleetSoftwareSummary,
};
