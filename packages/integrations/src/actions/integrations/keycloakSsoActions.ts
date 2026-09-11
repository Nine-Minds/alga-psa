'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  KEYCLOAK_TENANT_SECRET_KEYS,
  buildKeycloakIssuer,
  readTenantKeycloakConfig,
} from '@alga-psa/auth/lib/sso/mspSsoResolution';

const DISCOVERY_TIMEOUT_MS = 8000;
const REALM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface KeycloakSsoStatus {
  success: boolean;
  error?: string;
  redirectUri?: string;
  config?: {
    configured: boolean;
    url?: string;
    realm?: string;
    clientId?: string;
    clientSecretMasked?: string;
    issuer?: string;
  };
}

export interface SaveKeycloakSsoInput {
  url: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}

export interface SaveKeycloakSsoResult {
  success: boolean;
  error?: string;
  issuer?: string;
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function cleanInput(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function normalizeServerUrl(raw: string): string | null {
  const value = cleanInput(raw);
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.search || parsed.hash || parsed.username || parsed.password) return null;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

// LEVERAGE: pattern deployment-base-url — same derivation lives privately in googleActions.
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

async function getRedirectUri(): Promise<string> {
  const secretProvider = await getSecretProviderInstance();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';
  return `${computeBaseUrl(base)}/api/auth/callback/keycloak`;
}

// NextAuth fetches this same document at sign-in, so an unreachable realm or a
// mismatched issuer would fail every login; catch it at save time instead.
async function verifyOidcDiscovery(issuer: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return `The realm did not answer OpenID discovery (HTTP ${response.status}). Check the server URL and realm name.`;
    }
    const document = (await response.json().catch(() => null)) as { issuer?: unknown } | null;
    if (!document || typeof document.issuer !== 'string') {
      return 'The realm returned an unexpected OpenID discovery document.';
    }
    if (document.issuer.replace(/\/+$/, '') !== issuer) {
      return `The realm reports issuer ${document.issuer}, which does not match ${issuer}. Use the public URL Keycloak is configured with.`;
    }
    return null;
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? 'timed out'
      : error instanceof Error ? error.message : String(error);
    return `AlgaPSA could not reach the realm's OpenID discovery endpoint (${reason}).`;
  } finally {
    clearTimeout(timer);
  }
}

async function canManage(user: unknown): Promise<boolean> {
  const record = user as { user_type?: string } | null | undefined;
  if (record?.user_type === 'client') return false;
  return hasPermission(user as never, 'system_settings', 'update');
}

export const getKeycloakSsoStatus = withAuth(async (user, { tenant }): Promise<KeycloakSsoStatus> => {
  try {
    if (!(await canManage(user))) return { success: false, error: 'Forbidden' };

    const secretProvider = await getSecretProviderInstance();
    const [url, realm, clientId, clientSecret] = await Promise.all([
      secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.url),
      secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.realm),
      secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.clientId),
      secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.clientSecret),
    ]);
    const configured = Boolean(url && realm && clientId && clientSecret);

    return {
      success: true,
      redirectUri: await getRedirectUri(),
      config: {
        configured,
        url: url || undefined,
        realm: realm || undefined,
        clientId: clientId || undefined,
        clientSecretMasked: clientSecret ? maskSecret(clientSecret) : undefined,
        issuer: url && realm ? buildKeycloakIssuer(url, realm) : undefined,
      },
    };
  } catch {
    return { success: false, error: 'Failed to load Keycloak settings' };
  }
});

export const saveKeycloakSsoSettings = withAuth(async (
  user,
  { tenant },
  input: SaveKeycloakSsoInput
): Promise<SaveKeycloakSsoResult> => {
  try {
    if (!(await canManage(user))) return { success: false, error: 'Forbidden' };

    const url = normalizeServerUrl(input.url);
    if (!url) return { success: false, error: 'Enter the Keycloak server URL, for example https://keycloak.example.com' };

    const realm = cleanInput(input.realm);
    if (!realm || !REALM_PATTERN.test(realm)) return { success: false, error: 'Enter the realm name exactly as it appears in Keycloak' };

    const clientId = cleanInput(input.clientId);
    if (!clientId) return { success: false, error: 'Client ID is required' };

    const secretProvider = await getSecretProviderInstance();
    const clientSecret = cleanInput(input.clientSecret)
      || cleanInput(await secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.clientSecret));
    if (!clientSecret) return { success: false, error: 'Client secret is required' };

    const issuer = buildKeycloakIssuer(url, realm);
    const discoveryError = await verifyOidcDiscovery(issuer);
    if (discoveryError) return { success: false, error: discoveryError };

    await secretProvider.setTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.url, url);
    await secretProvider.setTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.realm, realm);
    await secretProvider.setTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.clientId, clientId);
    await secretProvider.setTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.clientSecret, clientSecret);

    return { success: true, issuer };
  } catch {
    return { success: false, error: 'Failed to save Keycloak settings' };
  }
});

export const clearKeycloakSsoSettings = withAuth(async (user, { tenant }): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!(await canManage(user))) return { success: false, error: 'Forbidden' };
    const secretProvider = await getSecretProviderInstance();
    for (const key of Object.values(KEYCLOAK_TENANT_SECRET_KEYS)) {
      await secretProvider.deleteTenantSecret(tenant, key);
    }
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to remove Keycloak settings' };
  }
});

export const isKeycloakSsoConfigured = withAuth(async (_user, { tenant }): Promise<boolean> => {
  return (await readTenantKeycloakConfig(tenant)) !== null;
});
