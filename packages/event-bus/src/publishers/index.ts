import logger from '@alga-psa/core/logger';
import { builtWorkflowPayload, isWorkflowCatalogEventType, type BuiltWorkflowPayload, type WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { EVENT_TYPES, type Event, type EventType } from '../events';
import { getEventBus } from '../index';
import { enforceWorkflowEventContract } from '../workflow/workflowEventContract';
import { buildWorkflowPayload, type WorkflowEventPublishContext } from '@alga-psa/event-schemas';
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
 * (registered builder payload + context, validated by the contract tests).
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
 * Publish a catalogued event whose payload is ALREADY complete (tenantId/occurredAt/actor stamped),
 * e.g. a replay of a payload a registered builder produced earlier. The payload must be a
 * `BuiltWorkflowPayload<T>` (a registered builder's return type), so an inline literal does not
 * compile. Prefer `publishWorkflowEvent`, which also stamps the context.
 */
export async function publishBuiltWorkflowPayload<T extends WorkflowCatalogEventType>(
  event: { eventType: T; payload: BuiltWorkflowPayload<T> },
  options?: PublishOptions
): Promise<void> {
  await publishEventUnchecked({ eventType: event.eventType, payload: event.payload as Record<string, unknown> }, options);
}

/**
 * Re-brand a catalogued payload that was PERSISTED after a registered builder produced it (the
 * inbound-email outbox row, an IEventPublisher adapter queue) so it can be replayed through
 * `publishBuiltWorkflowPayload`. This is the one deliberate runtime seam: a stored payload has lost
 * its static type, so it is checked against the canonical schema instead (throws in `enforce`
 * mode, warns in `warn`, no-op in `off` — replay must never drop notification fan-out in
 * production). Returns `null` for event types that are not catalogued; those replay through
 * `publishNonCatalogEventByName`.
 */
export function reviveStoredWorkflowPayload(
  eventType: string,
  stored: Record<string, unknown>
): { eventType: WorkflowCatalogEventType; payload: BuiltWorkflowPayload<WorkflowCatalogEventType> } | null {
  if (!isWorkflowCatalogEventType(eventType)) return null;
  enforceWorkflowEventContract(eventType, stored);
  return { eventType, payload: builtWorkflowPayload(eventType, stored) };
}

/**
 * Replay a catalogued event whose payload was PERSISTED after a registered builder produced it (the
 * comment publication outbox on `comments.comment_publication_payload`). Revives the payload against
 * the canonical schema (`reviveStoredWorkflowPayload`) and publishes it with `publishBuiltWorkflowPayload`.
 * Throws for a type that is not catalogued, so a typo cannot silently drop the event.
 */
export async function publishStoredWorkflowEvent(
  event: { eventType: string; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  const revived = reviveStoredWorkflowPayload(event.eventType, event.payload);
  if (!revived) {
    throw new Error(`[EventPublisher] ${event.eventType} is not a catalogued workflow event; cannot replay a stored payload`);
  }
  await publishBuiltWorkflowPayload(revived, options);
}

/**
 * Publish a NON-catalogued event whose type is only known at runtime (stored outbox rows, generic
 * IEventPublisher adapters). A catalogued type is rejected: it must go through
 * `publishWorkflowEvent` / `publishBuiltWorkflowPayload`.
 */
export async function publishNonCatalogEventByName(
  event: { eventType: string; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  if (isWorkflowCatalogEventType(event.eventType)) {
    throw new Error(`[EventPublisher] ${event.eventType} is a catalogued workflow event; publish it with publishWorkflowEvent`);
  }
  if (!(EVENT_TYPES as readonly string[]).includes(event.eventType)) {
    throw new Error(`[EventPublisher] Unknown event type: ${event.eventType}`);
  }
  await publishEventUnchecked(event as { eventType: EventType; payload: Record<string, unknown> }, options);
}

/**
 * KNOWN DEFECT (alga-2026-0002675): publishes an event type that is NOT in EVENT_TYPES (e.g.
 * TeamService 'PLACEHOLDER', TIME_SHEET_*, INVOICE_PAYMENT_RECORDED, CONTRACT_LINE_CREATED). The
 * transport rejects them, so these publishes never deliver. Behaviour is deliberately unchanged;
 * every call site cites the ticket. Do not add callers: the emit-site guard allow-lists the
 * existing ones by ticket and fails on any new one.
 */
export async function publishUnregisteredEventType(
  event: { eventType: string; payload: Record<string, unknown> },
  options?: PublishOptions
): Promise<void> {
  await publishEventUnchecked(event as { eventType: EventType; payload: Record<string, unknown> }, options);
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
  /** Must come from a registered builder (`builtWorkflowPayload(eventType, …)`); inline literals do not compile. */
  payload: BuiltWorkflowPayload<T>;
  ctx: WorkflowEventPublishContext;
  idempotencyKey?: string;
  eventName?: string;
  fromState?: string;
  toState?: string;
}, options?: Omit<PublishOptions, 'workflow'>): Promise<void> {
  const ctx = params.idempotencyKey ? { ...params.ctx, idempotencyKey: params.idempotencyKey } : params.ctx;
  const payload = buildWorkflowPayload(params.payload as Record<string, unknown>, ctx);
  const workflow: WorkflowPublishHooks = {
    // LEVERAGE: friction workflow-correlation-id — correlationId is copied into a UUID-only execution_id; callers with external ids fail the Zod parse after the fact
    executionId: ctx.correlationId,
    eventName: params.eventName,
    fromState: params.fromState,
    toState: params.toState,
  };

  await publishEventUnchecked({ eventType: params.eventType, payload }, { ...options, workflow });
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
    // LEVERAGE: friction workflow-correlation-id — correlationId is copied into a UUID-only execution_id; callers with external ids fail the Zod parse after the fact
    executionId: ctx.correlationId,
    eventName: params.eventName,
    fromState: params.fromState,
    toState: params.toState,
  };
  await publishEvent({ eventType: params.eventType, payload }, { ...options, workflow });
}

export type { WorkflowActor, WorkflowEventPublishContext } from '@alga-psa/event-schemas';
