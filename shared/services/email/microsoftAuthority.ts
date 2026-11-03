/**
 * Single source of truth for the Microsoft OAuth authority (the `{tenant}`
 * segment of `/oauth2/v2.0/authorize` and `/oauth2/v2.0/token`) used by the
 * Email and Calendar integrations, for authorize, code exchange and refresh.
 *
 * Rule (the issuer kind is checked FIRST):
 *  - Platform-managed (Nine Minds shared, multi-tenant) app -> always `common`,
 *    even if a profile row carries a `tenant_id`. That value is the platform's
 *    home directory; sending a customer's sign-in there produces AADSTS50020.
 *  - Tenant-owned app -> the profile's directory ID (GUID or domain). An empty
 *    value, `common` or `organizations` means "no specific directory" and
 *    falls back to `common`.
 *
 * Entra Direct deliberately does NOT use this: GDAP needs a multi-tenant
 * partner app, so it stays on `common`.
 */

export type MicrosoftIssuerKind = 'platform-managed' | 'tenant-owned';

export const MICROSOFT_MULTI_TENANT_AUTHORITY = 'common';

const NON_DIRECTORY_AUTHORITIES = new Set(['common', 'organizations']);

export function resolveMicrosoftOAuthAuthority(input: {
  issuerKind: MicrosoftIssuerKind;
  /** The Microsoft profile's stored Tenant ID, if any. */
  profileTenantId?: string | null;
}): string {
  if (input.issuerKind !== 'tenant-owned') {
    return MICROSOFT_MULTI_TENANT_AUTHORITY;
  }
  const tenantId = (input.profileTenantId || '').trim();
  if (!tenantId || NON_DIRECTORY_AUTHORITIES.has(tenantId.toLowerCase())) {
    return MICROSOFT_MULTI_TENANT_AUTHORITY;
  }
  return tenantId;
}

/**
 * Map the credential-source vocabularies used around the codebase onto an
 * issuer kind. `managed` (email issuer selection), `app` (consumer profile
 * resolver: hosted app secrets) and `platform` all mean the Nine Minds shared
 * app; anything else (`profile`, `binding`, ...) is a tenant-owned app.
 */
export function microsoftIssuerKindFromSource(source: string | null | undefined): MicrosoftIssuerKind {
  return source === 'managed' || source === 'app' || source === 'platform' ? 'platform-managed' : 'tenant-owned';
}
