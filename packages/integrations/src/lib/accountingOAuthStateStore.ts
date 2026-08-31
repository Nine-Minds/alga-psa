/**
 * Single-use OAuth state store for the QuickBooks Online and Xero connect
 * flows.
 *
 * A callback must atomically consume the state issued by the connect route so
 * the same signed state cannot be replayed to complete a second connection.
 * Consuming is an atomic delete: exactly one callback presentation wins, and
 * every later presentation fails closed. Redis-backed with an in-memory
 * fallback, mirroring the Microsoft email and calendar OAuth state stores.
 *
 * The identity binding (tenant + initiating user) lives in the OAuth state
 * payload itself; this store only gates single use keyed by the state nonce.
 */

import { createClient, type RedisClientType } from 'redis';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getRedisConfig } from '@alga-psa/event-bus';

export type AccountingOAuthProvider = 'qbo' | 'xero';

const STATE_NAMESPACE = 'accounting:oauth';
const DEFAULT_TTL_SECONDS = 10 * 60;

let redisClientPromise: Promise<RedisClientType | null> | null = null;
const memoryStore = new Map<string, { consumed: boolean; expiresAt: number }>();

async function getRedisClient(): Promise<RedisClientType | null> {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const config = getRedisConfig();
        const secretProvider = await getSecretProviderInstance();
        const password =
          (await secretProvider.getAppSecret('redis_password')) ||
          process.env.REDIS_PASSWORD ||
          undefined;
        const client = createClient({ url: config.url, password });
        client.on('error', (error) => {
          logger.error('[AccountingOAuthStateStore] Redis client error', error);
        });
        await client.connect();
        return client as RedisClientType;
      } catch (error) {
        logger.error('[AccountingOAuthStateStore] Failed to create Redis client', error);
        return null;
      }
    })();
  }

  return redisClientPromise;
}

function buildKey(provider: AccountingOAuthProvider, nonce: string): string {
  return `${STATE_NAMESPACE}:${provider}:${nonce}`;
}

export async function storeAccountingOAuthNonce(
  provider: AccountingOAuthProvider,
  nonce: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> {
  const key = buildKey(provider, nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      await client.set(key, '1', { EX: ttlSeconds });
      return;
    }
  } catch (error) {
    logger.warn(
      '[AccountingOAuthStateStore] Falling back to in-memory nonce storage',
      error instanceof Error ? error.message : error
    );
  }

  memoryStore.set(key, {
    consumed: false,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Atomically mark a state as used. Returns `true` only on the first successful
 * consume; a replayed state (second use of the same nonce) returns `false`, as
 * does an unknown or expired nonce.
 */
export async function consumeAccountingOAuthNonce(
  provider: AccountingOAuthProvider,
  nonce: string
): Promise<boolean> {
  const key = buildKey(provider, nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      const removed = await client.del(key);
      // A missing key means it was already consumed or never stored. The
      // callback must not proceed on an unknown nonce.
      return removed === 1;
    }
  } catch (error) {
    logger.warn(
      '[AccountingOAuthStateStore] Redis unavailable while consuming nonce',
      error instanceof Error ? error.message : error
    );
  }

  const stored = memoryStore.get(key);
  if (!stored || stored.consumed || stored.expiresAt <= Date.now()) return false;
  stored.consumed = true;
  return true;
}
