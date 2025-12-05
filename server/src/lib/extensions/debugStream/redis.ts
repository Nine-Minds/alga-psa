import { createClient, RedisClientType } from 'redis';
import { getSecret } from '../../utils/getSecret';

function resolveRedisUrl(): string {
  if (process.env.DEBUG_STREAM_REDIS_URL && process.env.DEBUG_STREAM_REDIS_URL.trim()) {
    return process.env.DEBUG_STREAM_REDIS_URL.trim();
  }
  // Match RedisStreamClient: use REDIS_HOST/REDIS_PORT, ignore REDIS_URL
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  return `redis://${host}:${port}`;
}

async function resolveRedisAuth(): Promise<{ username?: string; password?: string }> {
  const username = process.env.DEBUG_STREAM_REDIS_USERNAME || process.env.REDIS_USERNAME || undefined;
  
  let password = process.env.DEBUG_STREAM_REDIS_PASSWORD;
  if (!password) {
    password = await getSecret('redis_password', 'REDIS_PASSWORD');
  }
  
  return { username, password: password || undefined };
}

export async function createDebugStreamClient(): Promise<RedisClientType> {
  const url = resolveRedisUrl();
  const { username, password } = await resolveRedisAuth();

  const client = createClient({ url, username, password }) as RedisClientType;
  
  client.on('connect', () => {
    console.log('[ext-debug] redis initiating connection...');
  });
  
  client.on('ready', () => {
    console.log('[ext-debug] redis connection ready');
  });

  client.on('reconnecting', () => {
    console.log('[ext-debug] redis reconnecting...');
  });

  client.on('end', () => {
    console.log('[ext-debug] redis connection ended');
  });

  client.on('error', (err) => {
    console.error('[ext-debug] redis error', err);
  });
  
  await client.connect();
  return client;
}

export function getDebugStreamPrefix(): string {
  return process.env.RUNNER_DEBUG_REDIS_STREAM_PREFIX || 'ext-debug:';
}
