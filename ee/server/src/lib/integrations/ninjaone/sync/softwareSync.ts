/**
 * NinjaOne Software Inventory Sync
 *
 * Synchronizes software inventory from NinjaOne to Alga PSA assets.
 * Updates the installed_software field in asset extension tables.
 */

import logger from '@shared/core/logger';
import { createTenantKnex } from '../../../../../../../server/src/db';
import { createNinjaOneClient } from '../ninjaOneClient';
import type { NinjaOneSoftware } from '../../../../interfaces/ninjaone.interfaces';

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
 * Sync software inventory for all RMM-managed devices or a specific set
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
    errors: [],
    startedAt: startTime,
    completedAt: '',
  };

  const { batchSize = 25, assetIds, performedBy, trackChanges = false } = options;

  try {
    logger.info('[SoftwareSync] Starting software inventory sync', {
      tenantId,
      integrationId,
      assetIds: assetIds?.length,
      batchSize,
    });

    const { knex, tenant } = await createTenantKnex();
    const client = await createNinjaOneClient(tenantId);

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

            // Determine the extension table based on asset type
            const extensionTable = asset.asset_type === 'workstation'
              ? 'asset_workstations'
              : 'asset_servers';

            // Get existing software for change tracking
            let previousSoftware: SoftwareItem[] = [];
            if (trackChanges) {
              const existing = await knex(extensionTable)
                .where({ tenant, asset_id: asset.asset_id })
                .select('installed_software')
                .first();

              if (existing?.installed_software) {
                previousSoftware = Array.isArray(existing.installed_software)
                  ? existing.installed_software
                  : [];
              }
            }

            // Update the extension table with software data
            await knex(extensionTable)
              .where({ tenant, asset_id: asset.asset_id })
              .update({
                installed_software: JSON.stringify(software),
              });

            // Update the main asset's last sync timestamp
            await knex('assets')
              .where({ tenant, asset_id: asset.asset_id })
              .update({
                last_rmm_sync_at: new Date().toISOString(),
              });

            // Track changes in asset history if enabled
            if (trackChanges && previousSoftware.length > 0) {
              const changes = calculateSoftwareChanges(previousSoftware, software);
              if (changes.added.length > 0 || changes.removed.length > 0) {
                await knex('asset_history').insert({
                  tenant,
                  asset_id: asset.asset_id,
                  changed_by: performedBy || 'system',
                  change_type: 'software_update',
                  changes: JSON.stringify({
                    added: changes.added.slice(0, 10), // Limit to avoid huge entries
                    removed: changes.removed.slice(0, 10),
                    addedCount: changes.added.length,
                    removedCount: changes.removed.length,
                  }),
                  changed_at: new Date().toISOString(),
                });
              }
            }

            result.assetsUpdated++;

            logger.debug('[SoftwareSync] Updated software inventory for asset', {
              assetId: asset.asset_id,
              assetName: asset.name,
              softwareCount: software.length,
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
      duration: Date.now() - new Date(startTime).getTime(),
    });

    return result;
  } catch (error) {
    result.completedAt = new Date().toISOString();
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));

    logger.error('[SoftwareSync] Software inventory sync failed', { tenantId, error });

    return result;
  }
}

/**
 * Sync software inventory for a single device
 */
