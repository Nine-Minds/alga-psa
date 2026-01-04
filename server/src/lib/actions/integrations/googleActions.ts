'use server';

import { getSecretProviderInstance } from '@shared/core/secretProvider';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/db';

const GOOGLE_CLIENT_ID_SECRET = 'google_client_id';
const GOOGLE_CLIENT_SECRET_SECRET = 'google_client_secret';
const GOOGLE_PROJECT_ID_SECRET = 'google_project_id';
const GOOGLE_SERVICE_ACCOUNT_KEY_SECRET = 'google_service_account_key';

const GOOGLE_CALENDAR_CLIENT_ID_SECRET = 'google_calendar_client_id';
const GOOGLE_CALENDAR_CLIENT_SECRET_SECRET = 'google_calendar_client_secret';

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function isLikelyGoogleClientId(value: string): boolean {
  // Typical format: <digits>-<alnum>.apps.googleusercontent.com
  return /^[0-9]+-[a-zA-Z0-9_\\-]+\\.apps\\.googleusercontent\\.com$/.test(value.trim());
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

export async function getGoogleIntegrationStatus(): Promise<{
  success: boolean;
  error?: string;
  baseUrl?: string;
  redirectUris?: { gmail: string; calendar: string };
  scopes?: { gmail: string[]; calendar: string[] };
  config?: {
    projectId?: string;
    gmailClientId?: string;
    gmailClientSecretMasked?: string;
    calendarClientId?: string;
    calendarClientSecretMasked?: string;
    hasServiceAccountKey: boolean;
    usingSharedOAuthApp: boolean;
  };
}> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) return { success: false, error: 'Unauthorized' };

    const permitted = await hasPermission(user as any, 'system_settings', 'read');
    if (!permitted) return { success: false, error: 'Forbidden' };

    const { tenant } = await createTenantKnex();
    if (!tenant) return { success: false, error: 'Tenant not found' };

    const secretProvider = await getSecretProviderInstance();

    const [
      projectId,
      gmailClientId,
      gmailClientSecret,
      calendarClientId,
      calendarClientSecret,
      serviceAccountKey
    ] = await Promise.all([
      secretProvider.getTenantSecret(tenant, GOOGLE_PROJECT_ID_SECRET),
      secretProvider.getTenantSecret(tenant, GOOGLE_CLIENT_ID_SECRET),
      secretProvider.getTenantSecret(tenant, GOOGLE_CLIENT_SECRET_SECRET),
      secretProvider.getTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_ID_SECRET),
      secretProvider.getTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_SECRET_SECRET),
      secretProvider.getTenantSecret(tenant, GOOGLE_SERVICE_ACCOUNT_KEY_SECRET)
    ]);

    const baseUrl = await getDeploymentBaseUrl();
    const redirectUris = {
      gmail: `${baseUrl}/api/auth/google/callback`,
      calendar: `${baseUrl}/api/auth/google/calendar/callback`
    };

    const resolvedCalendarClientId = calendarClientId || gmailClientId || undefined;
    const resolvedCalendarClientSecret = calendarClientSecret || gmailClientSecret || undefined;

    return {
      success: true,
      baseUrl,
      redirectUris,
      scopes: {
        gmail: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/pubsub'
        ],
        calendar: ['https://www.googleapis.com/auth/calendar']
      },
      config: {
        projectId: projectId || undefined,
        gmailClientId: gmailClientId || undefined,
        gmailClientSecretMasked: gmailClientSecret ? maskSecret(gmailClientSecret) : undefined,
        calendarClientId: resolvedCalendarClientId,
        calendarClientSecretMasked: resolvedCalendarClientSecret
          ? maskSecret(resolvedCalendarClientSecret)
          : undefined,
        hasServiceAccountKey: Boolean(serviceAccountKey),
        usingSharedOAuthApp: Boolean(gmailClientId && gmailClientSecret && !calendarClientId && !calendarClientSecret)
      }
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load Google integration status' };
  }
}

