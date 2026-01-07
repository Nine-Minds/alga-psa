'use server';

import { getSecretProviderInstance } from '@shared/core/secretProvider';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/db';
import { randomUUID } from 'node:crypto';

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

function normalizeGoogleClientId(value: string): string {
  // Copy/paste from admin consoles can include zero-width characters that `trim()` does not remove.
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function describeGoogleClientId(rawValue: unknown): {
  raw: string | null;
  normalized: string | null;
  rawLength: number | null;
  normalizedLength: number | null;
  changedByNormalize: boolean | null;
  hasZeroWidthChars: boolean | null;
  hasNonAsciiChars: boolean | null;
  hasWhitespaceChars: boolean | null;
  codepointsHex: string[] | null;
} {
  if (typeof rawValue !== 'string') {
    return {
      raw: rawValue == null ? null : String(rawValue),
      normalized: null,
      rawLength: rawValue == null ? null : String(rawValue).length,
      normalizedLength: null,
      changedByNormalize: null,
      hasZeroWidthChars: null,
      hasNonAsciiChars: null,
      hasWhitespaceChars: null,
      codepointsHex: null,
    };
  }

  const normalized = normalizeGoogleClientId(rawValue);
  const codepointsHex = Array.from(rawValue).map((ch) => (ch.codePointAt(0) ?? 0).toString(16));

  return {
    raw: rawValue,
    normalized,
    rawLength: rawValue.length,
    normalizedLength: normalized.length,
    changedByNormalize: rawValue !== normalized,
    hasZeroWidthChars: /[\u200B-\u200D\uFEFF]/.test(rawValue),
    hasNonAsciiChars: /[^\x20-\x7E]/.test(rawValue),
    hasWhitespaceChars: /\s/.test(rawValue),
    codepointsHex,
  };
}

function isLikelyGoogleClientId(value: string): boolean {
  // Typical format: <digits>-<alnum>.apps.googleusercontent.com
  return /^[0-9]+-[a-zA-Z0-9_\\-]+\\.apps\\.googleusercontent\\.com$/.test(normalizeGoogleClientId(value));
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
  const traceId = randomUUID();
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) return { success: false, error: 'Unauthorized' };

    const permitted = await hasPermission(user as any, 'system_settings', 'update');
    if (!permitted) return { success: false, error: 'Forbidden' };

    const { tenant } = await createTenantKnex();
    if (!tenant) return { success: false, error: 'Tenant not found' };

    console.info('[google] saveGoogleIntegrationSettings start', {
      traceId,
      tenant,
      useSameOAuthAppForCalendar: input.useSameOAuthAppForCalendar,
      projectId: input.projectId?.trim?.() ?? input.projectId,
      gmailClientId: describeGoogleClientId(input.gmailClientId),
      calendarClientId: describeGoogleClientId(input.calendarClientId),
      gmailClientSecretLength:
        typeof input.gmailClientSecret === 'string' ? input.gmailClientSecret.length : null,
      calendarClientSecretLength:
        typeof input.calendarClientSecret === 'string' ? input.calendarClientSecret.length : null,
      serviceAccountKeyJsonLength:
        typeof input.serviceAccountKeyJson === 'string' ? input.serviceAccountKeyJson.length : null,
    });

    const projectId = input.projectId?.trim();
    if (!projectId) return { success: false, error: 'Google Cloud project ID is required' };

    const gmailClientId = normalizeGoogleClientId(input.gmailClientId ?? '');
    if (!gmailClientId) return { success: false, error: 'Gmail OAuth Client ID is required' };
    if (!isLikelyGoogleClientId(gmailClientId)) {
      console.warn('[google] invalid gmailClientId', {
        traceId,
        tenant,
        pattern: '^[0-9]+-[a-zA-Z0-9_\\-]+\\.apps\\.googleusercontent\\.com$',
        gmailClientId: describeGoogleClientId(input.gmailClientId),
      });
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
      console.warn('[google] service account key JSON parse failed', {
        traceId,
        tenant,
        length: typeof input.serviceAccountKeyJson === 'string' ? input.serviceAccountKeyJson.length : null,
      });
      return { success: false, error: 'Service account key is not valid JSON' };
    }
    if (!parsedKey?.client_email || !parsedKey?.private_key) {
      console.warn('[google] service account key JSON missing required fields', {
        traceId,
        tenant,
        hasClientEmail: Boolean(parsedKey?.client_email),
        hasPrivateKey: Boolean(parsedKey?.private_key),
        projectId: parsedKey?.project_id,
      });
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
      const calendarClientId = normalizeGoogleClientId(input.calendarClientId ?? '');
      const calendarClientSecret = input.calendarClientSecret?.trim();

      if (!calendarClientId) return { success: false, error: 'Calendar OAuth Client ID is required' };
      if (!isLikelyGoogleClientId(calendarClientId)) {
        console.warn('[google] invalid calendarClientId', {
          traceId,
          tenant,
          pattern: '^[0-9]+-[a-zA-Z0-9_\\-]+\\.apps\\.googleusercontent\\.com$',
          calendarClientId: describeGoogleClientId(input.calendarClientId),
        });
        return { success: false, error: 'Calendar OAuth Client ID does not look valid' };
      }
      if (!calendarClientSecret) return { success: false, error: 'Calendar OAuth Client Secret is required' };

      await secretProvider.setTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_ID_SECRET, calendarClientId);
      await secretProvider.setTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_SECRET_SECRET, calendarClientSecret);
    }

    console.info('[google] saveGoogleIntegrationSettings success', { traceId, tenant });
    return { success: true };
  } catch (err: any) {
    console.error('[google] saveGoogleIntegrationSettings failed', {
      traceId,
      message: err?.message || 'unknown',
    });
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
