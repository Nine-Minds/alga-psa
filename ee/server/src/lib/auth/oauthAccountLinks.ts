import logger from '@alga-psa/shared/core/logger';
import { getAdminConnection } from '@shared/db/admin';

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

const TABLE_NAME = 'user_auth_accounts';

function normalizeEmail(email?: string | null): string | null {
  if (!email) {
    return null;
  }
  return email.trim().toLowerCase();
}

export async function upsertOAuthAccountLink(input: OAuthAccountLinkInput): Promise<void> {
  const knex = await getAdminConnection();
  const metadataPayload = input.metadata ?? {};
  const providerEmail = normalizeEmail(input.providerEmail);

  try {
    await knex(TABLE_NAME)
      .insert({
        tenant: input.tenant,
        user_id: input.userId,
        provider: input.provider,
        provider_account_id: input.providerAccountId,
        provider_email: providerEmail,
        metadata: metadataPayload,
        last_used_at: input.lastUsedAt ?? knex.fn.now(),
      })
      .onConflict(['tenant', 'user_id', 'provider'])
      .merge({
        provider_account_id: input.providerAccountId,
        provider_email: providerEmail,
        metadata: metadataPayload,
        last_used_at: input.lastUsedAt ?? knex.fn.now(),
        updated_at: knex.fn.now(),
      });
  } catch (error: any) {
    if (error?.code === '23505') {
      logger.warn('[oauthAccountLinks] conflict while linking account', {
        tenant: input.tenant,
        userId: input.userId,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      });
      throw new OAuthAccountLinkConflictError(
        `Provider account ${input.provider}:${input.providerAccountId} is already linked.`,
      );
    }

    logger.error('[oauthAccountLinks] failed to upsert account link', {
      tenant: input.tenant,
      userId: input.userId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      error,
    });
    throw error;
  }
}

export async function findOAuthAccountLink(
  provider: OAuthLinkProvider,
  providerAccountId: string,
): Promise<OAuthAccountLinkRecord | undefined> {
  const knex = await getAdminConnection();
  const record = await knex<OAuthAccountLinkRecord>(TABLE_NAME)
    .where({
      provider,
      provider_account_id: providerAccountId,
    })
    .first();

  return record ?? undefined;
}

export async function listOAuthAccountLinksForUser(
  tenant: string,
  userId: string,
): Promise<OAuthAccountLinkRecord[]> {
  const knex = await getAdminConnection();
  return knex<OAuthAccountLinkRecord>(TABLE_NAME)
    .where({ tenant, user_id: userId })
    .orderBy('linked_at', 'desc');
}
