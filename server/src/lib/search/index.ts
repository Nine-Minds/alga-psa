import { eeIndexers } from '@ee/lib/search/indexers';

import { ceIndexers } from './indexers';
import type { EntityIndexer } from '@alga-psa/types';

function buildRegistry(): Map<string, EntityIndexer> {
  return new Map<string, EntityIndexer>(
    [...ceIndexers, ...eeIndexers].map((indexer) => [indexer.objectType, indexer]),
  );
}

export function getIndexer(objectType: string): EntityIndexer | undefined {
  return buildRegistry().get(objectType);
}

export function allIndexers(): EntityIndexer[] {
  return [...buildRegistry().values()];
}

export function registeredObjectTypes(): string[] {
  return [...buildRegistry().keys()];
}
