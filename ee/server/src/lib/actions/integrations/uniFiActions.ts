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
  UniFiApiError,
  UNIFI_CLOUD_BASE_URL,
  type UniFiConnectionMode,
} from '../../integrations/unifi/unifiApiClient';
import {
  addCredential,
  listCredentialViews,
  removeCredential,
  replaceCredentialKey,
  updateCredential,
  UniFiCredentialError,
} from '../../integrations/unifi/credentials/credentialService';
import {
  clearRoutes,
  deleteCredentialSecrets,
  LEGACY_API_KEY_SECRET,
  LEGACY_LOCAL_BASE_URL_SECRET,
  listCredentialRecords,
} from '../../integrations/unifi/credentials/credentialStore';
import { reconcileUniFiAlertsNow } from '../../integrations/unifi/alerts/uniFiAlertReconcile';
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
  // Validation text from the credential service is written for the user.
  if (error instanceof UniFiCredentialError) return error.message;
  if (error instanceof UniFiApiError) {
    switch (error.kind) {
      case 'auth':
        return 'UniFi rejected the API key. Create a new key and save it in the integration settings.';
      case 'credential_unavailable':
        return error.message;
      case 'console_forbidden':
        return 'UniFi denied access to a console. It may be offline or not shared with this API key.';
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
    const { knex } = await createTenantKnex();
    const credentialList = integration?.integration_id
      ? await listCredentialViews(knex, tenant, integration.integration_id)
      : { credentials: [], unreachableConsoles: [] };
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
        reconnectRequired: lifecycle.status === 'reconnect_required',
        offlineGraceMinutes: Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_OFFLINE_GRACE_MINUTES,
      },
      // Only labels, modes and statuses leave the server; no key and no controller URL.
      credentials: {
        hasApiKey: credentialList.credentials.length > 0,
        items: credentialList.credentials,
        unreachableConsoles: credentialList.unreachableConsoles,
      },
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to load UniFi settings.') };
  }
});

/**
 * Run one offline-alert cycle right after a successful connect so the MSP sees
 * current outages immediately. Best effort: a failure here must never fail the
 * connect itself (the scheduled poller will retry).
 */
async function reconcileAlertsBestEffort(tenant: string): Promise<void> {
  try {
    await reconcileUniFiAlertsNow(tenant);
  } catch {
    // Intentionally swallowed; the scheduled reconciliation surfaces persistent failures.
  }
}

/**
 * Converge the recurring rmm-alert-reconciliation / rmm-device-sync jobs right
 * after the integration's active state changes, instead of waiting for the
 * maintenance tick (same pattern as ninjaoneActions.ts disconnect). Best effort.
 */
// LEVERAGE: pattern rmm-provider-registration — each provider's connect/disconnect action re-invokes the schedule reconciler by hand
async function convergePollingSchedulesBestEffort(): Promise<void> {
  try {
    const { reconcileRmmPollingSchedules } = await import('@alga-psa/jobs/handlers/rmmAlertPollingHandlers');
    const { initializeJobRunner } = await import('server/src/lib/jobs/initializeJobRunner');
    await reconcileRmmPollingSchedules(await initializeJobRunner());
  } catch {
    // The periodic reconciler converges schedules on its next tick.
  }
}

/**
 * First connect (and the single-key form): creates the 'Default' credential when
 * the tenant has none. Later keys go through addUniFiCredential.
 */
