/**
 * SSO Types - Shared type definitions for OAuth/SSO functionality
 * These types are used by both CE (stubs) and EE (real implementations)
 */

export type OAuthLinkProvider = 'google' | 'microsoft' | 'keycloak';
export type EnterpriseOAuthProvider = 'google' | 'microsoft' | 'keycloak';

export interface OAuthProfileMappingInput {
  provider: EnterpriseOAuthProvider;
  email?: string | null;
  image?: unknown;
  profile: Record<string, unknown>;
  tenantHint?: string | null;
  vanityHostHint?: string | null;
  userTypeHint?: string | null;
}

// Expected reasons an OAuth profile never resolves to an AlgaPSA user. Auth.js
// swallows anything thrown from `profile()` into `error=Configuration`, so the
// mapper reports these as data instead and `callbacks.signIn` turns them into a
// readable redirect.
export const OAUTH_MAPPING_FAILURE_CODES = [
  'no_matching_user',
  'missing_email',
  'inactive_user',
  'user_type_mismatch',
  'tenant_mismatch',
] as const;

export type OAuthMappingFailureCode = (typeof OAUTH_MAPPING_FAILURE_CODES)[number];

// Sign-in pages receive the code through the query string, so never trust it as
// a translation key without matching it against the known set first.
export function parseOAuthMappingFailureCode(
  value: string | null | undefined,
): OAuthMappingFailureCode | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = OAUTH_MAPPING_FAILURE_CODES.find((code) => code === value);
  return match ?? null;
}

// Bootstrap copy for the failure messages, mirroring msp/auth.json
// `signIn.alerts.ssoNoMatch` and client-portal.json `auth.ssoNoMatch`. The
// sign-in pages are public, so their namespace is fetched rather than embedded,
// and until it lands the i18n client hands back whatever `defaultValue` the call
// site carries -- or the raw key when there is none. It also returns that
// default verbatim, without interpolation, hence the substitution here.
const OAUTH_MAPPING_FAILURE_FALLBACKS: Record<
  'internal' | 'client',
  Record<OAuthMappingFailureCode, string>
> = {
  internal: {
    no_matching_user:
      'No AlgaPSA account matches {{providerEmail}}. Sign in with your password or contact your administrator.',
    missing_email:
      'Your identity provider did not return an email address, so no AlgaPSA account could be matched. Sign in with your password or contact your administrator.',
    inactive_user:
      'The AlgaPSA account for {{providerEmail}} is inactive. Contact your administrator to reactivate it.',
    user_type_mismatch:
      '{{providerEmail}} is not an internal AlgaPSA account. Use the client portal sign-in page, or contact your administrator.',
    tenant_mismatch:
      '{{providerEmail}} belongs to a different organization. Sign in with your password or contact your administrator.',
  },
  client: {
    no_matching_user:
      'No client portal account matches {{providerEmail}}. Sign in with your password or contact your service provider.',
    missing_email:
      'Your identity provider did not return an email address, so no client portal account could be matched. Sign in with your password or contact your service provider.',
    inactive_user:
      'The client portal account for {{providerEmail}} is inactive. Contact your service provider to reactivate it.',
    user_type_mismatch:
      '{{providerEmail}} is not a client portal account. Contact your service provider.',
    tenant_mismatch:
      "{{providerEmail}} belongs to a different organization's portal. Sign in with your password or contact your service provider.",
  },
};

export function oauthMappingFailureFallbackMessage(
  code: OAuthMappingFailureCode,
  audience: 'internal' | 'client',
  providerEmail: string,
): string {
  const template = OAUTH_MAPPING_FAILURE_FALLBACKS[audience][code];
  return template.replace(/\{\{providerEmail\}\}/g, providerEmail);
}

export interface OAuthMappingFailure {
  code: OAuthMappingFailureCode;
  providerEmail?: string;
  userType: 'internal' | 'client';
}

export interface OAuthProfileMappingResult {
  id: string;
  email: string;
  name: string;
  username: string;
  image?: string;
  proToken: string;
  tenant?: string;
  tenantSlug?: string;
  user_type: 'internal' | 'client';
  clientId?: string;
  contactId?: string;
  authFailure?: OAuthMappingFailure;
}

export function isOAuthMappingFailure<
  T extends { authFailure?: OAuthMappingFailure | null },
>(user: T | null | undefined): user is T & { authFailure: OAuthMappingFailure } {
  return Boolean(user && user.authFailure && typeof user.authFailure.code === 'string');
}

export interface OAuthAccountLinkInput {
  tenant: string;
  userId: string;
  provider: OAuthLinkProvider;
  providerAccountId: string;
  providerEmail?: string | null;
  metadata?: Record<string, unknown> | null;
  lastUsedAt?: Date | string | null;
}

export interface OAuthAccountLinkRecord {
  tenant: string;
  user_id: string;
  provider: OAuthLinkProvider;
  provider_account_id: string;
  provider_email: string | null;
  metadata: Record<string, unknown>;
  linked_at: Date;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class OAuthAccountLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthAccountLinkConflictError';
  }
}
