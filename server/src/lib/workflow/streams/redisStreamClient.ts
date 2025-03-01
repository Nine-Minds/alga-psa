import { createClient } from 'redis';
import type { RedisClientType, RedisClientOptions } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../../utils/logger';
import { getSecret } from '../../../lib/utils/getSecret';
import { 
  WorkflowEventBase, 
  WorkflowEventProcessingStatus,
  RedisStreamMessage,
  parseStreamEvent
} from './workflowEventSchema';

/**
 * Configuration options for the Redis Stream client
 */
export interface RedisStreamConfig {
  url: string;
  password?: string;
  streamPrefix: string;
  consumerGroup: string;
  maxStreamLength: number;
  blockingTimeout: number;
  claimTimeout: number;
  batchSize: number;
  reconnectStrategy: {
    retries: number;
    initialDelay: number;
    maxDelay: number;
  };
}

/**
 * Default configuration for Redis Stream client
 */
const DEFAULT_CONFIG: RedisStreamConfig = {
  url: 'redis://localhost:6379',
  streamPrefix: 'workflow:events:',
  consumerGroup: 'workflow-processors',
  maxStreamLength: 1000,
  blockingTimeout: 5000, // ms
  claimTimeout: 30000, // ms
  batchSize: 10,
  reconnectStrategy: {
    retries: 10,
    initialDelay: 100, // ms
    maxDelay: 3000, // ms
  },
};

/**
 * Options for consuming messages from Redis Streams
 */
export interface ConsumeOptions {
  count?: number;
  block?: number;
  noAck?: boolean;
}

/**
 * Redis Stream client for workflow events
 * Provides methods for publishing events to Redis Streams and consuming events from Redis Streams
 */
export class RedisStreamClient {
  private client: any | null = null;
  private config: RedisStreamConfig;
  private consumerId: string;
  private isConnected: boolean = false;
  private isConsumerRunning: boolean = false;
  private consumerHandlers: Map<string, (event: WorkflowEventBase) => Promise<void>> = new Map();

  /**
   * Create a new Redis Stream client
   * @param config Configuration options for the Redis Stream client
   */
  constructor(config: Partial<RedisStreamConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.consumerId = `consumer-${process.pid}-${uuidv4().substring(0, 8)}`;
  }

