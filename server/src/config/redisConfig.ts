import { z } from 'zod';
import { createClient } from 'redis';
import logger from '@alga-psa/shared/core/logger';
import { getSecret } from '../lib/utils/getSecret';

// Construct Redis URL from environment variables
function getRedisUrl(): string {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  // URL without password - password will be added separately in client config
  return `redis://${host}:${port}`;
}

// Redis configuration schema
const RedisConfigSchema = z.object({
  url: z.string().default(getRedisUrl()),
  prefix: z.string().default('alga-psa:'),
  eventBus: z.object({
    streamPrefix: z.string().default('event-stream:'),
    consumerGroup: z.string().default('event-processors'),
    maxStreamLength: z.number().int().positive().default(1000),
    blockingTimeout: z.number().int().nonnegative().default(5000), // ms
    claimTimeout: z.number().int().positive().default(30000), // ms
    batchSize: z.number().int().positive().default(10),
    reconnectStrategy: z.object({
      retries: z.number().int().positive().default(10),
      initialDelay: z.number().int().positive().default(100), // ms
      maxDelay: z.number().int().positive().default(3000), // ms
    }).default({}),
  }).default({}),
});

// Environment variables validation
const validateConfig = () => {
  try {
    const config = RedisConfigSchema.parse({
      url: getRedisUrl(),
      prefix: process.env.REDIS_PREFIX,
      eventBus: {
        streamPrefix: process.env.REDIS_EVENT_STREAM_PREFIX,
        consumerGroup: process.env.REDIS_EVENT_CONSUMER_GROUP,
        maxStreamLength: parseInt(process.env.REDIS_STREAM_MAX_LENGTH || '1000', 10),
        blockingTimeout: parseInt(process.env.REDIS_STREAM_BLOCKING_TIMEOUT || '5000', 10),
        claimTimeout: parseInt(process.env.REDIS_STREAM_CLAIM_TIMEOUT || '30000', 10),
        batchSize: parseInt(process.env.REDIS_STREAM_BATCH_SIZE || '10', 10),
        reconnectStrategy: {
          retries: parseInt(process.env.REDIS_RECONNECT_RETRIES || '10', 10),
          initialDelay: parseInt(process.env.REDIS_RECONNECT_INITIAL_DELAY || '100', 10),
          maxDelay: parseInt(process.env.REDIS_RECONNECT_MAX_DELAY || '3000', 10),
        },
      },
    });
    
    logger.info('[RedisConfig] Using configuration:', {
      url: config.url,
      prefix: config.prefix,
      eventBus: config.eventBus
    });
    
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error('Invalid Redis configuration:', error.errors);
    }
    throw error;
  }
};

// Export type for use in other modules
export type RedisConfig = z.infer<typeof RedisConfigSchema>;

// Defer validation until explicitly requested
let cachedConfig: RedisConfig | null = null;

export function getRedisConfig(): RedisConfig {
  if (!cachedConfig) {
    cachedConfig = validateConfig();
  }
  return cachedConfig;
}

// Helper function to generate event stream name
export const DEFAULT_EVENT_CHANNEL = 'global';

export function getEventStream(eventType: string, channel: string = DEFAULT_EVENT_CHANNEL): string {
  const config = getRedisConfig();
  return `${config.prefix}${config.eventBus.streamPrefix}${channel}:${eventType}`;
}

// Helper function to generate consumer name
export function getConsumerName(processId: string = process.pid.toString()): string {
  return `consumer-${processId}`;
}

// Create Redis client for general use
export async function getRedisClient() {
  const config = getRedisConfig();
  const password = await getSecret('redis_password', 'REDIS_PASSWORD');

  if (!password) {
    logger.warn('[Redis] No Redis password configured - this is not recommended for production');
  }

  const clientConfig: any = {
    url: config.url,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 20) {
          return new Error('Max reconnection attempts reached');
        }
        return Math.min(500 * Math.pow(2, retries), 5000);
      }
    }
  };

  // Only set password if it's a non-empty string
  if (password && password.trim()) {
    clientConfig.password = password;
  }

  const client = createClient(clientConfig);

  await client.connect();
  return client;
}
