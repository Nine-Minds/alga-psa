/**
 * SSO Types - Shared type definitions for OAuth/SSO functionality
 * These types are used by both CE (stubs) and EE (real implementations)
 */

export type OAuthLinkProvider = 'google' | 'microsoft';
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
