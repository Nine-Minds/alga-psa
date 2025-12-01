'use server';

/**
 * RMM Actions
 *
 * Server actions for RMM-related asset operations.
 * Provides cached data retrieval and single-device refresh.
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.4.3
 */

import { createTenantKnex } from '../../../../../../server/src/lib/db';
import {
  RmmCachedData,
  RmmStorageInfo,
  RmmProvider,
  RmmAgentStatus,
} from '../../../../../../server/src/interfaces/asset.interfaces';
import { syncSingleDeviceByAssetId } from '../../integrations/ninjaone/sync/syncEngine';
import { createNinjaOneClient } from '../../integrations/ninjaone/ninjaOneClient';

/**
 * Get cached RMM data for an asset
 * Returns data from the database (populated during sync) for instant page load
 */
export async function getAssetRmmData(assetId: string): Promise<RmmCachedData | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Get base asset info
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select(
        'asset_type',
        'rmm_provider',
        'rmm_device_id',
        'agent_status',
        'last_seen_at',
        'last_rmm_sync_at'
      )
      .first();

    if (!asset || !asset.rmm_provider) {
      return null;
    }

    // Get extension data based on asset type
    let extensionData: Record<string, unknown> | null = null;
    let totalMemoryGb: number | null = null;

    if (asset.asset_type === 'workstation') {
      extensionData = await knex('workstation_assets')
        .where({ tenant, asset_id: assetId })
        .select(
          'current_user',
          'uptime_seconds',
          'lan_ip',
          'wan_ip',
          'cpu_utilization_percent',
          'memory_usage_percent',
          'memory_used_gb',
          'disk_usage',
          'ram_gb'
        )
        .first();
      totalMemoryGb = extensionData?.ram_gb as number || null;
    } else if (asset.asset_type === 'server') {
      extensionData = await knex('server_assets')
        .where({ tenant, asset_id: assetId })
        .select(
          'current_user',
          'uptime_seconds',
          'lan_ip',
          'wan_ip',
          'cpu_usage_percent',
          'memory_usage_percent',
          'memory_used_gb',
          'disk_usage',
          'ram_gb'
        )
        .first();
      totalMemoryGb = extensionData?.ram_gb as number || null;
    }

    if (!extensionData) {
      return null;
    }

    // Parse disk_usage if it's a string
    let storage: RmmStorageInfo[] = [];
    if (extensionData.disk_usage) {
      storage = typeof extensionData.disk_usage === 'string'
        ? JSON.parse(extensionData.disk_usage)
        : extensionData.disk_usage;
    }

    return {
      provider: asset.rmm_provider as RmmProvider,
      agent_status: (asset.agent_status || 'unknown') as RmmAgentStatus,
      last_check_in: asset.last_seen_at || null,
      last_rmm_sync_at: asset.last_rmm_sync_at || null,
      current_user: extensionData.current_user as string || null,
      uptime_seconds: extensionData.uptime_seconds as number || null,
      lan_ip: extensionData.lan_ip as string || null,
      wan_ip: extensionData.wan_ip as string || null,
      cpu_utilization_percent: (extensionData.cpu_utilization_percent || extensionData.cpu_usage_percent) as number || null,
      memory_utilization_percent: extensionData.memory_usage_percent as number || null,
      memory_used_gb: extensionData.memory_used_gb as number || null,
      memory_total_gb: totalMemoryGb,
      storage,
    };
  } catch (error) {
    console.error('Error getting asset RMM data:', error);
    throw new Error('Failed to get asset RMM data');
  }
}

/**
 * Refresh RMM data for a single asset
 * Triggers a single-device sync and returns updated cached data
 */
export async function refreshAssetRmmData(assetId: string): Promise<RmmCachedData | null> {
  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Trigger single device sync
    await syncSingleDeviceByAssetId(tenant, assetId);

    // Return updated cached data
    return getAssetRmmData(assetId);
  } catch (error) {
    console.error('Error refreshing asset RMM data:', error);
    throw new Error('Failed to refresh asset RMM data');
  }
}

/**
 * Get remote control URL for an asset
 * Returns URL for launching remote control session via NinjaOne
 */
export async function getAssetRemoteControlUrl(
  assetId: string,
  connectionType: 'splashtop' | 'teamviewer' | 'vnc' | 'rdp' | 'shell' = 'splashtop'
): Promise<string | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Get asset info
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select('rmm_provider', 'rmm_device_id')
      .first();

    if (!asset || asset.rmm_provider !== 'ninjaone' || !asset.rmm_device_id) {
      return null;
    }

    // Get NinjaOne client and fetch remote control link
    const client = await createNinjaOneClient(tenant);
    const deviceId = parseInt(asset.rmm_device_id, 10);

    // Note: This requires implementing getDeviceRemoteLink in ninjaOneClient
    // The actual NinjaOne API endpoint is GET /v2/device/{id}/links
    try {
      const links = await client.getDeviceLinks(deviceId);
      const connectionTypeUpper = connectionType.toUpperCase();
      const link = links.find((l: { type: string }) => l.type === connectionTypeUpper);
      return link?.url || null;
    } catch (linkError) {
      // Remote control may not be available for all devices
      console.warn('Remote control link not available:', linkError);
      return null;
    }
  } catch (error) {
    console.error('Error getting remote control URL:', error);
    throw new Error('Failed to get remote control URL');
  }
}

/**
 * Trigger a reboot on an RMM-managed device
 */
export async function triggerRmmReboot(assetId: string): Promise<{ success: boolean; message: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Get asset info
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select('rmm_provider', 'rmm_device_id', 'name')
      .first();

    if (!asset || asset.rmm_provider !== 'ninjaone' || !asset.rmm_device_id) {
      return { success: false, message: 'Asset is not managed by NinjaOne' };
    }

    // Note: This requires implementing device actions in ninjaOneClient
    // The actual NinjaOne API endpoint is POST /v2/device/{id}/reboot
    const client = await createNinjaOneClient(tenant);
    const deviceId = parseInt(asset.rmm_device_id, 10);

    try {
      await client.rebootDevice(deviceId);
      return {
        success: true,
        message: `Reboot command sent to ${asset.name}`,
      };
    } catch (rebootError) {
      return {
        success: false,
        message: rebootError instanceof Error ? rebootError.message : 'Failed to send reboot command',
      };
    }
  } catch (error) {
    console.error('Error triggering RMM reboot:', error);
    return { success: false, message: 'Failed to trigger reboot' };
  }
}

/**
 * Run a script on an RMM-managed device
 */
export async function triggerRmmScript(
  assetId: string,
  scriptId: string
): Promise<{ success: boolean; jobId?: string; message: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Get asset info
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select('rmm_provider', 'rmm_device_id', 'name')
      .first();

    if (!asset || asset.rmm_provider !== 'ninjaone' || !asset.rmm_device_id) {
      return { success: false, message: 'Asset is not managed by NinjaOne' };
    }

    // Note: This requires implementing script execution in ninjaOneClient
    // The actual NinjaOne API endpoint is POST /v2/device/{id}/script/run
    const client = await createNinjaOneClient(tenant);
    const deviceId = parseInt(asset.rmm_device_id, 10);

    try {
      const result = await client.runScript(deviceId, scriptId);
      return {
        success: true,
        jobId: result.jobId,
        message: `Script queued for execution on ${asset.name}`,
      };
    } catch (scriptError) {
      return {
        success: false,
        message: scriptError instanceof Error ? scriptError.message : 'Failed to run script',
      };
    }
  } catch (error) {
    console.error('Error triggering RMM script:', error);
    return { success: false, message: 'Failed to run script' };
  }
}
