import { Event } from '../events';
import { getEventBus } from '../index';
import logger from '@shared/core/logger';

export async function publishEvent(event: Omit<Event, 'id' | 'timestamp'>): Promise<void> {
  try {
    await getEventBus().publish(event);
  } catch (error) {
    logger.error('[EventPublisher] Failed to publish event:', {
      error,
      eventType: event.eventType
    });
    throw error;
  }
}
