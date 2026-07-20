const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_LOGIN_BASE_URL = 'https://login.microsoftonline.com';

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
