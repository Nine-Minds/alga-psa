/**
 * Tanium's bulk inventory sync, as a callable engine.
 *
 * Extracted from taniumActions.ts for the same reason Tactical's was: that file
 * carries 'use server', so every export becomes a callable RPC endpoint and an
 * unguarded sync could not live there. The action keeps its permission check and
 * delegates; the scheduled job calls this directly.
 *
 * The tier gate travels with the work rather than staying on the action.
 * ADVANCED_ASSETS is a tenant entitlement, not a user permission, so a scheduled
 * run must still satisfy it — otherwise scheduling would be a way around a paid
 * feature. assertTenantTierAccess is the session-free form of the same check.
 */
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { TIER_FEATURES } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { createTenantKnex } from '@/lib/db';
import {
  ingestNormalizedRmmDeviceSnapshot,
  type IngestNormalizedRmmDeviceSnapshotInput,
} from '@alga-psa/integrations/lib/rmm/sharedAssetIngestionService';
import type { NormalizedRmmExternalDeviceSnapshot } from '@alga-psa/integrations/lib/rmm/contracts';
import {
  normalizeTaniumGatewayUrl,
  TaniumGatewayClient,
  type TaniumEndpointCriticalityReading,
  type TaniumEndpointRecord,
} from '../taniumGatewayClient';
import { runRmmSyncWithTransport } from '../../rmm/sync/syncOrchestration';
import { assertTenantTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { upsertAssetFact } from '@alga-psa/assets/lib/assetFactsService';

const PROVIDER = 'tanium' as const;

const TANIUM_GATEWAY_URL_SECRET = 'tanium_gateway_url';
const TANIUM_API_TOKEN_SECRET = 'tanium_api_token';
const TANIUM_ASSET_API_URL_SECRET = 'tanium_asset_api_url';
const TANIUM_CRITICALITY_SENSOR_NAME = 'Endpoint Criticality with Level';

export function sanitizeError(error: unknown, fallback = 'Unable to complete the Tanium request.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (!message) {
    return fallback;
  }

  if (message === 'Forbidden' || message.startsWith('Forbidden:')) {
    return 'You do not have permission to manage Tanium settings.';
  }

  if (
    message.startsWith('Tanium Gateway') ||
    message.startsWith('Tanium API token') ||
    message.startsWith('Tanium Asset API') ||
    message === 'Tanium Gateway URL is required.'
  ) {
    return message;
  }

  if (message.includes('fetch failed') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return 'Unable to reach Tanium. Verify the Gateway URL and network connectivity.';
  }

  return fallback;
}

function inferTaniumAssetType(endpoint: TaniumEndpointRecord): NormalizedRmmExternalDeviceSnapshot['assetType'] {
  const fingerprint = [
    endpoint.name,
    endpoint.osName,
    endpoint.osVersion,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    fingerprint.includes('switch') ||
    fingerprint.includes('router') ||
    fingerprint.includes('firewall') ||
    fingerprint.includes('access point') ||
    fingerprint.includes('load balancer')
  ) {
    return 'network_device';
  }

  if (
    fingerprint.includes('android') ||
    fingerprint.includes('ios') ||
    fingerprint.includes('ipad') ||
    fingerprint.includes('iphone') ||
    fingerprint.includes('mobile')
  ) {
    return 'mobile_device';
  }

  if (fingerprint.includes('server')) {
    return 'server';
  }

  return 'workstation';
}

function mapEndpointToSnapshot(args: {
  integrationId: string;
  endpoint: TaniumEndpointRecord;
  scopeId: string;
}): NormalizedRmmExternalDeviceSnapshot {
  const endpoint = args.endpoint;
  const isOffline = endpoint.online === false;
  const uptimeSeconds = endpoint.lastRebootAt
    ? Math.max(0, Math.floor((Date.now() - new Date(endpoint.lastRebootAt).getTime()) / 1000))
    : null;

  return {
    provider: PROVIDER,
    integrationId: args.integrationId,
    externalDeviceId: String(endpoint.id),
    externalScopeId: args.scopeId,
    lifecycleState: isOffline ? 'offline' : 'active',
    assetType: inferTaniumAssetType(endpoint),
    displayName: endpoint.name || endpoint.id,
    serialNumber: endpoint.serialNumber ?? null,
    status: isOffline ? 'inactive' : 'active',
    location: null,
    assetTag: `tanium:${endpoint.id}`,
    agentStatus: isOffline ? 'offline' : 'online',
    lastSeenAt: endpoint.lastSeen ?? null,
    extension: {
      osType: endpoint.osName ?? null,
      osVersion: endpoint.osVersion ?? null,
      currentUser: endpoint.currentUser ?? null,
      uptimeSeconds: Number.isFinite(uptimeSeconds) ? uptimeSeconds : null,
      lanIp: endpoint.ipAddress ?? null,
      wanIp: endpoint.wanIpAddress ?? null,
      lastRebootAt: endpoint.lastRebootAt ?? null,
      cpuModel: endpoint.cpuModel ?? null,
      cpuCores: endpoint.cpuLogicalProcessors ?? null,
      ramGb: endpoint.memoryTotalGb ?? null,
      diskUsage: endpoint.diskUsage ?? [],
      installedSoftware: endpoint.installedApplications?.map((application) => ({
        name: application.name,
        version: application.version ?? null,
      })) ?? [],
      systemInfo: endpoint.metadata ?? null,
    },
    metadata: endpoint.metadata ?? {},
  };
}