export async function syncDeviceSoftware(
  tenantId: string,
  assetId: string
): Promise<{
  success: boolean;
  softwareCount?: number;
  error?: string;
}> {
  try {
    const { knex, tenant } = await createTenantKnex();

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

    const client = await createNinjaOneClient(tenantId);
    const deviceId = parseInt(asset.rmm_device_id, 10);
    const ninjaSoftware = await client.getDeviceSoftware(deviceId) as NinjaOneSoftware[];
    const software = transformSoftware(ninjaSoftware);

    // Determine extension table
    const extensionTable = asset.asset_type === 'workstation'
      ? 'asset_workstations'
      : 'asset_servers';

    // Update extension table
    await knex(extensionTable)
      .where({ tenant, asset_id: assetId })
      .update({
        installed_software: JSON.stringify(software),
      });

    // Update main asset
    await knex('assets')
      .where({ tenant, asset_id: assetId })
      .update({
        last_rmm_sync_at: new Date().toISOString(),
      });

    return {
      success: true,
      softwareCount: software.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[SoftwareSync] Failed to sync device software', { assetId, error });
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
 * Search for software across all assets
 */
export async function searchSoftwareAcrossAssets(
  tenantId: string,
  searchTerm: string,
  options: {
    companyId?: string;
    limit?: number;
  } = {}
): Promise<Array<{
  assetId: string;
  assetName: string;
  companyId: string;
  software: SoftwareItem;
}>> {
  const { companyId, limit = 100 } = options;

  try {
    const { knex, tenant } = await createTenantKnex();
    const lowerSearch = searchTerm.toLowerCase();

    // Query workstations
    let workstationsQuery = knex('assets as a')
      .join('asset_workstations as aw', function() {
        this.on('a.tenant', '=', 'aw.tenant')
          .andOn('a.asset_id', '=', 'aw.asset_id');
      })
      .where('a.tenant', tenant)
      .where('a.asset_type', 'workstation')
      .whereNotNull('aw.installed_software')
      .select('a.asset_id', 'a.name as asset_name', 'a.client_id as company_id', 'aw.installed_software');

    if (companyId) {
      workstationsQuery = workstationsQuery.where('a.client_id', companyId);
    }

    // Query servers
    let serversQuery = knex('assets as a')
      .join('asset_servers as asrv', function() {
        this.on('a.tenant', '=', 'asrv.tenant')
          .andOn('a.asset_id', '=', 'asrv.asset_id');
      })
      .where('a.tenant', tenant)
      .where('a.asset_type', 'server')
      .whereNotNull('asrv.installed_software')
      .select('a.asset_id', 'a.name as asset_name', 'a.client_id as company_id', 'asrv.installed_software');

    if (companyId) {
      serversQuery = serversQuery.where('a.client_id', companyId);
    }

    const [workstations, servers] = await Promise.all([
      workstationsQuery,
      serversQuery,
    ]);

    const results: Array<{
      assetId: string;
      assetName: string;
      companyId: string;
      software: SoftwareItem;
    }> = [];

    // Search through workstations
    for (const ws of workstations) {
      const softwareList: SoftwareItem[] = typeof ws.installed_software === 'string'
        ? JSON.parse(ws.installed_software)
        : ws.installed_software;

      for (const sw of softwareList) {
        if (
          sw.name?.toLowerCase().includes(lowerSearch) ||
          sw.publisher?.toLowerCase().includes(lowerSearch)
        ) {
          results.push({
            assetId: ws.asset_id,
            assetName: ws.asset_name,
            companyId: ws.company_id,
            software: sw,
          });

          if (results.length >= limit) break;
        }
      }

      if (results.length >= limit) break;
    }

    // Search through servers
    if (results.length < limit) {
      for (const srv of servers) {
        const softwareList: SoftwareItem[] = typeof srv.installed_software === 'string'
          ? JSON.parse(srv.installed_software)
          : srv.installed_software;

        for (const sw of softwareList) {
          if (
            sw.name?.toLowerCase().includes(lowerSearch) ||
            sw.publisher?.toLowerCase().includes(lowerSearch)
          ) {
            results.push({
              assetId: srv.asset_id,
              assetName: srv.asset_name,
              companyId: srv.company_id,
              software: sw,
            });

            if (results.length >= limit) break;
          }
        }

        if (results.length >= limit) break;
      }
    }

    return results;
  } catch (error) {
    logger.error('[SoftwareSync] Failed to search software across assets', { error });
    throw error;
  }
}

export default {
  syncSoftwareInventory,
  syncDeviceSoftware,
  searchSoftwareAcrossAssets,
};
