'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth } from '@alga-psa/auth';

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