  /**
   * Initialize the Redis client and connect to Redis
   */
  public async initialize(): Promise<void> {
    if (this.client && this.isConnected) {
      return;
    }

    try {
      const password = await getSecret('redis_password', 'REDIS_PASSWORD');
      if (!password) {
        logger.warn('[RedisStreamClient] No Redis password configured - this is not recommended for production');
      }

      const options: RedisClientOptions = {
        url: this.config.url,
        password,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > this.config.reconnectStrategy.retries) {
              return new Error('Max reconnection attempts reached');
            }
            const delay = Math.min(
              this.config.reconnectStrategy.initialDelay * Math.pow(2, retries),
              this.config.reconnectStrategy.maxDelay
            );
            logger.info(`[RedisStreamClient] Reconnecting in ${delay}ms (attempt ${retries})`);
            return delay;
          }
        }
      };

      this.client = createClient(options);

      this.client.on('error', (err: Error) => {
        logger.error('[RedisStreamClient] Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('[RedisStreamClient] Redis Client Connected');
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
        logger.info('[RedisStreamClient] Redis Client Reconnecting');
        this.isConnected = false;
      });

      this.client.on('end', () => {
        logger.info('[RedisStreamClient] Redis Client Connection Closed');
        this.isConnected = false;
      });

      await this.client.connect();
      this.isConnected = true;
      logger.info('[RedisStreamClient] Redis Stream Client initialized');
    } catch (error) {
      logger.error('[RedisStreamClient] Failed to initialize Redis client:', error);
      throw error;
    }
  }

  /**
   * Get the Redis client, initializing it if necessary
   * @returns The Redis client
   */
  private async getClient(): Promise<RedisClientType> {
    if (!this.client || !this.isConnected) {
      await this.initialize();
    }
    return this.client!;
  }

  /**
   * Get the full stream name for a workflow execution
   * @param executionId The workflow execution ID
   * @returns The full stream name
   */
  private getStreamName(executionId: string): string {
    return `${this.config.streamPrefix}${executionId}`;
  }

  /**
   * Ensure a stream and consumer group exist
   * @param streamName The name of the stream
   */
  private async ensureStreamAndGroup(streamName: string): Promise<void> {
    try {
      const client = await this.getClient();
      await client.xGroupCreate(streamName, this.config.consumerGroup, '0', {
        MKSTREAM: true
      });
      logger.info(`[RedisStreamClient] Created consumer group for stream: ${streamName}`);
    } catch (err: any) {
      if (err.message.includes('BUSYGROUP')) {
        logger.info(`[RedisStreamClient] Consumer group already exists for stream: ${streamName}`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Publish a workflow event to Redis Streams
   * @param event The workflow event to publish
   * @returns The ID of the message in the stream
   */
  public async publishEvent(event: WorkflowEventBase): Promise<string> {
    try {
      const client = await this.getClient();
      const streamName = this.getStreamName(event.execution_id);
      
      // Ensure the stream and consumer group exist
      await this.ensureStreamAndGroup(streamName);

      // Add the event to the stream
      const messageId = await client.xAdd(
        streamName,
        '*', // Auto-generate ID
        { event: JSON.stringify(event) },
        {
          TRIM: {
            strategy: 'MAXLEN',
            threshold: this.config.maxStreamLength,
            strategyModifier: '~' // Approximate trimming for better performance
          }
        }
      );

      logger.info(`[RedisStreamClient] Published event to stream ${streamName} with ID ${messageId}`, {
        eventId: event.event_id,
        eventName: event.event_name,
        executionId: event.execution_id
      });

      return messageId;
    } catch (error) {
      logger.error('[RedisStreamClient] Failed to publish event:', error);
      throw error;
    }
  }

  /**
   * Read new messages from a stream using a consumer group
   * @param executionId The workflow execution ID
   * @param options Options for consuming messages
   * @returns Array of stream messages
   */
  public async readGroupMessages(
    executionId: string,
    options: ConsumeOptions = {}
  ): Promise<RedisStreamMessage[]> {
    try {
      const client = await this.getClient();
      const streamName = this.getStreamName(executionId);
      
      // Ensure the stream and consumer group exist
      await this.ensureStreamAndGroup(streamName);

      const count = options.count || this.config.batchSize;
      const block = options.block || this.config.blockingTimeout;

      const streamEntries = await client.xReadGroup(
        this.config.consumerGroup,
        this.consumerId,
        [{ key: streamName, id: '>' }], // '>' means only new messages
        { COUNT: count, BLOCK: block }
      );

      if (!streamEntries || streamEntries.length === 0) {
        return [];
      }

      // Extract messages from the stream entries
      const messages: RedisStreamMessage[] = [];
      for (const { messages } of streamEntries) {
        for (const message of messages) {
          messages.push({
            id: message.id,
            message: message.message
          });
        }
      }

      return messages;
    } catch (error) {
      logger.error(`[RedisStreamClient] Failed to read messages from stream for execution ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Acknowledge a message in a stream
   * @param executionId The workflow execution ID
   * @param messageId The ID of the message to acknowledge
   */
  public async acknowledgeMessage(executionId: string, messageId: string): Promise<void> {
    try {
      const client = await this.getClient();
      const streamName = this.getStreamName(executionId);
      
      await client.xAck(streamName, this.config.consumerGroup, messageId);
      logger.debug(`[RedisStreamClient] Acknowledged message ${messageId} in stream ${streamName}`);
    } catch (error) {
      logger.error(`[RedisStreamClient] Failed to acknowledge message ${messageId} in stream for execution ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Claim pending messages that have been idle for too long
   * @param executionId The workflow execution ID
   * @returns Array of claimed messages
   */
  public async claimPendingMessages(executionId: string): Promise<RedisStreamMessage[]> {
    try {
      const client = await this.getClient();
      const streamName = this.getStreamName(executionId);
      
      // Get pending messages information
      const pendingInfo = await client.xPending(
        streamName,
        this.config.consumerGroup
      );

      if (pendingInfo.pending === 0) {
        return [];
      }

      // Get detailed information about pending messages
      const pendingMessages = await client.xPendingRange(
        streamName,
        this.config.consumerGroup,
        '-', // Start with the oldest message
        '+', // End with the newest message
        this.config.batchSize
      );

      if (!pendingMessages || pendingMessages.length === 0) {
        return [];
      }

      // Filter messages that have been idle for too long
      const now = Date.now();
      const claimIds = pendingMessages
        .filter(msg => (now - msg.millisecondsSinceLastDelivery) > this.config.claimTimeout)
        .map(msg => msg.id);

      if (claimIds.length === 0) {
        return [];
      }

      // Claim the messages
      const claimedMessages = await client.xClaim(
        streamName,
        this.config.consumerGroup,
        this.consumerId,
        this.config.claimTimeout,
        claimIds
      );

      if (!claimedMessages || claimedMessages.length === 0) {
        return [];
      }

      // Convert to RedisStreamMessage format
      return claimedMessages
        .filter(message => message !== null)
        .map(message => ({
          id: message.id,
          message: message.message
        }));
    } catch (error) {
      logger.error(`[RedisStreamClient] Failed to claim pending messages for execution ${executionId}:`, error);
      throw error;
    }
  }

  /**
   * Register a handler for consuming events from a specific execution
   * @param executionId The workflow execution ID
   * @param handler The handler function to process events
   */
  public registerConsumer(
    executionId: string,
    handler: (event: WorkflowEventBase) => Promise<void>
  ): void {
    this.consumerHandlers.set(executionId, handler);
    logger.info(`[RedisStreamClient] Registered consumer for execution ${executionId}`);
    
    // Start the consumer if it's not already running
    if (!this.isConsumerRunning) {
      this.startConsumer();
    }
  }

  /**
   * Unregister a consumer handler for a specific execution
   * @param executionId The workflow execution ID
   */
  public unregisterConsumer(executionId: string): void {
    this.consumerHandlers.delete(executionId);
    logger.info(`[RedisStreamClient] Unregistered consumer for execution ${executionId}`);
  }

  /**
   * Start the consumer loop to process events from all registered executions
   */
  private async startConsumer(): Promise<void> {
    if (this.isConsumerRunning) {
      return;
    }

    this.isConsumerRunning = true;
    logger.info('[RedisStreamClient] Starting consumer loop');

    const processEvents = async () => {
      if (!this.isConsumerRunning) {
        return;
      }

      try {
        // Process each registered execution
        for (const [executionId, handler] of this.consumerHandlers.entries()) {
          // Read new messages
          const messages = await this.readGroupMessages(executionId);
          
          // Process messages
          for (const message of messages) {
            try {
              // Parse the event
              const event = parseStreamEvent(message);
              
              // Process the event
              await handler(event);
              
              // Acknowledge the message
              await this.acknowledgeMessage(executionId, message.id);
            } catch (error) {
              logger.error(`[RedisStreamClient] Error processing message ${message.id} for execution ${executionId}:`, error);
              // Don't acknowledge the message so it can be retried
            }
          }

          // Claim pending messages
          const claimedMessages = await this.claimPendingMessages(executionId);
          
          // Process claimed messages
          for (const message of claimedMessages) {
            try {
              // Parse the event
              const event = parseStreamEvent(message);
              
              // Process the event
              await handler(event);
              
              // Acknowledge the message
              await this.acknowledgeMessage(executionId, message.id);
            } catch (error) {
              logger.error(`[RedisStreamClient] Error processing claimed message ${message.id} for execution ${executionId}:`, error);
              // Don't acknowledge the message so it can be retried
            }
          }
        }

        // Continue the loop
        setImmediate(processEvents);
      } catch (error) {
        logger.error('[RedisStreamClient] Error in consumer loop:', error);
        // Continue the loop after a delay
        setTimeout(processEvents, 1000);
      }
    };

    // Start the consumer loop
    processEvents();
  }

  /**
   * Stop the consumer loop
   */
  public stopConsumer(): void {
    this.isConsumerRunning = false;
    logger.info('[RedisStreamClient] Stopping consumer loop');
  }

  /**
   * Acquire a distributed lock
   *
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @param ttlMs Time-to-live in milliseconds
   * @returns True if lock was acquired, false otherwise
   */
  public async acquireLock(key: string, owner: string, ttlMs: number): Promise<boolean> {
    try {
      const client = await this.getClient();
      
      // Use Redis SET with NX option (only set if key doesn't exist)
      const result = await client.set(
        `lock:${key}`,
        owner,
        {
          PX: ttlMs, // Expire in milliseconds
          NX: true // Only set if key doesn't exist
        }
      );
      
      return result === 'OK';
    } catch (error) {
      logger.error(`[RedisStreamClient] Error acquiring lock ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Release a distributed lock
   *
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @returns True if lock was released, false if lock doesn't exist or is owned by someone else
   */
  public async releaseLock(key: string, owner: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      
      // Use Lua script to ensure we only delete the lock if we own it
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await client.eval(
        script,
        {
          keys: [`lock:${key}`],
          arguments: [owner]
        }
      );
      
      return result === 1;
    } catch (error) {
      logger.error(`[RedisStreamClient] Error releasing lock ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * Extend a lock's TTL
   *
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @param ttlMs New time-to-live in milliseconds
   * @returns True if lock was extended, false if lock doesn't exist or is owned by someone else
   */
  public async extendLock(key: string, owner: string, ttlMs: number): Promise<boolean> {
    try {
      const client = await this.getClient();
      
      // Use Lua script to ensure we only extend the lock if we own it
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      
      const result = await client.eval(
        script,
        {
          keys: [`lock:${key}`],
          arguments: [owner, ttlMs.toString()]
        }
      );
      
      return result === 1;
    } catch (error) {
      logger.error(`[RedisStreamClient] Error extending lock ${key}:`, error);
      throw error;
    }
  }

  /**
   * Close the Redis client connection
   */
  public async close(): Promise<void> {
    this.stopConsumer();
    
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      logger.info('[RedisStreamClient] Redis client closed');
    }
  }
}

// Singleton instance
let redisStreamClientInstance: RedisStreamClient | null = null;

/**
 * Get the Redis Stream client instance
 * @param config Configuration options for the Redis Stream client
 * @returns The Redis Stream client instance
 */
export function getRedisStreamClient(config: Partial<RedisStreamConfig> = {}): RedisStreamClient {
  if (!redisStreamClientInstance) {
    redisStreamClientInstance = new RedisStreamClient(config);
  }
  return redisStreamClientInstance;
}