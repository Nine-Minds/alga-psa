'use server';

import { randomBytes } from 'crypto';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { isRmmContactAssignmentMode } from '@alga-psa/shared/rmm/userMatching';
import { moveRmmOrganizationAssets } from '@alga-psa/shared/rmm/moveRmmOrganizationAssets';
import { resolveMappingBillingProfileId } from '@alga-psa/shared/rmm/mappingBillingProfile';
import { ASSET_BILLING_PROFILE_UNAVAILABLE } from '@alga-psa/shared/models/assetBillingProfileModel';
import logger from '@alga-psa/core/logger';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { getWebhookBaseUrl } from '@alga-psa/integrations/utils/email/webhookHelpers';
import { tenantScopedTable } from '../../integrations/datto/db';
import { axiosErrorToMessage } from '../../integrations/datto/errors';
import {
  assertAllowedDattoBaseUrl,
  DattoRmmAuthError,
  DattoRmmPermissionError,
  normalizeDattoBaseUrl,
} from '../../integrations/datto/dattoApiClient';
import {
  buildDattoClientForTenant,
  clearDattoReconnectRequired,
} from '../../integrations/datto/buildClient';
import {
  DATTO_RMM_PLATFORMS,
  DATTO_RMM_PROVIDER,
  DATTO_RMM_SECRET_KEYS,
  dattoPlatformApiUrl,
  type DattoRmmPlatform,
} from '../../integrations/datto/shared';
// The sync engines live in plain lib modules: exports from this 'use server'
// file are callable RPC endpoints, so an unguarded sync could not live here,
// and the scheduled jobs call the same functions without an acting user.
import { runDattoRmmSiteSync } from '../../integrations/datto/siteSync';
import {
  provisionClientsForDattoSites,
  provisionClientsForNewDattoSitesIfEnabled,
  type DattoSiteClientProvisioningResult,
} from '../../integrations/datto/siteClientProvisioning';
import type { DattoSiteSyncResult } from '../../integrations/datto/siteSync';
import { runDattoRmmDeviceSync, type DattoSyncResult } from '../../integrations/datto/deviceSync';
import { syncDattoSingleDeviceForTenant } from '../../integrations/datto/syncSingleDevice';
import { runDattoRmmAlertBackfill } from '../../integrations/datto/alertBackfill';
import { runDattoRmmSoftwareIngest } from '../../integrations/datto/softwareIngest';
import {
  buildDattoWebhookBodyTemplate,
  buildDattoWebhookResolveBodyTemplate,
  DATTO_RMM_WEBHOOK_PATH,
} from '../../integrations/datto/webhookTemplate';

const PROVIDER = DATTO_RMM_PROVIDER;
const LABEL = 'Datto RMM';

// Shown to the operator, so it names the header exactly as Datto's webhook
// editor expects it (the route compares case-insensitively).
const WEBHOOK_HEADER_DISPLAY_NAME = 'X-Alga-Webhook-Secret';

function withAdvancedAssetsAccess<TArgs extends unknown[], TResult>(
  handler: (user: any, context: { tenant: string }, ...args: TArgs) => Promise<TResult>,
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_ASSETS);
    return handler(user, context as { tenant: string }, ...args);
  });
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function isAuthError(err: unknown): boolean {
  return err instanceof DattoRmmAuthError || (err as Error | undefined)?.name === 'DattoRmmAuthError';
}

function isPermissionError(err: unknown): boolean {
  return err instanceof DattoRmmPermissionError || (err as Error | undefined)?.name === 'DattoRmmPermissionError';
}

/**
 * Operator-facing message for any failure. Distinguishes bad credentials
 * (check key / secret / platform) from a security-level gap (the API user
 * works but may not read a resource) from everything else, and never echoes
 * URLs, headers, or response bodies.
 */
