import logger from '@alga-psa/core/logger';
import type { Event, EventType } from '@alga-psa/event-schemas';

import { getEventBus } from '../index';
import { allIndexers } from '../../search';
import type { EntityIndexer } from '../../search/types';

let isRegistered = false;
let subscribedEventTypes: EventType[] = [];

function buildIndexersByEvent(): Map<EventType, EntityIndexer[]> {
  const byEvent = new Map<EventType, EntityIndexer[]>();

  for (const indexer of allIndexers()) {
    for (const eventType of indexer.sourceEvents) {
      const existing = byEvent.get(eventType) ?? [];
      existing.push(indexer);
      byEvent.set(eventType, existing);
    }
  }

  return byEvent;
}

export function resolveSearchIndexersForEvent(eventType: EventType): EntityIndexer[] {
  return buildIndexersByEvent().get(eventType) ?? [];
}

export async function registerSearchIndexSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  const indexersByEvent = buildIndexersByEvent();
  subscribedEventTypes = [...indexersByEvent.keys()];

  for (const eventType of subscribedEventTypes) {
    await getEventBus().subscribe(eventType, handleSearchIndexEvent);
  }

  isRegistered = true;
  logger.info('[SearchIndexSubscriber] Registered search index subscriber', {
    eventTypes: subscribedEventTypes,
  });
}

export async function unregisterSearchIndexSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  for (const eventType of subscribedEventTypes) {
    await getEventBus().unsubscribe(eventType, handleSearchIndexEvent);
  }

  const eventTypes = subscribedEventTypes;
  subscribedEventTypes = [];
  isRegistered = false;
  logger.info('[SearchIndexSubscriber] Unregistered search index subscriber', { eventTypes });
}

async function handleSearchIndexEvent(event: Event): Promise<void> {
  const indexers = resolveSearchIndexersForEvent(event.eventType);

  if (indexers.length === 0) {
    logger.warn('[SearchIndexSubscriber] Received event without a registered indexer', {
      eventType: event.eventType,
      eventId: event.id,
    });
    return;
  }

  logger.debug('[SearchIndexSubscriber] Resolved event to search indexers', {
    eventType: event.eventType,
    eventId: event.id,
    objectTypes: indexers.map((indexer) => indexer.objectType),
  });
}
