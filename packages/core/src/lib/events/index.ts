import type { EventPayload } from './publisher';

/**
 * @alga-psa/core - Events Module
 *
 * Event publishing system for Alga PSA.
 * Publishes events to the workflow engine via Redis streams.
 */

// Event Publisher
export async function publishEvent(event: EventPayload): Promise<string> {
  if (typeof window !== 'undefined') {
    throw new Error('publishEvent is not available on the client');
  }
  const { publishEvent: internalPublish } = await import('./publisher');
  return internalPublish(event);
}

export type { EventPayload } from './publisher';
