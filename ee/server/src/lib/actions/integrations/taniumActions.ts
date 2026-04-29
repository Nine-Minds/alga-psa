'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { TIER_FEATURES } from '@alga-psa/types';
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
} from '../../integrations/tanium/taniumGatewayClient';
import { runRmmSyncWithTransport } from '../../integrations/rmm/sync/syncOrchestration';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { upsertAssetFact } from 'server/src/lib/assets/assetFactsService';

const PROVIDER = 'tanium' as const;

const TANIUM_GATEWAY_URL_SECRET = 'tanium_gateway_url';
const TANIUM_API_TOKEN_SECRET = 'tanium_api_token';
const TANIUM_ASSET_API_URL_SECRET = 'tanium_asset_api_url';
const TANIUM_CRITICALITY_SENSOR_NAME = 'Endpoint Criticality with Level';

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withAdvancedAssetsAccess<TArgs extends unknown[], TResult>(
  handler: (user: any, context: { tenant: string }, ...args: TArgs) => Promise<TResult>,
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS);
    return handler(user, context as { tenant: string }, ...args);
  });
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

async function upsertTaniumIntegrationRow(args: {
  tenant: string;
  gatewayUrl: string;
  assetApiUrl?: string | null;
  isActive?: boolean;
  connectedAt?: Date | null;
  syncStatus?: 'pending' | 'syncing' | 'completed' | 'error';
  syncError?: string | null;
  useAssetApiFallback?: boolean;
}) {
  const { knex } = await createTenantKnex();

  const settings = {
    provider_settings: {
      tanium: {
        gateway_url: args.gatewayUrl,
        asset_api_url: args.assetApiUrl ?? null,
        use_asset_api_fallback: Boolean(args.useAssetApiFallback),
      },
    },
  };

  const response = await knex('rmm_integrations')
    .insert({
      tenant: args.tenant,
      provider: PROVIDER,
      instance_url: args.gatewayUrl,
      is_active: args.isActive ?? false,
      connected_at: args.connectedAt ?? null,
      sync_status: args.syncStatus ?? 'pending',
      sync_error: args.syncError ?? null,
      settings,
      updated_at: knex.fn.now(),
    })
    .onConflict(['tenant', 'provider'])
    .merge({
      instance_url: args.gatewayUrl,
      is_active: typeof args.isActive === 'boolean' ? args.isActive : knex.raw('rmm_integrations.is_active'),
      connected_at: args.connectedAt ?? knex.raw('rmm_integrations.connected_at'),
      sync_status: args.syncStatus ?? knex.raw('rmm_integrations.sync_status'),
      sync_error: args.syncError ?? null,
      settings,
      updated_at: knex.fn.now(),
    })
    .returning(['integration_id', 'is_active', 'instance_url', 'settings', 'connected_at', 'sync_status', 'sync_error']);

  return Array.isArray(response) ? response[0] : response;
}

