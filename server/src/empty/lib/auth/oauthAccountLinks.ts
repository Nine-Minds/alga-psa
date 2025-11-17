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

export async function upsertOAuthAccountLink(input: OAuthAccountLinkInput): Promise<void> {
  throw new Error('OAuth account linking is only available in Enterprise Edition');
}

export async function findOAuthAccountLink(
  provider: OAuthLinkProvider,
  providerAccountId: string,
): Promise<OAuthAccountLinkRecord | undefined> {
  return undefined;
}

export async function listOAuthAccountLinksForUser(
  tenant: string,
  userId: string,
): Promise<OAuthAccountLinkRecord[]> {
  return [];
}
