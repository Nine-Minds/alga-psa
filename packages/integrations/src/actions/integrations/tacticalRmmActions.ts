'use server';

import axios, { AxiosError } from 'axios';
import { randomBytes } from 'crypto';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';
import { createAsset } from '@alga-psa/assets/actions/assetActions';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { isAxiosUnauthorized, TacticalRmmClient, normalizeTacticalBaseUrl } from '../../lib/rmm/tacticalrmm/tacticalApiClient';
import { computeTacticalAgentStatus } from '../../lib/rmm/tacticalrmm/agentStatus';
import { getWebhookBaseUrl } from '../../utils/email/webhookHelpers';
import { TACTICAL_WEBHOOK_HEADER_NAME, type TacticalRmmAuthMode } from '../../lib/rmm/tacticalrmm/shared';

const PROVIDER = 'tacticalrmm' as const;

const TACTICAL_INSTANCE_URL_SECRET = 'tacticalrmm_instance_url';
const TACTICAL_API_KEY_SECRET = 'tacticalrmm_api_key';
const TACTICAL_KNOX_USERNAME_SECRET = 'tacticalrmm_username';
const TACTICAL_KNOX_PASSWORD_SECRET = 'tacticalrmm_password';
const TACTICAL_KNOX_TOKEN_SECRET = 'tacticalrmm_knox_token';
const TACTICAL_WEBHOOK_SECRET = 'tacticalrmm_webhook_secret';

