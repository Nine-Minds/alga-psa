import crypto from 'crypto';

import { tenantDb } from '@alga-psa/db';
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

export interface TenantReactivationTokenPayload {
  tenant_id: string;
  deletion_id: string;
  exp: number;
  nonce: string;
}

export interface ReservedTenantReactivationToken {
  tenantId: string;
  deletionId: string;
  tokenHash: string;
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value: string): Buffer {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
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

function tenantReactivationTokens(knex: KnexLike, tenantId: string) {
  return tenantDb(knex, tenantId).table('tenant_reactivation_tokens');
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

export function verifyTenantReactivationToken(token: string): TenantReactivationTokenPayload | null {
  const [encodedPayload, encodedSignature] = token.split('.');
  if (!encodedPayload || !encodedSignature || token.split('.').length !== 2) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', getTokenSecret())
    .update(encodedPayload)
    .digest();
  const actualSignature = base64UrlDecode(encodedSignature);

  if (
    actualSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    if (
      typeof payload?.tenant_id !== 'string' ||
      typeof payload?.deletion_id !== 'string' ||
      typeof payload?.exp !== 'number' ||
      typeof payload?.nonce !== 'string'
    ) {
      return null;
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload as TenantReactivationTokenPayload;
  } catch {
    return null;
  }
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

  await tenantReactivationTokens(knex, input.tenantId).insert({
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

export async function reserveTenantReactivationToken(
  token: string,
  knexOverride?: KnexLike,
): Promise<ReservedTenantReactivationToken | null> {
  const payload = verifyTenantReactivationToken(token);
  if (!payload) {
    return null;
  }

  const knex = await getKnex(knexOverride);
  const tokenHash = hashTenantReactivationToken(token);
  const rows = await tenantReactivationTokens(knex, payload.tenant_id)
    .where({
      token_hash: tokenHash,
      deletion_id: payload.deletion_id,
    })
    .whereNull('reserved_at')
    .whereNull('consumed_at')
    .where('expires_at', '>', knex.fn.now())
    .update({
      reserved_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })
    .returning(['tenant', 'deletion_id']);
  const row = Array.isArray(rows) ? rows[0] : null;

  if (!row) {
    return null;
  }

  return {
    tenantId: row.tenant,
    deletionId: row.deletion_id,
    tokenHash,
  };
}

export async function attachCheckoutSessionToReactivationToken(
  token: string,
  checkoutSessionId: string,
  knexOverride?: KnexLike,
): Promise<boolean> {
  const payload = verifyTenantReactivationToken(token);
  if (!payload || !checkoutSessionId) {
    return false;
  }

  const knex = await getKnex(knexOverride);
  const updated = await tenantReactivationTokens(knex, payload.tenant_id)
    .where({
      token_hash: hashTenantReactivationToken(token),
      deletion_id: payload.deletion_id,
    })
    .whereNotNull('reserved_at')
    .whereNull('consumed_at')
    .whereNull('checkout_session_id')
    .update({
      checkout_session_id: checkoutSessionId,
      updated_at: knex.fn.now(),
    });

  return Number(updated) > 0;
}

export async function consumeTenantReactivationTokenByCheckoutSession(
  checkoutSessionId: string,
  knexOverride?: KnexLike,
): Promise<boolean> {
  if (!checkoutSessionId) {
    return false;
  }

  const knex = await getKnex(knexOverride);
  const updated = await tenantDb(knex, '__tenant_reactivation_checkout_session_consume__')
    .unscoped(
      'tenant_reactivation_tokens',
      'tenant reactivation checkout completion resolves token by checkout session before tenant context exists',
    )
    .where({ checkout_session_id: checkoutSessionId })
    .whereNotNull('reserved_at')
    .whereNull('consumed_at')
    .update({
      consumed_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

  return Number(updated) > 0;
}