type TaniumCriticalityFactCandidate = {
  isAvailable: boolean;
  valueText: string | null;
  valueNumber: number | null;
  valueJson: Record<string, unknown>;
};

function toCriticalityFactCandidate(reading: TaniumEndpointCriticalityReading): TaniumCriticalityFactCandidate {
  return {
    isAvailable: reading.isAvailable,
    valueText: reading.label,
    valueNumber: reading.multiplier,
    valueJson: {
      sensorName: TANIUM_CRITICALITY_SENSOR_NAME,
      columns: reading.columns,
      rawValues: reading.columns.map((column) => ({
        name: column.name,
        values: column.values,
      })),
    },
  };
}

export async function buildConfiguredTaniumClient(args: { tenant: string; gatewayUrl?: string; apiToken?: string; assetApiUrl?: string | null }) {
  const secretProvider = await getSecretProviderInstance();

  const gatewayUrl = normalizeTaniumGatewayUrl(
    args.gatewayUrl || (await secretProvider.getTenantSecret(args.tenant, TANIUM_GATEWAY_URL_SECRET)) || ''
  );
  const apiToken = args.apiToken || (await secretProvider.getTenantSecret(args.tenant, TANIUM_API_TOKEN_SECRET)) || '';
  const assetApiUrl = args.assetApiUrl ?? ((await secretProvider.getTenantSecret(args.tenant, TANIUM_ASSET_API_URL_SECRET)) || '');

  if (!gatewayUrl || !apiToken) {
    throw new Error('Tanium Gateway URL and API token must be configured.');
  }

  return new TaniumGatewayClient({
    gatewayUrl,
    apiToken,
    assetApiUrl: assetApiUrl || undefined,
  });
}

export interface TaniumDeviceSyncOptions {
  syncType?: 'full' | 'incremental';
  /** Only endpoints seen at or after this instant are ingested. */
  since?: Date;
}

export interface TaniumDeviceSyncResult {
  success: boolean;
  error?: string;
  items_processed?: number;
  items_created?: number;
  items_updated?: number;
  items_deleted?: number;
  items_failed?: number;
  errors?: string[];
  sync_type?: 'full' | 'incremental';
}

/**
 * Whether an endpoint falls inside an incremental window.
 *
 * listEndpoints() accepts only a computerGroupId — no time filter — so
 * "incremental" is the same page walk filtered on the endpoint's own lastSeen.
 * Inclusive at the boundary; a missing or unparseable lastSeen is always
 * considered, so absent data cannot exclude an endpoint from every run forever.
 *
 * Filtering is only safe because nothing here deletes by set difference: assets
 * are marked deleted from a snapshot's own lifecycleState, and Tanium's mapper
 * only ever emits 'offline' or 'active'. An endpoint outside the window is
 * simply not visited.
 */
export function taniumEndpointChangedSince(endpoint: { lastSeen?: string | null }, since?: Date): boolean {
  if (!since) return true;
  const raw = endpoint?.lastSeen ?? null;
  if (!raw) return true;
  const seen = new Date(raw);
  if (Number.isNaN(seen.getTime())) return true;
  return seen.getTime() >= since.getTime();
}

