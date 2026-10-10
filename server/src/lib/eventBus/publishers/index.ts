import logger from '@alga-psa/core/logger';
import { EVENT_TYPES, isWorkflowCatalogEventType, type Event, type EventType, type WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { getEventBus } from '../index';
import { getEmailEventChannel } from '@alga-psa/notifications';
import { buildWorkflowPayload, type WorkflowEventPublishContext, type WorkflowPublishHooks } from '@alga-psa/event-schemas';

export interface PublishOptions {
  channel?: string;
  workflow?: WorkflowPublishHooks;
}

const EMAIL_EVENT_TYPES = new Set<Event['eventType']>([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_STATUS_CHANGED',
  'TICKET_CLOSED',
  'TICKET_ASSIGNED',
  'TICKET_ADDITIONAL_AGENT_ASSIGNED',
  'TICKET_COMMENT_ADDED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
  'APPOINTMENT_REQUEST_CREATED',
  'APPOINTMENT_REQUEST_APPROVED',
  'APPOINTMENT_REQUEST_DECLINED',
  'APPOINTMENT_REQUEST_CANCELLED'
]);

const INTERNAL_NOTIFICATION_EVENT_TYPES = new Set<Event['eventType']>([
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_ADDITIONAL_AGENT_ASSIGNED',
  'TICKET_UPDATED',
  'TICKET_STATUS_CHANGED',
  'TICKET_CLOSED',
  'TICKET_COMMENT_ADDED',
  'PROJECT_CREATED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
  'TASK_COMMENT_ADDED',
  'INVOICE_GENERATED',
  'MESSAGE_SENT',
  'USER_MENTIONED_IN_DOCUMENT',
  'APPOINTMENT_REQUEST_CREATED',
  'APPOINTMENT_REQUEST_APPROVED',
  'APPOINTMENT_REQUEST_DECLINED',
  'APPOINTMENT_REQUEST_CANCELLED',
  'CALENDAR_SHARE_GRANTED'
]);

/** Event types with no workflow catalog entry. Catalogued types must use `publishWorkflowEvent` / `publishCatalogEventPayload`. */
export type NonCatalogEventType = Exclude<EventType, WorkflowCatalogEventType>;

export type NonCatalogEvent = {
  eventType: NonCatalogEventType;
  payload: Record<string, unknown>;
};

export async function publishEvent(event: NonCatalogEvent, options?: PublishOptions): Promise<void> {
  await publishEventUnchecked(event, options);
}

/**
 * KNOWN DEFECT (alga0002106): publishes an event type that is NOT in EVENT_TYPES (e.g. TeamService
 * 'PLACEHOLDER', TIME_SHEET_*, INVOICE_PAYMENT_RECORDED, CONTRACT_LINE_CREATED). These were hidden
 * while `Event` was `any`; the transport rejects them. Behaviour is deliberately unchanged here so
 * the typing change does not alter runtime; each caller is reported, not fixed. Do not add callers.
 */
export async function publishUnregisteredEventType(
  event: { eventType: string; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  await publishEventUnchecked(event as { eventType: EventType; payload: Record<string, unknown> }, options);
}

/** Raw path for an already-built payload of a catalogued event; the type is checked against the catalog. */
export async function publishCatalogEventPayload<T extends WorkflowCatalogEventType>(
  event: { eventType: T; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  await publishEventUnchecked(event, options);
}

async function publishEventUnchecked(
  event: { eventType: EventType; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  try {
    const isEmailEvent = EMAIL_EVENT_TYPES.has(event.eventType as Event['eventType']);
    const isInternalNotificationEvent = INTERNAL_NOTIFICATION_EVENT_TYPES.has(event.eventType as Event['eventType']);
    const channel = options?.channel;

    // Always publish to the default global channel first (for workflows)
    await getEventBus().publish(event as any, { workflow: options?.workflow });

    // If this is an internal notification event, publish to the internal-notifications channel
    if (isInternalNotificationEvent && !channel) {
      await getEventBus().publish(event as any, { channel: 'internal-notifications', workflow: options?.workflow });
    }

    // If this is an email event type and no specific channel was provided,
    // also publish to the email channel for email notifications
    if (isEmailEvent && !channel) {
      await getEventBus().publish(event as any, { channel: getEmailEventChannel(), workflow: options?.workflow });
    } else if (channel) {
      // If a specific channel was provided, publish to that channel as well
      await getEventBus().publish(event as any, { channel, workflow: options?.workflow });
    }
  } catch (error) {
    logger.error('[EventPublisher] Failed to publish event:', {
      error,
      eventType: event.eventType,
      channel: options?.channel
    });
    throw error;
  }
}

export async function publishWorkflowEvent<T extends WorkflowCatalogEventType>(params: {
  eventType: T;
  payload: Record<string, unknown>;
  ctx: WorkflowEventPublishContext;
  idempotencyKey?: string;
  eventName?: string;
  fromState?: string;
  toState?: string;
}, options?: Omit<PublishOptions, 'workflow'>): Promise<void> {
  const ctx = params.idempotencyKey ? { ...params.ctx, idempotencyKey: params.idempotencyKey } : params.ctx;
  const payload = buildWorkflowPayload(params.payload, ctx);
  const workflow: WorkflowPublishHooks = {
    executionId: ctx.correlationId,
    eventName: params.eventName,
    fromState: params.fromState,
    toState: params.toState,
  };

  await publishCatalogEventPayload({ eventType: params.eventType, payload }, { ...options, workflow });
}

/** `publishWorkflowEvent` for event types with no workflow catalog entry (no registered payload schema). */
export async function publishNonCatalogWorkflowEvent<T extends NonCatalogEventType>(params: {
  eventType: T;
  payload: Record<string, unknown>;
  ctx: WorkflowEventPublishContext;
  idempotencyKey?: string;
  eventName?: string;
  fromState?: string;
  toState?: string;
}, options?: Omit<PublishOptions, 'workflow'>): Promise<void> {
  const ctx = params.idempotencyKey ? { ...params.ctx, idempotencyKey: params.idempotencyKey } : params.ctx;
  const payload = buildWorkflowPayload(params.payload, ctx);
  const workflow: WorkflowPublishHooks = {
    executionId: ctx.correlationId,
    eventName: params.eventName,
    fromState: params.fromState,
    toState: params.toState,
  };
  await publishEvent({ eventType: params.eventType, payload }, { ...options, workflow });
}

function isKnownEventType(eventType: string): eventType is NonCatalogEventType {
  return (EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * `publishWorkflowEvent` for adapters that only know the event type as a string. Catalogued types
 * take the catalog path, other known event types the non-catalog path, and an unknown type throws
 * (instead of an `as any` cast reaching the transport).
 */
export async function publishWorkflowEventByName(params: {
  eventType: string;
  payload: Record<string, unknown>;
  ctx: WorkflowEventPublishContext;
  idempotencyKey?: string;
  eventName?: string;
  fromState?: string;
  toState?: string;
}, options?: Omit<PublishOptions, 'workflow'>): Promise<void> {
  if (isWorkflowCatalogEventType(params.eventType)) {
    return publishWorkflowEvent({ ...params, eventType: params.eventType }, options);
  }
  if (isKnownEventType(params.eventType)) {
    return publishNonCatalogWorkflowEvent({ ...params, eventType: params.eventType }, options);
  }
  throw new Error(`[EventPublisher] Unknown event type: ${params.eventType}`);
}

export type { WorkflowActor, WorkflowEventPublishContext } from '@alga-psa/event-schemas';