async function publishRmmSyncEvent(args: {
  eventType: 'RMM_SYNC_STARTED' | 'RMM_SYNC_COMPLETED' | 'RMM_SYNC_FAILED';
  tenantId: string;
  actorUserId?: string;
  integrationId: string;
  syncType: 'organizations' | 'devices' | 'alerts';
  itemsProcessed?: number;
  itemsCreated?: number;
  itemsUpdated?: number;
  itemsFailed?: number;
  errorMessage?: string;
}) {
  const payload: Record<string, unknown> = {
    tenantId: args.tenantId,
    occurredAt: new Date().toISOString(),
    actorType: args.actorUserId ? 'USER' : 'SYSTEM',
    actorUserId: args.actorUserId,
    integrationId: args.integrationId,
    provider: PROVIDER,
    syncType: args.syncType,
    itemsProcessed: args.itemsProcessed,
    itemsCreated: args.itemsCreated,
    itemsUpdated: args.itemsUpdated,
    itemsFailed: args.itemsFailed,
    ...(args.eventType === 'RMM_SYNC_FAILED'
      ? { error: { message: args.errorMessage || 'Sync failed' } }
      : {}),
  };

  try {
    await publishEvent({ eventType: args.eventType, payload } as any);
  } catch {
    // Best-effort: never fail the sync on event-publish issues.
  }
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function normalizeBaseUrl(input: string): string {
  return normalizeTacticalBaseUrl(input);
}

function axiosErrorToMessage(err: unknown): string {
  if (err && typeof err === 'object' && (err as any).isAxiosError) {
    const ax = err as AxiosError<any>;
    const status = ax.response?.status;
    const detail = ax.response?.data ? JSON.stringify(ax.response.data) : ax.message;
    if (status === 401) return 'Unauthorized (401): invalid credentials or token expired.';
    return status ? `Request failed (${status}): ${detail}` : `Request failed: ${detail}`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

async function upsertIntegrationRow(args: {
  tenant: string;
  instance_url: string;
  auth_mode: TacticalRmmAuthMode;
  is_active?: boolean;
  connected_at?: Date | null;
  sync_error?: string | null;
}) {
  const { knex } = await createTenantKnex();
  const now = new Date();
  const settings = { auth_mode: args.auth_mode };

  // Postgres: rely on unique (tenant, provider) to be idempotent.
  const insertRow = {
    tenant: args.tenant,
    provider: PROVIDER,
    instance_url: args.instance_url,
    is_active: args.is_active ?? false,
    connected_at: args.connected_at ?? null,
    sync_error: args.sync_error ?? null,
    settings,
    updated_at: now,
  };

  const res = await knex('rmm_integrations')
    .insert(insertRow)
    .onConflict(['tenant', 'provider'])
    .merge({
      instance_url: args.instance_url,
      is_active: args.is_active ?? knex.raw('rmm_integrations.is_active'),
      connected_at: args.connected_at ?? knex.raw('rmm_integrations.connected_at'),
      sync_error: args.sync_error ?? null,
      settings,
      updated_at: now,
    })
    .returning(['integration_id', 'is_active', 'instance_url', 'settings', 'connected_at', 'sync_error']);

  const row = Array.isArray(res) ? res[0] : res;
  return row as {
    integration_id: string;
    is_active: boolean;
    instance_url: string | null;
    settings: any;
    connected_at: string | null;
    sync_error: string | null;
  };
}

async function buildConfiguredTacticalClient(args: {
  tenant: string;
  instanceUrl: string;
  authMode: TacticalRmmAuthMode;
}) {
  const secretProvider = await getSecretProviderInstance();
  const baseUrl = normalizeTacticalBaseUrl(args.instanceUrl);
  if (!baseUrl) throw new Error('Instance URL is not configured');

  if (args.authMode === 'api_key') {
    const apiKey = await secretProvider.getTenantSecret(args.tenant, TACTICAL_API_KEY_SECRET);
    return new TacticalRmmClient({
      baseUrl,
      authMode: 'api_key',
      apiKey: apiKey || undefined,
    });
  }

  const token = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_TOKEN_SECRET);
  const username = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_USERNAME_SECRET);
  const password = await secretProvider.getTenantSecret(args.tenant, TACTICAL_KNOX_PASSWORD_SECRET);

  const client = new TacticalRmmClient({
    baseUrl,
    authMode: 'knox',
    knoxToken: token || undefined,
    refreshKnoxToken: async () => {
      if (!username || !password) {
        throw new Error('Knox username/password not configured');
      }
      const unauth = new TacticalRmmClient({ baseUrl, authMode: 'knox' });
      const { totp } = await unauth.checkCreds({ username, password });
      if (totp) {
        throw new Error('TOTP required. Run Test Connection with a TOTP code to save a Knox token.');
      }
      const login = await unauth.login({ username, password });
      return login.token;
    },
    onKnoxTokenRefreshed: async (newToken) => {
      await secretProvider.setTenantSecret(args.tenant, TACTICAL_KNOX_TOKEN_SECRET, newToken);
    },
  });

  return client;
}

export const getTacticalRmmSettings = withAuth(async (user, { tenant }): Promise<{
  success: boolean;
  error?: string;
  config?: {
    instanceUrl?: string;
    authMode: TacticalRmmAuthMode;
    isActive: boolean;
    connectedAt?: string | null;
    syncError?: string | null;
  };
  credentials?: {
    hasApiKey: boolean;
    apiKeyMasked?: string;
    hasKnoxCredentials: boolean;
    username?: string;
    hasKnoxToken: boolean;
    knoxTokenMasked?: string;
  };
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['instance_url', 'is_active', 'connected_at', 'sync_error', 'settings']);

    const secretProvider = await getSecretProviderInstance();
    const [instanceUrlSecret, apiKey, username, token] = await Promise.all([
      secretProvider.getTenantSecret(tenant, TACTICAL_INSTANCE_URL_SECRET),
      secretProvider.getTenantSecret(tenant, TACTICAL_API_KEY_SECRET),
      secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_USERNAME_SECRET),
      secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET),
    ]);

    const authMode = (integration?.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const instanceUrl = (integration?.instance_url as string | undefined) || instanceUrlSecret || undefined;

    return {
      success: true,
      config: {
        instanceUrl,
        authMode,
        isActive: Boolean(integration?.is_active),
        connectedAt: integration?.connected_at ?? null,
        syncError: integration?.sync_error ?? null,
      },
      credentials: {
        hasApiKey: Boolean(apiKey),
        apiKeyMasked: apiKey ? maskSecret(apiKey) : undefined,
        hasKnoxCredentials: Boolean(username),
        username: username || undefined,
        hasKnoxToken: Boolean(token),
        knoxTokenMasked: token ? maskSecret(token) : undefined,
      },
    };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const getTacticalRmmConnectionSummary = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  summary?: {
    isActive: boolean;
    instanceUrl?: string;
    authMode: TacticalRmmAuthMode;
    connectedAt?: string | null;
    lastSyncAt?: string | null;
    syncError?: string | null;
    counts: {
      mappedOrganizations: number;
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
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first([
        'integration_id',
        'instance_url',
        'is_active',
        'connected_at',
        'last_sync_at',
        'sync_error',
        'settings',
      ]);

    const secretProvider = await getSecretProviderInstance();
    const instanceUrlSecret = await secretProvider.getTenantSecret(tenant, TACTICAL_INSTANCE_URL_SECRET);

    const authMode = (integration?.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const instanceUrl = (integration?.instance_url as string | undefined) || instanceUrlSecret || undefined;

    if (!integration?.integration_id) {
      return {
        success: true,
        summary: {
          isActive: false,
          instanceUrl,
          authMode,
          connectedAt: null,
          lastSyncAt: null,
          syncError: null,
          counts: { mappedOrganizations: 0, syncedDevices: 0, activeAlerts: 0, byAgentStatus: {} },
        },
      };
    }

    const integrationId = integration.integration_id as string;

    const [
      mappedOrganizationsRow,
      syncedDevicesRow,
      activeAlertsRow,
      statusRows,
    ] = await Promise.all([
      knex('rmm_organization_mappings')
        .where({ tenant, integration_id: integrationId })
        .count<{ count: string }[]>('* as count')
        .first(),
      knex('assets')
        .where({ tenant, rmm_provider: PROVIDER })
        .whereNotNull('rmm_device_id')
        .count<{ count: string }[]>('* as count')
        .first(),
      knex('rmm_alerts')
        .where({ tenant, integration_id: integrationId, status: 'active' })
        .count<{ count: string }[]>('* as count')
        .first(),
      knex('assets')
        .where({ tenant, rmm_provider: PROVIDER })
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
        authMode,
        connectedAt: integration.connected_at ?? null,
        lastSyncAt: integration.last_sync_at ?? null,
        syncError: integration.sync_error ?? null,
        counts: {
          mappedOrganizations: Number((mappedOrganizationsRow as any)?.count || 0),
          syncedDevices: Number((syncedDevicesRow as any)?.count || 0),
          activeAlerts: Number((activeAlertsRow as any)?.count || 0),
          byAgentStatus,
        },
      },
    };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const saveTacticalRmmConfiguration = withAuth(async (
  user,
  { tenant },
  input: {
    instanceUrl: string;
    authMode: TacticalRmmAuthMode;
    apiKey?: string;
    username?: string;
    password?: string;
  }
): Promise<{ success: boolean; error?: string }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const instanceUrl = normalizeBaseUrl(input.instanceUrl);
  if (!instanceUrl) return { success: false, error: 'Instance URL is required' };

  try {
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, TACTICAL_INSTANCE_URL_SECRET, instanceUrl);

    if (input.authMode === 'api_key') {
      const apiKey = (input.apiKey || '').trim();
      if (!apiKey) return { success: false, error: 'API key is required for API key auth mode' };
      await secretProvider.setTenantSecret(tenant, TACTICAL_API_KEY_SECRET, apiKey);

      // Clear Knox secrets when switching modes.
      await Promise.all([
        secretProvider.deleteTenantSecret(tenant, TACTICAL_KNOX_USERNAME_SECRET).catch(() => undefined),
        secretProvider.deleteTenantSecret(tenant, TACTICAL_KNOX_PASSWORD_SECRET).catch(() => undefined),
        secretProvider.deleteTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET).catch(() => undefined),
      ]);
    } else {
      const username = (input.username || '').trim();
      const password = (input.password || '').trim();
      if (!username || !password) {
        return { success: false, error: 'Username and password are required for Knox auth mode' };
      }
      await secretProvider.setTenantSecret(tenant, TACTICAL_KNOX_USERNAME_SECRET, username);
      await secretProvider.setTenantSecret(tenant, TACTICAL_KNOX_PASSWORD_SECRET, password);

      // Clear API key when switching modes.
      await Promise.all([
        secretProvider.deleteTenantSecret(tenant, TACTICAL_API_KEY_SECRET).catch(() => undefined),
      ]);
    }

    await upsertIntegrationRow({
      tenant,
      instance_url: instanceUrl,
      auth_mode: input.authMode,
      // Keep inactive until a successful connection test.
      is_active: false,
      connected_at: null,
      sync_error: null,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const disconnectTacticalRmmIntegration = withAuth(async (
  user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    await Promise.all([
      secretProvider.deleteTenantSecret(tenant, TACTICAL_INSTANCE_URL_SECRET).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, TACTICAL_API_KEY_SECRET).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, TACTICAL_KNOX_USERNAME_SECRET).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, TACTICAL_KNOX_PASSWORD_SECRET).catch(() => undefined),
      secretProvider.deleteTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET).catch(() => undefined),
    ]);

    const { knex } = await createTenantKnex();
    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({ is_active: false, connected_at: null, sync_error: null });

    return { success: true };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const testTacticalRmmConnection = withAuth(async (
  user,
  { tenant },
  input?: { totpCode?: string }
): Promise<{ success: boolean; error?: string; totpRequired?: boolean }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['instance_url', 'settings']);

    const authMode = (integration?.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const instanceUrl = normalizeBaseUrl(
      (integration?.instance_url as string | undefined) ||
      (await secretProvider.getTenantSecret(tenant, TACTICAL_INSTANCE_URL_SECRET)) ||
      ''
    );
    if (!instanceUrl) return { success: false, error: 'Instance URL is not configured' };

    if (authMode === 'api_key') {
      const apiKey = await secretProvider.getTenantSecret(tenant, TACTICAL_API_KEY_SECRET);
      if (!apiKey) return { success: false, error: 'API key is not configured' };

      await axios.get(new URL('/api/beta/v1/client/', instanceUrl).toString(), {
        headers: { 'X-API-KEY': apiKey },
        timeout: 15_000,
      });
    } else {
      const username = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_USERNAME_SECRET);
      const password = await secretProvider.getTenantSecret(tenant, TACTICAL_KNOX_PASSWORD_SECRET);
      if (!username || !password) {
        return { success: false, error: 'Username/password are not configured' };
      }

      const check = await axios.post(new URL('/api/v2/checkcreds/', instanceUrl).toString(), {
        username,
        password,
      }, { timeout: 15_000 });

      const needsTotp = Boolean((check.data as any)?.totp);
      if (needsTotp && !input?.totpCode) {
        return { success: false, totpRequired: true, error: 'TOTP code required' };
      }

      const buildLoginPayload = (): Record<string, any> => {
        const payload: Record<string, any> = { username, password };
        if (needsTotp && input?.totpCode) {
          payload.twofactor = String(input.totpCode).trim();
        }
        return payload;
      };

      const extractToken = (data: any): string | undefined =>
        data?.token || data?.auth_token || data?.key;

      const doLogin = async (): Promise<string> => {
        const login = await axios.post(
          new URL('/api/v2/login/', instanceUrl).toString(),
          buildLoginPayload(),
          { timeout: 15_000 }
        );
        const token = extractToken(login.data);
        if (!token) throw new Error('Login succeeded but no token was returned');
        await secretProvider.setTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET, token);
        return token;
      };

      const verifyToken = async (token: string): Promise<void> => {
        await axios.get(new URL('/api/beta/v1/client/', instanceUrl).toString(), {
          headers: { Authorization: `Token ${token}` },
          timeout: 15_000,
        });
      };

      const token = await doLogin();
      try {
        await verifyToken(token);
      } catch (err) {
        // Best-effort retry once on 401 in case the token is stale/invalid immediately.
        if (isAxiosUnauthorized(err)) {
          const retryToken = await doLogin();
          await verifyToken(retryToken);
        } else {
          throw err;
        }
      }
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({ is_active: true, connected_at: knex.fn.now(), sync_error: null });

    return { success: true };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const syncTacticalRmmOrganizations = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  items_processed?: number;
  items_created?: number;
  items_updated?: number;
  items_failed?: number;
  errors?: string[];
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const errors: string[] = [];
  const actorUserId = (user as any)?.user_id as string | undefined;
  let integrationId: string | null = null;

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tactical RMM is not configured yet. Save settings first.' };
    }

    integrationId = integration.integration_id;

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_STARTED',
      tenantId: tenant,
      actorUserId,
      integrationId,
      syncType: 'organizations',
    });

    const authMode = (integration.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const client = await buildConfiguredTacticalClient({
      tenant,
      instanceUrl: integration.instance_url,
      authMode,
    });

    const remoteClients = await client.listAllBeta<any>({ path: '/api/beta/v1/client/' });

    const existingRows = await knex('rmm_organization_mappings')
      .where({ tenant, integration_id: integration.integration_id })
      .select('external_organization_id');

    const existing = new Set(existingRows.map((r: any) => String(r.external_organization_id)));

    let created = 0;
    let updated = 0;

    for (const rc of remoteClients) {
      const externalId = String((rc as any).id ?? (rc as any).pk ?? (rc as any).client_id ?? '');
      if (!externalId) {
        errors.push('Client record missing id');
        continue;
      }

      const name =
        (rc as any).name ||
        (rc as any).client_name ||
        (rc as any).company_name ||
        (rc as any).organization ||
        externalId;

      if (existing.has(externalId)) updated += 1;
      else created += 1;

      await knex('rmm_organization_mappings')
        .insert({
          tenant,
          integration_id: integration.integration_id,
          external_organization_id: externalId,
          external_organization_name: String(name),
          metadata: rc,
        })
        .onConflict(['tenant', 'integration_id', 'external_organization_id'])
        .merge({
          external_organization_name: String(name),
          metadata: rc,
          updated_at: knex.fn.now(),
        });
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({ last_sync_at: knex.fn.now(), sync_error: errors.length ? errors.slice(0, 5).join('; ') : null });

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_COMPLETED',
      tenantId: tenant,
      actorUserId,
      integrationId,
      syncType: 'organizations',
      itemsProcessed: remoteClients.length,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsFailed: errors.length,
    });

    return {
      success: true,
      items_processed: remoteClients.length,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    if (integrationId) {
      await publishRmmSyncEvent({
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId,
        syncType: 'organizations',
        errorMessage: axiosErrorToMessage(err),
      });
    }
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

function inferAssetTypeFromTacticalAgent(agent: any): 'workstation' | 'server' {
  const os = String(agent?.operating_system || agent?.os || agent?.platform || agent?.os_name || '').toLowerCase();
  if (os.includes('server')) return 'server';
  return 'workstation';
}

function extractOsFields(agent: any): { os_type: string | null; os_version: string | null } {
  const raw = String(agent?.operating_system || agent?.os || agent?.os_name || '').trim();
  if (!raw) return { os_type: null, os_version: null };
  const parts = raw.split(/\s+/);
  const os_type = parts[0] || raw;
  const os_version = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { os_type, os_version };
}

function extractVitals(agent: any): {
  current_user: string | null;
  uptime_seconds: number | null;
  lan_ip: string | null;
  wan_ip: string | null;
} {
  const currentUser =
    agent?.logged_in_username ??
    agent?.current_user ??
    agent?.currentUser ??
    null;

  const uptimeRaw =
    agent?.uptime_seconds ??
    agent?.uptimeSeconds ??
    agent?.uptime ??
    null;

  const uptimeSeconds = uptimeRaw === null || typeof uptimeRaw === 'undefined'
    ? null
    : Number(uptimeRaw);

  const lanIp =
    agent?.lan_ip ??
    agent?.local_ip ??
    agent?.localIp ??
    agent?.ip_address ??
    null;

  const wanIp =
    agent?.wan_ip ??
    agent?.public_ip ??
    agent?.publicIp ??
    null;

  return {
    current_user: currentUser ? String(currentUser) : null,
    uptime_seconds: Number.isFinite(uptimeSeconds as any) ? uptimeSeconds : null,
    lan_ip: lanIp ? String(lanIp) : null,
    wan_ip: wanIp ? String(wanIp) : null,
  };
}

export const syncTacticalRmmDevices = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  items_processed?: number;
  items_created?: number;
  items_updated?: number;
  items_deleted?: number;
  items_failed?: number;
  errors?: string[];
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const errors: string[] = [];
  const actorUserId = (user as any)?.user_id as string | undefined;
  let integrationId: string | null = null;

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tactical RMM is not configured yet. Save settings first.' };
    }

    integrationId = integration.integration_id;

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_STARTED',
      tenantId: tenant,
      actorUserId,
      integrationId,
      syncType: 'devices',
    });

    const authMode = (integration.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const client = await buildConfiguredTacticalClient({
      tenant,
      instanceUrl: integration.instance_url,
      authMode,
    });

    const mappedOrgs = await knex('rmm_organization_mappings')
      .where({ tenant, integration_id: integration.integration_id })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select(['external_organization_id', 'client_id']);

    const sites = await client.listAllBeta<any>({ path: '/api/beta/v1/site/' });
    const siteById = new Map<string, any>();
    for (const s of sites) {
      const id = String((s as any).id ?? (s as any).pk ?? '');
      if (id) siteById.set(id, s);
    }

    let processed = 0;
    let created = 0;
    let updated = 0;

    for (const org of mappedOrgs) {
      const externalOrgId = String((org as any).external_organization_id);
      const algaClientId = String((org as any).client_id);

      const agents = await client.listAllBeta<any>({
        path: '/api/beta/v1/agent/',
        params: { client_id: externalOrgId },
      });

      for (const agent of agents) {
        processed += 1;
        try {
          const agentId = String((agent as any).agent_id ?? (agent as any).id ?? (agent as any).pk ?? '');
          if (!agentId) {
            errors.push(`Agent record missing id (org=${externalOrgId})`);
            continue;
          }

          const siteId = String((agent as any).site_id ?? (agent as any).site ?? '');
          const site = siteId ? siteById.get(siteId) : undefined;
          const siteName = site ? String((site as any).name ?? (site as any).site_name ?? '') : undefined;

          const mapping = await knex('tenant_external_entity_mappings')
            .where({
              tenant,
              integration_type: PROVIDER,
              alga_entity_type: 'asset',
              external_entity_id: agentId,
              external_realm_id: externalOrgId,
            })
            .first(['id', 'alga_entity_id']);

          const lastSeen = (agent as any).last_seen || (agent as any).lastSeen || null;
          const offlineTime = (agent as any).offline_time ?? (agent as any).offlineTime ?? null;
          const overdueTime = (agent as any).overdue_time ?? (agent as any).overdueTime ?? null;
          const status = computeTacticalAgentStatus({
            lastSeen,
            offlineTimeMinutes: offlineTime,
            overdueTimeMinutes: overdueTime,
          });

          const deviceName = String((agent as any).hostname || (agent as any).name || (agent as any).computer_name || agentId);
          const osFields = extractOsFields(agent);
          const agentVersion = (agent as any).agent_version ?? (agent as any).version ?? null;
          const vitals = extractVitals(agent);

          if (!mapping?.alga_entity_id) {
            const assetType = inferAssetTypeFromTacticalAgent(agent);
            const asset = await createAsset({
              asset_type: assetType,
              client_id: algaClientId,
              asset_tag: `tactical:${agentId}`,
              name: deviceName,
              status: 'active',
              serial_number: String((agent as any).serial_number || (agent as any).serial || ''),
              location: siteName || '',
            } as any);

            await knex('assets')
              .where({ tenant })
              .whereRaw('assets.asset_id::text = ?', [String(asset.asset_id)])
              .update({
                rmm_provider: PROVIDER,
                rmm_device_id: agentId,
                rmm_organization_id: externalOrgId,
                agent_status: status,
                last_seen_at: lastSeen ? new Date(lastSeen) : null,
                last_rmm_sync_at: knex.fn.now(),
              });

            if (assetType === 'workstation') {
              await knex('workstation_assets')
                .insert({
                  tenant,
                  asset_id: asset.asset_id,
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            } else {
              await knex('server_assets')
                .insert({
                  tenant,
                  asset_id: asset.asset_id,
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            }

            await knex('tenant_external_entity_mappings').insert({
              tenant,
              integration_type: PROVIDER,
              alga_entity_type: 'asset',
              alga_entity_id: String(asset.asset_id),
              external_entity_id: agentId,
              external_realm_id: externalOrgId,
              sync_status: 'synced',
              last_synced_at: knex.fn.now(),
              metadata: {
                site_id: siteId || undefined,
                site_name: siteName || undefined,
                raw: agent,
              },
            });

            created += 1;
          } else {
            const assetIdText = String(mapping.alga_entity_id);

            const assetRow = await knex('assets')
              .where({ tenant })
              .whereRaw('assets.asset_id::text = ?', [assetIdText])
              .first(['asset_type']);

            await knex('assets')
              .where({ tenant })
              .whereRaw('assets.asset_id::text = ?', [assetIdText])
              .update({
                name: deviceName,
                rmm_provider: PROVIDER,
                rmm_device_id: agentId,
                rmm_organization_id: externalOrgId,
                agent_status: status,
                last_seen_at: lastSeen ? new Date(lastSeen) : null,
                last_rmm_sync_at: knex.fn.now(),
              });

            if (assetRow?.asset_type === 'server') {
              await knex('server_assets')
                .insert({
                  tenant,
                  asset_id: knex.raw('?::uuid', [assetIdText]),
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            } else {
              await knex('workstation_assets')
                .insert({
                  tenant,
                  asset_id: knex.raw('?::uuid', [assetIdText]),
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                })
                .onConflict(['tenant', 'asset_id'])
                .merge({
                  os_type: osFields.os_type,
                  os_version: osFields.os_version,
                  agent_version: agentVersion ? String(agentVersion) : null,
                  current_user: vitals.current_user,
                  uptime_seconds: vitals.uptime_seconds,
                  lan_ip: vitals.lan_ip,
                  wan_ip: vitals.wan_ip,
                });
            }

            await knex('tenant_external_entity_mappings')
              .where({ tenant, id: mapping.id })
              .update({
                external_realm_id: externalOrgId,
                external_entity_id: agentId,
                sync_status: 'synced',
                last_synced_at: knex.fn.now(),
                metadata: {
                  site_id: siteId || undefined,
                  site_name: siteName || undefined,
                  raw: agent,
                },
              });

            updated += 1;
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : 'Unknown error syncing agent');
        }
      }
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({ last_sync_at: knex.fn.now(), sync_error: errors.length ? errors.slice(0, 5).join('; ') : null });

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_COMPLETED',
      tenantId: tenant,
      actorUserId,
      integrationId,
      syncType: 'devices',
      itemsProcessed: processed,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsFailed: errors.length,
    });

    return {
      success: true,
      items_processed: processed,
      items_created: created,
      items_updated: updated,
      items_deleted: 0,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    if (integrationId) {
      await publishRmmSyncEvent({
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId,
        syncType: 'devices',
        errorMessage: axiosErrorToMessage(err),
      });
    }
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const listTacticalRmmOrganizationMappings = withAuth(async (
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
    company_name?: string | null;
    auto_sync_assets: boolean;
    metadata?: Record<string, unknown> | null;
  }>;
}> => {
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
      .leftJoin('clients as c', function () {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const join = this as any;
        join.on('c.client_id', '=', 'rom.client_id').andOn('c.tenant', '=', 'rom.tenant');
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
        'rom.metadata',
        knex.raw('c.client_name as company_name'),
      ])
      .orderBy('rom.external_organization_name', 'asc');

    return { success: true, mappings: rows as any };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const updateTacticalRmmOrganizationMapping = withAuth(async (
  user,
  { tenant },
  input: { mappingId: string; clientId?: string | null; autoSyncAssets?: boolean }
): Promise<{ success: boolean; error?: string }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const patch: Record<string, any> = {};
    if (typeof input.clientId !== 'undefined') patch.client_id = input.clientId;
    if (typeof input.autoSyncAssets !== 'undefined') patch.auto_sync_assets = input.autoSyncAssets;
    if (!Object.keys(patch).length) return { success: true };

    await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: input.mappingId })
      .update({ ...patch, updated_at: knex.fn.now() });

    return { success: true };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const getTacticalRmmWebhookInfo = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  webhook?: {
    url: string;
    headerName: string;
    secret: string;
    payloadTemplate: string;
  };
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const secretProvider = await getSecretProviderInstance();
    let secret = await secretProvider.getTenantSecret(tenant, TACTICAL_WEBHOOK_SECRET);
    if (!secret) {
      secret = randomBytes(24).toString('hex');
      await secretProvider.setTenantSecret(tenant, TACTICAL_WEBHOOK_SECRET, secret);
    }

    const baseUrl = getWebhookBaseUrl();
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const url = `${cleanBaseUrl}/api/webhooks/tacticalrmm?tenant=${encodeURIComponent(tenant)}`;

    const payloadTemplate = JSON.stringify({
      agent_id: '<TACTICAL_AGENT_ID>',
      alert_id: '<ALERT_ID_OPTIONAL>',
      event: 'trigger|resolve',
      severity: 'critical|major|moderate|minor|none',
      message: '<ALERT_MESSAGE>',
      alert_time: '<ISO_TIMESTAMP>',
      client_id: '<TACTICAL_CLIENT_ID_OPTIONAL>',
      site_id: '<TACTICAL_SITE_ID_OPTIONAL>',
    }, null, 2);

    return {
      success: true,
      webhook: {
        url,
        headerName: TACTICAL_WEBHOOK_HEADER_NAME,
        secret,
        payloadTemplate,
      },
    };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

function mapTacticalSeverity(input: any): 'critical' | 'major' | 'moderate' | 'minor' | 'none' {
  const raw = String(input || '').toLowerCase();
  if (!raw) return 'none';
  if (raw.includes('crit')) return 'critical';
  if (raw.includes('major') || raw.includes('high')) return 'major';
  if (raw.includes('moder')) return 'moderate';
  if (raw.includes('minor') || raw.includes('low')) return 'minor';
  return 'none';
}

export const backfillTacticalRmmAlerts = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  items_processed?: number;
  items_created?: number;
  items_updated?: number;
  items_failed?: number;
  errors?: string[];
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const errors: string[] = [];
  const actorUserId = (user as any)?.user_id as string | undefined;
  let integrationId: string | null = null;

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tactical RMM is not configured yet. Save settings first.' };
    }

    integrationId = integration.integration_id;

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_STARTED',
      tenantId: tenant,
      actorUserId,
      integrationId,
      syncType: 'alerts',
    });

    const authMode = (integration.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const client = await buildConfiguredTacticalClient({
      tenant,
      instanceUrl: integration.instance_url,
      authMode,
    });

    // Tactical supports a filterable alerts endpoint; prefer PATCH per docs, but be permissive in response shape.
    const res = await client.request<any>({
      method: 'PATCH',
      path: '/api/alerts/',
      data: {
        // Conservative default: request active alerts. Tactical may ignore unknown filters.
        status: 'active',
      },
    });

    const alerts: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.results)
        ? (res as any).results
        : Array.isArray((res as any)?.alerts)
          ? (res as any).alerts
          : [];

    const existingRows = await knex('rmm_alerts')
      .where({ tenant, integration_id: integration.integration_id })
      .select('external_alert_id');
    const existing = new Set(existingRows.map((r: any) => String(r.external_alert_id)));

    let created = 0;
    let updated = 0;

    for (const alert of alerts) {
      try {
        const externalAlertId = String(alert?.id ?? alert?.alert_id ?? alert?.uid ?? '');
        if (!externalAlertId) {
          errors.push('Alert record missing id');
          continue;
        }

        const agentId = String(alert?.agent_id ?? alert?.device_id ?? alert?.agent ?? alert?.device ?? '');
        let assetId: string | undefined;
        if (agentId) {
          const mapping = await knex('tenant_external_entity_mappings')
            .where({
              tenant,
              integration_type: PROVIDER,
              alga_entity_type: 'asset',
              external_entity_id: agentId,
            })
            .first(['alga_entity_id']);
          assetId = mapping?.alga_entity_id;
        }

        const status: string =
          alert?.status ? String(alert.status) :
          alert?.resolved ? 'resolved' :
          'active';

        const severity = mapTacticalSeverity(alert?.severity ?? alert?.alert_severity);
        const message = String(alert?.message ?? alert?.alert_message ?? alert?.description ?? '');
        const triggeredAt = alert?.alert_time || alert?.triggered_at || alert?.created || new Date().toISOString();
        const resolvedAt = alert?.resolved_at || alert?.resolved || null;

        const baseRow = {
          tenant,
          integration_id: integration.integration_id,
          external_alert_id: externalAlertId,
          external_device_id: agentId || null,
          asset_id: assetId || null,
          severity,
          priority: null,
          activity_type: 'tacticalrmm_alert',
          status,
          message: message || null,
          source_data: JSON.stringify(alert),
          triggered_at: triggeredAt,
          resolved_at: resolvedAt,
          updated_at: knex.fn.now(),
        };

        if (existing.has(externalAlertId)) {
          await knex('rmm_alerts')
            .where({ tenant, integration_id: integration.integration_id, external_alert_id: externalAlertId })
            .update(baseRow);
          updated += 1;
        } else {
          await knex('rmm_alerts')
            .insert({ ...baseRow, created_at: knex.fn.now() });
          created += 1;
          existing.add(externalAlertId);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Unknown error upserting alert');
      }
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({ last_sync_at: knex.fn.now(), sync_error: errors.length ? errors.slice(0, 5).join('; ') : null });

    await publishRmmSyncEvent({
      eventType: 'RMM_SYNC_COMPLETED',
      tenantId: tenant,
      actorUserId,
      integrationId,
      syncType: 'alerts',
      itemsProcessed: alerts.length,
      itemsCreated: created,
      itemsUpdated: updated,
      itemsFailed: errors.length,
    });

    return {
      success: true,
      items_processed: alerts.length,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    if (integrationId) {
      await publishRmmSyncEvent({
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId,
        syncType: 'alerts',
        errorMessage: axiosErrorToMessage(err),
      });
    }
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

function normalizeSoftwareName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.+-]/g, '');
}

async function findOrCreateSoftwareCatalogEntry(
  knex: any,
  tenant: string,
  input: { name: string; publisher?: string | null }
): Promise<string> {
  const normalizedName = normalizeSoftwareName(input.name);
  const publisher = input.publisher ? String(input.publisher).trim() : null;

  const existing = await knex('software_catalog')
    .where({ tenant, normalized_name: normalizedName, publisher })
    .first(['software_id']);
  if (existing?.software_id) return existing.software_id;

  const [row] = await knex('software_catalog')
    .insert({
      tenant,
      name: input.name.trim(),
      normalized_name: normalizedName,
      publisher,
      category: 'application',
      software_type: 'application',
      is_managed: false,
      is_security_relevant: false,
    })
    .returning(['software_id']);

  return row.software_id;
}

async function syncAssetSoftwareToNormalizedTables(
  knex: any,
  tenant: string,
  assetId: string,
  softwareList: Array<{ name: string; version?: string | null; publisher?: string | null; installPath?: string | null }>,
  syncTimestamp: Date
): Promise<{ installed: number; uninstalled: number; catalogCreated: number }> {
  const stats = { installed: 0, uninstalled: 0, catalogCreated: 0 };

  const currentSoftware = await knex('asset_software')
    .where({ tenant, asset_id: assetId, is_current: true })
    .select('software_id');
  const currentSoftwareIds = new Set<string>(
    currentSoftware.map((s: { software_id: unknown }) => String(s.software_id))
  );

  const seenSoftwareIds = new Set<string>();

  for (const sw of softwareList) {
    if (!sw?.name) continue;

    const softwareId = await findOrCreateSoftwareCatalogEntry(knex, tenant, {
      name: sw.name,
      publisher: sw.publisher || null,
    });

    seenSoftwareIds.add(softwareId);

    const existing = await knex('asset_software')
      .where({ tenant, asset_id: assetId, software_id: softwareId })
      .first();

    if (existing) {
      const updateData: Record<string, any> = {
        last_seen_at: syncTimestamp,
        version: sw.version || existing.version,
        install_path: sw.installPath || existing.install_path,
      };

      if (!existing.is_current) {
        updateData.is_current = true;
        updateData.uninstalled_at = null;
        stats.installed += 1;
      }

      await knex('asset_software')
        .where({ tenant, asset_id: assetId, software_id: softwareId })
        .update(updateData);
    } else {
      await knex('asset_software').insert({
        tenant,
        asset_id: assetId,
        software_id: softwareId,
        version: sw.version || null,
        install_path: sw.installPath || null,
        first_seen_at: syncTimestamp,
        last_seen_at: syncTimestamp,
        is_current: true,
      });
      stats.installed += 1;
      stats.catalogCreated += 1;
    }
  }

  for (const softwareId of currentSoftwareIds) {
    if (!seenSoftwareIds.has(softwareId)) {
      await knex('asset_software')
        .where({ tenant, asset_id: assetId, software_id: softwareId, is_current: true })
        .update({ is_current: false, uninstalled_at: syncTimestamp });
      stats.uninstalled += 1;
    }
  }

  return stats;
}

export const ingestTacticalRmmSoftwareInventory = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  items_processed?: number;
  items_created?: number;
  items_updated?: number;
  items_failed?: number;
  errors?: string[];
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const errors: string[] = [];

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tactical RMM is not configured yet. Save settings first.' };
    }

    const authMode = (integration.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const client = await buildConfiguredTacticalClient({
      tenant,
      instanceUrl: integration.instance_url,
      authMode,
    });

    const res = await client.request<any>({ method: 'GET', path: '/api/software/' });

    const rows: any[] = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.results)
        ? (res as any).results
        : [];

    // Build agent_id -> asset_id map
    const mappings = await knex('tenant_external_entity_mappings')
      .where({ tenant, integration_type: PROVIDER, alga_entity_type: 'asset' })
      .select(['external_entity_id', 'alga_entity_id']);

    const assetIdByAgentId = new Map<string, string>();
    for (const m of mappings) {
      assetIdByAgentId.set(String((m as any).external_entity_id), String((m as any).alga_entity_id));
    }

    // Group by agent
    const softwareByAgent = new Map<string, Array<{ name: string; version?: string | null; publisher?: string | null; installPath?: string | null }>>();
    for (const r of rows) {
      const agentId = String(r?.agent_id ?? r?.agent ?? r?.device_id ?? r?.device ?? '');
      const name = String(r?.name ?? r?.software_name ?? r?.product_name ?? '').trim();
      if (!agentId || !name) continue;

      const list = softwareByAgent.get(agentId) || [];
      list.push({
        name,
        version: r?.version ? String(r.version) : null,
        publisher: r?.publisher ? String(r.publisher) : null,
        installPath: r?.install_path ? String(r.install_path) : (r?.location ? String(r.location) : null),
      });
      softwareByAgent.set(agentId, list);
    }

    const syncTs = new Date();
    let processed = 0;
    let updatedAssets = 0;
    let installed = 0;

    for (const [agentId, softwareList] of softwareByAgent.entries()) {
      processed += softwareList.length;
      const assetId = assetIdByAgentId.get(agentId);
      if (!assetId) continue;
      try {
        const stats = await syncAssetSoftwareToNormalizedTables(knex, tenant, assetId, softwareList, syncTs);
        installed += stats.installed;
        updatedAssets += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `Failed syncing software for agent ${agentId}`);
      }
    }

    await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .update({ last_sync_at: knex.fn.now(), sync_error: errors.length ? errors.slice(0, 5).join('; ') : null });

    return {
      success: true,
      items_processed: processed,
      items_created: installed,
      items_updated: updatedAssets,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});

export const syncTacticalRmmSingleAgent = withAuth(async (
  user,
  { tenant },
  input: { agentId: string }
): Promise<{ success: boolean; error?: string; updated?: boolean; assetId?: string | null }> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'update');
  if (!permitted) return { success: false, error: 'Forbidden' };

  const agentId = String(input.agentId || '').trim();
  if (!agentId) return { success: false, error: 'agentId is required' };

  try {
    const { knex } = await createTenantKnex();
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: PROVIDER })
      .first(['integration_id', 'instance_url', 'settings']);

    if (!integration?.integration_id) {
      return { success: false, error: 'Tactical RMM is not configured yet. Save settings first.' };
    }

    const authMode = (integration.settings?.auth_mode as TacticalRmmAuthMode) || 'api_key';
    const client = await buildConfiguredTacticalClient({
      tenant,
      instanceUrl: integration.instance_url,
      authMode,
    });

    const agent = await client.request<any>({ method: 'GET', path: `/api/beta/v1/agent/${encodeURIComponent(agentId)}/` });

    const mapping = await knex('tenant_external_entity_mappings')
      .where({
        tenant,
        integration_type: PROVIDER,
        alga_entity_type: 'asset',
        external_entity_id: agentId,
      })
      .first(['id', 'alga_entity_id', 'external_realm_id']);

    if (!mapping?.alga_entity_id) {
      return { success: true, updated: false, assetId: null };
    }

    const assetIdText = String(mapping.alga_entity_id);
    const externalOrgId = String(
      (agent as any).client_id ??
      (agent as any).client ??
      (mapping.external_realm_id ?? '')
    );

    const lastSeen = (agent as any).last_seen || (agent as any).lastSeen || null;
    const offlineTime = (agent as any).offline_time ?? (agent as any).offlineTime ?? null;
    const overdueTime = (agent as any).overdue_time ?? (agent as any).overdueTime ?? null;
    const status = computeTacticalAgentStatus({
      lastSeen,
      offlineTimeMinutes: offlineTime,
      overdueTimeMinutes: overdueTime,
    });

    const deviceName = String((agent as any).hostname || (agent as any).name || (agent as any).computer_name || agentId);
    const osFields = extractOsFields(agent);
    const agentVersion = (agent as any).agent_version ?? (agent as any).version ?? null;
    const vitals = extractVitals(agent);

    const siteId = String((agent as any).site_id ?? (agent as any).site ?? '');
    const siteName = (agent as any).site_name ? String((agent as any).site_name) : undefined;

    const assetRow = await knex('assets')
      .where({ tenant })
      .whereRaw('assets.asset_id::text = ?', [assetIdText])
      .first(['asset_type']);

    await knex('assets')
      .where({ tenant })
      .whereRaw('assets.asset_id::text = ?', [assetIdText])
      .update({
        name: deviceName,
        rmm_provider: PROVIDER,
        rmm_device_id: agentId,
        rmm_organization_id: externalOrgId || null,
        agent_status: status,
        last_seen_at: lastSeen ? new Date(lastSeen) : null,
        last_rmm_sync_at: knex.fn.now(),
      });

    if (assetRow?.asset_type === 'server') {
      await knex('server_assets')
        .insert({
          tenant,
          asset_id: knex.raw('?::uuid', [assetIdText]),
          os_type: osFields.os_type,
          os_version: osFields.os_version,
          agent_version: agentVersion ? String(agentVersion) : null,
          current_user: vitals.current_user,
          uptime_seconds: vitals.uptime_seconds,
          lan_ip: vitals.lan_ip,
          wan_ip: vitals.wan_ip,
        })
        .onConflict(['tenant', 'asset_id'])
        .merge({
          os_type: osFields.os_type,
          os_version: osFields.os_version,
          agent_version: agentVersion ? String(agentVersion) : null,
          current_user: vitals.current_user,
          uptime_seconds: vitals.uptime_seconds,
          lan_ip: vitals.lan_ip,
          wan_ip: vitals.wan_ip,
        });
    } else {
      await knex('workstation_assets')
        .insert({
          tenant,
          asset_id: knex.raw('?::uuid', [assetIdText]),
          os_type: osFields.os_type,
          os_version: osFields.os_version,
          agent_version: agentVersion ? String(agentVersion) : null,
          current_user: vitals.current_user,
          uptime_seconds: vitals.uptime_seconds,
          lan_ip: vitals.lan_ip,
          wan_ip: vitals.wan_ip,
        })
        .onConflict(['tenant', 'asset_id'])
        .merge({
          os_type: osFields.os_type,
          os_version: osFields.os_version,
          agent_version: agentVersion ? String(agentVersion) : null,
          current_user: vitals.current_user,
          uptime_seconds: vitals.uptime_seconds,
          lan_ip: vitals.lan_ip,
          wan_ip: vitals.wan_ip,
        });
    }

    await knex('tenant_external_entity_mappings')
      .where({ tenant, id: mapping.id })
      .update({
        external_realm_id: externalOrgId || mapping.external_realm_id,
        sync_status: 'synced',
        last_synced_at: knex.fn.now(),
        metadata: {
          site_id: siteId || undefined,
          site_name: siteName || undefined,
          raw: agent,
        },
      });

    return { success: true, updated: true, assetId: assetIdText };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});
