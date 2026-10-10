import logger from '@alga-psa/core/logger';
import { isWorkflowCatalogEventType, type WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { EVENT_TYPES, type Event, type EventType } from '../events';
import { getEventBus } from '../index';
import { buildWorkflowPayload, type WorkflowEventPublishContext } from '../workflow/workflowEventPublishHelpers';
import type { WorkflowPublishHooks } from '../schemas/eventBusSchema';

// Email event channel constant - inlined to avoid circular dependency with notifications
// Must match the value in @alga-psa/notifications/emailChannel
const EMAIL_EVENT_CHANNEL = 'emailservice::v7';
function getEmailEventChannel(): string {
  return EMAIL_EVENT_CHANNEL;
}

export interface PublishOptions {
  channel?: string;
  workflow?: WorkflowPublishHooks;
  /** Caller-supplied stable event id (used by the inbound outbox dispatcher). */
  eventId?: string;
  /** Strict mode propagates an unsuccessful stream write (dispatcher only). */
  strict?: boolean;
  /**
   * Recovery re-publish: bypasses the event-bus processed-event/handler Redis
   * sets so incomplete inbound-outbox consumer deliveries re-run. Consumers
   * that already completed are skipped by their own idempotency ledger.
   */
  force?: boolean;
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
  'PROJECT_MILESTONE_READY',
  'PROJECT_BUDGET_THRESHOLD_REACHED',
  'PROJECT_BUDGET_EXCEEDED',
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
  'PROJECT_MILESTONE_READY',
  'PROJECT_BUDGET_THRESHOLD_REACHED',
  'PROJECT_BUDGET_EXCEEDED',
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

/**
 * Event types with no workflow catalog entry (no registered payload schema). These are the only
 * types `publishEvent` accepts directly; catalogued types must go through `publishWorkflowEvent`
 * (builder payload + context, validated by the contract tests) or `publishCatalogEventPayload`.
 */
export type NonCatalogEventType = Exclude<EventType, WorkflowCatalogEventType>;

/** Shape accepted by the narrowed `publishEvent`. */
export type NonCatalogEvent = {
  eventType: NonCatalogEventType;
  payload: Record<string, unknown>;
};

export async function publishEvent(
  event: NonCatalogEvent,
  options?: PublishOptions
): Promise<void> {
  await publishEventUnchecked(event, options);
}

/**
 * Raw path for a payload that is ALREADY built for a catalogued event (WorkflowEventPublisher,
 * the inbound-email outbox dispatcher, inventory). The event type is constrained to the catalog at
 * compile time; payload shape is covered by the emitter contract tests.
 */
export async function publishCatalogEventPayload<T extends WorkflowCatalogEventType>(
  event: { eventType: T; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  await publishEventUnchecked(event, options);
}

/**
 * For adapters whose event type is only known as a string at runtime (stored outbox rows, generic
 * IEventPublisher). Catalogued types take the catalog path; anything else must be a known event
 * type or the call throws, instead of silently casting to `any`.
 */
export async function publishEventByName(
  event: { eventType: string; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  if (isWorkflowCatalogEventType(event.eventType)) {
    await publishCatalogEventPayload({ eventType: event.eventType, payload: event.payload }, options);
    return;
  }
  if (!isKnownEventType(event.eventType)) {
    throw new Error(`[EventPublisher] Unknown event type: ${event.eventType}`);
  }
  await publishEvent({ eventType: event.eventType, payload: event.payload }, options);
}

function isKnownEventType(eventType: string): eventType is NonCatalogEventType {
  return (EVENT_TYPES as readonly string[]).includes(eventType);
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
    await getEventBus().publish(event as any, {
      workflow: options?.workflow,
      eventId: options?.eventId,
      strict: options?.strict,
      force: options?.force,
    });

    // If this is an internal notification event, publish to the internal-notifications channel
    if (isInternalNotificationEvent && !channel) {
      await getEventBus().publish(event as any, {
        channel: 'internal-notifications',
        workflow: options?.workflow,
        eventId: options?.eventId,
        strict: options?.strict,
        force: options?.force,
      });
    }

    // If this is an email event type and no specific channel was provided,
    // also publish to the email channel for email notifications
    if (isEmailEvent && !channel) {
      await getEventBus().publish(event as any, {
        channel: getEmailEventChannel(),
        workflow: options?.workflow,
        eventId: options?.eventId,
        strict: options?.strict,
        force: options?.force,
      });
    } else if (channel) {
      // If a specific channel was provided, publish to that channel as well
      await getEventBus().publish(event as any, {
        channel,
        workflow: options?.workflow,
        eventId: options?.eventId,
        strict: options?.strict,
        force: options?.force,
      });
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

  await publishCatalogEventPayload(
    { eventType: params.eventType, payload },
    { ...options, workflow }
  );
}

/**
 * `publishWorkflowEvent` for event types that have NO workflow catalog entry (e.g. USER_*,
 * ASSET_DELETED, *_DELETED search events, TICKET_SLA_THRESHOLD_REACHED). Same context/idempotency
 * handling, but there is no registered payload schema, so the emitter contract test cannot cover it.
 */
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

export type { WorkflowActor, WorkflowEventPublishContext } from '../workflow/workflowEventPublishHelpers';