export async function saveGoogleIntegrationSettings(input: {
  projectId: string;
  gmailClientId: string;
  gmailClientSecret: string;
  serviceAccountKeyJson: string;
  useSameOAuthAppForCalendar: boolean;
  calendarClientId?: string;
  calendarClientSecret?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) return { success: false, error: 'Unauthorized' };

    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) return { success: false, error: 'Forbidden' };

    const { tenant } = await createTenantKnex();
    if (!tenant) return { success: false, error: 'Tenant not found' };

    const projectId = input.projectId?.trim();
    if (!projectId) return { success: false, error: 'Google Cloud project ID is required' };

    const gmailClientId = input.gmailClientId?.trim();
    if (!gmailClientId) return { success: false, error: 'Gmail OAuth Client ID is required' };
    if (!isLikelyGoogleClientId(gmailClientId)) {
      return { success: false, error: 'Gmail OAuth Client ID does not look valid' };
    }

    const gmailClientSecret = input.gmailClientSecret?.trim();
    if (!gmailClientSecret) return { success: false, error: 'Gmail OAuth Client Secret is required' };

    const serviceAccountKeyJson = input.serviceAccountKeyJson?.trim();
    if (!serviceAccountKeyJson) {
      return { success: false, error: 'Service account key JSON is required for Pub/Sub provisioning' };
    }

    let parsedKey: any;
    try {
      parsedKey = JSON.parse(serviceAccountKeyJson);
    } catch {
      return { success: false, error: 'Service account key is not valid JSON' };
    }
    if (!parsedKey?.client_email || !parsedKey?.private_key) {
      return { success: false, error: 'Service account key JSON is missing required fields (client_email, private_key)' };
    }

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, GOOGLE_PROJECT_ID_SECRET, projectId);
    await secretProvider.setTenantSecret(tenant, GOOGLE_CLIENT_ID_SECRET, gmailClientId);
    await secretProvider.setTenantSecret(tenant, GOOGLE_CLIENT_SECRET_SECRET, gmailClientSecret);
    await secretProvider.setTenantSecret(tenant, GOOGLE_SERVICE_ACCOUNT_KEY_SECRET, serviceAccountKeyJson);

    if (input.useSameOAuthAppForCalendar) {
      await secretProvider.setTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_ID_SECRET, gmailClientId);
      await secretProvider.setTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_SECRET_SECRET, gmailClientSecret);
    } else {
      const calendarClientId = input.calendarClientId?.trim();
      const calendarClientSecret = input.calendarClientSecret?.trim();

      if (!calendarClientId) return { success: false, error: 'Calendar OAuth Client ID is required' };
      if (!isLikelyGoogleClientId(calendarClientId)) {
        return { success: false, error: 'Calendar OAuth Client ID does not look valid' };
      }
      if (!calendarClientSecret) return { success: false, error: 'Calendar OAuth Client Secret is required' };

      await secretProvider.setTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_ID_SECRET, calendarClientId);
      await secretProvider.setTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_SECRET_SECRET, calendarClientSecret);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to save Google integration settings' };
  }
}

export async function resetGoogleProvidersToDisconnected(): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) return { success: false, error: 'Unauthorized' };

    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) return { success: false, error: 'Forbidden' };

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) return { success: false, error: 'Tenant not found' };

    // Email providers: mark disconnected + clear tokens
    await knex('email_providers')
      .where({ tenant, provider_type: 'google' })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now()
      });

    await knex('google_email_provider_config')
      .where({ tenant })
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        history_id: null,
        watch_expiration: null,
        pubsub_initialised_at: null,
        updated_at: knex.fn.now()
      });

    // Calendar providers: mark disconnected + clear tokens + webhook identifiers
    await knex('calendar_providers')
      .where({ tenant, provider_type: 'google' })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now()
      });

    await knex('google_calendar_provider_config')
      .where({ tenant })
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        sync_token: null,
        pubsub_initialised_at: null,
        pubsub_topic_name: null,
        pubsub_subscription_name: null,
        webhook_subscription_id: null,
        webhook_expires_at: null,
        webhook_resource_id: null,
        webhook_notification_url: null,
        webhook_verification_token: null,
        updated_at: knex.fn.now()
      });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to reset Google providers' };
  }
}
