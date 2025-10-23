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

export async function publishEvent(
  event: Omit<Event, 'id' | 'timestamp'>,
  options?: PublishOptions
): Promise<void> {
  try {
    const channel =
      options?.channel ??
      (EMAIL_EVENT_TYPES.has(event.eventType as Event['eventType'])
        ? getEmailEventChannel()
        : undefined);

    if (channel) {
      await getEventBus().publish(event, { channel });
    } else {
      await getEventBus().publish(event);
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
