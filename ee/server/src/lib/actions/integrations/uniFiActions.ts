'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { TIER_FEATURES } from '@alga-psa/types';
import { createTenantKnex } from '@/lib/db';
import { buildIntegrationDisconnectedPayload } from '@alga-psa/workflow-streams';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { runRmmSyncWithTransport } from '../../integrations/rmm/sync/syncOrchestration';
import {
  createUniFiClient,
  normalizeLocalBaseUrl,
  UniFiApiClient,
  UniFiApiError,
  UNIFI_API_KEY_SECRET,
  UNIFI_CLOUD_BASE_URL,
  UNIFI_LOCAL_BASE_URL_SECRET,
  type UniFiConnectionMode,
} from '../../integrations/unifi/unifiApiClient';
import { clearReconnectRequired } from '../../integrations/unifi/reconnect';
import { runUniFiDeviceSync, runUniFiFullSync, runUniFiScopeSync } from '../../integrations/unifi/sync/syncEngine';
import {
  startUniFiDeviceSyncWorkflow,
  startUniFiSyncWorkflow,
  unifiTransportOverride,
} from '../../integrations/unifi/sync/transport';

const PROVIDER = 'unifi' as const;
const DEFAULT_OFFLINE_GRACE_MINUTES = 5;

function sanitizeError(error: unknown, fallback = 'Unable to complete the UniFi request.'): string {
  if (error instanceof UniFiApiError) {
    switch (error.kind) {
      case 'auth':
        return 'UniFi rejected the API key. Create a new key and save it in the integration settings.';
      case 'rate_limited':
        return 'UniFi rate limit reached. Please try again later.';
      case 'config':
      case 'network':
        return error.message;
      case 'invalid_response':
        return 'UniFi returned an unexpected response. The API may have changed; try again later.';
      default:
        return error.status && error.status >= 500
          ? 'UniFi is temporarily unavailable. Please try again later.'
          : fallback;
    }
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return fallback;
  if (message === 'Forbidden' || message.startsWith('Forbidden:')) {
    return 'You do not have permission to manage UniFi settings.';
  }
  if (message === 'UniFi integration is not configured.') return message;
  if (message.includes('fetch failed') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return 'Unable to reach UniFi. Check network connectivity and try again.';
  }
  return fallback;
}

function withAdvancedAssetsAccess<TArgs extends unknown[], TResult>(
  handler: (user: any, context: { tenant: string }, ...args: TArgs) => Promise<TResult>,
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS);
    return handler(user, context as { tenant: string }, ...args);
  });
}

function parseSettings(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function resolveMode(settings: Record<string, unknown>): UniFiConnectionMode {
  return settings.connectionMode === 'local' ? 'local' : 'site_manager';
}

async function getUniFiIntegration(tenant: string) {
  const { knex } = await createTenantKnex();
  const integration = await tenantDb(knex, tenant)
    .table('rmm_integrations')
    .where({ provider: PROVIDER })
    .first([
      'integration_id',
      'is_active',
      'instance_url',
      'connected_at',
      'last_sync_at',
      'last_full_sync_at',
      'sync_status',
      'sync_error',
      'settings',
    ]);
  return { knex, integration };
}

async function upsertUniFiIntegrationRow(args: {
  tenant: string;
  mode: UniFiConnectionMode;
  isActive?: boolean;
  connectedAt?: Date | null;
  syncStatus?: 'pending' | 'syncing' | 'completed' | 'error';
  syncError?: string | null;
}) {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, args.tenant);
  const existing = await db.table('rmm_integrations').where({ provider: PROVIDER }).first(['settings']);
  const prior = clearReconnectRequired(parseSettings(existing?.settings));
  const settings = {
    deviceSync: { enabled: true, intervalMinutes: 60 },
    alertPolling: { enabled: true, intervalMinutes: 5 },
    offlineGraceMinutes: DEFAULT_OFFLINE_GRACE_MINUTES,
    ...prior,
    connectionMode: args.mode,
  };
  const instanceUrl = args.mode === 'local' ? null : UNIFI_CLOUD_BASE_URL;

  const response = await db
    .table('rmm_integrations')
    .insert({
      tenant: args.tenant,
      provider: PROVIDER,
      instance_url: instanceUrl,
      is_active: args.isActive ?? false,
      connected_at: args.connectedAt ?? null,
      sync_status: args.syncStatus ?? 'pending',
      sync_error: args.syncError ?? null,
      settings: JSON.stringify(settings),
      updated_at: knex.fn.now(),
    })
    .onConflict(['tenant', 'provider'])
    .merge({
      instance_url: instanceUrl,
      is_active: typeof args.isActive === 'boolean' ? args.isActive : knex.raw('rmm_integrations.is_active'),
      connected_at: args.connectedAt ?? knex.raw('rmm_integrations.connected_at'),
      sync_status: args.syncStatus ?? knex.raw('rmm_integrations.sync_status'),
      sync_error: args.syncError ?? null,
      settings: JSON.stringify(settings),
      updated_at: new Date().toISOString(),
    })
    .returning(['integration_id', 'is_active', 'connected_at', 'sync_status', 'sync_error']);

  return Array.isArray(response) ? response[0] : response;
}