export const saveUniFiConfiguration = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { apiKey?: string; connectionMode?: UniFiConnectionMode; localBaseUrl?: string; label?: string }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const mode: UniFiConnectionMode = input.connectionMode === 'local' ? 'local' : 'site_manager';
    const { knex } = await createTenantKnex();

    // The integration row must exist before a credential can reference it. It is
    // created inactive; it is only activated after the key has been verified.
    // An existing row is left untouched until validation passes (a rejected mode change
    // must not rewrite settings.connectionMode).
    const found = await getUniFiIntegration(tenant);
    const integrationId = (found.integration?.integration_id ??
      (await upsertUniFiIntegrationRow({ tenant, mode })).integration_id) as string;
    const existing = await listCredentialRecords(knex, tenant, integrationId);

    if (existing.length === 0) {
      await addCredential(knex, tenant, {
        integrationId,
        label: input.label?.trim() || 'Default',
        mode,
        apiKey: input.apiKey,
        localBaseUrl: input.localBaseUrl,
      });
    } else {
      // Single-key form against an existing integration edits the oldest credential.
      // Destination binding is enforced inside: a URL or mode change needs a new key.
      const target = existing[0];
      if (mode !== target.mode) {
        throw new UniFiCredentialError(
          'A key cannot change its connection mode. Remove it and add a new key in the other mode.'
        );
      }
      if (input.apiKey?.trim()) {
        await replaceCredentialKey(knex, tenant, {
          integrationId,
          credentialId: target.credentialId,
          apiKey: input.apiKey,
          localBaseUrl: input.localBaseUrl,
        });
      } else {
        await updateCredential(knex, tenant, {
          integrationId,
          credentialId: target.credentialId,
          localBaseUrl: input.localBaseUrl,
        });
      }
    }

    const row = await upsertUniFiIntegrationRow({
      tenant,
      mode,
      isActive: true,
      connectedAt: new Date(),
      syncError: null,
    });

    await convergePollingSchedulesBestEffort();
    await reconcileAlertsBestEffort(tenant);
    return { success: true, integrationId: row.integration_id as string };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to save UniFi configuration.') };
  }
});

async function requireIntegrationId(tenant: string): Promise<{ knex: any; integrationId: string; mode: UniFiConnectionMode }> {
  const { knex, integration } = await getUniFiIntegration(tenant);
  if (!integration?.integration_id) throw new Error('UniFi integration is not configured.');
  return {
    knex,
    integrationId: integration.integration_id as string,
    mode: resolveMode(parseSettings(integration.settings)),
  };
}

/** Adds a key. The key is verified against the destination it was entered for before anything is saved. */
export const addUniFiCredential = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { label: string; apiKey: string; connectionMode?: UniFiConnectionMode; localBaseUrl?: string }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integrationId, mode: integrationMode } = await requireIntegrationId(tenant);
    const credential = await addCredential(knex, tenant, {
      integrationId,
      label: input.label,
      mode: input.connectionMode === 'local' ? 'local' : input.connectionMode === 'site_manager' ? 'site_manager' : integrationMode,
      apiKey: input.apiKey,
      localBaseUrl: input.localBaseUrl,
    });
    return { success: true, credentialId: credential.credentialId };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to add the UniFi key.') };
  }
});

export const replaceUniFiCredentialKey = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { credentialId: string; apiKey: string; localBaseUrl?: string }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integrationId } = await requireIntegrationId(tenant);
    await replaceCredentialKey(knex, tenant, { integrationId, ...input });
    // A replaced key revives a parked integration only through the normal connect path.
    const { integration } = await getUniFiIntegration(tenant);
    await upsertUniFiIntegrationRow({
      tenant,
      mode: resolveMode(parseSettings(integration?.settings)),
      isActive: true,
      connectedAt: new Date(),
      syncError: null,
    });
    await convergePollingSchedulesBestEffort();
    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to replace the UniFi key.') };
  }
});

export const updateUniFiCredential = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { credentialId: string; label?: string; connectionMode?: UniFiConnectionMode; localBaseUrl?: string; apiKey?: string }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integrationId } = await requireIntegrationId(tenant);
    await updateCredential(knex, tenant, {
      integrationId,
      credentialId: input.credentialId,
      label: input.label,
      mode: input.connectionMode,
      localBaseUrl: input.localBaseUrl,
      apiKey: input.apiKey,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to update the UniFi key.') };
  }
});

/** First call without `confirm` lists the mapped sites that would lose their key; the UI asks, then repeats with confirm. */
export const removeUniFiCredential = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: { credentialId: string; confirm?: boolean }
) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integrationId } = await requireIntegrationId(tenant);
    const outcome = await removeCredential(knex, tenant, { integrationId, ...input });
    return { success: true, ...outcome };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to remove the UniFi key.') };
  }
});

