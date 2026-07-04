'use server';

import { randomBytes } from 'crypto';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { TIER_FEATURES } from '@alga-psa/types';
import { createTenantKnex } from '@/lib/db';
import { getWebhookBaseUrl } from '@alga-psa/integrations/utils/email/webhookHelpers';
import { buildIntegrationDisconnectedPayload } from '@alga-psa/workflow-streams';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { runRmmSyncWithTransport } from '../../integrations/rmm/sync/syncOrchestration';
import {
  createLevelIoClient,
  DEFAULT_LEVELIO_BASE_URL,
  LevelIoApiClient,
  LEVELIO_API_KEY_SECRET,
  LEVELIO_WEBHOOK_SECRET_KEY,
} from '../../integrations/levelio/levelApiClient';
import {
  runLevelIoAlertsBackfill,
  runLevelIoDeviceSync,
  runLevelIoFullSync,
  runLevelIoScopeSync,
} from '../../integrations/levelio/sync/syncEngine';
import {
  levelIoTransportOverride,
  startLevelIoDeviceSyncWorkflow,
  startLevelIoSyncWorkflow,
  type LevelIoWorkflowSyncType,
} from '../../integrations/levelio/sync/transport';

const PROVIDER = 'levelio' as const;

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

async function getLevelIoIntegration(tenant: string) {
  const { knex } = await createTenantKnex();
  const integration = await tenantDb(knex, tenant).table('rmm_integrations')
    .where({ provider: PROVIDER })
    .first([
      'integration_id',
      'is_active',
      'connected_at',
      'last_sync_at',
      'last_full_sync_at',
      'sync_status',
      'sync_error',
    ]);
  return { knex, integration };
}

async function upsertLevelIoIntegrationRow(args: {
  tenant: string;
  isActive?: boolean;
  connectedAt?: Date | null;
  syncStatus?: 'pending' | 'syncing' | 'completed' | 'error';
  syncError?: string | null;
}) {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, args.tenant);
  const settings = { provider_settings: { levelio: {} } };

  const response = await db.table('rmm_integrations')
    .insert({
      tenant: args.tenant,
      provider: PROVIDER,
      instance_url: DEFAULT_LEVELIO_BASE_URL,
      is_active: args.isActive ?? false,
      connected_at: args.connectedAt ?? null,
      sync_status: args.syncStatus ?? 'pending',
      sync_error: args.syncError ?? null,
      settings,
      updated_at: knex.fn.now(),
    })
    .onConflict(['tenant', 'provider'])
    .merge({
      instance_url: DEFAULT_LEVELIO_BASE_URL,
      is_active: typeof args.isActive === 'boolean' ? args.isActive : knex.raw('rmm_integrations.is_active'),
      connected_at: args.connectedAt ?? knex.raw('rmm_integrations.connected_at'),
      sync_status: args.syncStatus ?? knex.raw('rmm_integrations.sync_status'),
      sync_error: args.syncError ?? null,
      updated_at: new Date().toISOString(),
    })
    .returning(['integration_id', 'is_active', 'instance_url', 'connected_at', 'sync_status', 'sync_error']);

  return Array.isArray(response) ? response[0] : response;
}

async function runLevelIoSyncOperation(args: {
  tenant: string;
  operation: 'scope_sync' | 'full_sync' | 'alerts_backfill';
  syncType: LevelIoWorkflowSyncType;
}) {
  const { knex, integration } = await getLevelIoIntegration(args.tenant);
  if (!integration?.integration_id) {
    throw new Error('Level integration is not configured.');
  }

  const engineByType = {
    organizations: runLevelIoScopeSync,
    full: runLevelIoFullSync,
    alerts: runLevelIoAlertsBackfill,
  } as const;

  return runRmmSyncWithTransport({
    context: {
      provider: PROVIDER,
      operation: args.operation,
      input: { tenant: args.tenant },
    },
    transportOverride: levelIoTransportOverride(),
    directExecutor: async () => {
      const client = await createLevelIoClient(args.tenant);
      return engineByType[args.syncType](
        { tenant: args.tenant, integrationId: integration.integration_id },
        { knex, client }
      );
    },
    temporalExecutor: async () =>
      startLevelIoSyncWorkflow({
        tenantId: args.tenant,
        integrationId: integration.integration_id,
        syncType: args.syncType,
      }),
  });
}

export const getLevelIoSettings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { integration } = await getLevelIoIntegration(tenant);
    const secretProvider = await getSecretProviderInstance();
    const apiKey = await secretProvider.getTenantSecret(tenant, LEVELIO_API_KEY_SECRET);

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
      },
      credentials: {
        hasApiKey: Boolean(apiKey),
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const saveLevelIoConfiguration = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { apiKey?: string }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    const candidateKey =
      input.apiKey?.trim() || (await secretProvider.getTenantSecret(tenant, LEVELIO_API_KEY_SECRET)) || '';
    if (!candidateKey) {
      return { success: false, error: 'A Level API key is required.' };
    }

    // Validate the key against the live API before persisting anything.
    const client = new LevelIoApiClient({
      apiKey: candidateKey,
      baseUrl: process.env.LEVELIO_API_BASE_URL || DEFAULT_LEVELIO_BASE_URL,
    });
    await client.testConnection();

    if (input.apiKey?.trim()) {
      await secretProvider.setTenantSecret(tenant, LEVELIO_API_KEY_SECRET, input.apiKey.trim());
    }

    const existingWebhookSecret = await secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY);
    if (!existingWebhookSecret) {
      await secretProvider.setTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY, randomBytes(24).toString('hex'));
    }

    const row = await upsertLevelIoIntegrationRow({
      tenant,
      isActive: true,
      connectedAt: new Date(),
      syncError: null,
    });

    return { success: true, integrationId: row.integration_id as string };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const testLevelIoConnection = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const client = await createLevelIoClient(tenant);
    await client.testConnection();

    await upsertLevelIoIntegrationRow({
      tenant,
      isActive: true,
      connectedAt: new Date(),
      syncStatus: 'pending',
      syncError: null,
    });

    return { success: true };
  } catch (error) {
    try {
      const { knex } = await createTenantKnex();
      await tenantDb(knex, tenant).table('rmm_integrations')
        .where({ provider: PROVIDER })
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

export const disconnectLevelIoIntegration = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);

    const secretProvider = await getSecretProviderInstance();
    await Promise.all([
      secretProvider.deleteTenantSecret(tenant, LEVELIO_API_KEY_SECRET),
      secretProvider.deleteTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY),
    ]);

    await tenantDb(knex, tenant).table('rmm_integrations')
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
    return { success: false, error: sanitizeError(error) };
  }
});