function dattoErrorMessage(err: unknown): string {
  if (isAuthError(err)) {
    return 'Datto RMM rejected the API key and secret. Check the API key, API secret, and platform region, then try again.';
  }
  if (isPermissionError(err)) {
    const path = String((err as DattoRmmPermissionError).path || 'this resource');
    return `The Datto API user's security level does not have access to ${path}. Grant the user read access to the account, sites, devices, and alerts, then try again.`;
  }
  return axiosErrorToMessage(err, LABEL);
}

type StoredSettings = Record<string, any>;

function parseSettings(value: unknown): StoredSettings {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as StoredSettings) : {};
}

function isKnownPlatform(value: unknown): value is DattoRmmPlatform {
  return typeof value === 'string' && (DATTO_RMM_PLATFORMS as readonly string[]).includes(value);
}

export const getDattoRmmSettings = withAdvancedAssetsAccess(async (user, { tenant }): Promise<{
  success: boolean;
  error?: string;
  config?: {
    instanceUrl?: string;
    platform: DattoRmmPlatform | 'custom';
    isActive: boolean;
    connectedAt?: string | null;
    lastSyncAt?: string | null;
    syncError?: string | null;
    rebootComponentUid?: string | null;
    resolveAlertsOnTicketClose: boolean;
    softwareIngestOnSync: boolean;
    autoCreateClientsForNewSites: boolean;
  };
  credentials?: {
    hasApiKey: boolean;
    hasApiSecret: boolean;
    apiKeyMasked?: string;
  };
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const integration = await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where('provider', PROVIDER)
      .first(['instance_url', 'is_active', 'connected_at', 'last_sync_at', 'sync_error', 'settings']);

    const secretProvider = await getSecretProviderInstance();
    const [apiKey, apiSecret] = await Promise.all([
      secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiKey),
      secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiSecret),
    ]);

    const settings = parseSettings(integration?.settings);
    const instanceUrl = (integration?.instance_url as string | undefined) || undefined;
    const platform: DattoRmmPlatform | 'custom' = isKnownPlatform(settings.platform)
      ? settings.platform
      : instanceUrl
        ? 'custom'
        : 'merlot';

    return {
      success: true,
      config: {
        instanceUrl,
        platform,
        isActive: Boolean(integration?.is_active),
        connectedAt: integration?.connected_at ?? null,
        lastSyncAt: integration?.last_sync_at ?? null,
        syncError: integration?.sync_error ?? null,
        rebootComponentUid: settings.rebootComponentUid ? String(settings.rebootComponentUid) : null,
        resolveAlertsOnTicketClose: Boolean(settings.resolveAlertsOnTicketClose),
        softwareIngestOnSync: Boolean(settings.softwareIngestOnSync),
        autoCreateClientsForNewSites: Boolean(settings.autoCreateClientsForNewSites),
      },
      credentials: {
        hasApiKey: Boolean(apiKey),
        hasApiSecret: Boolean(apiSecret),
        apiKeyMasked: apiKey ? maskSecret(apiKey) : undefined,
      },
    };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

