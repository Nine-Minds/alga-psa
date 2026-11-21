import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getRedisConfig } from '@alga-psa/event-bus';

export const IMAP_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const STATE_NAMESPACE = 'imap:oauth_state';

export interface ImapOAuthStatePayload {
  purpose: 'imap-reconnect';
  tenant: string;
  userId: string;
  providerId: string;
  credentialGeneration: string | null;
  redirectUri: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

let redisClientPromise: Promise<RedisClientType> | null = null;

export async function getImapOAuthStateSigningSecret(): Promise<string | null> {
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const secretProvider = await getSecretProviderInstance();
  const fromAppSecret = (await secretProvider.getAppSecret('NEXTAUTH_SECRET'))?.trim();
  return fromAppSecret || null;
}

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signPayload(payload: string, secret: string): string {
  return encodeBase64Url(createHmac('sha256', secret).update(payload).digest());
}

export function createImapOAuthStateToken(input: {
  tenant: string;
  userId: string;
  providerId: string;
  credentialGeneration: string | null;
  redirectUri: string;
  secret: string;
  ttlSeconds?: number;
}): { token: string; payload: ImapOAuthStatePayload } {
  if (!input.secret.trim()) throw new Error('IMAP OAuth state signing secret is not configured');

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: ImapOAuthStatePayload = {
    purpose: 'imap-reconnect',
    tenant: input.tenant,
    userId: input.userId,
    providerId: input.providerId,
    credentialGeneration: input.credentialGeneration,
    redirectUri: new URL(input.redirectUri).toString(),
    nonce: randomBytes(24).toString('hex'),
    issuedAt,
    expiresAt: issuedAt + (input.ttlSeconds ?? IMAP_OAUTH_STATE_TTL_SECONDS),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return { token: `${encodedPayload}.${signPayload(encodedPayload, input.secret)}`, payload };
}

export function validateImapOAuthStateToken(input: {
  token: string | null | undefined;
  secret: string | null | undefined;
  now?: number;
}): ImapOAuthStatePayload | null {
  if (!input.token || !input.secret) return null;

  const [encodedPayload, signature, extra] = input.token.split('.');
  if (!encodedPayload || !signature || extra) return null;

  const expected = Buffer.from(signPayload(encodedPayload, input.secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const value = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<ImapOAuthStatePayload>;
    if (
      value.purpose !== 'imap-reconnect' ||
      typeof value.tenant !== 'string' ||
      typeof value.userId !== 'string' ||
      typeof value.providerId !== 'string' ||
      !(value.credentialGeneration === null || typeof value.credentialGeneration === 'string') ||
      typeof value.redirectUri !== 'string' ||
      typeof value.nonce !== 'string' ||
      typeof value.issuedAt !== 'number' ||
      typeof value.expiresAt !== 'number'
    ) return null;

    new URL(value.redirectUri);
    const now = input.now ?? Math.floor(Date.now() / 1000);
    if (value.issuedAt > now + 60 || value.expiresAt <= now || value.expiresAt <= value.issuedAt) return null;
    return value as ImapOAuthStatePayload;
  } catch {
    return null;
  }
}

async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const config = getRedisConfig();
      const secretProvider = await getSecretProviderInstance();
      const password = (await secretProvider.getAppSecret('redis_password')) || process.env.REDIS_PASSWORD || undefined;
      const client = createClient({ url: config.url, password });
      client.on('error', (error) => logger.error('[ImapOAuthState] Redis client error', error));
      await client.connect();
      return client as RedisClientType;
    })().catch((error) => {
      redisClientPromise = null;
      throw error;
    });
  }
  return redisClientPromise;
}

export async function storeImapOAuthStateNonce(nonce: string, ttlSeconds = IMAP_OAUTH_STATE_TTL_SECONDS): Promise<void> {
  const result = await (await getRedisClient()).set(`${STATE_NAMESPACE}:${nonce}`, '1', { EX: ttlSeconds, NX: true });
  if (result !== 'OK') throw new Error('IMAP OAuth state nonce collision');
}

/** Atomically consume an initiated nonce; missing, expired, and replayed state fails closed. */
export async function consumeImapOAuthStateNonce(nonce: string): Promise<boolean> {
  const deleted = await (await getRedisClient()).del(`${STATE_NAMESPACE}:${nonce}`);
  return deleted === 1;
}
