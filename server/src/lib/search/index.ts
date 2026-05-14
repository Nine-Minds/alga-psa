import { eeIndexers } from '@ee/lib/search/indexers';

import { ceIndexers } from './indexers';
import type { EntityIndexer } from './types';

const registry = new Map<string, EntityIndexer>(
  [...ceIndexers, ...eeIndexers].map((indexer) => [indexer.objectType, indexer]),
);

export function getIndexer(objectType: string): EntityIndexer | undefined {
  return registry.get(objectType);
}

export function allIndexers(): EntityIndexer[] {
  return [...registry.values()];
}

export function registeredObjectTypes(): string[] {
  return [...registry.keys()];
}
