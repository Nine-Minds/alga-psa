import logger from '@alga-psa/core/logger';
import { Event } from '../events';
import { getEventBus } from '../index';
import { getEmailEventChannel } from '../../notifications/emailChannel';
import { buildWorkflowPayload, type WorkflowEventPublishContext } from '@shared/workflow/streams/workflowEventPublishHelpers';
import type { WorkflowPublishHooks } from '@shared/workflow/streams/eventBusSchema';

export interface PublishOptions {
  channel?: string;
  workflow?: WorkflowPublishHooks;
}

const EMAIL_EVENT_TYPES = new Set<Event['eventType']>([
  'TICKET_CREATED',
  'TICKET_UPDATED',
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
  'APPOINTMENT_REQUEST_CANCELLED'
]);

export async function publishEvent(
  event: Omit<Event, 'id' | 'timestamp'>,
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

export async function publishWorkflowEvent(params: {
  eventType: Event['eventType'];
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

  await publishEvent(
    { eventType: params.eventType, payload } as any,
    { ...options, workflow }
  );
}

export type { WorkflowActor, WorkflowEventPublishContext } from '@shared/workflow/streams/workflowEventPublishHelpers';