export const getDattoRmmConnectionSummary = withAdvancedAssetsAccess(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  summary?: {
    isActive: boolean;
    instanceUrl?: string;
    platform: DattoRmmPlatform | 'custom';
    connectedAt?: string | null;
    lastSyncAt?: string | null;
    syncError?: string | null;
    counts: {
      mappedSites: number;
      syncedDevices: number;
      activeAlerts: number;
      byAgentStatus: Record<string, number>;
    };
  };
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const integration = await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where('provider', PROVIDER)
      .first([
        'integration_id',
        'instance_url',
        'is_active',
        'connected_at',
        'last_sync_at',
        'sync_error',
        'settings',
      ]);

    const settings = parseSettings(integration?.settings);
    const instanceUrl = (integration?.instance_url as string | undefined) || undefined;
    const platform: DattoRmmPlatform | 'custom' = isKnownPlatform(settings.platform)
      ? settings.platform
      : instanceUrl
        ? 'custom'
        : 'merlot';

    if (!integration?.integration_id) {
      return {
        success: true,
        summary: {
          isActive: false,
          instanceUrl,
          platform,
          connectedAt: null,
          lastSyncAt: null,
          syncError: null,
          counts: { mappedSites: 0, syncedDevices: 0, activeAlerts: 0, byAgentStatus: {} },
        },
      };
    }

    const integrationId = integration.integration_id as string;

    const [mappedSitesRow, syncedDevicesRow, activeAlertsRow, statusRows] = await Promise.all([
      tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
        .where('integration_id', integrationId)
        .count<{ count: string }[]>('* as count')
        .first(),
      tenantScopedTable(knex, 'assets', tenant)
        .where('rmm_provider', PROVIDER)
        .whereNotNull('rmm_device_id')
        .count<{ count: string }[]>('* as count')
        .first(),
      tenantScopedTable(knex, 'rmm_alerts', tenant)
        .where({ integration_id: integrationId, status: 'active' })
        .count<{ count: string }[]>('* as count')
        .first(),
      tenantScopedTable(knex, 'assets', tenant)
        .where('rmm_provider', PROVIDER)
        .select('agent_status')
        .count<{ agent_status: string | null; count: string }[]>('* as count')
        .groupBy('agent_status'),
    ]);

    const byAgentStatus: Record<string, number> = {};
    for (const row of statusRows || []) {
      const key = row.agent_status || 'unknown';
      byAgentStatus[key] = Number(row.count || 0);
    }

    return {
      success: true,
      summary: {
        isActive: Boolean(integration.is_active),
        instanceUrl,
        platform,
        connectedAt: integration.connected_at ?? null,
        lastSyncAt: integration.last_sync_at ?? null,
        syncError: integration.sync_error ?? null,
        counts: {
          mappedSites: Number((mappedSitesRow as any)?.count || 0),
          syncedDevices: Number((syncedDevicesRow as any)?.count || 0),
          activeAlerts: Number((activeAlertsRow as any)?.count || 0),
          byAgentStatus,
        },
      },
    };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

export const saveDattoRmmConfiguration = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input: {
    platform: DattoRmmPlatform | 'custom';
    /** Only read for platform 'custom'. */
    instanceUrl?: string;
    /** Blank / omitted keeps the stored value. */
    apiKey?: string;
    apiSecret?: string;
    rebootComponentUid?: string | null;
    resolveAlertsOnTicketClose?: boolean;
    softwareIngestOnSync?: boolean;
    autoCreateClientsForNewSites?: boolean;
  }
): Promise<{ success: boolean; error?: string }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  let instanceUrl: string;
  if (input.platform === 'custom') {
    try {
      instanceUrl = normalizeDattoBaseUrl(input.instanceUrl || '');
      // Credentials are sent to this host, so it must be one of Datto's.
      assertAllowedDattoBaseUrl(instanceUrl);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Datto RMM API URL is not valid' };
    }
  } else if (isKnownPlatform(input.platform)) {
    instanceUrl = dattoPlatformApiUrl(input.platform);
  } else {
    return { success: false, error: 'Select a Datto RMM platform' };
  }

  const apiKey = (input.apiKey || '').trim();
  const apiSecret = (input.apiSecret || '').trim();

  try {
    const { knex } = await createTenantKnex();
    const secretProvider = await getSecretProviderInstance();

    const existing = await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where('provider', PROVIDER)
      .first(['instance_url', 'settings']);

    // Once on, the scheduled sync creates clients with no user present, so the
    // user switching it on must be allowed to create clients themselves (as the
    // manual create action and the Entra mapping confirm require). Saving with
    // it already on is not a new grant and stays settings-only.
    const enablingAutoCreate =
      input.autoCreateClientsForNewSites === true &&
      parseSettings(existing?.settings).autoCreateClientsForNewSites !== true;
    if (enablingAutoCreate && !(await hasPermission(user as any, 'client', 'create'))) {
      return {
        success: false,
        error: 'Forbidden: turning on automatic client creation requires permission to create clients',
      };
    }

    const [storedKey, storedSecret] = await Promise.all([
      secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiKey),
      secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiSecret),
    ]);
    if (!(apiKey || storedKey) || !(apiSecret || storedSecret)) {
      return { success: false, error: 'API key and API secret are required' };
    }

    const urlChanged = (existing?.instance_url ?? null) !== instanceUrl;
    // Stored credentials must not follow a host change: re-entering both makes
    // the admin vouch for the new destination and stops a changed URL from
    // being used to replay the stored secret elsewhere.
    if (urlChanged && (!apiKey || !apiSecret)) {
      return {
        success: false,
        error: 'The Datto RMM platform or URL changed. Re-enter the API key and API secret to confirm the new location.',
      };
    }
    const keyChanged = Boolean(apiKey) && apiKey !== storedKey;
    const secretChanged = Boolean(apiSecret) && apiSecret !== storedSecret;
    // Any change to what authenticates the connection invalidates it until the
    // next successful Test Connection.
    const connectionChanged = !existing || urlChanged || keyChanged || secretChanged;

    if (apiKey) await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiKey, apiKey);
    if (apiSecret) await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiSecret, apiSecret);

    if (connectionChanged) {
      // A cached bearer token belongs to the old key/secret/host.
      await Promise.all([
        secretProvider.deleteTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessToken).catch(() => undefined),
        secretProvider.deleteTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessTokenExpiresAt).catch(() => undefined),
      ]);
    }

    // Only the keys this form owns are written; deviceSync / alertPolling /
    // tokenLifecycle belong to the shared settings code and survive the merge.
    const settingsPatch: StoredSettings = { platform: input.platform };
    if (typeof input.rebootComponentUid !== 'undefined') {
      settingsPatch.rebootComponentUid = (input.rebootComponentUid || '').trim() || null;
    }
    if (typeof input.resolveAlertsOnTicketClose !== 'undefined') {
      settingsPatch.resolveAlertsOnTicketClose = Boolean(input.resolveAlertsOnTicketClose);
    }
    if (typeof input.softwareIngestOnSync !== 'undefined') {
      settingsPatch.softwareIngestOnSync = Boolean(input.softwareIngestOnSync);
    }
    if (typeof input.autoCreateClientsForNewSites !== 'undefined') {
      settingsPatch.autoCreateClientsForNewSites = Boolean(input.autoCreateClientsForNewSites);
    }

    const now = new Date();
    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .insert({
        tenant,
        provider: PROVIDER,
        instance_url: instanceUrl,
        // Inactive until a successful connection test.
        is_active: false,
        connected_at: null,
        sync_error: null,
        settings: settingsPatch,
        updated_at: now,
      })
      .onConflict(['tenant', 'provider'])
      .merge({
        instance_url: instanceUrl,
        is_active: connectionChanged ? false : knex.raw('rmm_integrations.is_active'),
        connected_at: connectionChanged ? null : knex.raw('rmm_integrations.connected_at'),
        sync_error: connectionChanged ? null : knex.raw('rmm_integrations.sync_error'),
        settings: knex.raw(
          `COALESCE(rmm_integrations.settings, '{}'::jsonb) || ?::jsonb`,
          [JSON.stringify(settingsPatch)]
        ),
        updated_at: now,
      });

    // New credentials deserve a fresh attempt: the polling and sync gates skip
    // a reconnect-required integration, so nothing else would clear the flag.
    if (connectionChanged) await clearDattoReconnectRequired(tenant);

    return { success: true };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

