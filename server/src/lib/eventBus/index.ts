import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import logger from '@shared/core/logger';
import { getRedisConfig, getEventStream, getConsumerName, DEFAULT_EVENT_CHANNEL } from '../../config/redisConfig';
import { getSecret } from '../utils/getSecret';
import {
  BaseEvent,
  Event,
  EventType,
  EventSchemas,
  BaseEventSchema,
  convertToWorkflowEvent
} from '@shared/workflow/streams/eventBusSchema';
import { WorkflowEventBaseSchema } from '@shared/workflow/streams/workflowEventSchema';

type EventHandler = (event: Event) => Promise<void>;

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
let clientPromise: Promise<Awaited<ReturnType<typeof createRedisClient>>> | null = null;

async function getClient() {
  if (!client) {
    // If another call is already creating the client, wait for it
    if (!clientPromise) {
      logger.info('[EventBus] Creating new Redis client');
      clientPromise = (async () => {
        const newClient = await createRedisClient();
        await newClient.connect();
        client = newClient;
        return newClient;
      })();
    }
    return await clientPromise;
  }
  return client;
}

export class EventBus {
  private static instance: EventBus;
  private static createdConsumerGroups: Set<string> = new Set<string>();
  // Map<EventType, Map<Channel, Handlers>> so channel-specific consumers do not step on each other.
  private handlers: Map<EventType, Map<string, Set<EventHandler>>>;
  private initialized: boolean = false;
  private consumerName: string;
  private processingEvents: boolean = false;
  private defaultChannel: string;

