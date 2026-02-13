'use server';

import axios, { AxiosError } from 'axios';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';

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
  const raw = (input || '').trim();
  if (!raw) return '';

  const withProto = raw.startsWith('http://') || raw.startsWith('https://')
    ? raw
    : `https://${raw}`;

  const url = new URL(withProto);
  const pathname = url.pathname.replace(/\/+$/, '');
  const normalizedPath = pathname === '/api' ? '' : pathname;
  return `${url.protocol}//${url.host}${normalizedPath}`;
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
