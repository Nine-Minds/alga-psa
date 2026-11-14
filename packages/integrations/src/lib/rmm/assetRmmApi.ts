/**
 * REST-only RMM adapters and the helpers they share with the asset-page server actions.
 * Deliberately NOT a 'use server' module: these are called by the REST routes, which gate the
 * asset with readAssetGateForRequest and project the result under that decision, so they must
 * not be reachable as standalone server-action entry points.
 */

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  resolveRmmAssetDeviceActions,
  type RmmAssetDeviceActions,
  type RmmAssetDeviceRef,
} from './assetDeviceActions';
import { getRmmProviderMetadata } from './providerRegistry';
import type { RmmAgentStatus, RmmCachedData, RmmProvider, RmmStorageInfo } from '@alga-psa/types';

export function providerLabel(provider: string | null | undefined): string {
  return getRmmProviderMetadata(provider as RmmProvider)?.title ?? (provider || 'RMM');
}

/** Internal response envelope lets REST select the source graph for this asset type without serializing the type. */
export interface RmmApiReadResult {
  assetType: string;
  data: RmmCachedData | null;
}


export type ManagedAssetRow = {
  asset_type: string;
  name: string;
  rmm_provider: string | null;
  rmm_device_id: string | null;
  agent_status: string | null;
  last_seen_at: Date | string | null;
  last_rmm_sync_at: Date | string | null;
};

export async function loadManagedAsset(tenant: string, assetId: string): Promise<ManagedAssetRow | null> {
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
export async function resolveDevice(
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

export async function requireAssetPermission(user: unknown, action: 'read' | 'update'): Promise<void> {
  if (!(await hasPermission(user as any, 'asset', action))) {
    throw new Error(`Permission denied: Cannot ${action} assets`);
  }
}

/**
 * Cached RMM vitals for the asset page, read from the extension tables the
 * provider syncs populate. Never throws for a missing row: the page renders
 * its "not managed" state from null.
 */
export async function loadAssetRmmData(tenant: string, assetId: string): Promise<RmmApiReadResult | null> {
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
    assetType: asset.asset_type,
    data: {
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
    },
  };
}

/** REST adapter retains the discriminator needed to apply the actual extension-table source descriptor. */
export const getAssetRmmDataForApi = withAuth(async (user, { tenant }, assetId: string): Promise<RmmApiReadResult | null> => {
  await requireAssetPermission(user, 'read');
  return loadAssetRmmData(tenant, assetId);
});

/** API refresh preserves update authorization and returns the source discriminator for response projection. */
export const refreshAssetRmmDataForApi = withAuth(async (user, { tenant }, assetId: string): Promise<RmmApiReadResult | null> => {
  await requireAssetPermission(user, 'update');
  await requireAssetPermission(user, 'read');
  const { ref, actions } = await resolveDevice(tenant, assetId);
  await actions.refresh(ref);
  return loadAssetRmmData(tenant, assetId);
});