async function buildConfiguredTaniumClient(args: { tenant: string; gatewayUrl?: string; apiToken?: string; assetApiUrl?: string | null }) {
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

export const getTaniumSettings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'is_active', 'connected_at', 'last_sync_at', 'sync_status', 'sync_error', 'settings']);

    const secretProvider = await getSecretProviderInstance();
    const [gatewayUrl, apiToken, assetApiUrl] = await Promise.all([
      secretProvider.getTenantSecret(tenant, TANIUM_GATEWAY_URL_SECRET),
      secretProvider.getTenantSecret(tenant, TANIUM_API_TOKEN_SECRET),
      secretProvider.getTenantSecret(tenant, TANIUM_ASSET_API_URL_SECRET),
    ]);

    const providerSettings = integration?.settings?.provider_settings?.tanium || {};

    return {
      success: true,
      config: {
        integrationId: integration?.integration_id || null,
        gatewayUrl: integration?.instance_url || gatewayUrl || '',
        assetApiUrl: providerSettings.asset_api_url || assetApiUrl || '',
        useAssetApiFallback: Boolean(providerSettings.use_asset_api_fallback),
        isActive: Boolean(integration?.is_active),
        connectedAt: integration?.connected_at || null,
        lastSyncAt: integration?.last_sync_at || null,
        syncStatus: integration?.sync_status || 'pending',
        syncError: integration?.sync_error || null,
      },
      credentials: {
        hasApiToken: Boolean(apiToken),
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const saveTaniumConfiguration = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: {
    gatewayUrl: string;
    apiToken?: string;
    assetApiUrl?: string;
    useAssetApiFallback?: boolean;
  }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const gatewayUrl = normalizeTaniumGatewayUrl(input.gatewayUrl);
  if (!gatewayUrl) {
    return { success: false, error: 'Gateway URL is required.' };
  }

  try {
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, TANIUM_GATEWAY_URL_SECRET, gatewayUrl);

    if (input.apiToken) {
      await secretProvider.setTenantSecret(tenant, TANIUM_API_TOKEN_SECRET, input.apiToken);
    }

    if (typeof input.assetApiUrl === 'string') {
      const normalizedAssetUrl = normalizeTaniumGatewayUrl(input.assetApiUrl);
      if (normalizedAssetUrl) {
        await secretProvider.setTenantSecret(tenant, TANIUM_ASSET_API_URL_SECRET, normalizedAssetUrl);
      } else {
        await secretProvider.deleteTenantSecret(tenant, TANIUM_ASSET_API_URL_SECRET);
      }
    }

    const row = await upsertTaniumIntegrationRow({
      tenant,
      gatewayUrl,
      assetApiUrl: input.assetApiUrl ? normalizeTaniumGatewayUrl(input.assetApiUrl) : null,
      useAssetApiFallback: Boolean(input.useAssetApiFallback),
      syncError: null,
    });

    return {
      success: true,
      integrationId: row.integration_id as string,
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const testTaniumConnection = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const client = await buildConfiguredTaniumClient({ tenant });
    await client.testConnection();

    const secretProvider = await getSecretProviderInstance();
    const gatewayUrl = normalizeTaniumGatewayUrl((await secretProvider.getTenantSecret(tenant, TANIUM_GATEWAY_URL_SECRET)) || '');
    const assetApiUrl = (await secretProvider.getTenantSecret(tenant, TANIUM_ASSET_API_URL_SECRET)) || '';

    await upsertTaniumIntegrationRow({
      tenant,
      gatewayUrl,
      assetApiUrl: assetApiUrl || null,
      isActive: true,
      connectedAt: new Date(),
      syncStatus: 'pending',
      syncError: null,
    });

    return { success: true };
  } catch (error) {
    try {
      const { knex } = await createTenantKnex();
      await knex('rmm_integrations')
        .where({ tenant, provider: PROVIDER })
        .update({
          is_active: false,
          sync_error: sanitizeError(error),
          updated_at: knex.fn.now(),
        });
    } catch {
      // Best effort.
    }

    return { success: false, error: sanitizeError(error) };
  }
});

export const disconnectTaniumIntegration = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    await Promise.all([
      secretProvider.deleteTenantSecret(tenant, TANIUM_GATEWAY_URL_SECRET),
      secretProvider.deleteTenantSecret(tenant, TANIUM_API_TOKEN_SECRET),
      secretProvider.deleteTenantSecret(tenant, TANIUM_ASSET_API_URL_SECRET),
    ]);

    const { knex } = await createTenantKnex();
    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        is_active: false,
        connected_at: null,
        sync_status: 'pending',
        sync_error: null,
        updated_at: knex.fn.now(),
      });

    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const syncTaniumScopes = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const { knex } = await createTenantKnex();

  try {
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);
    if (!integration?.integration_id) {
      return { success: false, error: 'Tanium integration not configured.' };
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        sync_status: 'syncing',
        sync_error: null,
        updated_at: knex.fn.now(),
      });

    const client = await buildConfiguredTaniumClient({
      tenant,
      gatewayUrl: integration.instance_url || undefined,
      assetApiUrl: integration?.settings?.provider_settings?.tanium?.asset_api_url || undefined,
    });

    const scopes = await client.listComputerGroups();
    const existing = await knex('rmm_organization_mappings')
      .where({ tenant, integration_id: integration.integration_id })
      .select(['mapping_id', 'external_organization_id', 'client_id', 'auto_sync_assets', 'auto_create_tickets']);

    const byExternalId = new Map(existing.map((row: any) => [String(row.external_organization_id), row]));

    let created = 0;
    let updated = 0;
    for (const scope of scopes) {
      const prior = byExternalId.get(scope.id);
      if (prior) {
        await knex('rmm_organization_mappings')
          .where({ tenant, mapping_id: prior.mapping_id })
          .update({
            external_organization_name: scope.name,
            metadata: { kind: 'computer_group' },
            last_synced_at: knex.fn.now(),
            updated_at: knex.fn.now(),
          });
        updated += 1;
      } else {
        await knex('rmm_organization_mappings').insert({
          tenant,
          integration_id: integration.integration_id,
          external_organization_id: scope.id,
          external_organization_name: scope.name,
          auto_sync_assets: true,
          auto_create_tickets: false,
          metadata: { kind: 'computer_group' },
          last_synced_at: knex.fn.now(),
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
        created += 1;
      }
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        sync_status: 'completed',
        last_sync_at: knex.fn.now(),
        sync_error: null,
        updated_at: knex.fn.now(),
      });

    return {
      success: true,
      items_processed: scopes.length,
      items_created: created,
      items_updated: updated,
      items_failed: 0,
      errors: [],
    };
  } catch (error) {
    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        sync_status: 'error',
        sync_error: sanitizeError(error),
        updated_at: knex.fn.now(),
      });

    return { success: false, error: sanitizeError(error) };
  }
});

