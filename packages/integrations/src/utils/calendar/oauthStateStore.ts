import { createClient, RedisClientType } from 'redis';
import logger from '@alga-psa/core/logger';
import { getRedisConfig } from '../../config/redisConfig';
import { getSecret } from '../../lib/utils/getSecret';
import type { CalendarOAuthState } from '@alga-psa/types';

const STATE_NAMESPACE = 'calendar:oauth_state';
const DEFAULT_TTL_SECONDS = 10 * 60; // 10 minutes

type StoredCalendarOAuthState = CalendarOAuthState;

let redisClientPromise: Promise<RedisClientType | null> | null = null;
const memoryStore = new Map<string, { state: StoredCalendarOAuthState; expiresAt: number }>();

async function getRedisClient(): Promise<RedisClientType | null> {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const config = getRedisConfig();
        const password =
          (await getSecret('redis_password', 'REDIS_PASSWORD')) || undefined;

        const client = createClient({
          url: config.url,
          password,
          socket: {
            reconnectStrategy: (retries) => {
              if (retries > config.eventBus.reconnectStrategy.retries) {
                return new Error('Max reconnection attempts reached');
              }
              return Math.min(
                config.eventBus.reconnectStrategy.initialDelay,
                config.eventBus.reconnectStrategy.maxDelay
              );
            }
          }
        });

        client.on('error', (err) => {
          logger.error('[CalendarOAuthStateStore] Redis client error', err);
        });

        await client.connect();
        logger.info('[CalendarOAuthStateStore] Redis client connected');
        return client as RedisClientType;
      } catch (error) {
        logger.error('[CalendarOAuthStateStore] Failed to create Redis client', error);
        return null;
      }
    })();
  }

  return redisClientPromise;
}

function buildKey(nonce: string): string {
  return `${STATE_NAMESPACE}:${nonce}`;
}

export async function storeCalendarOAuthState(
  nonce: string,
  state: StoredCalendarOAuthState,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  const key = buildKey(nonce);

  try {
    const client = await getRedisClient();
    if (client) {
      await client.set(key, JSON.stringify(state), {
        EX: ttlSeconds
      });
      return;
    }
  } catch (error) {
    logger.warn(
      '[CalendarOAuthStateStore] Falling back to in-memory store for OAuth state',
      error instanceof Error ? error.message : error
    );
  }

  memoryStore.set(key, {
    state,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

export async function consumeCalendarOAuthState(
  nonce: string
): Promise<StoredCalendarOAuthState | null> {
  const key = buildKey(nonce);

  try {
    const client = await getRedisClient();
    if (client) {
      const raw = await client.get(key);
      if (raw) {
        await client.del(key).catch(() => {});
        try {
          return JSON.parse(raw) as StoredCalendarOAuthState;
        } catch (error) {
          logger.error('[CalendarOAuthStateStore] Failed to parse stored OAuth state', error);
          return null;
        }
      }
    }
  } catch (error) {
    logger.warn(
      '[CalendarOAuthStateStore] Redis unavailable when consuming OAuth state; checking memory fallback',
      error instanceof Error ? error.message : error
    );
  }

  const fallback = memoryStore.get(key);
  if (!fallback) {
    return null;
  }

  memoryStore.delete(key);

  if (fallback.expiresAt < Date.now()) {
    return null;
  }

  return fallback.state;
}
