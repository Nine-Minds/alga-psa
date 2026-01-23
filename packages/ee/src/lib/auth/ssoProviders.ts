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

export async function mapOAuthProfileToExtendedUser(
  input: OAuthProfileMappingInput,
): Promise<OAuthProfileMappingResult> {
  throw new Error('OAuth providers are only available in Enterprise Edition');
}

export async function applyOAuthAccountHints(
  user: OAuthProfileMappingResult,
  account: Record<string, unknown> | null | undefined,
): Promise<OAuthProfileMappingResult> {
  throw new Error('OAuth providers are only available in Enterprise Edition');
}

export function decodeOAuthJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  return undefined;
}
