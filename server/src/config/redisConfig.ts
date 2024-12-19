import { z } from 'zod';
import logger from '../utils/logger';

// Construct Redis URL from environment variables
function getRedisUrl(): string {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
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
export function getEventStream(eventType: string): string {
  const config = getRedisConfig();
  return `${config.prefix}${config.eventBus.streamPrefix}${eventType}`;
}

// Helper function to generate consumer name
export function getConsumerName(processId: string = process.pid.toString()): string {
  return `consumer-${processId}`;
}
