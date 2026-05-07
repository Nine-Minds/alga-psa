import logger from '@alga-psa/core/logger';
import type { Event } from '@alga-psa/event-schemas';
import { getConnection } from '../../db/db';
import { getEventBus } from '../index';
import { publicEventsFor, type TicketWebhookInternalEvent } from './webhook/webhookEventMap';
import {
  buildTicketWebhookPayload,
  fetchTicketCommentsForWebhook,
  projectWebhookPayload,
  type TicketWebhookSourceEvent,
} from './webhook/webhookTicketPayload';
import { webhookEntityForEventType } from '../../api/schemas/webhookSchemas';
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
  // TEMP DIAGNOSTIC — remove once we've confirmed COMMENT_ADDED reaches the subscriber.
  const rawEventType =
    typeof event === 'object' && event !== null && 'eventType' in event
      ? String((event as { eventType?: unknown }).eventType)
      : 'unknown';
  logger.info('[WebhookSubscriber] handleTicketEvent invoked', { eventType: rawEventType });

  try {
    const internalEvent = toTicketWebhookSourceEvent(event);
    if (!internalEvent) {
      logger.info('[WebhookSubscriber] event rejected by toTicketWebhookSourceEvent', { eventType: rawEventType });
      return;
    }

    const publicEvents = publicEventsFor(internalEvent.eventType);
    if (publicEvents.length === 0) {
      logger.info('[WebhookSubscriber] no public events mapped', { eventType: rawEventType });
      return;
    }

    const tenantId = internalEvent.payload.tenantId;
    const knex = await getConnection(tenantId);
    const payload = await buildTicketWebhookPayload(internalEvent, knex);

    for (const publicEventType of publicEvents) {
      const subscribers = await webhookModel.listForEventType(tenantId, publicEventType);
      logger.info('[WebhookSubscriber] resolved subscribers', {
        publicEventType,
        tenantId,
        count: subscribers.length,
      });
      if (subscribers.length === 0) {
        continue;
      }

      const matchingSubscribers = subscribers.filter((subscriber) =>
        matchesEntityIdFilter(subscriber.eventFilter, internalEvent.payload.ticketId),
      );

      const entity = webhookEntityForEventType(publicEventType);

      // Per-subscriber allowlist for THIS entity.
      // - subscriber.payloadFields === null/undefined  -> full payload
      // - subscriber.payloadFields[entity] absent        -> full payload for entity
      // - subscriber.payloadFields[entity] === null      -> full payload for entity
      // - subscriber.payloadFields[entity] === [...]     -> only these fields
      const allowlistFor = (sub: {
        payloadFields: Record<string, string[] | null> | null | undefined;
      }): string[] | null => {
        if (sub.payloadFields == null) return null;
        const perEntity = sub.payloadFields[entity];
        return perEntity === undefined || perEntity === null ? null : perEntity;
      };

      // Fetch the full comment thread once if any matching subscriber wants
      // it (full payload OR explicit `comments` selection on the ticket entity).
      const wantsCommentsFor = (sub: {
        payloadFields: Record<string, string[] | null> | null | undefined;
      }) => {
        const fields = allowlistFor(sub);
        return fields === null || fields.includes('comments');
      };
      const anyWantsComments = entity === 'ticket'
        && matchingSubscribers.some(wantsCommentsFor);
      const fullCommentThread = anyWantsComments
        ? await fetchTicketCommentsForWebhook(knex, tenantId, internalEvent.payload.ticketId)
        : null;

      for (const subscriber of matchingSubscribers) {
        const payloadWithComments = wantsCommentsFor(subscriber) && fullCommentThread !== null
          ? { ...payload, comments: fullCommentThread }
          : payload;
        const subscriberPayload = projectWebhookPayload(
          entity,
          payloadWithComments,
          allowlistFor(subscriber),
        );
        await WebhookDeliveryQueue.getInstance().enqueue({
          webhookId: subscriber.webhookId,
          eventId: internalEvent.id,
          eventType: publicEventType,
          occurredAt: internalEvent.timestamp,
          tenantId,
          payload: subscriberPayload,
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
