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

export interface OAuthAccountLinkRecord extends OAuthAccountLinkInput {
  link_id: string;
  created_at: Date | string;
  updated_at: Date | string;
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
