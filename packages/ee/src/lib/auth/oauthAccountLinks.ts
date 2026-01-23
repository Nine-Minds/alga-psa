/**
 * OAuth Account Links - CE stubs
 *
 * These are placeholder implementations for Community Edition.
 * Enterprise Edition provides real implementations in ee/server.
 */

export type OAuthLinkProvider = 'google' | 'microsoft';

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

// These are no longer used - auth uses the registry pattern instead.
// Kept for any external code that might still import from here.

export async function upsertOAuthAccountLink(_input: OAuthAccountLinkInput): Promise<void> {
  throw new Error('OAuth account linking is only available in Enterprise Edition');
}

export async function findOAuthAccountLink(
  _provider: OAuthLinkProvider,
  _providerAccountId: string,
): Promise<OAuthAccountLinkRecord | undefined> {
  return undefined;
}

export async function listOAuthAccountLinksForUser(
  _tenant: string,
  _userId: string,
): Promise<OAuthAccountLinkRecord[]> {
  return [];
}