export const disconnectDattoRmmIntegration = withAdvancedAssetsAccess(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    // The webhook secret goes too (as Level.io and NinjaOne do): it is the only
    // thing that authenticates inbound alerts, so a reconnect, possibly to a
    // different Datto account, starts with a fresh one that the old account's
    // webhooks do not hold.
    const secretProvider = await getSecretProviderInstance();
    await Promise.all([
      secretProvider.deleteTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.webhookSecret).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiKey).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.apiSecret).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessToken).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.accessTokenExpiresAt).catch(() => undefined),
    ]);

    // Mappings stay. Going inactive is what retires the recurring jobs: the
    // rmm polling reconciler cancels the alert-poll and device-sync schedules of
    // any integration that is no longer active.
    const { knex } = await createTenantKnex();
    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where('provider', PROVIDER)
      .update({ is_active: false, connected_at: null, sync_error: null, updated_at: new Date() });

    return { success: true };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

export const testDattoRmmConnection = withAdvancedAssetsAccess(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  accountName?: string;
  deviceCount?: number;
  siteCount?: number;
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const client = await buildDattoClientForTenant(tenant, { allowInactive: true });
    if (!client) {
      return { success: false, error: 'Datto RMM is not configured yet. Save the platform, API key, and API secret first.' };
    }

    const account = await client.getAccount();
    // One row is enough to prove the sites permission; pageDetails carries the total.
    const sitesPage = await client.request<any>({
      method: 'GET',
      path: '/v2/account/sites',
      params: { max: 1 },
    });

    const { knex } = await createTenantKnex();
    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where('provider', PROVIDER)
      .update({ is_active: true, connected_at: knex.fn.now(), sync_error: null });
    await clearDattoReconnectRequired(tenant);

    const deviceCount = account?.devicesStatus?.numberOfDevices;
    const totalSites = sitesPage?.pageDetails?.totalCount;
    return {
      success: true,
      accountName: account?.name ? String(account.name) : undefined,
      deviceCount: typeof deviceCount === 'number' ? deviceCount : undefined,
      siteCount: typeof totalSites === 'number'
        ? totalSites
        : Array.isArray(sitesPage?.sites) ? sitesPage.sites.length : undefined,
    };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

export const syncDattoRmmSites = withAdvancedAssetsAccess(async (user, { tenant }): Promise<DattoSiteSyncResult & {
  /** Set when autoCreateClientsForNewSites acted on sites this sync found. */
  auto_clients?: { created: number; linked: number; failed: number };
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' } as DattoSyncResult;

  try {
    const actorUserId = (user as any)?.user_id as string | undefined;
    const result = await runDattoRmmSiteSync({ tenant, actorUserId });
    if (!result.success) return result;

    // Whichever sync discovers a site acts on it, so a manual sync does not
    // rob the scheduled one of the "new site" signal. Creating clients needs
    // client:create on top of the settings permission.
    if (!(await hasPermission(user as any, 'client', 'create'))) return result;
    const outcome = await provisionClientsForNewDattoSitesIfEnabled({
      tenant,
      newSiteUids: result.created_site_uids,
      actorUserId,
    });
    return outcome
      ? { ...result, auto_clients: { created: outcome.created, linked: outcome.linked, failed: outcome.failed } }
      : result;
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) } as DattoSyncResult;
  }
});

