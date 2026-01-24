/**
 * SSO Providers - CE stubs
 *
 * These are placeholder implementations for Community Edition.
 * Enterprise Edition provides real implementations in ee/server.
 */

export type EnterpriseOAuthProvider = 'google' | 'microsoft';

export interface OAuthProfileMappingInput {
  provider: EnterpriseOAuthProvider;
  email?: string | null;
  image?: unknown;
  profile: Record<string, unknown>;
  tenantHint?: string | null;
  vanityHostHint?: string | null;
  userTypeHint?: string | null;
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
}

// These are no longer used - auth uses the registry pattern instead.
// Kept for any external code that might still import from here.

export async function mapOAuthProfileToExtendedUser(
  _input: OAuthProfileMappingInput,
): Promise<OAuthProfileMappingResult> {
  throw new Error('OAuth providers are only available in Enterprise Edition');
}

export async function applyOAuthAccountHints(
  _user: OAuthProfileMappingResult,
  _account: Record<string, unknown> | null | undefined,
): Promise<OAuthProfileMappingResult> {
  throw new Error('OAuth providers are only available in Enterprise Edition');
}

export function decodeOAuthJwtPayload(_token: string | undefined): Record<string, unknown> | undefined {
  return undefined;
}
