import { createClient, type RedisClientType } from 'redis';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getRedisConfig } from '@alga-psa/event-bus';

const STATE_NAMESPACE = 'microsoft:email_setup';
const DEFAULT_TTL_SECONDS = 10 * 60;

export interface StoredMicrosoftEmailSetupState {
  verifier: string;
  algaTenant: string;
  userId: string;
  oauthNonce: string;
}

let redisClientPromise: Promise<RedisClientType | null> | null = null;
const memoryStore = new Map<string, { state: StoredMicrosoftEmailSetupState; expiresAt: number }>();

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
          logger.error('[MicrosoftEmailSetupStateStore] Redis client error', error);
        });
        await client.connect();
        return client as RedisClientType;
      } catch (error) {
        logger.error('[MicrosoftEmailSetupStateStore] Failed to create Redis client', error);
        return null;
      }
    })();
  }

  return redisClientPromise;
}

function buildKey(nonce: string): string {
  return `${STATE_NAMESPACE}:${nonce}`;
}

export async function storeMicrosoftEmailSetupState(
  nonce: string,
  state: StoredMicrosoftEmailSetupState,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> {
  const key = buildKey(nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      await client.set(key, JSON.stringify(state), { EX: ttlSeconds });
      return;
    }
  } catch (error) {
    logger.warn(
      '[MicrosoftEmailSetupStateStore] Falling back to in-memory state storage',
      error instanceof Error ? error.message : error
    );
  }

  memoryStore.set(key, {
    state,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function consumeMicrosoftEmailSetupState(
  nonce: string
): Promise<StoredMicrosoftEmailSetupState | null> {
  const key = buildKey(nonce);
  try {
    const client = await getRedisClient();
    if (client) {
      const raw = await client.getDel(key);
      if (raw) {
        try {
          return JSON.parse(raw) as StoredMicrosoftEmailSetupState;
        } catch (error) {
          logger.error('[MicrosoftEmailSetupStateStore] Failed to parse stored state', error);
          return null;
        }
      }
    }
  } catch (error) {
    logger.warn(
      '[MicrosoftEmailSetupStateStore] Redis unavailable while consuming state',
      error instanceof Error ? error.message : error
    );
  }

  const stored = memoryStore.get(key);
  memoryStore.delete(key);
  if (!stored || stored.expiresAt <= Date.now()) return null;
  return stored.state;
}