  private constructor() {
    this.handlers = new Map();
    this.consumerName = getConsumerName();
    this.defaultChannel = DEFAULT_EVENT_CHANNEL;
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  private getStreamKey(eventType: EventType, channel: string): string {
    return getEventStream(eventType, channel);
  }

  private getChannelHandlers(
    eventType: EventType,
    channel: string,
    createIfMissing: boolean = false
  ): Set<EventHandler> | undefined {
    let channelMap = this.handlers.get(eventType);
    if (!channelMap) {
      if (!createIfMissing) {
        return undefined;
      }
      channelMap = new Map<string, Set<EventHandler>>();
      this.handlers.set(eventType, channelMap);
    }

    let handlers = channelMap.get(channel);
    if (!handlers && createIfMissing) {
      handlers = new Set<EventHandler>();
      channelMap.set(channel, handlers);
    }
    return handlers;
  }

  private getActiveSubscriptions(): Array<{
    eventType: EventType;
    channel: string;
    stream: string;
    handlers: Set<EventHandler>;
  }> {
    // Redis consumes a flat list of streams, so collapse the nested handler structure here.
    const subscriptions: Array<{
      eventType: EventType;
      channel: string;
      stream: string;
      handlers: Set<EventHandler>;
    }> = [];

    for (const [eventType, channelMap] of this.handlers.entries()) {
      for (const [channel, handlers] of channelMap.entries()) {
        if (handlers.size === 0) {
          continue;
        }
        const stream = this.getStreamKey(eventType, channel);
        subscriptions.push({ eventType, channel, stream, handlers });
      }
    }

    return subscriptions;
  }

  private async ensureStreamAndGroup(stream: string): Promise<void> {
    // Check if we've already created this consumer group
    if (EventBus.createdConsumerGroups.has(stream)) {
      // logger.debug(`[EventBus] Consumer group already ensured for stream: ${stream}`);
      return;
    }

    const client = await getClient();
    try {
      const config = getRedisConfig();
      // Lazily create the consumer group; MKSTREAM creates the stream if it does not exist yet.
      await client.xGroupCreate(stream, config.eventBus.consumerGroup, '0', {
        MKSTREAM: true
      });
      logger.info(`[EventBus] Created consumer group for stream: ${stream}`);
      // Add to the set of created consumer groups
      EventBus.createdConsumerGroups.add(stream);
    } catch (err: any) {
      if (err.message.includes('BUSYGROUP')) {
        logger.info(`[EventBus] Consumer group already exists for stream: ${stream}`);
        // Add to the set of created consumer groups even if it already existed
        EventBus.createdConsumerGroups.add(stream);
      } else {
        throw err;
      }
    }
  }

  public async initialize() {
    if (!this.initialized) {
      console.log('[EventBus] Initializing event bus');
      await getClient();

      for (const eventType of Object.keys(EventSchemas) as EventType[]) {
        const stream = this.getStreamKey(eventType, this.defaultChannel);
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
        const config = getRedisConfig();
        const subscriptions = this.getActiveSubscriptions();

        if (subscriptions.length === 0) {
          setTimeout(processEvents, 1000);
          return;
        }

        // Ensure all subscribed streams exist before attempting to read
        for (const { stream } of subscriptions) {
          await this.ensureStreamAndGroup(stream);
        }

        // xReadGroup expects flat stream descriptors; reuse the subscriptions list we built above.
        const streamEntries = await client.xReadGroup(
          config.eventBus.consumerGroup,
          this.consumerName,
          subscriptions.map(({ stream }) => ({ key: stream, id: '>' })),
          {
            COUNT: config.eventBus.batchSize,
            BLOCK: config.eventBus.blockingTimeout
          }
        );

        if (streamEntries) {
          logger.info('[EventBus] Received stream entries:', {
            streamsWithMessages: streamEntries.length,
            totalMessages: streamEntries.reduce((sum, s) => sum + s.messages.length, 0)
          });

          const subscriptionLookup = new Map(subscriptions.map((sub) => [sub.stream, sub]));

          for (const { name: stream, messages } of streamEntries) {
            const subscription = subscriptionLookup.get(stream);
            if (!subscription) {
              logger.warn('[EventBus] No subscription found for stream', { stream });
              continue;
            }

            for (const message of messages) {
              try {
                const rawEventPayload = message.message.event;
                if (!rawEventPayload) {
                  logger.warn('[EventBus] Missing event payload in message', {
                    stream,
                    messageId: message.id
                  });
                  await client.xAck(stream, config.eventBus.consumerGroup, message.id);
                  continue;
                }

                const rawEvent = JSON.parse(rawEventPayload);
                const baseEvent = BaseEventSchema.parse(rawEvent);
                const eventSchema = EventSchemas[baseEvent.eventType];

                if (!eventSchema) {
                  logger.error('[EventBus] Unknown event type:', {
                    eventType: baseEvent.eventType,
                    availableTypes: Object.keys(EventSchemas)
                  });
                  await client.xAck(stream, config.eventBus.consumerGroup, message.id);
                  continue;
                }

                const event = eventSchema.parse(rawEvent) as Event;
                const handlers = subscription.handlers;
                const handler = handlers.values().next().value as EventHandler | undefined;

                if (handler) {
                  const isProcessed = await this.isEventProcessed(event);
                  if (!isProcessed) {
                    try {
                      await handler(event);
                      await this.markEventProcessed(event);
                    } catch (error) {
                      logger.error('[EventBus] Error in event handler:', {
                        error,
                        eventType: baseEvent.eventType,
                        handler: handler.name,
                        channel: subscription.channel
                      });
                      // Don't acknowledge message on error to allow retry
                      continue;
                    }
                  } else {
                    logger.info('[EventBus] Skipping already processed event:', {
                      eventId: event.id,
                      eventType: event.eventType,
                      channel: subscription.channel
                    });
                  }
                } else {
                  logger.warn('[EventBus] No handlers registered when processing message', {
                    eventType: baseEvent.eventType,
                    channel: subscription.channel
                  });
                }

                await client.xAck(stream, config.eventBus.consumerGroup, message.id);
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
      const config = getRedisConfig();
      const subscriptions = this.getActiveSubscriptions();

      for (const { stream } of subscriptions) {
        const pendingInfo = await client.xPending(
          stream,
          config.eventBus.consumerGroup
        );

        if (pendingInfo.pending > 0) {
          const pendingMessages = await client.xPendingRange(
            stream,
            config.eventBus.consumerGroup,
            '-',
            '+',
            config.eventBus.batchSize
          );

          if (pendingMessages && pendingMessages.length > 0) {
            const now = Date.now();
            const claimIds = pendingMessages
              .filter(msg => (now - msg.millisecondsSinceLastDelivery) > config.eventBus.claimTimeout)
              .map(msg => msg.id);

            if (claimIds.length > 0) {
              await client.xClaim(
                stream,
                config.eventBus.consumerGroup,
                this.consumerName,
                config.eventBus.claimTimeout,
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
    handler: EventHandler,
    options?: { channel?: string }
  ): Promise<void> {
    await this.initialize();

    const channel = options?.channel || this.defaultChannel;
    const handlers = this.getChannelHandlers(eventType, channel, true)!;
    handlers.add(handler);

    const stream = this.getStreamKey(eventType, channel);
    await this.ensureStreamAndGroup(stream);

    logger.info('[EventBus] Added handler:', {
      eventType,
      channel,
      handlerName: handler.name,
      handlersCount: handlers.size
    });
  }

  public async unsubscribe(
    eventType: EventType,
    handler: EventHandler,
    options?: { channel?: string }
  ): Promise<void> {
    const channel = options?.channel || this.defaultChannel;
    const channelMap = this.handlers.get(eventType);
    if (!channelMap) {
      return;
    }

    const handlers = channelMap.get(channel);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);
    if (handlers.size === 0) {
      channelMap.delete(channel);
      if (channelMap.size === 0) {
        this.handlers.delete(eventType);
      }
    }
  }

  public async publish(
    event: Omit<Event, 'id' | 'timestamp'>,
    options?: { channel?: string }
  ): Promise<void> {
    try {
      // Unless a caller specifies otherwise, publish onto the default channel for this service.
      const channel = options?.channel || this.defaultChannel;
      const config = getRedisConfig();

      logger.info('[EventBus] Starting to publish event:', {
        eventType: event.eventType,
        channel
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

      const client = await getClient();

      // Publish to the workflow stream only when using the default channel; channel-specific events stay isolated.
      if (channel === this.defaultChannel) {
        const globalStream = 'workflow:events:global';
        await this.ensureStreamAndGroup(globalStream);

        const workflowEvent = WorkflowEventBaseSchema.parse(
          convertToWorkflowEvent(fullEvent)
        );

        logger.debug('[EventBus] Publishing event in workflow format:', {
          eventType: workflowEvent.event_type,
          eventId: workflowEvent.event_id
        });

        // Construct the message fields for XADD in the flat format
        const messageFields: { [key: string]: string } = {
          event_id: workflowEvent.event_id,
          execution_id: workflowEvent.execution_id || '',
          event_name: workflowEvent.event_name,
          event_type: workflowEvent.event_type,
          tenant: workflowEvent.tenant,
          timestamp: workflowEvent.timestamp, // Already a string from Zod schema
          user_id: workflowEvent.user_id || '',
          from_state: workflowEvent.from_state || '',
          to_state: workflowEvent.to_state || '',
          payload_json: JSON.stringify(workflowEvent.payload || {})
        };

        await client.xAdd(
          globalStream,
          '*',
          messageFields, // Use the flat messageFields object
          {
            TRIM: {
              strategy: 'MAXLEN',
              threshold: config.eventBus.maxStreamLength,
              strategyModifier: '~'
            }
          }
        );

        logger.debug('[EventBus] Event published to workflow stream:', {
          stream: globalStream,
          eventType: fullEvent.eventType,
          eventId: fullEvent.id
        });
      }

      // 2. ALSO publish to individual event stream (channel-scoped legacy consumers such as email notifications).
      const individualStream = this.getStreamKey(fullEvent.eventType, channel);
      await this.ensureStreamAndGroup(individualStream);

      // Publish the original event format for legacy consumers
      await client.xAdd(
        individualStream,
        '*',
        {
          event: JSON.stringify(fullEvent),
          channel
        },
        {
          TRIM: {
            strategy: 'MAXLEN',
            threshold: config.eventBus.maxStreamLength,
            strategyModifier: '~'
          }
        }
      );

      logger.info('[EventBus] Event published:', {
        eventType: fullEvent.eventType,
        eventId: fullEvent.id,
        tenant: fullEvent.payload.tenantId,
        channel
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
