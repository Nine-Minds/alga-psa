'use server';

/**
 * Asset-page RMM actions: cached vitals plus single-device refresh, reboot,
 * script and remote-control commands. Lives here rather than in the assets
 * package because feature packages may not import each other; the asset page
 * receives these through AssetCrossFeatureContext from the composition layer.
 * Per-provider work is resolved via assetDeviceActions (Tactical in CE, the
 * NinjaOne and Datto seams in EE).
 */

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  resolveRmmAssetDeviceActions,
  type RmmAssetDeviceActions,
  type RmmAssetDeviceRef,
  type RmmRemoteConnectionType,
} from '../../lib/rmm/assetDeviceActions';
import { getRmmProviderMetadata } from '../../lib/rmm/providerRegistry';
import type { RmmAgentStatus, RmmCachedData, RmmProvider, RmmStorageInfo } from '@alga-psa/types';

function providerLabel(provider: string | null | undefined): string {
  return getRmmProviderMetadata(provider as RmmProvider)?.title ?? (provider || 'RMM');
}

export interface RmmCommandResult {
  success: boolean;
  message: string;
  jobId?: string;
}

type ManagedAssetRow = {
  asset_type: string;
  name: string;
  rmm_provider: string | null;
  rmm_device_id: string | null;
  agent_status: string | null;
  last_seen_at: Date | string | null;
  last_rmm_sync_at: Date | string | null;
};

async function loadManagedAsset(tenant: string, assetId: string): Promise<ManagedAssetRow | null> {
  const { knex } = await createTenantKnex();
  const row = await tenantDb(knex, tenant)
    .table('assets')
    .where({ asset_id: assetId })
    .first(['asset_type', 'name', 'rmm_provider', 'rmm_device_id', 'agent_status', 'last_seen_at', 'last_rmm_sync_at']);
  return (row as ManagedAssetRow | undefined) ?? null;
}

/**
 * Resolves the provider adapter for an asset, or throws with the message the
 * page and API routes translate for the user.
 */
async function resolveDevice(
  tenant: string,
  assetId: string
): Promise<{ asset: ManagedAssetRow; ref: RmmAssetDeviceRef; actions: RmmAssetDeviceActions }> {
  const asset = await loadManagedAsset(tenant, assetId);
  if (!asset) throw new Error('Asset not found');
  if (!asset.rmm_provider || !asset.rmm_device_id) throw new Error('Asset is not managed by an RMM');

  const actions = await resolveRmmAssetDeviceActions(asset.rmm_provider);
  if (!actions) {
    throw new Error(`Device actions are not available for ${providerLabel(asset.rmm_provider)} assets`);
  }

  return {
    asset,
    actions,
    ref: { tenant, assetId, deviceId: asset.rmm_device_id, assetName: asset.name },
  };
}

async function requireAssetPermission(user: unknown, action: 'read' | 'update'): Promise<void> {
  if (!(await hasPermission(user as any, 'asset', action))) {
    throw new Error(`Permission denied: Cannot ${action} assets`);
  }
}

/**
 * Datto reboots, component runs and Web Remote sessions are raw remote command execution, so they
 * need the dedicated RMM permission on top of asset update. Other providers
 * keep their existing asset-update gate.
 */
const EXECUTE_COMMAND_DENIED_MESSAGE = 'Permission denied: Cannot execute RMM commands';

/**
 * Datto adapters throw DattoActionError for messages written for the operator;
 * anything else (knex, secret provider, axios) can carry internals, so it is
 * replaced by the generic text instead of being returned. Matched by name to
 * keep the Datto module out of this file's static imports.
 */
function dattoSafeMessage(error: unknown): string | null {
  const e = error as { name?: string; message?: string } | null;
  return e?.name === 'DattoActionError' && e.message ? e.message : null;
}

async function canExecuteCommands(user: unknown, provider: string | null | undefined): Promise<boolean> {
  if (provider !== 'datto') return true;
  return hasPermission(user as any, 'rmm', 'execute_command');
}

/**
 * Cached RMM vitals for the asset page, read from the extension tables the
 * provider syncs populate. Never throws for a missing row: the page renders
 * its "not managed" state from null.
 */