/** Manual re-check: forgets console routes and tests every key against its own destination. */
export const testUniFiConnection = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex, integration } = await getUniFiIntegration(tenant);
    const mode = resolveMode(parseSettings(integration?.settings));
    if (integration?.integration_id) await clearRoutes(knex, tenant, integration.integration_id);
    const client = await createUniFiClient(tenant, mode);
    await client.testConnection();
    // Run the consoles through discovery so routes and unreachable consoles are fresh.
    await client.listSites().catch(() => undefined);

    await upsertUniFiIntegrationRow({
      tenant,
      mode,
      isActive: true,
      connectedAt: new Date(),
      syncStatus: 'pending',
      syncError: null,
    });

    await convergePollingSchedulesBestEffort();
    await reconcileAlertsBestEffort(tenant);
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
    if (integration?.integration_id) {
      const credentials = await listCredentialRecords(knex, tenant, integration.integration_id);
      await Promise.all(credentials.map((credential) => deleteCredentialSecrets(tenant, credential.credentialId)));
      await tenantDb(knex, tenant).table('unifi_console_routes').where({ integration_id: integration.integration_id }).delete();
      await tenantDb(knex, tenant).table('unifi_credentials').where({ integration_id: integration.integration_id }).delete();
    }
    await Promise.all([
      secretProvider.deleteTenantSecret(tenant, LEGACY_API_KEY_SECRET),
      secretProvider.deleteTenantSecret(tenant, LEGACY_LOCAL_BASE_URL_SECRET),
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

    // Integration is inactive now: cancel its recurring jobs immediately.
    await convergePollingSchedulesBestEffort();

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

export const saveUniFiAlertingSettings = withAdvancedAssetsAccess(
  async (user, { tenant }, input: { offlineGraceMinutes: number }) => {
    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) return { success: false, error: 'Forbidden' };

    const minutes = Number(input?.offlineGraceMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      return { success: false, error: 'Enter a whole number of minutes between 0 and 1440.' };
    }

    try {
      const { knex, integration } = await getUniFiIntegration(tenant);
      if (!integration?.integration_id) {
        return { success: false, error: 'UniFi integration is not configured.' };
      }
      await knex.raw(
        `UPDATE rmm_integrations
            SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{offlineGraceMinutes}', to_jsonb(?::int), true),
                updated_at = now()
          WHERE tenant = ? AND integration_id = ?`,
        [minutes, tenant, integration.integration_id]
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: sanitizeError(error, 'Unable to save alerting settings.') };
    }
  }
);

export const runUniFiAlertCheckNow = withAdvancedAssetsAccess(async (user, { tenant }) => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const result = await reconcileUniFiAlertsNow(tenant);
    return {
      success: true,
      remoteActive: result.remoteActive,
      ingested: result.ingested,
      resolved: result.resetsSynthesized,
      warnings: result.warnings,
    };
  } catch (error) {
    return { success: false, error: sanitizeError(error, 'Unable to check UniFi devices.') };
  }
});

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

    // Scope to this tenant's UniFi integration so another provider's mapping can't be edited here.
    const integrationIds = db.table('rmm_integrations').where({ provider: PROVIDER }).select('integration_id');
    const updatedRows = await db
      .table('rmm_organization_mappings')
      .where({ mapping_id: input.mappingId })
      .whereIn('integration_id', integrationIds)
      .update(patch);
    if (!updatedRows) return { success: false, error: 'UniFi site mapping not found.' };

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
      // Exclude retired (tombstoned) devices: their mapping carries metadata.deleted = true.
      db
        .table('tenant_external_entity_mappings')
        .where({ integration_type: PROVIDER, alga_entity_type: 'asset' })
        .whereRaw("COALESCE(metadata->>'deleted', 'false') <> 'true'")
        .count<{ count: string }[]>('id as count'),
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
