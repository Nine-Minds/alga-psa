import logger from '@alga-psa/core/logger';
import type { Event } from '@alga-psa/event-schemas';
import { getConnection } from '../../db/db';
import { getEventBus } from '../index';
import { publicEventsFor, type TicketWebhookInternalEvent } from './webhook/webhookEventMap';
import {
  buildTicketWebhookPayload,
  type TicketWebhookSourceEvent,
} from './webhook/webhookTicketPayload';
import { webhookModel } from '../../webhooks/webhookModel';
import { WebhookDeliveryQueue } from '../../webhooks/WebhookDeliveryQueue';

const WEBHOOK_TICKET_EVENT_TYPES = [
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_STATUS_CHANGED',
  'TICKET_CLOSED',
  'TICKET_ASSIGNED',
  'TICKET_COMMENT_ADDED',
] as const satisfies readonly TicketWebhookInternalEvent[];

let isRegistered = false;

export async function registerWebhookSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  for (const eventType of WEBHOOK_TICKET_EVENT_TYPES) {
    await getEventBus().subscribe(eventType, handleTicketEvent);
  }

  isRegistered = true;
  logger.info('[WebhookSubscriber] Registered webhook ticket event handlers');
}

export async function unregisterWebhookSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  for (const eventType of WEBHOOK_TICKET_EVENT_TYPES) {
    await getEventBus().unsubscribe(eventType, handleTicketEvent);
  }

  isRegistered = false;
  logger.info('[WebhookSubscriber] Unregistered webhook ticket event handlers');
}

async function handleTicketEvent(event: unknown): Promise<void> {
  try {
    const internalEvent = toTicketWebhookSourceEvent(event);
    if (!internalEvent) {
      return;
    }

    const publicEvents = publicEventsFor(internalEvent.eventType);
    if (publicEvents.length === 0) {
      return;
    }

    const tenantId = internalEvent.payload.tenantId;
    const knex = await getConnection(tenantId);
    const payload = await buildTicketWebhookPayload(internalEvent, knex);

    for (const publicEventType of publicEvents) {
      const subscribers = await webhookModel.listForEventType(tenantId, publicEventType);
      if (subscribers.length === 0) {
        continue;
      }

      const matchingSubscribers = subscribers.filter((subscriber) =>
        matchesEntityIdFilter(subscriber.eventFilter, internalEvent.payload.ticketId),
      );

      for (const subscriber of matchingSubscribers) {
        await WebhookDeliveryQueue.getInstance().enqueue({
          webhookId: subscriber.webhookId,
          eventId: internalEvent.id,
          eventType: publicEventType,
          occurredAt: internalEvent.timestamp,
          tenantId,
          payload,
          attempt: 1,
          deliverAt: Date.now(),
        });
      }
    }
  } catch (error) {
    logger.error('[WebhookSubscriber] Failed to handle ticket event', {
      error: error instanceof Error ? error.message : 'Unknown error',
      eventType:
        typeof event === 'object' && event !== null && 'eventType' in event
          ? String((event as { eventType?: unknown }).eventType)
          : 'unknown',
    });
  }
}

type EventPayloadShape = {
  tenantId: string;
  ticketId: string;
  occurredAt?: string;
  changes?: unknown;
  comment?: unknown;
  [key: string]: unknown;
};

type TicketWebhookBusEvent = TicketWebhookSourceEvent & {
  id: string;
  timestamp: string;
};

function toTicketWebhookSourceEvent(event: unknown): TicketWebhookBusEvent | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const candidate = event as Partial<Event> & {
    payload?: EventPayloadShape;
  };

  if (
    typeof candidate.id !== 'string'
    || typeof candidate.timestamp !== 'string'
    || typeof candidate.eventType !== 'string'
    || !WEBHOOK_TICKET_EVENT_TYPES.includes(candidate.eventType as TicketWebhookInternalEvent)
    || !candidate.payload
    || typeof candidate.payload.tenantId !== 'string'
    || typeof candidate.payload.ticketId !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    timestamp: candidate.timestamp,
    eventType: candidate.eventType as TicketWebhookInternalEvent,
    payload: candidate.payload,
  };
}

function matchesEntityIdFilter(
  eventFilter: Record<string, unknown> | null,
  entityId: string,
): boolean {
  const entityIds = eventFilter?.entity_ids;

  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return true;
  }

  return entityIds.includes(entityId);
}
