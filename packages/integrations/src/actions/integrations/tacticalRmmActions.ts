'use server';

import axios, { AxiosError } from 'axios';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';
import { TacticalRmmClient, normalizeTacticalBaseUrl } from '../../lib/rmm/tacticalrmm/tacticalApiClient';

const PROVIDER = 'tacticalrmm' as const;

const TACTICAL_INSTANCE_URL_SECRET = 'tacticalrmm_instance_url';
const TACTICAL_API_KEY_SECRET = 'tacticalrmm_api_key';
const TACTICAL_KNOX_USERNAME_SECRET = 'tacticalrmm_username';
const TACTICAL_KNOX_PASSWORD_SECRET = 'tacticalrmm_password';
const TACTICAL_KNOX_TOKEN_SECRET = 'tacticalrmm_knox_token';

export type TacticalRmmAuthMode = 'api_key' | 'knox';

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

      const loginPayload: Record<string, any> = { username, password };
      if (needsTotp && input?.totpCode) {
        loginPayload.twofactor = String(input.totpCode).trim();
      }
      const login = await axios.post(new URL('/api/v2/login/', instanceUrl).toString(), loginPayload, { timeout: 15_000 });

      // Tactical returns a Knox token in typical DRF Knox format; accept a few common keys.
      const token: string | undefined =
        (login.data as any)?.token ||
        (login.data as any)?.auth_token ||
        (login.data as any)?.key;

      if (!token) return { success: false, error: 'Login succeeded but no token was returned' };
      await secretProvider.setTenantSecret(tenant, TACTICAL_KNOX_TOKEN_SECRET, token);

      // Verify token works against a cheap endpoint.
      await axios.get(new URL('/api/beta/v1/client/', instanceUrl).toString(), {
        headers: { Authorization: `Token ${token}` },
        timeout: 15_000,
      });
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

    return {
      success: true,
      items_processed: remoteClients.length,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    return { success: false, error: axiosErrorToMessage(err) };
  }
});
