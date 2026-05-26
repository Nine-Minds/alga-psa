import { describe, expect, it } from 'vitest';
import type { EventType } from '@alga-psa/event-schemas';

import { allIndexers } from '../../lib/search';
import {
  getSearchIndexSubscriberEventTypes,
  resolveSearchIndexersForEvent,
} from '../../lib/eventBus/subscribers/searchIndexSubscriber';

describe('search index subscriber registration', () => {
  it('T069 subscribes to the union of registered indexer source events', () => {
    const indexers = allIndexers();
    const expectedEventTypes = Array.from(
      new Set(indexers.flatMap((indexer) => indexer.sourceEvents)),
    ).sort();

    expect(getSearchIndexSubscriberEventTypes().sort()).toEqual(expectedEventTypes);

    for (const eventType of expectedEventTypes as EventType[]) {
      const expectedObjectTypes = indexers
        .filter((indexer) => indexer.sourceEvents.includes(eventType))
        .map((indexer) => indexer.objectType)
        .sort();

      expect(resolveSearchIndexersForEvent(eventType).map((indexer) => indexer.objectType).sort())
        .toEqual(expectedObjectTypes);
    }
  });
});
