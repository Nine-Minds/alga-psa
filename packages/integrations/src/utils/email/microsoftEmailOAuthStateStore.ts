/**
 * Single-use nonce store for the Microsoft inbound-email mailbox OAuth state.
 *
 * A successful callback consumes the nonce so the same signed state cannot be
 * replayed to swap credentials twice. Redis-backed with an in-memory fallback,
 * mirroring the Microsoft email setup state store.
 */

import { createClient, type RedisClientType } from 'redis';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getRedisConfig } from '@alga-psa/event-bus';

const STATE_NAMESPACE = 'microsoft:email_oauth';
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
          logger.error('[MicrosoftEmailOAuthStateStore] Redis client error', error);
        });
        await client.connect();
        return client as RedisClientType;
      } catch (error) {
        logger.error('[MicrosoftEmailOAuthStateStore] Failed to create Redis client', error);
        return null;
      }
    })();
  }

  return redisClientPromise;
}

function buildKey(nonce: string): string {
  return `${STATE_NAMESPACE}:${nonce}`;
}

export async function storeMicrosoftEmailOAuthNonce(
  nonce: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> {
  const key = buildKey(nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      await client.set(key, '1', { EX: ttlSeconds });
      return;
    }
  } catch (error) {
    logger.warn(
      '[MicrosoftEmailOAuthStateStore] Falling back to in-memory nonce storage',
      error instanceof Error ? error.message : error
    );
  }

  memoryStore.set(key, {
    consumed: false,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Atomically mark a nonce as used. Returns `true` only on the first successful
 * consume; a replayed state (second use of the same nonce) returns `false`.
 */
export async function consumeMicrosoftEmailOAuthNonce(
  nonce: string
): Promise<boolean> {
  const key = buildKey(nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      const removed = await client.del(key);
      // A missing key means it was already consumed or never stored. In
      // single-node dev the callback still must not proceed on an unknown nonce.
      return removed === 1;
    }
  } catch (error) {
    logger.warn(
      '[MicrosoftEmailOAuthStateStore] Redis unavailable while consuming nonce',
      error instanceof Error ? error.message : error
    );
  }

  const stored = memoryStore.get(key);
  if (!stored || stored.consumed || stored.expiresAt <= Date.now()) return false;
  stored.consumed = true;
  return true;
}