export const listDattoRmmSiteMappings = withAdvancedAssetsAccess(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  mappings?: Array<{
    mapping_id: string;
    external_organization_id: string;
    external_organization_name: string | null;
    client_id: string | null;
    default_contact_id: string | null;
    contact_assignment_mode: string;
    billing_profile_id: string | null;
    company_name?: string | null;
    auto_sync_assets: boolean;
    metadata?: Record<string, unknown> | null;
    /** Client the sync matched by name; a suggestion only, never assigned. */
    suggested_client_id: string | null;
    suggested_client_name: string | null;
  }>;
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const integration = await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where({ provider: PROVIDER })
      .first(['integration_id']);

    if (!integration?.integration_id) {
      return { success: true, mappings: [] };
    }

    const db = tenantDb(knex, tenant);
    const rowsQuery = db.table('rmm_organization_mappings as rom');
    db.tenantJoin(rowsQuery, 'clients as c', 'c.client_id', 'rom.client_id', { type: 'left' });

    const rows = await rowsQuery
      .where({
        'rom.integration_id': integration.integration_id,
      })
      .select([
        'rom.mapping_id',
        'rom.external_organization_id',
        'rom.external_organization_name',
        'rom.client_id',
        'rom.default_contact_id',
        'rom.contact_assignment_mode',
        'rom.billing_profile_id',
        'rom.auto_sync_assets',
        'rom.metadata',
        knex.raw('c.client_name as company_name'),
      ])
      .orderBy('rom.external_organization_name', 'asc');

    const mappings = (rows as any[]).map((row) => {
      const metadata = parseSettings(row.metadata);
      return {
        ...row,
        suggested_client_id: metadata.suggested_client_id ? String(metadata.suggested_client_id) : null,
        suggested_client_name: metadata.suggested_client_name ? String(metadata.suggested_client_name) : null,
      };
    });

    return { success: true, mappings };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

export const updateDattoRmmSiteMapping = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  mappingId: string,
  input: {
    clientId?: string | null;
    defaultContactId?: string | null;
    autoSyncAssets?: boolean;
    /** off | suggest | auto. */
    contactAssignmentMode?: string;
    /** The site's billing profile, or null. */
    billingProfileId?: string | null;
  }
): Promise<{ success: boolean; error?: string }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const patch: Record<string, any> = {};
    if (typeof input.clientId !== 'undefined') patch.client_id = input.clientId || null;
    if (typeof input.defaultContactId !== 'undefined') patch.default_contact_id = input.defaultContactId || null;
    if (typeof input.autoSyncAssets !== 'undefined') patch.auto_sync_assets = input.autoSyncAssets;
    if (typeof input.contactAssignmentMode !== 'undefined') {
      if (!isRmmContactAssignmentMode(input.contactAssignmentMode)) {
        return { success: false, error: 'Invalid people mode' };
      }
      patch.contact_assignment_mode = input.contactAssignmentMode;
    }
    if (!Object.keys(patch).length && typeof input.billingProfileId === 'undefined') {
      return { success: true };
    }

    // A client change moves the site's assets in the same transaction as the
    // mapping update, so the two can never disagree.
    const outcome = await withTransaction(knex, async (trx: Knex.Transaction): Promise<string | null> => {
      // Only this tenant's Datto mappings: the id must not reach another
      // provider's mapping, and a stale id must not report success.
      const integration = await tenantScopedTable(trx, 'rmm_integrations', tenant)
        .where({ provider: PROVIDER })
        .first(['integration_id']);
      const existing = integration?.integration_id
        ? await tenantScopedTable(trx, 'rmm_organization_mappings', tenant)
            .where({ mapping_id: mappingId, integration_id: integration.integration_id })
            .first(['client_id', 'integration_id', 'external_organization_id', 'default_contact_id'])
        : undefined;
      if (!existing) return 'Mapping not found';

      const clientChanged = typeof patch.client_id !== 'undefined'
        && String(existing.client_id ?? '') !== String(patch.client_id ?? '');
      if (patch.client_id) {
        const client = await tenantScopedTable(trx, 'clients', tenant)
          .where({ client_id: patch.client_id })
          .first(['client_id']);
        if (!client) return 'Client not found';
      }
      // The default contact must belong to the client the site ends up on; a
      // client change drops one that was not re-chosen alongside it.
      const nextClientId = clientChanged ? patch.client_id : existing.client_id;
      if (clientChanged && typeof patch.default_contact_id === 'undefined') patch.default_contact_id = null;
      if (patch.default_contact_id) {
        const contact = await tenantScopedTable(trx, 'contacts', tenant)
          .where({ contact_name_id: patch.default_contact_id })
          .first(['client_id']);
        if (!contact || !nextClientId || String(contact.client_id) !== String(nextClientId)) {
          return 'Contact does not belong to this client';
        }
      }

      // Validated against the client the mapping ends up on, and cleared by a
      // client change whatever else the patch carries.
      const billingProfileId = await resolveMappingBillingProfileId(trx, tenant, {
        existingClientId: existing.client_id ?? null,
        nextClientId: patch.client_id,
        billingProfileId: input.billingProfileId,
      });
      if (typeof billingProfileId !== 'undefined') patch.billing_profile_id = billingProfileId;

      await tenantScopedTable(trx, 'rmm_organization_mappings', tenant)
        .where({ mapping_id: mappingId })
        .update({ ...patch, updated_at: trx.fn.now() });

      if (clientChanged && patch.client_id) {
        await moveRmmOrganizationAssets(trx, tenant, {
          integrationId: String(existing.integration_id),
          provider: PROVIDER,
          externalOrganizationId: String(existing.external_organization_id),
          newClientId: String(patch.client_id),
          actorUserId: (user as { user_id?: string }).user_id ?? null,
        });
      }
      return null;
    });

    return outcome ? { success: false, error: outcome } : { success: true };
  } catch (err) {
    return { success: false, error: mappingUpdateErrorMessage(err, { tenant, mappingId }) };
  }
});

