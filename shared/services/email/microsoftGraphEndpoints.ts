const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_LOGIN_BASE_URL = 'https://login.microsoftonline.com';

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

export function getMicrosoftAuthorizeUrl(tenantAuthority = 'common'): string {
  return `${getMicrosoftLoginBaseUrl()}/${encodeURIComponent(tenantAuthority)}/oauth2/v2.0/authorize`;
}

export function getMicrosoftTokenUrl(tenantAuthority = 'common'): string {
  return `${getMicrosoftLoginBaseUrl()}/${encodeURIComponent(tenantAuthority)}/oauth2/v2.0/token`;
}
