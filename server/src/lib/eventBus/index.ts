import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import logger from '@shared/core/logger';
import { getRedisConfig, getEventStream, getConsumerName } from '../../config/redisConfig';
import { getSecret } from '../utils/getSecret';
import {
  BaseEvent,
  Event,
  EventType,
  EventSchemas,
  BaseEventSchema,
} from './events';

// Redis client configuration
const createRedisClient = async () => {
  const config = getRedisConfig();
  const password = await getSecret('redis_password', 'REDIS_PASSWORD');
  if (!password) {
    logger.warn('[EventBus] No Redis password configured - this is not recommended for production');
  }
  
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
    logger.error('Redis Client Error:', err);
  });

  client.on('connect', () => {
    logger.info('Redis Client Connected');
  });

  return client;
};

// Singleton Redis client
let client: Awaited<ReturnType<typeof createRedisClient>> | null = null;

async function getClient() {
  if (!client) {
    logger.debug('[EventBus] Creating new Redis client');
    client = await createRedisClient();
    await client.connect();
  }
  return client;
}

export class EventBus {
  private static instance: EventBus;
  private handlers: Map<EventType, Set<(event: Event) => Promise<void>>>;
  private initialized: boolean = false;
  private consumerName: string;
  private processingEvents: boolean = false;