export async function runTaniumDeviceSync(
  args: { tenant: string },
  options: TaniumDeviceSyncOptions = {}
): Promise<TaniumDeviceSyncResult> {
  const { tenant } = args;
  const syncType = options.syncType ?? 'full';
  const since = options.since;

  await assertTenantTierAccess(tenant, TIER_FEATURES.ADVANCED_ASSETS);

  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  try {
    return await runRmmSyncWithTransport({
      context: {
        provider: PROVIDER,
        operation: 'full_inventory_sync',
        input: { tenant },
      },
      directExecutor: async () => {
    const integration = await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tanium integration not configured.' };
    }

    await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .update({
        sync_status: 'syncing',
        sync_error: null,
        updated_at: knex.fn.now(),
      });

    const mappedScopes = await db.table('rmm_organization_mappings')
      .where({ integration_id: integration.integration_id })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select(['external_organization_id', 'client_id']);

    const taniumSettings = integration?.settings?.provider_settings?.tanium || {};
    const useAssetApiFallback = Boolean(taniumSettings.use_asset_api_fallback);

    const client = await buildConfiguredTaniumClient({
      tenant,
      gatewayUrl: integration.instance_url || undefined,
      assetApiUrl: taniumSettings.asset_api_url || undefined,
    });

    let processed = 0;
    let created = 0;
    let updated = 0;
    let deleted = 0;
    const errors: string[] = [];

    for (const scope of mappedScopes) {
      const externalScopeId = String(scope.external_organization_id);
      const resolvedClientId = String(scope.client_id);
      let endpoints = await client.listEndpoints({ computerGroupId: externalScopeId });
      let criticalityByEndpointId = new Map<string, TaniumCriticalityFactCandidate>();
      let criticalityQuerySucceeded = false;

      try {
        await client.getCriticalitySensorMetadata();
        const criticalityReadings = await client.listEndpointCriticalityReadings({ computerGroupId: externalScopeId });
        criticalityByEndpointId = new Map(
          Array.from(criticalityReadings.entries()).map(([endpointId, reading]) => [endpointId, toCriticalityFactCandidate(reading)])
        );
        criticalityQuerySucceeded = true;
      } catch (criticalityError) {
        console.warn('Tanium criticality enrichment failed; continuing inventory sync', {
          tenant,
          scopeId: externalScopeId,
          error: sanitizeError(criticalityError, 'Unable to load Tanium criticality data.'),
        });
      }

      if (endpoints.length === 0 && useAssetApiFallback) {
        const fallbackEndpoints = await client.listAgedOutAssetFallback({ computerGroupId: externalScopeId });
        endpoints = fallbackEndpoints;
      }

      for (const endpoint of endpoints) {
        if (!taniumEndpointChangedSince(endpoint, since)) continue;

        const snapshot = mapEndpointToSnapshot({
          integrationId: integration.integration_id,
          endpoint,
          scopeId: externalScopeId,
        });

        try {
          const ingestResult = await ingestNormalizedRmmDeviceSnapshot({
            tenant,
            snapshot,
            resolvedClientId,
            knex,
          } as IngestNormalizedRmmDeviceSnapshotInput);

          processed += 1;
          if (ingestResult.action === 'created') created += 1;
          if (ingestResult.action === 'updated') updated += 1;
          if (ingestResult.action === 'marked_deleted') deleted += 1;
          if (ingestResult.action === 'failed' && ingestResult.error) {
            errors.push(`${endpoint.id}: ${ingestResult.error}`);
          }

          if (ingestResult.assetId) {
            const foundCandidate = criticalityByEndpointId.get(endpoint.id);
            const candidate = foundCandidate || (
              criticalityQuerySucceeded
                ? {
                    isAvailable: false,
                    valueText: null,
                    valueNumber: null,
                    valueJson: {
                      sensorName: TANIUM_CRITICALITY_SENSOR_NAME,
                      reason: 'endpoint_missing_or_unavailable',
                    },
                  } satisfies TaniumCriticalityFactCandidate
                : null
            );

            if (candidate) {
              await upsertAssetFact(knex, {
                tenant,
                assetId: ingestResult.assetId,
                sourceType: 'integration',
                provider: PROVIDER,
                integrationId: integration.integration_id,
                namespace: 'tanium',
                factKey: 'criticality',
                label: 'Tanium Criticality',
                valueText: candidate.valueText,
                valueNumber: candidate.valueNumber,
                valueJson: candidate.valueJson,
                source: 'tanium.gateway.sensor.Endpoint Criticality with Level',
                sourceUpdatedAt: null,
                lastSyncedAt: new Date(),
                isAvailable: candidate.isAvailable,
              });
            }
          }
        } catch (error) {
          processed += 1;
          errors.push(`${endpoint.id}: ${sanitizeError(error, 'Unable to sync this Tanium endpoint.')}`);
        }
      }
    }

    await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .update({
        sync_status: errors.length ? 'error' : 'completed',
        last_sync_at: knex.fn.now(),
        // Only a genuine full run may claim one: resolveDeviceSyncCursor falls
        // back to last_full_sync_at, so stamping it here would let an
        // incremental run stand in for a full sweep it never performed.
        ...(syncType === 'full' ? { last_full_sync_at: knex.fn.now() } : {}),
        sync_error: errors.length ? errors.slice(0, 10).join('; ') : null,
        updated_at: knex.fn.now(),
      });

        return {
          success: errors.length === 0,
          items_processed: processed,
          items_created: created,
          items_updated: updated,
          items_deleted: deleted,
          items_failed: errors.length,
          errors,
        };
      },
    });
  } catch (error) {
    await db.table('rmm_integrations')
      .where({ provider: PROVIDER })
      .update({
        sync_status: 'error',
        sync_error: sanitizeError(error, 'Unable to sync Tanium inventory.'),
        updated_at: knex.fn.now(),
      });

    return { success: false, error: sanitizeError(error, 'Unable to sync Tanium inventory.'), sync_type: syncType };
  }
}
