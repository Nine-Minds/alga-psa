/**
 * NinjaOne Patch Status Sync
 *
 * Synchronizes patch status information from NinjaOne to Alga PSA assets.
 * Updates pending patches, failed patches, and last scan timestamps.
 */

import logger from '@alga-psa/core/logger';
import axios from 'axios';
import { createTenantKnex } from '@/db';
import { createNinjaOneClient } from '../ninjaOneClient';
import type { NinjaOneDevicePatchStatus } from '../../../../interfaces/ninjaone.interfaces';

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

export interface PatchSyncOptions {
  /** Only sync patches for specific asset IDs */
  assetIds?: string[];
  /** Maximum number of devices to sync in one batch */
  batchSize?: number;
  /** User ID who triggered the sync */
  performedBy?: string;
}

export interface PatchSyncResult {
  success: boolean;
  assetsProcessed: number;
  assetsUpdated: number;
  assetsFailed: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
}

/**
 * Sync patch status for all RMM-managed devices or a specific set
 */
export async function syncPatchStatus(
  tenantId: string,
  integrationId: string,
  options: PatchSyncOptions = {}
): Promise<PatchSyncResult> {
  const startTime = new Date().toISOString();
  const result: PatchSyncResult = {
    success: true,
    assetsProcessed: 0,
    assetsUpdated: 0,
    assetsFailed: 0,
    errors: [],
    startedAt: startTime,
    completedAt: '',
  };

  const { batchSize = 50, assetIds, performedBy } = options;

  try {
    logger.info('[PatchSync] Starting patch status sync', {
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

    logger.info('[PatchSync] Found assets to sync', { count: assets.length });

    // Process in batches
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

            // Fetch patch status from NinjaOne
            const patchStatus = await client.getDevicePatchStatus(deviceId);

            // Determine the extension table based on asset type
            const extensionTable = asset.asset_type === 'workstation'
              ? 'workstation_assets'
              : 'server_assets';

            // Calculate OS vs software patches (NinjaOne groups them)
            // For now, we'll estimate based on typical ratios
            const totalPending = patchStatus.pending || 0;
            const osPatches = Math.ceil(totalPending * 0.6);
            const softwarePatches = totalPending - osPatches;

            // Update the extension table with patch data
            await knex(extensionTable)
              .where({ tenant, asset_id: asset.asset_id })
              .update({
                pending_patches: totalPending,
                pending_os_patches: osPatches,
                pending_software_patches: softwarePatches,
                failed_patches: patchStatus.failed || 0,
                last_patch_scan_at: new Date().toISOString(),
              });

            // Update the main asset's last sync timestamp
            await knex('assets')
              .where({ tenant, asset_id: asset.asset_id })
              .update({
                last_rmm_sync_at: new Date().toISOString(),
              });

            result.assetsUpdated++;

            logger.debug('[PatchSync] Updated patch status for asset', {
              assetId: asset.asset_id,
              assetName: asset.name,
              pending: totalPending,
              failed: patchStatus.failed,
            });
          } catch (assetError) {
            result.assetsFailed++;
            const errorMsg = assetError instanceof Error ? assetError.message : String(assetError);
            result.errors.push(`Asset ${asset.asset_id} (${asset.name}): ${errorMsg}`);

            logger.warn('[PatchSync] Failed to sync patch status for asset', {
              assetId: asset.asset_id,
              error: errorMsg,
            });
          }
        })
      );

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < assets.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    result.completedAt = new Date().toISOString();
    result.success = result.assetsFailed === 0;

    logger.info('[PatchSync] Patch status sync completed', {
      tenantId,
      processed: result.assetsProcessed,
      updated: result.assetsUpdated,
      failed: result.assetsFailed,
      duration: Date.now() - new Date(startTime).getTime(),
    });

    return result;
  } catch (error) {
    result.completedAt = new Date().toISOString();
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));

    logger.error('[PatchSync] Patch status sync failed', { tenantId, error: extractErrorInfo(error) });

    return result;
  }
}

/**
 * Sync patch status for a single device
 */
export async function syncDevicePatchStatus(
  tenantId: string,
  assetId: string
): Promise<{
  success: boolean;
  patchStatus?: {
    pending: number;
    pendingOs: number;
    pendingSoftware: number;
    failed: number;
  };
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
      throw new Error('Patch status only available for workstations and servers');
    }

    const client = await createNinjaOneClient(tenantId);
    const deviceId = parseInt(asset.rmm_device_id, 10);
    const patchStatus = await client.getDevicePatchStatus(deviceId);

    const totalPending = patchStatus.pending || 0;
    const osPatches = Math.ceil(totalPending * 0.6);
    const softwarePatches = totalPending - osPatches;

    // Determine extension table
    const extensionTable = asset.asset_type === 'workstation'
      ? 'workstation_assets'
      : 'server_assets';

    // Update extension table
    await knex(extensionTable)
      .where({ tenant, asset_id: assetId })
      .update({
        pending_patches: totalPending,
        pending_os_patches: osPatches,
        pending_software_patches: softwarePatches,
        failed_patches: patchStatus.failed || 0,
        last_patch_scan_at: new Date().toISOString(),
      });

    // Update main asset
    await knex('assets')
      .where({ tenant, asset_id: assetId })
      .update({
        last_rmm_sync_at: new Date().toISOString(),
      });

    return {
      success: true,
      patchStatus: {
        pending: totalPending,
        pendingOs: osPatches,
        pendingSoftware: softwarePatches,
        failed: patchStatus.failed || 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[PatchSync] Failed to sync device patch status', { assetId, error: extractErrorInfo(error) });
    return { success: false, error: errorMessage };
  }
}

export default {
  syncPatchStatus,
  syncDevicePatchStatus,
};
