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

export class OAuthAccountLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthAccountLinkConflictError';
  }
}

export async function upsertOAuthAccountLink(): Promise<void> {
  throw new Error('OAuth account linking is only available in Enterprise Edition');
}

export async function findOAuthAccountLink() {
  return undefined;
}

export async function listOAuthAccountLinksForUser() {
  return [];
}