  private constructor() {
    this.handlers = new Map();
    this.consumerName = getConsumerName();
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  private async ensureStreamAndGroup(stream: string): Promise<void> {
    const client = await getClient();
    try {
      const config = getRedisConfig();
      await client.xGroupCreate(stream, config.eventBus.consumerGroup, '0', {
        MKSTREAM: true
      });
      logger.info(`[EventBus] Created consumer group for stream: ${stream}`);
    } catch (err: any) {
      if (err.message.includes('BUSYGROUP')) {
        logger.info(`[EventBus] Consumer group already exists for stream: ${stream}`);
      } else {
        throw err;
      }
    }
  }

  public async initialize() {
    if (!this.initialized) {
      console.log('[EventBus] Initializing event bus');
      const client = await getClient();

      for (const eventType of Object.keys(EventSchemas)) {
        const stream = getEventStream(eventType);
        await this.ensureStreamAndGroup(stream);
      }

      this.initialized = true;
      this.startEventProcessing();
    }
  }

  private getProcessedSetKey(tenantId: string): string {
    return `processed_events:${tenantId}`;
  }

  private async isEventProcessed(event: Event): Promise<boolean> {
    const client = await getClient();
    const setKey = this.getProcessedSetKey(event.payload.tenantId);
    return await client.sIsMember(setKey, event.id);
  }

  private async markEventProcessed(event: Event): Promise<void> {
    const client = await getClient();
    const setKey = this.getProcessedSetKey(event.payload.tenantId);
    await client.sAdd(setKey, event.id);
    // Set expiration to prevent unbounded growth (3 days)
    await client.expire(setKey, 60 * 60 * 24 * 3);
  }

  private async startEventProcessing() {
    if (this.processingEvents) return;
    this.processingEvents = true;

    const processEvents = async () => {
      if (!this.processingEvents) return;

      try {
        const client = await getClient();
        const streams = Array.from(this.handlers.keys()).map((eventType): string => getEventStream(eventType));
        
        if (streams.length === 0) {
          setTimeout(processEvents, 1000);
          return;
        }

        const streamEntries = await client.xReadGroup(
          getRedisConfig().eventBus.consumerGroup,
          this.consumerName,
          streams.map((stream): { key: string; id: string } => ({
            key: stream,
            id: '>' // Read only new messages
          })),
          {
            COUNT: getRedisConfig().eventBus.batchSize,
            BLOCK: getRedisConfig().eventBus.blockingTimeout
          }
        );

        if (streamEntries) {
          for (const { name: stream, messages } of streamEntries) {
            for (const message of messages) {
              try {
                const eventType = stream.split(':').pop() as EventType;
                const rawEvent = JSON.parse(message.message.event);
                const baseEvent = BaseEventSchema.parse(rawEvent);
                const eventSchema = EventSchemas[baseEvent.eventType];

                if (!eventSchema) {
                  logger.error('[EventBus] Unknown event type:', {
                    eventType: baseEvent.eventType,
                    availableTypes: Object.keys(EventSchemas)
                  });
                  continue;
                }

                const event = eventSchema.parse(rawEvent) as Event;
                const handlers = this.handlers.get(baseEvent.eventType);

                if (handlers) {
                  // Check if event has already been processed
                  const isProcessed = await this.isEventProcessed(event);
                  if (!isProcessed) {
                    // Process event with first available handler
                    const handler = handlers.values().next().value;
                    if (handler) {
                      try {
                        await handler(event);
                        // Mark event as processed after successful handling
                        await this.markEventProcessed(event);
                      } catch (error) {
                        logger.error('[EventBus] Error in event handler:', {
                          error,
                          eventType: baseEvent.eventType,
                          handler: handler.name
                        });
                        // Don't acknowledge message on error to allow retry
                        continue;
                      }
                    }
                  } else {
                    logger.info('[EventBus] Skipping already processed event:', {
                      eventId: event.id,
                      eventType: event.eventType
                    });
                  }
                }

                // Acknowledge message after successful processing or if already processed
                await client.xAck(stream, getRedisConfig().eventBus.consumerGroup, message.id);

              } catch (error) {
                logger.error('[EventBus] Error processing message:', {
                  error,
                  stream,
                  messageId: message.id
                });
              }
            }
          }
        }

        await this.claimPendingMessages();
        setImmediate(processEvents);
      } catch (error) {
        logger.error('[EventBus] Error in event processing loop:', error);
        setTimeout(processEvents, 1000);
      }
    };

    processEvents();
  }

  private async claimPendingMessages() {
    try {
      const client = await getClient();
      const streams = Array.from(this.handlers.keys()).map((eventType): string => getEventStream(eventType));

      for (const stream of streams) {
        const pendingInfo = await client.xPending(
          stream,
          getRedisConfig().eventBus.consumerGroup
        );

        if (pendingInfo.pending > 0) {
          const pendingMessages = await client.xPendingRange(
            stream,
            getRedisConfig().eventBus.consumerGroup,
            '-',
            '+',
            getRedisConfig().eventBus.batchSize
          );

          if (pendingMessages && pendingMessages.length > 0) {
            const now = Date.now();
            const claimIds = pendingMessages
              .filter(msg => (now - msg.millisecondsSinceLastDelivery) > getRedisConfig().eventBus.claimTimeout)
              .map((msg): string => msg.id);

            if (claimIds.length > 0) {
              await client.xClaim(
                stream,
                getRedisConfig().eventBus.consumerGroup,
                this.consumerName,
                getRedisConfig().eventBus.claimTimeout,
                claimIds
              );
            }
          }
        }
      }
    } catch (error) {
      logger.error('[EventBus] Error claiming pending messages:', error);
    }
  }

  public async subscribe(
    eventType: EventType,
    handler: (event: Event) => Promise<void>
  ): Promise<void> {
    await this.initialize();

    const stream = getEventStream(eventType);
    logger.info('[EventBus] Subscribing to stream:', { stream, eventType });

    if (!this.handlers.has(eventType)) {
      logger.info('[EventBus] Creating new handler set for event type:', eventType);
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    logger.info('[EventBus] Added handler:', {
      eventType,
      handlerName: handler.name,
      handlersCount: this.handlers.get(eventType)!.size
    });
  }

  public async unsubscribe(
    eventType: EventType,
    handler: (event: Event) => Promise<void>
  ): Promise<void> {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    }
  }

  public async publish(event: Omit<Event, 'id' | 'timestamp'>): Promise<void> {
    try {
      logger.info('[EventBus] Starting to publish event:', {
        eventType: event.eventType
      });

      const fullEvent: Event = {
        ...event,
        id: uuidv4(),
        timestamp: new Date().toISOString(),
      } as Event;

      const eventSchema = EventSchemas[fullEvent.eventType as keyof typeof EventSchemas];
      if (!eventSchema) {
        logger.error('[EventBus] Unknown event type:', {
          eventType: fullEvent.eventType,
          availableTypes: Object.keys(EventSchemas)
        });
        throw new Error(`Unknown event type: ${fullEvent.eventType}`);
      }

      eventSchema.parse(fullEvent);

      const stream = getEventStream(fullEvent.eventType);
      const client = await getClient();

      await this.ensureStreamAndGroup(stream);

      await client.xAdd(
        stream,
        '*',
        { event: JSON.stringify(fullEvent) },
        {
          TRIM: {
            strategy: 'MAXLEN',
            threshold: getRedisConfig().eventBus.maxStreamLength,
            strategyModifier: '~'
          }
        }
      );

      logger.info('[EventBus] Event published successfully:', {
        stream,
        eventType: fullEvent.eventType,
        eventId: fullEvent.id
      });
    } catch (error) {
      logger.error('Error publishing event:', error);
      // throw error;
    }
  }

  public async close(): Promise<void> {
    this.processingEvents = false;
    const currentClient = await getClient();
    if (currentClient) {
      await currentClient.quit();
      client = null;
    }
    this.initialized = false;
  }
}

// Defer instance creation until explicitly requested
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = EventBus.getInstance();
  }
  return eventBusInstance;
}
