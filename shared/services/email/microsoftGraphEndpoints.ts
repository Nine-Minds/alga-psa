const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_LOGIN_BASE_URL = 'https://login.microsoftonline.com';

/**
 * The multi-tenant Entra application operated by Alga for Microsoft Email.
 * Customer-provided applications are not assumed to be multi-tenant and must
 * use their configured directory authority.
 */
export const ALGA_MICROSOFT_EMAIL_CLIENT_ID = 'f879c391-04fe-4e49-b303-e8e6977a6447';

export type MicrosoftEmailCredentialSource = 'platform' | 'tenant';

const NON_TENANT_AUTHORITIES = new Set(['common', 'organizations', 'consumers']);

export const MICROSOFT_EMAIL_OAUTH_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Read.Shared',
  'https://graph.microsoft.com/Mail.Send',
  // Mailbox path auto-detection reads /me; without this the call is denied
  // and connect() cannot tell a personal mailbox from a shared one.
  'https://graph.microsoft.com/User.Read',
  'offline_access',
] as const;

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getMicrosoftGraphBaseUrl(): string {
  return withoutTrailingSlash(
    (process.env.MICROSOFT_GRAPH_BASE_URL || '').trim() || DEFAULT_GRAPH_BASE_URL
  );
}

export function getMicrosoftLoginBaseUrl(): string {
  return withoutTrailingSlash(
    (process.env.MICROSOFT_LOGIN_BASE_URL || '').trim() || DEFAULT_LOGIN_BASE_URL
  );
}

export function resolveMicrosoftEmailOAuthAuthority(params: {
  clientId?: string | null;
  tenantId?: string | null;
  credentialSource?: MicrosoftEmailCredentialSource;
}): string {
  const clientId = (params.clientId || '').trim().toLowerCase();
  if (
    params.credentialSource === 'platform' ||
    clientId === ALGA_MICROSOFT_EMAIL_CLIENT_ID
  ) {
    return 'common';
  }

  const tenantId = (params.tenantId || '').trim();
  if (!tenantId || NON_TENANT_AUTHORITIES.has(tenantId.toLowerCase())) {
    throw new Error(
      'A concrete Microsoft tenant ID is required when using a tenant-provided email application'
    );
  }

  return tenantId;
}

export function getMicrosoftAuthorizeUrl(tenantAuthority = 'common'): string {
  return `${getMicrosoftLoginBaseUrl()}/${encodeURIComponent(tenantAuthority)}/oauth2/v2.0/authorize`;
}

export function getMicrosoftTokenUrl(tenantAuthority = 'common'): string {
  return `${getMicrosoftLoginBaseUrl()}/${encodeURIComponent(tenantAuthority)}/oauth2/v2.0/token`;
}
