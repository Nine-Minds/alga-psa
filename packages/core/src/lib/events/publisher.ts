/**
 * @alga-psa/core - Event Publisher
 *
 * Publishes events to the workflow engine via Redis streams.
 */

import { RedisStreamClient, type WorkflowEventBase } from './redisStreamClient';

import { v4 as uuidv4 } from 'uuid';
import logger from '../logger';

// Initialize Redis stream client
let redisClient: RedisStreamClient | null = null;

async function getRedisClient(): Promise<RedisStreamClient> {
  if (!redisClient) {
    redisClient = new RedisStreamClient();
    await redisClient.initialize();
  }
  return redisClient;
}

export interface EventPayload {
  eventType: string;
  tenant: string;
  payload: any;
  correlationId?: string;
}

/**
 * Publish an event to the workflow engine
 */
export async function publishEvent(event: EventPayload): Promise<string> {
  try {
    const client = await getRedisClient();

    const workflowEvent: WorkflowEventBase = {
      event_id: uuidv4(),
      execution_id: event.correlationId || uuidv4(),
      event_name: event.eventType,
      event_type: event.eventType, // Use the actual event type instead of hardcoded 'system'
      timestamp: new Date().toISOString(),
      tenant: event.tenant,
      payload: event.payload
    };

    const messageId = await client.publishEvent(workflowEvent);

    logger.info('[EventPublisher] Published event', {
      eventType: event.eventType,
      tenant: event.tenant,
      messageId,
      correlationId: workflowEvent.execution_id
    });

    return messageId;
  } catch (error) {
    logger.error('[EventPublisher] Failed to publish event', {
      eventType: event.eventType,
      tenant: event.tenant,
      error
    });
    throw error;
  }
}