export const getUniFiSettings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { integration } = await getUniFiIntegration(tenant);
    const secretProvider = await getSecretProviderInstance();
    const apiKey = await secretProvider.getTenantSecret(tenant, UNIFI_API_KEY_SECRET);
    const localBaseUrl = await secretProvider.getTenantSecret(tenant, UNIFI_LOCAL_BASE_URL_SECRET);
    const settings = parseSettings(integration?.settings);
    const lifecycle = (settings.tokenLifecycle ?? {}) as { status?: string };
    const grace = Number(settings.offlineGraceMinutes);

    return {
      success: true,
      config: {
        integrationId: integration?.integration_id || null,
        isActive: Boolean(integration?.is_active),
        connectedAt: integration?.connected_at || null,
        lastSyncAt: integration?.last_sync_at || null,
        lastFullSyncAt: integration?.last_full_sync_at || null,
        syncStatus: integration?.sync_status || 'pending',
        syncError: integration?.sync_error || null,
        connectionMode: resolveMode(settings),
        localBaseUrl: localBaseUrl || null,
        reconnectRequired: lifecycle.status === 'reconnect_required',
        offlineGraceMinutes: Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_OFFLINE_GRACE_MINUTES,
      },
      // Only a boolean ever leaves the server; the stored key is never returned.
      credentials: { hasApiKey: Boolean(apiKey) },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to load UniFi settings.') };
  }
});

export const saveUniFiConfiguration = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { apiKey?: string; connectionMode?: UniFiConnectionMode; localBaseUrl?: string }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const mode: UniFiConnectionMode = input.connectionMode === 'local' ? 'local' : 'site_manager';
    const secretProvider = await getSecretProviderInstance();
    const newKey = input.apiKey?.trim() || '';
    const candidateKey = newKey || (await secretProvider.getTenantSecret(tenant, UNIFI_API_KEY_SECRET)) || '';
    if (!candidateKey) {
      return { success: false, error: 'A UniFi API key is required.' };
    }

    let localBaseUrl: string | undefined;
    if (mode === 'local') {
      const rawUrl =
        input.localBaseUrl?.trim() || (await secretProvider.getTenantSecret(tenant, UNIFI_LOCAL_BASE_URL_SECRET)) || '';
      if (!rawUrl) return { success: false, error: 'A controller URL is required for local mode.' };
      localBaseUrl = normalizeLocalBaseUrl(rawUrl);
    }

    // Validate against the live API before persisting anything.
    const client = new UniFiApiClient({ apiKey: candidateKey, mode, localBaseUrl });
    await client.testConnection();

    if (newKey) await secretProvider.setTenantSecret(tenant, UNIFI_API_KEY_SECRET, newKey);
    if (localBaseUrl) await secretProvider.setTenantSecret(tenant, UNIFI_LOCAL_BASE_URL_SECRET, localBaseUrl);

    const row = await upsertUniFiIntegrationRow({
      tenant,
      mode,
      isActive: true,
      connectedAt: new Date(),
      syncError: null,
    });

    return { success: true, integrationId: row.integration_id as string };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to save UniFi configuration.') };
  }
});

