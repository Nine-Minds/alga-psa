import logger from '@alga-psa/core/logger';
import { getEventBus } from '@alga-psa/event-bus';
import type { Event } from '@alga-psa/event-schemas';

export async function publishEvent(event: Omit<Event, 'id' | 'timestamp'>): Promise<void> {
  try {
    await getEventBus().publish(event as any);
  } catch (error) {
    logger.error('[CalendarEventPublisher] Failed to publish event', {
      error,
      eventType: event.eventType,
    });
    throw error;
  }
}
