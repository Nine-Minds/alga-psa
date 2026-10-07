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
