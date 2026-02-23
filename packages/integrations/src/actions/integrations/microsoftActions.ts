'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';

const MICROSOFT_CLIENT_ID_SECRET = 'microsoft_client_id';
const MICROSOFT_CLIENT_SECRET_SECRET = 'microsoft_client_secret';
const MICROSOFT_TENANT_ID_SECRET = 'microsoft_tenant_id';

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function computeBaseUrl(envValue?: string | null): string {
  const raw = (envValue || '').trim();
  if (!raw) return 'http://localhost:3000';

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return 'http://localhost:3000';
  }
}

async function getDeploymentBaseUrl(): Promise<string> {
  const secretProvider = await getSecretProviderInstance();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';

  return computeBaseUrl(base);
}

export const getMicrosoftIntegrationStatus = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  baseUrl?: string;
  redirectUris?: { email: string; calendar: string; sso: string };
  scopes?: { email: string[]; calendar: string[]; sso: string[] };
  config?: {
    clientId?: string;
    clientSecretMasked?: string;
    tenantId: string;
    ready: boolean;
  };
}> => {
  try {
    // This endpoint intentionally returns only masked/derived configuration.
    // Internal MSP users can view this to complete Microsoft connection workflows.
    if ((user as any)?.user_type === 'client') return { success: false, error: 'Forbidden' };

    const secretProvider = await getSecretProviderInstance();
    const [clientId, clientSecret, tenantIdRaw] = await Promise.all([
      secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_ID_SECRET),
      secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_SECRET_SECRET),
      secretProvider.getTenantSecret(tenant, MICROSOFT_TENANT_ID_SECRET),
    ]);

    const tenantId = (tenantIdRaw || '').trim() || 'common';
    const baseUrl = await getDeploymentBaseUrl();

    return {
      success: true,
      baseUrl,
      redirectUris: {
        email: `${baseUrl}/api/auth/microsoft/callback`,
        calendar: `${baseUrl}/api/auth/microsoft/calendar/callback`,
        sso: `${baseUrl}/api/auth/callback/azure-ad`,
      },
      scopes: {
        email: [
          'https://graph.microsoft.com/Mail.Read',
          'https://graph.microsoft.com/Mail.ReadWrite',
          'https://graph.microsoft.com/Mail.Send',
          'offline_access',
          'openid',
          'profile',
          'email',
        ],
        calendar: [
          'https://graph.microsoft.com/Calendars.ReadWrite',
          'https://graph.microsoft.com/Mail.Read',
          'offline_access',
        ],
        sso: ['openid', 'profile', 'email'],
      },
      config: {
        clientId: clientId || undefined,
        clientSecretMasked: clientSecret ? maskSecret(clientSecret) : undefined,
        tenantId,
        ready: Boolean(clientId && clientSecret),
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load Microsoft integration status' };
  }
});

function normalizeMicrosoftClientId(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normalizeTenantId(value?: string): string {
  const normalized = (value || '').trim();
  return normalized || 'common';
}

export const saveMicrosoftIntegrationSettings = withAuth(async (
  _user,
  { tenant },
  input: {
    clientId: string;
    clientSecret: string;
    tenantId?: string;
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const clientId = normalizeMicrosoftClientId(input.clientId ?? '');
    if (!clientId) return { success: false, error: 'Microsoft OAuth Client ID is required' };

    const clientSecret = (input.clientSecret || '').trim();
    if (!clientSecret) return { success: false, error: 'Microsoft OAuth Client Secret is required' };

    const tenantId = normalizeTenantId(input.tenantId);

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, MICROSOFT_CLIENT_ID_SECRET, clientId);
    await secretProvider.setTenantSecret(tenant, MICROSOFT_CLIENT_SECRET_SECRET, clientSecret);
    await secretProvider.setTenantSecret(tenant, MICROSOFT_TENANT_ID_SECRET, tenantId);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to save Microsoft integration settings' };
  }
});

export const resetMicrosoftProvidersToDisconnected = withAuth(async (
  _user,
  { tenant }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();

    await knex('email_providers')
      .where({ tenant, provider_type: 'microsoft' })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    await knex('microsoft_email_provider_config')
      .where({ tenant })
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        webhook_subscription_id: null,
        webhook_verification_token: null,
        webhook_expires_at: null,
        last_subscription_renewal: null,
        updated_at: knex.fn.now(),
      });

    await knex('calendar_providers')
      .where({ tenant, provider_type: 'microsoft' })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    await knex('microsoft_calendar_provider_config')
      .where({ tenant })
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        webhook_subscription_id: null,
        webhook_expires_at: null,
        webhook_notification_url: null,
        webhook_verification_token: null,
        delta_link: null,
        updated_at: knex.fn.now(),
      });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reset Microsoft providers' };
  }
});