export const getAssetRmmData = withAuth(async (user, { tenant }, assetId: string): Promise<RmmCachedData | null> => {
  await requireAssetPermission(user, 'read');

  const asset = await loadManagedAsset(tenant, assetId);
  if (!asset?.rmm_provider) return null;

  const table = asset.asset_type === 'server' ? 'server_assets' : asset.asset_type === 'workstation' ? 'workstation_assets' : null;
  if (!table) return null;

  const { knex } = await createTenantKnex();
  const ext = await tenantDb(knex, tenant)
    .table(table)
    .where({ asset_id: assetId })
    .first([
      'current_user',
      'uptime_seconds',
      'lan_ip',
      'wan_ip',
      knex.raw(asset.asset_type === 'server' ? 'cpu_usage_percent as cpu_utilization_percent' : 'cpu_utilization_percent'),
      'memory_usage_percent',
      'memory_used_gb',
      'disk_usage',
      'ram_gb',
    ]);
  if (!ext) return null;

  const storage: RmmStorageInfo[] = typeof ext.disk_usage === 'string'
    ? JSON.parse(ext.disk_usage)
    : Array.isArray(ext.disk_usage) ? ext.disk_usage : [];

  const toNumber = (v: unknown): number | null => {
    const n = v === null || typeof v === 'undefined' ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    provider: asset.rmm_provider as RmmProvider,
    agent_status: (asset.agent_status || 'unknown') as RmmAgentStatus,
    last_check_in: asset.last_seen_at ? new Date(asset.last_seen_at).toISOString() : null,
    last_rmm_sync_at: asset.last_rmm_sync_at ? new Date(asset.last_rmm_sync_at).toISOString() : null,
    current_user: ext.current_user ? String(ext.current_user) : null,
    uptime_seconds: toNumber(ext.uptime_seconds),
    lan_ip: ext.lan_ip ? String(ext.lan_ip) : null,
    wan_ip: ext.wan_ip ? String(ext.wan_ip) : null,
    cpu_utilization_percent: toNumber(ext.cpu_utilization_percent),
    memory_utilization_percent: toNumber(ext.memory_usage_percent),
    memory_used_gb: toNumber(ext.memory_used_gb),
    memory_total_gb: toNumber(ext.ram_gb),
    storage,
  };
});

/** Pulls the device from its provider, then returns the refreshed cached data. */
export const refreshAssetRmmData = withAuth(async (user, { tenant }, assetId: string): Promise<RmmCachedData | null> => {
  await requireAssetPermission(user, 'update');
  const { ref, actions } = await resolveDevice(tenant, assetId);
  await actions.refresh(ref);
  return getAssetRmmData(assetId);
});

export const triggerRmmReboot = withAuth(async (user, { tenant }, assetId: string): Promise<RmmCommandResult> => {
  await requireAssetPermission(user, 'update');
  const { asset, ref, actions } = await resolveDevice(tenant, assetId);
  if (!(await canExecuteCommands(user, asset.rmm_provider))) {
    return { success: false, message: EXECUTE_COMMAND_DENIED_MESSAGE };
  }
  try {
    await actions.reboot(ref);
    return { success: true, message: `Reboot command sent to ${asset.name}` };
  } catch (error) {
    console.warn('RMM reboot command failed:', error);
    return {
      success: false,
      message: (asset.rmm_provider === 'datto'
        ? dattoSafeMessage(error)
        : error instanceof Error && error.message ? error.message : null)
        ?? 'Unable to send reboot command. Confirm the device is online and remote actions are enabled.',
    };
  }
});

export const triggerRmmScript = withAuth(async (user, { tenant }, assetId: string, scriptId: string): Promise<RmmCommandResult> => {
  await requireAssetPermission(user, 'update');
  const { asset, ref, actions } = await resolveDevice(tenant, assetId);
  if (!(await canExecuteCommands(user, asset.rmm_provider))) {
    return { success: false, message: EXECUTE_COMMAND_DENIED_MESSAGE };
  }
  if (!actions.runScript) {
    return { success: false, message: `Scripts are not supported for ${providerLabel(asset.rmm_provider)} assets` };
  }
  try {
    const result = await actions.runScript(ref, scriptId);
    return { success: true, jobId: result.jobId, message: `Script queued for execution on ${asset.name}` };
  } catch (error) {
    console.warn('RMM script execution failed:', error);
    return {
      success: false,
      message: (asset.rmm_provider === 'datto' ? dattoSafeMessage(error) : null)
        ?? 'Unable to run script. Confirm the device is online and the script is available.',
    };
  }
});

export const getAssetRemoteControlTypes = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<RmmRemoteConnectionType[]> => {
  await requireAssetPermission(user, 'read');
  if (!await hasPermission(user as any, 'asset', 'update')) return [];
  try {
    const { asset, ref, actions } = await resolveDevice(tenant, assetId);
    // Listing is gated like opening, so the UI never offers a button that will be refused.
    if (!(await canExecuteCommands(user, asset.rmm_provider))) return [];
    if (!actions.remoteControlTypes) return [];
    return await actions.remoteControlTypes(ref);
  } catch (error) {
    console.warn('Remote control types not available:', error);
    return [];
  }
});

export const getAssetRemoteControlUrl = withAuth(async (
  user,
  { tenant },
  assetId: string,
  connectionType: RmmRemoteConnectionType = 'splashtop'
): Promise<string | null> => {
  await requireAssetPermission(user, 'update');
  const { asset, ref, actions } = await resolveDevice(tenant, assetId);
  // A Web Remote session is at least as powerful as a reboot.
  if (!(await canExecuteCommands(user, asset.rmm_provider))) throw new Error(EXECUTE_COMMAND_DENIED_MESSAGE);
  if (!actions.remoteControlUrl) return null;
  try {
    return await actions.remoteControlUrl(ref, connectionType);
  } catch (error) {
    console.warn('Remote control link not available:', error);
    return null;
  }
});