/**
 * The failures an operator can cause get their own words (the settings UI
 * translates them); the rest are logged and reported generically.
 */
function mappingUpdateErrorMessage(err: unknown, context: { tenant: string; mappingId: string }): string {
  if (err instanceof Error && err.message === ASSET_BILLING_PROFILE_UNAVAILABLE) return ASSET_BILLING_PROFILE_UNAVAILABLE;
  // A client or contact deleted after the page loaded.
  if ((err as { code?: string } | null)?.code === '23503') return 'Client not found';
  logger.warn('[DattoRmm] site mapping update failed', {
    tenant: context.tenant,
    mappingId: context.mappingId,
    error: err instanceof Error ? err.message : String(err),
  });
  return dattoErrorMessage(err);
}

/**
 * Creates an Alga client for each given unmapped site (or links the one client
 * already carrying its name) and maps the site to it. With no ids, every
 * unmapped site that is neither on-demand nor gone from Datto.
 */
export const createClientsForDattoRmmSites = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  mappingIds?: string[]
): Promise<DattoSiteClientProvisioningResult> => {
  const empty = { results: [], created: 0, linked: 0, skipped: 0, failed: 0 };
  const canConfigure = await hasPermission(user as any, 'system_settings', 'update');
  const canCreateClients = await hasPermission(user as any, 'client', 'create');
  if (!canConfigure || !canCreateClients) return { success: false, error: 'Forbidden', ...empty };

  try {
    return await provisionClientsForDattoSites({
      tenant,
      actorUserId: (user as any)?.user_id as string | undefined,
      mappingIds: Array.isArray(mappingIds) ? mappingIds.map(String) : undefined,
    });
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err), ...empty };
  }
});

