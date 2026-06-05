import crypto from 'crypto';

import { getAdminConnection } from '@alga-psa/db/admin';

type KnexLike = Awaited<ReturnType<typeof getAdminConnection>>;

export interface CreateTenantReactivationTokenInput {
  tenantId: string;
  deletionId: string;
  expiresAt?: Date;
  knex?: KnexLike;
}

export interface CreatedTenantReactivationToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getTokenSecret(): string {
  const secret = process.env.TENANT_REACTIVATION_TOKEN_SECRET || process.env.ALGA_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('TENANT_REACTIVATION_TOKEN_SECRET or ALGA_WEBHOOK_SECRET must be configured');
  }
  return secret;
}

function defaultTokenExpiry(): Date {
  const days = Number.parseInt(process.env.TENANT_REACTIVATION_TOKEN_TTL_DAYS || '7', 10);
  const ttlDays = Number.isFinite(days) && days > 0 ? days : 7;
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}

async function getKnex(knex?: KnexLike): Promise<KnexLike> {
  return knex ?? getAdminConnection();
}

export function hashTenantReactivationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signTenantReactivationTokenPayload(payload: Record<string, unknown>): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getTokenSecret())
    .update(encodedPayload)
    .digest();

  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export async function createTenantReactivationToken(
  input: CreateTenantReactivationTokenInput,
): Promise<CreatedTenantReactivationToken> {
  const expiresAt = input.expiresAt ?? defaultTokenExpiry();
  const nonce = base64UrlEncode(crypto.randomBytes(24));
  const token = signTenantReactivationTokenPayload({
    tenant_id: input.tenantId,
    deletion_id: input.deletionId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    nonce,
  });
  const tokenHash = hashTenantReactivationToken(token);
  const knex = await getKnex(input.knex);

  await knex('tenant_reactivation_tokens').insert({
    tenant: input.tenantId,
    deletion_id: input.deletionId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  return {
    token,
    tokenHash,
    expiresAt,
  };
}