export const getTaniumOrganizationMappings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id']);

    if (!integration?.integration_id) {
      return { success: true, mappings: [] };
    }

    const rows = await knex('rmm_organization_mappings as rom')
      .leftJoin('clients as c', function joinClient() {
        this.on('rom.tenant', '=', 'c.tenant').andOn('rom.client_id', '=', 'c.client_id');
      })
      .where({
        'rom.tenant': tenant,
        'rom.integration_id': integration.integration_id,
      })
      .select([
        'rom.mapping_id',
        'rom.external_organization_id',
        'rom.external_organization_name',
        'rom.client_id',
        'rom.auto_sync_assets',
        'rom.auto_create_tickets',
        'rom.last_synced_at',
        'c.client_name as client_name',
      ])
      .orderBy('rom.external_organization_name', 'asc');

    const clients = await knex('clients')
      .where({ tenant })
      .select(['client_id', 'client_name'])
      .orderBy('client_name', 'asc');

    return { success: true, mappings: rows, clients };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const updateTaniumOrganizationMapping = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: {
    mappingId: string;
    clientId?: string | null;
    autoSyncAssets?: boolean;
    autoCreateTickets?: boolean;
  }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const patch: Record<string, unknown> = {
      updated_at: knex.fn.now(),
    };
    if (typeof input.clientId !== 'undefined') patch.client_id = input.clientId || null;
    if (typeof input.autoSyncAssets !== 'undefined') patch.auto_sync_assets = input.autoSyncAssets;
    if (typeof input.autoCreateTickets !== 'undefined') patch.auto_create_tickets = input.autoCreateTickets;

    await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: input.mappingId })
      .update(patch);

    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const triggerTaniumFullSync = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const { knex } = await createTenantKnex();

  try {
    return await runRmmSyncWithTransport({
      context: {
        provider: PROVIDER,
        operation: 'full_inventory_sync',
        input: { tenant },
      },
      directExecutor: async () => {
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tanium integration not configured.' };
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        sync_status: 'syncing',
        sync_error: null,
        updated_at: knex.fn.now(),
      });

    const mappedScopes = await knex('rmm_organization_mappings')
      .where({ tenant, integration_id: integration.integration_id })
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
          error: sanitizeError(criticalityError),
        });
      }

      if (endpoints.length === 0 && useAssetApiFallback) {
        const fallbackEndpoints = await client.listAgedOutAssetFallback({ computerGroupId: externalScopeId });
        endpoints = fallbackEndpoints;
      }

      for (const endpoint of endpoints) {
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
          errors.push(`${endpoint.id}: ${sanitizeError(error)}`);
        }
      }
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        sync_status: errors.length ? 'error' : 'completed',
        last_sync_at: knex.fn.now(),
        last_full_sync_at: knex.fn.now(),
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
    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({
        sync_status: 'error',
        sync_error: sanitizeError(error),
        updated_at: knex.fn.now(),
      });

    return { success: false, error: sanitizeError(error) };
  }
});