export const syncDattoRmmDevices = withAdvancedAssetsAccess(async (user, { tenant }): Promise<DattoSyncResult> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' } as DattoSyncResult;

  // A manual run is a full sync attributed to the operator who pressed the
  // button; the scheduled job runs the incremental flavour with no actor.
  try {
    return await runDattoRmmDeviceSync(
      { tenant, actorUserId: (user as any)?.user_id as string | undefined },
      { syncType: 'full' }
    );
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) } as DattoSyncResult;
  }
});

export const syncDattoRmmSingleDevice = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  deviceUid: string
): Promise<{ success: boolean; error?: string; updated?: boolean; assetId?: string | null }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const uid = String(deviceUid || '').trim();
  if (!uid) return { success: false, error: 'deviceUid is required' };

  try {
    const result = await syncDattoSingleDeviceForTenant({ tenant, deviceUid: uid });
    return { success: true, updated: result.updated, assetId: result.assetId ?? null };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

type DattoWebhookInfo = {
  url: string;
  headerName: string;
  secret: string;
  bodyTemplate: string;
  resolveBodyTemplate: string;
};

function buildWebhookInfo(tenant: string, secret: string): DattoWebhookInfo {
  const baseUrl = getWebhookBaseUrl();
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  // The tenant id is not a secret; the secret travels in the header only.
  const url = `${cleanBaseUrl}${DATTO_RMM_WEBHOOK_PATH}?tenant=${encodeURIComponent(tenant)}`;
  return {
    url,
    headerName: WEBHOOK_HEADER_DISPLAY_NAME,
    secret,
    bodyTemplate: buildDattoWebhookBodyTemplate(),
    resolveBodyTemplate: buildDattoWebhookResolveBodyTemplate(),
  };
}

function newWebhookSecret(): string {
  return randomBytes(24).toString('hex');
}

export const getDattoRmmWebhookInfo = withAdvancedAssetsAccess(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string; webhook?: DattoWebhookInfo }> => {
  // The secret authenticates inbound alerts (anyone holding it can open
  // tickets), and this call mints it on first use: settings-update only.
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    let secret = await secretProvider.getTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.webhookSecret);
    if (!secret) {
      secret = newWebhookSecret();
      await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.webhookSecret, secret);
    }
    return { success: true, webhook: buildWebhookInfo(tenant, secret) };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

