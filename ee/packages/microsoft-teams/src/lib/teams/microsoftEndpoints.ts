const DEFAULT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_LOGIN_BASE_URL = 'https://login.microsoftonline.com';

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Package-local mirror of shared/services/email/microsoftGraphEndpoints. The
 * Teams add-on cannot depend on `shared`, but it honors the same env overrides
 * so `algasim` can stand in for Microsoft. Defaults are the real endpoints.
 */
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

export function getMicrosoftTokenUrl(tenantAuthority: string): string {
  return `${getMicrosoftLoginBaseUrl()}/${encodeURIComponent(tenantAuthority)}/oauth2/v2.0/token`;
}
