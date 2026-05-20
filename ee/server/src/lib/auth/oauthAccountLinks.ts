import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';

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

type KnexLike = Awaited<ReturnType<typeof getAdminConnection>>;

function normalizeEmail(email?: string | null): string | null {
  if (!email) {
    return null;
  }
  return email.trim().toLowerCase();
}

async function assertProviderAccountAvailableForUser(
  knex: KnexLike,
  input: OAuthAccountLinkInput,
): Promise<void> {
  const conflictingLink = await knex<OAuthAccountLinkRecord>(TABLE_NAME)
    .where({
      tenant: input.tenant,
      provider: input.provider,
      provider_account_id: input.providerAccountId,
    })
    .whereNot('user_id', input.userId)
    .first(['user_id']);

  if (conflictingLink?.user_id) {
    throw new OAuthAccountLinkConflictError(
      `Provider account ${input.provider}:${input.providerAccountId} is already linked.`,
    );
  }
}

async function withProviderAccountLock<T>(
  knex: KnexLike,
  input: OAuthAccountLinkInput,
  callback: (trx: KnexLike) => Promise<T>,
  startTransaction = true
): Promise<T> {
  const run = async (trx: KnexLike): Promise<T> => {
    if (typeof (trx as any).raw === 'function') {
      const lockKey = `${input.tenant}:${input.provider}:${input.providerAccountId}`;
      await (trx as any).raw(
        'select pg_advisory_xact_lock(hashtext(?), hashtext(?))',
        ['oauth_account_link', lockKey]
      );
    }

    return callback(trx);
  };

  if (startTransaction && typeof (knex as any).transaction === 'function') {
    return (knex as any).transaction((trx: KnexLike) => run(trx));
  }

  return run(knex);
}

export async function upsertOAuthAccountLink(
  input: OAuthAccountLinkInput,
  connection?: KnexLike
): Promise<void> {
  const knex = connection ?? (await getAdminConnection());
  const metadataPayload = input.metadata ?? {};
  const providerEmail = normalizeEmail(input.providerEmail);

  try {
    const writeLink = async (trx: KnexLike) => {
      await assertProviderAccountAvailableForUser(trx, input);

      await trx(TABLE_NAME)
        .insert({
          tenant: input.tenant,
          user_id: input.userId,
          provider: input.provider,
          provider_account_id: input.providerAccountId,
          provider_email: providerEmail,
          metadata: metadataPayload,
          last_used_at: input.lastUsedAt ?? trx.fn.now(),
        })
        .onConflict(['tenant', 'user_id', 'provider'])
        .merge({
          provider_account_id: input.providerAccountId,
          provider_email: providerEmail,
          metadata: metadataPayload,
          last_used_at: input.lastUsedAt ?? trx.fn.now(),
          updated_at: trx.fn.now(),
        });
    };

    await withProviderAccountLock(knex, input, writeLink, !connection);
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
  tenant?: string,
): Promise<OAuthAccountLinkRecord | undefined> {
  const knex = await getAdminConnection();
  const query = knex<OAuthAccountLinkRecord>(TABLE_NAME)
    .where({
      provider,
      provider_account_id: providerAccountId,
    });

  if (tenant) {
    query.andWhere({ tenant });
  }

  const record = await query
    .orderBy('updated_at', 'desc')
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