/**
 * Replaces the webhook secret. The old one stops working immediately, so every
 * Datto webhook response must be updated with the new header value.
 */
export const regenerateDattoRmmWebhookSecret = withAdvancedAssetsAccess(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string; webhook?: DattoWebhookInfo }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    const secret = newWebhookSecret();
    await secretProvider.setTenantSecret(tenant, DATTO_RMM_SECRET_KEYS.webhookSecret, secret);
    return { success: true, webhook: buildWebhookInfo(tenant, secret) };
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) };
  }
});

export const backfillDattoRmmAlerts = withAdvancedAssetsAccess(async (user, { tenant }): Promise<DattoSyncResult> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' } as DattoSyncResult;

  try {
    return await runDattoRmmAlertBackfill({
      tenant,
      actorUserId: (user as any)?.user_id as string | undefined,
    });
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) } as DattoSyncResult;
  }
});

export const ingestDattoRmmSoftwareInventory = withAdvancedAssetsAccess(async (
  user,
  { tenant },
  input?: { force?: boolean }
): Promise<DattoSyncResult> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' } as DattoSyncResult;

  try {
    return await runDattoRmmSoftwareIngest({ tenant, force: Boolean(input?.force) });
  } catch (err) {
    return { success: false, error: dattoErrorMessage(err) } as DattoSyncResult;
  }
});

export const listDattoRmmComponents = withAdvancedAssetsAccess(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  /** True when the API user is not allowed to list components. */
  permissionDenied?: boolean;
  components?: Array<{ uid: string; name: string; description: string | null; categoryCode: string | null }>;
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const client = await buildDattoClientForTenant(tenant);
    if (!client) {
      return { success: false, error: 'Datto RMM is not connected. Save the credentials and run Test Connection first.' };
    }

    const components = await client.listComponents();
    return {
      success: true,
      components: components
        .filter((c) => c?.uid)
        .map((c) => ({
          uid: String(c.uid),
          name: String(c.name || c.uid),
          description: c.description ? String(c.description) : null,
          categoryCode: c.categoryCode ? String(c.categoryCode) : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (err) {
    // The UI falls back to a free-text UID input, so this is an answer, not a crash.
    return { success: false, error: dattoErrorMessage(err), permissionDenied: isPermissionError(err) || undefined };
  }
});