export const testUniFiConnection = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { integration } = await getUniFiIntegration(tenant);
    const mode = resolveMode(parseSettings(integration?.settings));
    const client = await createUniFiClient(tenant, mode);
    await client.testConnection();

    await upsertUniFiIntegrationRow({
      tenant,
      mode,
      isActive: true,
      connectedAt: new Date(),
      syncStatus: 'pending',
      syncError: null,
    });

    return { success: true };
  } catch (error) {
    const message = sanitizeError(error, 'Unable to test the UniFi connection.');
    try {
      const { knex } = await createTenantKnex();
      await tenantDb(knex, tenant)
        .table('rmm_integrations')
        .where({ provider: PROVIDER })
        .update({ is_active: false, sync_error: message, updated_at: knex.fn.now() });
    } catch {
      // Best effort.
    }
    return { success: false, error: message };
  }
});

export const disconnectUniFiIntegration = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getUniFiIntegration(tenant);

    const secretProvider = await getSecretProviderInstance();
    await Promise.all([
      secretProvider.deleteTenantSecret(tenant, UNIFI_API_KEY_SECRET),
      secretProvider.deleteTenantSecret(tenant, UNIFI_LOCAL_BASE_URL_SECRET),
    ]);

    await tenantDb(knex, tenant)
      .table('rmm_integrations')
      .where({ provider: PROVIDER })
      .update({
        is_active: false,
        connected_at: null,
        sync_status: 'pending',
        sync_error: null,
        updated_at: knex.fn.now(),
      });

    if (integration?.integration_id) {
      const disconnectedAt = new Date().toISOString();
      try {
        await publishWorkflowEvent({
          eventType: 'INTEGRATION_DISCONNECTED',
          payload: buildIntegrationDisconnectedPayload({
            integrationId: integration.integration_id,
            provider: PROVIDER,
            connectionId: integration.integration_id,
            disconnectedAt,
            disconnectedByUserId: user.user_id,
            reason: 'user_requested',
          }),
          ctx: {
            tenantId: tenant,
            actor: { actorType: 'USER', actorUserId: user.user_id },
            occurredAt: disconnectedAt,
          },
          idempotencyKey: `integration_disconnected:${tenant}:${integration.integration_id}:${disconnectedAt}`,
        });
      } catch {
        // Best-effort event.
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to disconnect UniFi.') };
  }
});

export const syncUniFiSites = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getUniFiIntegration(tenant);
    if (!integration?.integration_id) {
      throw new Error('UniFi integration is not configured.');
    }
    const mode = resolveMode(parseSettings(integration.settings));

    return await runRmmSyncWithTransport({
      context: { provider: PROVIDER, operation: 'scope_sync', input: { tenant } },
      transportOverride: unifiTransportOverride(),
      directExecutor: async () => {
        const client = await createUniFiClient(tenant, mode);
        return runUniFiScopeSync({ tenant, integrationId: integration.integration_id }, { knex, client });
      },
      temporalExecutor: async () =>
        startUniFiSyncWorkflow({
          tenantId: tenant,
          integrationId: integration.integration_id,
          syncType: 'organizations',
        }),
    });
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to sync UniFi sites.') };
  }
});

export const triggerUniFiFullSync = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getUniFiIntegration(tenant);
    if (!integration?.integration_id) {
      throw new Error('UniFi integration is not configured.');
    }
    const mode = resolveMode(parseSettings(integration.settings));

    return await runRmmSyncWithTransport({
      context: { provider: PROVIDER, operation: 'full_sync', input: { tenant } },
      transportOverride: unifiTransportOverride(),
      directExecutor: async () => {
        const client = await createUniFiClient(tenant, mode);
        return runUniFiFullSync({ tenant, integrationId: integration.integration_id }, { knex, client });
      },
      temporalExecutor: async () =>
        startUniFiSyncWorkflow({ tenantId: tenant, integrationId: integration.integration_id, syncType: 'full' }),
    });
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to sync UniFi devices.') };
  }
});

