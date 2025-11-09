import { createClient, RedisClientType } from 'redis';

function resolveRedisUrl(): string {
  if (process.env.DEBUG_STREAM_REDIS_URL && process.env.DEBUG_STREAM_REDIS_URL.trim()) {
    return process.env.DEBUG_STREAM_REDIS_URL.trim();
  }
  if (process.env.REDIS_URL && process.env.REDIS_URL.trim()) {
    return process.env.REDIS_URL.trim();
  }
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  return `redis://${host}:${port}`;
}

function resolveRedisAuth(): { username?: string; password?: string } {
  const username = process.env.DEBUG_STREAM_REDIS_USERNAME || process.env.REDIS_USERNAME || undefined;
  const password = process.env.DEBUG_STREAM_REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined;
  return { username, password };
}

export async function createDebugStreamClient(): Promise<RedisClientType> {
  const url = resolveRedisUrl();
  const { username, password } = resolveRedisAuth();

  const client = createClient({ url, username, password });
  client.on('error', (err) => {
    console.error('[ext-debug] redis error', err);
  });
  await client.connect();
  return client;
}

export function getDebugStreamPrefix(): string {
  return process.env.RUNNER_DEBUG_REDIS_STREAM_PREFIX || 'ext-debug:';
}
