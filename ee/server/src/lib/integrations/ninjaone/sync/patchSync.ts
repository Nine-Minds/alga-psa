/**
 * NinjaOne Patch Status Sync
 *
 * Synchronizes patch status information from NinjaOne to AlgaPSA assets.
 * Updates pending patches, failed patches, and last scan timestamps.
 */

import logger from '@alga-psa/core/logger';
import axios from 'axios';
import { createTenantKnex } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import { createNinjaOneClient } from '../ninjaOneClient';
import {
  recordSyncError,
  reportProgress,
  statusForCompletedRun,
  type SyncRunStatus,
} from './syncOutcome';
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
  /** Called once per completed batch with devices done so far and the total to process. */
  onProgress?: (done: number, total: number) => void;
}

export interface PatchSyncResult {
  /**
   * Legacy boolean, kept exactly as before (`assetsFailed === 0`). A run that
   * updated 830 of 831 devices reads `false` here, so user-facing code must NOT
   * branch on it — read `status` instead.
   */
  success: boolean;
  /** User-facing outcome: `partial` = ran to completion with at least one device failing; `failed` = threw. */
  status: SyncRunStatus;
  assetsProcessed: number;
  assetsUpdated: number;
  assetsFailed: number;
  /** First 20 messages only (MAX_SYNC_ERRORS); `errorCount` is the real total. */
  errors: string[];
  errorCount: number;
  startedAt: string;
  completedAt: string;
}

/**
 * Sync patch status for all RMM-managed devices or a specific set
 */
// LEVERAGE: pattern fleet-batch-walk — same loop as syncSoftwareInventory; see there
export async function syncPatchStatus(
  tenantId: string,
  integrationId: string,
  options: PatchSyncOptions = {}
): Promise<PatchSyncResult> {
  const startTime = new Date().toISOString();
  const result: PatchSyncResult = {
    success: true,
    status: 'succeeded',
    assetsProcessed: 0,
    assetsUpdated: 0,
    assetsFailed: 0,
    errors: [],
    errorCount: 0,
    startedAt: startTime,
    completedAt: '',
  };

  const { batchSize = 50, assetIds, performedBy, onProgress } = options;

  try {
    logger.info('[PatchSync] Starting patch status sync', {
      tenantId,
      integrationId,
      assetIds: assetIds?.length,
      batchSize,
    });

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenantId);
    const client = await createNinjaOneClient(tenantId, undefined, { integrationId });

    // Build query for assets to sync
    let assetsQuery = db.table('assets')
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
            await db.table(extensionTable)
              .where({ asset_id: asset.asset_id })
              .update({
                pending_patches: totalPending,
                pending_os_patches: osPatches,
                pending_software_patches: softwarePatches,
                failed_patches: patchStatus.failed || 0,
                last_patch_scan_at: new Date().toISOString(),
              });

            // Update the main asset's last sync timestamp
            await db.table('assets')
              .where({ asset_id: asset.asset_id })
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
            // Device name, not asset_id: these messages are shown to users in the Fleet Compliance panel.
            recordSyncError(result, `${asset.name}: ${errorMsg}`);

            logger.warn('[PatchSync] Failed to sync patch status for asset', {
              assetId: asset.asset_id,
              error: errorMsg,
            });
          }
        })
      );

      reportProgress(onProgress, Math.min(i + batchSize, assets.length), assets.length);

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < assets.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    result.completedAt = new Date().toISOString();
    result.success = result.assetsFailed === 0;
    result.status = statusForCompletedRun(result.assetsFailed);

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
    result.status = 'failed';
    recordSyncError(result, error instanceof Error ? error.message : String(error));

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
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenantId);

    // Get the asset
    const asset = await db.table('assets')
      .where({ asset_id: assetId })
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

    const client = await createNinjaOneClient(tenantId, undefined, {});
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
    await db.table(extensionTable)
      .where({ asset_id: assetId })
      .update({
        pending_patches: totalPending,
        pending_os_patches: osPatches,
        pending_software_patches: softwarePatches,
        failed_patches: patchStatus.failed || 0,
        last_patch_scan_at: new Date().toISOString(),
      });

    // Update main asset
    await db.table('assets')
      .where({ asset_id: assetId })
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