export const syncLevelIoOrganizations = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    return await runLevelIoSyncOperation({ tenant, operation: 'scope_sync', syncType: 'organizations' });
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const triggerLevelIoFullSync = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    return await runLevelIoSyncOperation({ tenant, operation: 'full_sync', syncType: 'full' });
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const backfillLevelIoAlerts = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    return await runLevelIoSyncOperation({ tenant, operation: 'alerts_backfill', syncType: 'alerts' });
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const syncLevelIoSingleDevice = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  deviceId: string
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);
    if (!integration?.integration_id) {
      return { success: false, error: 'Level integration is not configured.' };
    }

    const outcome = await runRmmSyncWithTransport({
      context: { provider: PROVIDER, operation: 'device_sync', input: { tenant, deviceId } },
      transportOverride: levelIoTransportOverride(),
      directExecutor: async () => {
        const client = await createLevelIoClient(tenant);
        return runLevelIoDeviceSync(
          { tenant, integrationId: integration.integration_id, deviceId },
          { knex, client }
        );
      },
      temporalExecutor: async () =>
        (await startLevelIoDeviceSyncWorkflow({
          tenantId: tenant,
          integrationId: integration.integration_id,
          deviceId,
          waitForResult: true,
        }))!,
    });

    return { success: true, outcome };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const listLevelIoOrganizationMappings = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);
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

    const clients = await db.table('clients')
      .select(['client_id', 'client_name'])
      .orderBy('client_name', 'asc');

    return { success: true, mappings: rows, clients };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const updateLevelIoOrganizationMapping = withAdvancedAssetsAccess(async (
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
    const patch: Record<string, unknown> = {
      updated_at: knex.fn.now(),
    };
    if (typeof input.clientId !== 'undefined') patch.client_id = input.clientId || null;
    if (typeof input.defaultContactId !== 'undefined') patch.default_contact_id = input.defaultContactId || null;
    if (typeof input.autoSyncAssets !== 'undefined') patch.auto_sync_assets = input.autoSyncAssets;
    if (typeof input.autoCreateTickets !== 'undefined') patch.auto_create_tickets = input.autoCreateTickets;

    await db.table('rmm_organization_mappings')
      .where({ mapping_id: input.mappingId })
      .update(patch);

    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const getLevelIoWebhookInfo = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    // The webhook secret is generated by saveLevelIoConfiguration on first save.
    const secret = await secretProvider.getTenantSecret(tenant, LEVELIO_WEBHOOK_SECRET_KEY);
    if (!secret) {
      return { success: true, webhook: null };
    }

    const baseUrl = getWebhookBaseUrl().replace(/\/$/, '');
    const payloadTemplate = JSON.stringify(
      {
        event: 'alert.triggered',
        alert_id: '{{alert_id}}',
        device_id: '{{device_id}}',
        hostname: '{{hostname}}',
        name: '{{alert_name}}',
        severity: '{{severity}}',
        description: '{{description}}',
      },
      null,
      2
    );

    return {
      success: true,
      webhook: {
        url: `${baseUrl}/api/webhooks/levelio?tenant=${encodeURIComponent(tenant)}`,
        headerName: 'X-Alga-Webhook-Secret',
        secret,
        payloadTemplate,
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});

export const getLevelIoConnectionSummary = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getLevelIoIntegration(tenant);
    if (!integration?.integration_id) {
      return { success: true, summary: { mappedGroups: 0, devices: 0, activeAlerts: 0 } };
    }

    const [mappedGroups, devices, activeAlerts] = await Promise.all([
      tenantDb(knex, tenant).table('rmm_organization_mappings')
        .where({ integration_id: integration.integration_id })
        .whereNotNull('client_id')
        .count<{ count: string }[]>('mapping_id as count'),
      tenantDb(knex, tenant).table('assets').where({ rmm_provider: PROVIDER }).count<{ count: string }[]>('asset_id as count'),
      tenantDb(knex, tenant).table('rmm_alerts')
        .where({ integration_id: integration.integration_id, status: 'active' })
        .count<{ count: string }[]>('alert_id as count'),
    ]);

    return {
      success: true,
      summary: {
        mappedGroups: Number(mappedGroups[0]?.count ?? 0),
        devices: Number(devices[0]?.count ?? 0),
        activeAlerts: Number(activeAlerts[0]?.count ?? 0),
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error) };
  }
});
