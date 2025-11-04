import logger from '@shared/core/logger';
import { Event } from '../events';
import { getEventBus } from '../index';
import { getEmailEventChannel } from '../../notifications/emailChannel';

export interface PublishOptions {
  channel?: string;
}

const EMAIL_EVENT_TYPES = new Set<Event['eventType']>([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_ASSIGNED',
  'TICKET_COMMENT_ADDED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED'
]);

const INTERNAL_NOTIFICATION_EVENT_TYPES = new Set<Event['eventType']>([
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_COMMENT_ADDED',
  'PROJECT_CREATED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'INVOICE_GENERATED',
  'MESSAGE_SENT',
  'USER_MENTIONED_IN_DOCUMENT'
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
    await getEventBus().publish(event);

    // If this is an internal notification event, publish to the internal-notifications channel
    if (isInternalNotificationEvent && !channel) {
      await getEventBus().publish(event, { channel: 'internal-notifications' });
    }

    // If this is an email event type and no specific channel was provided,
    // also publish to the email channel for email notifications
    if (isEmailEvent && !channel) {
      await getEventBus().publish(event, { channel: getEmailEventChannel() });
    } else if (channel) {
      // If a specific channel was provided, publish to that channel as well
      await getEventBus().publish(event, { channel });
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
