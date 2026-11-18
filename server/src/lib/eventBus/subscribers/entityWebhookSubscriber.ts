/**
 * Registry-driven webhook subscriber shared by client, contact and
 * client_location.
 *
 * What an entity supplies is only its name; the internal -> public mapping,
 * the events to subscribe to and the entity-ID filter keys all come from
 * `eventRegistry.ts`, and the payload from `webhookEntityPayload.ts`.
 *
 * LEVERAGE: pattern entity-webhook-subscriber — the ticket (webhookSubscriber.ts) and project
 * (projectWebhookSubscriber.ts) subscribers repeat this resolve-subscribers / entity-ID filter / allowlist /
 * enqueue loop. They are not moved onto this layer: both hydrate payloads from the DB (comments, phases,
 * task counts) and the ticket one wraps delivery in the inbound-outbox dedupe ledger.
 */
import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import {
  getWebhookEventDefinition,
  internalToPublicMap,
  sourceEventsForEntity,
  type WebhookEntity,
} from '../../webhooks/eventRegistry';
import { applyPayloadAllowlist } from '../../webhooks/payloadFields';
import { webhookModel } from '../../webhooks/webhookModel';
import { WebhookDeliveryQueue } from '../../webhooks/WebhookDeliveryQueue';
import {
  buildEntityWebhookPayload,
  type DomainEventPayload,
  type EntityWebhookEntity,
} from './webhook/webhookEntityPayload';

interface BusEvent {
  id: string;
  timestamp: string;
  eventType: string;
  payload: DomainEventPayload;
}

function toBusEvent(event: unknown): BusEvent | null {
  if (!event || typeof event !== 'object') return null;
  const c = event as Partial<BusEvent>;
  if (
    typeof c.id !== 'string' ||
    typeof c.timestamp !== 'string' ||
    typeof c.eventType !== 'string' ||
    !c.payload ||
    typeof c.payload !== 'object' ||
    typeof c.payload.tenantId !== 'string'
  ) {
    return null;
  }
  return c as BusEvent;
}

/**
 * `event_filter.entity_ids` matches when it is empty/absent, or when any entry
 * equals one of the event's id values (the entity's own id, or for contact and
 * client_location the parent client_id).
 */
export function matchesEntityIdFilter(
  eventFilter: Record<string, unknown> | null | undefined,
  candidateIds: readonly (string | undefined)[],
): boolean {
  const entityIds = eventFilter?.entity_ids;
  if (!Array.isArray(entityIds) || entityIds.length === 0) return true;
  return candidateIds.some((id) => typeof id === 'string' && entityIds.includes(id));
}

export interface EntityWebhookSubscriber {
  readonly entity: EntityWebhookEntity;
  /** Internal event types this subscriber listens to (derived from the registry). */
  readonly internalEvents: readonly string[];
  /** Internal -> public mapping this subscriber applies (derived from the registry). */
  readonly internalToPublic: Readonly<Record<string, readonly string[]>>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  handle(event: unknown): Promise<void>;
}

export function createEntityWebhookSubscriber(
  entity: EntityWebhookEntity,
  label: string,
): EntityWebhookSubscriber {
  const internalToPublic = internalToPublicMap(entity as WebhookEntity);
  const internalEvents = sourceEventsForEntity(entity as WebhookEntity);
  const subscriberId = `webhook-${entity}`;
  let isRegistered = false;

  async function handle(event: unknown): Promise<void> {
    const rawEventType =
      typeof event === 'object' && event !== null && 'eventType' in event
        ? String((event as { eventType?: unknown }).eventType)
        : 'unknown';
    try {
      const busEvent = toBusEvent(event);
      if (!busEvent) return;
      const publicEvents = internalToPublic[busEvent.eventType];
      if (!publicEvents || publicEvents.length === 0) return;

      const tenantId = busEvent.payload.tenantId;

      for (const publicEventType of publicEvents) {
        const data = buildEntityWebhookPayload(entity, busEvent.eventType, publicEventType, busEvent.payload);
        if (!data) continue;

        const subscribers = await webhookModel.listForEventType(tenantId, publicEventType);
        if (subscribers.length === 0) continue;

        const definition = getWebhookEventDefinition(publicEventType);
        const candidateIds = (definition?.entityIdKeys ?? []).map((key) => data[key] as string | undefined);

        for (const subscriber of subscribers) {
          if (!matchesEntityIdFilter(subscriber.eventFilter, candidateIds)) continue;

          const perEntity = subscriber.payloadFields?.[entity];
          const allowlist = perEntity === undefined || perEntity === null ? null : perEntity;

          await WebhookDeliveryQueue.getInstance().enqueue({
            webhookId: subscriber.webhookId,
            eventId: busEvent.id,
            eventType: publicEventType,
            occurredAt: busEvent.timestamp,
            tenantId,
            payload: applyPayloadAllowlist(entity, data, allowlist),
            attempt: 1,
            deliverAt: Date.now(),
          });
        }
      }
    } catch (error) {
      logger.error(`[${label}] Failed to handle ${entity} event`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        eventType: rawEventType,
      });
    }
  }

  return {
    entity,
    internalEvents,
    internalToPublic,
    handle,
    async register() {
      if (isRegistered) return;
      for (const eventType of internalEvents) {
        await getEventBus().subscribe(eventType as never, handle, { subscriberId });
      }
      isRegistered = true;
      logger.info(`[${label}] Registered webhook ${entity} event handlers`);
    },
    async unregister() {
      if (!isRegistered) return;
      for (const eventType of internalEvents) {
        await getEventBus().unsubscribe(eventType as never, handle);
      }
      isRegistered = false;
      logger.info(`[${label}] Unregistered webhook ${entity} event handlers`);
    },
  };
}