export const syncUniFiSingleDevice = withAdvancedAssetsAccess(
  async (user, { tenant }, scopeKey: string, deviceId: string) => {
    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) return { success: false, error: 'Forbidden' };

    try {
      const { knex, integration } = await getUniFiIntegration(tenant);
      if (!integration?.integration_id) {
        throw new Error('UniFi integration is not configured.');
      }
      const mode = resolveMode(parseSettings(integration.settings));
      const args = { tenant, integrationId: integration.integration_id, scopeKey, deviceId };

      if (unifiTransportOverride() === 'direct') {
        const client = await createUniFiClient(tenant, mode);
        const result = await runUniFiDeviceSync(args, { knex, client });
        return { success: true, result };
      }
      const result = await startUniFiDeviceSyncWorkflow({
        tenantId: tenant,
        integrationId: integration.integration_id,
        scopeKey,
        deviceId,
        waitForResult: true,
      });
      return { success: true, result };
    } catch (error) {
      return { success: false, error: sanitizeError(error, 'Unable to sync the UniFi device.') };
    }
  }
);

export const listUniFiSiteMappings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getUniFiIntegration(tenant);
    if (!integration?.integration_id) {
      return { success: true, mappings: [], clients: [] };
    }

    const db = tenantDb(knex, tenant);
    const rowsQuery = db.table('rmm_organization_mappings as rom');
    db.tenantJoin(rowsQuery, 'clients as c', 'rom.client_id', 'c.client_id', { type: 'left' });

    const rows = await rowsQuery
      .where({ 'rom.integration_id': integration.integration_id })
      .select([
        'rom.mapping_id',
        'rom.external_organization_id',
        'rom.external_organization_name',
        'rom.client_id',
        'rom.default_contact_id',
        'rom.auto_sync_assets',
        'rom.auto_create_tickets',
        'rom.metadata',
        'rom.last_synced_at',
        'c.client_name as client_name',
      ])
      .orderBy('rom.external_organization_name', 'asc');

    const clients = await db.table('clients').select(['client_id', 'client_name']).orderBy('client_name', 'asc');

    return { success: true, mappings: rows, clients };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to load UniFi site mappings.') };
  }
});

export const updateUniFiSiteMapping = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: {
    mappingId: string;
    clientId?: string | null;
    defaultContactId?: string | null;
    autoSyncAssets?: boolean;
    autoCreateTickets?: boolean;
  }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const patch: Record<string, unknown> = { updated_at: knex.fn.now() };
    if (typeof input.clientId !== 'undefined') patch.client_id = input.clientId || null;
    if (typeof input.defaultContactId !== 'undefined') patch.default_contact_id = input.defaultContactId || null;
    if (typeof input.autoSyncAssets !== 'undefined') patch.auto_sync_assets = input.autoSyncAssets;
    if (typeof input.autoCreateTickets !== 'undefined') patch.auto_create_tickets = input.autoCreateTickets;

    await db.table('rmm_organization_mappings').where({ mapping_id: input.mappingId }).update(patch);

    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to update the UniFi site mapping.') };
  }
});

export const getUniFiConnectionSummary = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getUniFiIntegration(tenant);
    if (!integration?.integration_id) {
      return { success: true, summary: { mappedSites: 0, devices: 0, activeAlerts: 0 } };
    }

    const db = tenantDb(knex, tenant);
    const [mappedSites, devices, activeAlerts] = await Promise.all([
      db
        .table('rmm_organization_mappings')
        .where({ integration_id: integration.integration_id })
        .whereNotNull('client_id')
        .count<{ count: string }[]>('mapping_id as count'),
      db.table('assets').where({ rmm_provider: PROVIDER }).count<{ count: string }[]>('asset_id as count'),
      db
        .table('rmm_alerts')
        .where({ integration_id: integration.integration_id, status: 'active' })
        .count<{ count: string }[]>('alert_id as count'),
    ]);

    return {
      success: true,
      summary: {
        mappedSites: Number(mappedSites[0]?.count ?? 0),
        devices: Number(devices[0]?.count ?? 0),
        activeAlerts: Number(activeAlerts[0]?.count ?? 0),
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to load UniFi connection summary.') };
  }
});
