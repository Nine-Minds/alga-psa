import { createClient } from 'redis';
import type { RedisClientType, RedisClientOptions } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import logger from '@alga-psa/core/logger';
import { getSecret } from '../../core/getSecret';
import { 
  WorkflowEventBase, 
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
  maxRetries: number;
  deadLetterQueueSuffix: string;
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
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
  streamPrefix: 'workflow:events:',
  consumerGroup: 'workflow-processors',
  maxStreamLength: 1000,
  blockingTimeout: 300000, // 5 minutes in ms
  claimTimeout: 30000, // ms
  batchSize: 10,
  maxRetries: 3, // Maximum number of retries before moving to DLQ
  deadLetterQueueSuffix: 'dlq', // Suffix for dead letter queue streams
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
 * Redis Stream for workflow events
 * Provides methods for publishing events to Redis Streams and consuming events from Redis Streams
 */
export class RedisStreamClient {
  private static createdConsumerGroups: Set<string> = new Set<string>();
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
    const cacheKey = `${streamName}::${this.config.consumerGroup}`;

    // Check if we've already created this consumer group for this stream
    if (RedisStreamClient.createdConsumerGroups.has(cacheKey)) {
      // logger.debug(`[RedisStreamClient] Consumer group already ensured for stream: ${streamName}`);
      return;
    }

    try {
      const client = await this.getClient();
      await client.xGroupCreate(streamName, this.config.consumerGroup, '0', {
        MKSTREAM: true
      });
      logger.info(`[RedisStreamClient] Created consumer group ${this.config.consumerGroup} for stream: ${streamName}`);
      // Add to the set of created consumer groups
      RedisStreamClient.createdConsumerGroups.add(cacheKey);
    } catch (err: any) {
      if (err.message.includes('BUSYGROUP')) {
        logger.info(`[RedisStreamClient] Consumer group ${this.config.consumerGroup} already exists for stream: ${streamName}`);
        // Add to the set of created consumer groups even if it already existed
        RedisStreamClient.createdConsumerGroups.add(cacheKey);
      } else {
        logger.error(`[RedisStreamClient] Error creating consumer group ${this.config.consumerGroup} for stream ${streamName}:`, err);
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
      // All events will be published to the global stream as per user request.
      // The original event.execution_id is still part of the event payload for routing by consumers.
      const streamName = this.getStreamName('global'); // Publish to global stream
      
      // Ensure the stream and consumer group exist for the global stream
      await this.ensureStreamAndGroup(streamName);

      // Add the event to the stream
      // Store key fields as top-level entries in the Redis message for easier routing/filtering,
      // and the payload as a JSON string.
      const messageFields: { [key: string]: string } = {
        event_id: event.event_id,
        execution_id: event.execution_id || '',
        event_name: event.event_name,
        event_type: event.event_type,
        tenant: event.tenant,
        timestamp: event.timestamp, // This is already a string from Zod schema
        user_id: event.user_id || '',
        from_state: event.from_state || '',
        to_state: event.to_state || '',
        payload_json: JSON.stringify(event.payload || {})
      };
      
      const messageId = await client.xAdd(
        streamName, // Use the global stream name
        '*', // Auto-generate ID
        messageFields,
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
   * Publish a raw message to a specific stream (for notification channels)
   * @param streamName The stream name to publish to
   * @param messageFields The message fields to publish
   * @returns The ID of the message in the stream
   */
  public async publishToStream(
    streamName: string,
    messageFields: Record<string, string>
  ): Promise<string> {
    try {
      const client = await this.getClient();

      const messageId = await client.xAdd(
        streamName,
        '*', // Auto-generate ID
        messageFields,
        {
          TRIM: {
            strategy: 'MAXLEN',
            threshold: this.config.maxStreamLength,
            strategyModifier: '~'
          }
        }
      );

      logger.debug(`[RedisStreamClient] Published message to stream ${streamName} with ID ${messageId}`);
      return messageId;
    } catch (error) {
      logger.error(`[RedisStreamClient] Failed to publish to stream ${streamName}:`, error);
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

      logger.debug(`[RedisStreamClient] Reading from stream ${streamName} with consumer ${this.consumerId} in group ${this.config.consumerGroup}`);

      // First, check if there are any pending messages for this consumer
      const pendingInfo = await client.xPending(
        streamName,
        this.config.consumerGroup
      );

      // If there are pending messages, read those first
      let streamEntries;
      if (pendingInfo && pendingInfo.pending > 0) {
        // Read pending messages
        streamEntries = await client.xReadGroup(
          this.config.consumerGroup,
          this.consumerId,
          [{ key: streamName, id: '0' }], // '0' means read pending messages
          { COUNT: count, BLOCK: block }
        );
      } else {
        // No pending messages, read new messages
        streamEntries = await client.xReadGroup(
          this.config.consumerGroup,
          this.consumerId,
          [{ key: streamName, id: '>' }], // '>' means only new messages
          { COUNT: count, BLOCK: block }
        );
      }

      if (!streamEntries || streamEntries.length === 0) {
        logger.debug(`[RedisStreamClient] No messages found in stream ${streamName}`);
        return [];
      }
      
      logger.info(`[RedisStreamClient] Successfully read ${streamEntries.length} entries from stream ${streamName}`);

      // Extract messages from the stream entries
      const resultMessages: RedisStreamMessage[] = [];
      for (const { messages: streamMessages } of streamEntries) {
        for (const message of streamMessages) {
          resultMessages.push({
            id: message.id,
            message: message.message
          });
        }
      }

      return resultMessages;
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

      // Use XAUTOCLAIM to automatically claim messages that have been idle for too long
      // This is more efficient than manually filtering and claiming
      const { messages } = await client.xAutoClaim(
        streamName,
        this.config.consumerGroup,
        this.consumerId,
        this.config.claimTimeout,
        '0-0', // Start with the oldest message
        {
          COUNT: Math.min(this.config.batchSize, 10) // Limit batch size to prevent memory issues
        }
      );

      if (!messages || messages.length === 0) {
        return [];
      }

      // Convert to RedisStreamMessage format
      return messages
        .filter(message => message !== null)
        .map(message => ({
          id: message!.id,
          message: message!.message
        }));
    } catch (error: any) {
      // If XAUTOCLAIM is not supported (Redis < 6.2), fall back to the old method
      if (error.message && error.message.includes('ERR unknown command')) {
        logger.warn(`[RedisStreamClient] XAUTOCLAIM not supported, falling back to XCLAIM`);
        return this.claimPendingMessagesLegacy(executionId);
      }
      
      logger.error(`[RedisStreamClient] Failed to claim pending messages for execution ${executionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Legacy method to claim pending messages for Redis < 6.2
   * @param executionId The workflow execution ID
   * @returns Array of claimed messages
   */
  private async claimPendingMessagesLegacy(executionId: string): Promise<RedisStreamMessage[]> {
    try {
      const client = await this.getClient();
      const streamName = this.getStreamName(executionId);
      
      // Get detailed information about pending messages
      const pendingMessages = await client.xPendingRange(
        streamName,
        this.config.consumerGroup,
        '-', // Start with the oldest message
        '+', // End with the newest message
        Math.min(this.config.batchSize, 10) // Limit batch size to prevent memory issues
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
          id: message!.id,
          message: message!.message
        }));
    } catch (error) {
      logger.error(`[RedisStreamClient] Failed to claim pending messages (legacy) for execution ${executionId}:`, error);
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
    const streamName = this.getStreamName(executionId);
    logger.info(`[RedisStreamClient] Registered consumer for execution ${executionId}, will read from stream: ${streamName}`);
    
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
          try {
            // Log which stream we're reading from
            const streamName = this.getStreamName(executionId);
            logger.debug(`[RedisStreamClient] Attempting to read from stream: ${streamName}`);
            
            // Read new messages
            const messages = await this.readGroupMessages(executionId);
            
            if (messages.length > 0) {
              logger.info(`[RedisStreamClient] Processing ${messages.length} messages from stream ${streamName}`);
            }
            
            // Process messages in batches to improve efficiency
            const processingPromises: Promise<void>[] = [];
            
            for (const message of messages) {
              processingPromises.push((async () => {
                try {
                  // Parse the event
                  const event = parseStreamEvent(message);
                  
                  // Process the event
                  await handler(event);
                  
                  // Acknowledge the message
                  await this.acknowledgeMessage(executionId, message.id);
                } catch (error) {
                  logger.error(`[RedisStreamClient] Error processing message ${message.id} for execution ${executionId}:`, error);
                  
                  // Get the number of times this message has been delivered
                  try {
                    const client = await this.getClient();
                    const pendingInfo = await client.xPendingRange(
                      this.getStreamName(executionId),
                      this.config.consumerGroup,
                      message.id,
                      message.id,
                      1
                    );
                    
                    if (pendingInfo && pendingInfo.length > 0) {
                      const deliveryCount = pendingInfo[0].deliveriesCounter;
                      
                      // If the message has been delivered too many times, move it to the DLQ
                      if (deliveryCount >= this.config.maxRetries) {
                        logger.warn(`[RedisStreamClient] Message ${message.id} has been delivered ${deliveryCount} times, moving to DLQ`);
                        await this.moveToDeadLetterQueue(executionId, message.id, message, error);
                      } else {
                        logger.info(`[RedisStreamClient] Message ${message.id} will be retried (${deliveryCount}/${this.config.maxRetries})`);
                        // Don't acknowledge the message so it can be retried
                      }
                    }
                  } catch (pendingError) {
                    logger.error(`[RedisStreamClient] Error checking pending info for message ${message.id}:`, pendingError);
                    // Don't acknowledge the message so it can be retried
                  }
                }
              })());
            }
            
            // Wait for all messages to be processed
            if (processingPromises.length > 0) {
              await Promise.all(processingPromises);
            }

            // Claim and process pending messages
            const claimedMessages = await this.claimPendingMessages(executionId);
            
            if (claimedMessages.length > 0) {
              logger.debug(`[RedisStreamClient] Processing ${claimedMessages.length} claimed messages for execution ${executionId}`);
            }
            
            // Process claimed messages in batches
            const claimedProcessingPromises: Promise<void>[] = [];
            
            for (const message of claimedMessages) {
              claimedProcessingPromises.push((async () => {
                try {
                  // Parse the event
                  const event = parseStreamEvent(message);
                  
                  // Process the event
                  await handler(event);
                  
                  // Acknowledge the message
                  await this.acknowledgeMessage(executionId, message.id);
                } catch (error) {
                  logger.error(`[RedisStreamClient] Error processing claimed message ${message.id} for execution ${executionId}:`, error);
                  
                  // Get the number of times this message has been delivered
                  try {
                    const client = await this.getClient();
                    const pendingInfo = await client.xPendingRange(
                      this.getStreamName(executionId),
                      this.config.consumerGroup,
                      message.id,
                      message.id,
                      1
                    );
                    
                    if (pendingInfo && pendingInfo.length > 0) {
                      const deliveryCount = pendingInfo[0].deliveriesCounter;
                      
                      // If the message has been delivered too many times, move it to the DLQ
                      if (deliveryCount >= this.config.maxRetries) {
                        logger.warn(`[RedisStreamClient] Claimed message ${message.id} has been delivered ${deliveryCount} times, moving to DLQ`);
                        await this.moveToDeadLetterQueue(executionId, message.id, message, error);
                      } else {
                        logger.info(`[RedisStreamClient] Claimed message ${message.id} will be retried (${deliveryCount}/${this.config.maxRetries})`);
                        // Don't acknowledge the message so it can be retried
                      }
                    }
                  } catch (pendingError) {
                    logger.error(`[RedisStreamClient] Error checking pending info for claimed message ${message.id}:`, pendingError);
                    // Don't acknowledge the message so it can be retried
                  }
                }
              })());
            }
            
            // Wait for all claimed messages to be processed
            if (claimedProcessingPromises.length > 0) {
              await Promise.all(claimedProcessingPromises);
            }
          } catch (error) {
            logger.error(`[RedisStreamClient] Error processing execution ${executionId}:`, error);
            // Continue with the next execution
          }
        }

        // Continue the loop with a small delay to prevent excessive CPU usage
        setTimeout(processEvents, 100);
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
   * List messages in the dead letter queue for a specific execution
   * @param executionId The workflow execution ID
   * @param count Maximum number of messages to return
   * @returns Array of messages in the DLQ
   */
  public async listDeadLetterQueueMessages(
    executionId: string,
    count: number = 100
  ): Promise<any[]> {
    try {
      const client = await this.getClient();
      const streamName = `${this.getStreamName(executionId)}:${this.config.deadLetterQueueSuffix}`;
      
      // Read messages from the DLQ
      const messages = await client.xRange(
        streamName,
        '-', // Start with the oldest message
        '+', // End with the newest message
        { COUNT: count }
      );
      
      return messages.map(msg => ({
        id: msg.id,
        ...msg.message
      }));
    } catch (error) {
      logger.error(`[RedisStreamClient] Failed to list DLQ messages for execution ${executionId}:`, error);
      return [];
    }
  }

  /**
   * Reprocess a message from the dead letter queue
   * @param executionId The workflow execution ID
   * @param dlqMessageId The ID of the message in the DLQ
   * @returns True if the message was successfully reprocessed, false otherwise
   */
  public async reprocessDeadLetterQueueMessage(
    executionId: string,
    dlqMessageId: string
  ): Promise<boolean> {
    try {
      const client = await this.getClient();
      const dlqStreamName = `${this.getStreamName(executionId)}:${this.config.deadLetterQueueSuffix}`;
      const targetStreamName = this.getStreamName(executionId);
      
      // Get the message from the DLQ
      const messages = await client.xRange(
        dlqStreamName,
        dlqMessageId,
        dlqMessageId
      );
      
      if (!messages || messages.length === 0) {
        logger.error(`[RedisStreamClient] Message ${dlqMessageId} not found in DLQ for execution ${executionId}`);
        return false;
      }
      
      const dlqMessage = messages[0];
      
      // Extract the original message
      let originalMessage;
      try {
        originalMessage = JSON.parse(dlqMessage.message.original_message);
      } catch (parseError) {
        logger.error(`[RedisStreamClient] Failed to parse original message from DLQ message ${dlqMessageId}:`, parseError);
        return false;
      }
      
      // Add the message back to the original stream
      // Ensure it's formatted correctly, like in publishEvent
      const messageFields: { [key: string]: string } = {
        event_id: originalMessage.event_id,
        execution_id: originalMessage.execution_id || '',
        event_name: originalMessage.event_name,
        event_type: originalMessage.event_type,
        tenant: originalMessage.tenant,
        timestamp: originalMessage.timestamp, // Assuming originalMessage.timestamp is already string
        user_id: originalMessage.user_id || '',
        from_state: originalMessage.from_state || '',
        to_state: originalMessage.to_state || '',
        payload_json: JSON.stringify(originalMessage.payload || {})
      };

      const messageId = await client.xAdd(
        targetStreamName,
        '*', // Auto-generate ID
        messageFields,
        {
          TRIM: { // Optional: Apply trimming similar to publishEvent if desired
            strategy: 'MAXLEN',
            threshold: this.config.maxStreamLength,
            strategyModifier: '~'
          }
        }
      );
      
      // Delete the message from the DLQ
      await client.xDel(dlqStreamName, dlqMessageId);
      
      logger.info(`[RedisStreamClient] Reprocessed message ${dlqMessageId} from DLQ to stream ${targetStreamName} with ID ${messageId}`);
      
      return true;
    } catch (error) {
      logger.error(`[RedisStreamClient] Failed to reprocess message ${dlqMessageId} from DLQ for execution ${executionId}:`, error);
      return false;
    }
  }

  /**
   * Move a message to the dead letter queue
   * @param executionId The workflow execution ID
   * @param messageId The ID of the message to move
   * @param error The error that caused the message to be moved to DLQ
   */
  public async moveToDeadLetterQueue(
    executionId: string,
    messageId: string,
    message: RedisStreamMessage,
    error: any
  ): Promise<void> {
    try {
      const client = await this.getClient();
      const sourceStreamName = this.getStreamName(executionId);
      const dlqStreamName = `${sourceStreamName}:${this.config.deadLetterQueueSuffix}`;
      
      // Add metadata about the error
      const dlqMessage: Record<string, string> = {
        original_message: JSON.stringify(message.message),
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error && error.stack ? error.stack : 'No stack trace',
        source_stream: sourceStreamName,
        original_id: messageId,
        moved_at: new Date().toISOString()
      };
      
      // Add the message to the DLQ
      const dlqMessageId = await client.xAdd(
        dlqStreamName,
        '*', // Auto-generate ID
        dlqMessage
      );
      
      // Acknowledge the original message to remove it from pending
      await this.acknowledgeMessage(executionId, messageId);
      
      logger.warn(`[RedisStreamClient] Moved message ${messageId} to DLQ ${dlqStreamName} with ID ${dlqMessageId}`, {
        executionId,
        error: error instanceof Error ? error.message : String(error)
      });
    } catch (dlqError) {
      logger.error(`[RedisStreamClient] Failed to move message ${messageId} to DLQ for execution ${executionId}:`, dlqError);
      // Don't throw the error, as we don't want to fail the processing of other messages
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
