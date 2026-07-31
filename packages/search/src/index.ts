import { ceIndexers } from './indexers';
import type { EntityIndexer } from '@alga-psa/types';

// Additional indexers injected by edition-specific consumers (e.g. EE search
// indexers registered by the Next.js server). The shared package must not import
// `@ee`/`@enterprise` directly, so EE wires its indexers in at runtime via
// `registerIndexers`. CE indexers are always present.
const extraIndexers: EntityIndexer[] = [];

export function registerIndexers(indexers: EntityIndexer[]): void {
  for (const indexer of indexers) {
    if (!extraIndexers.some((existing) => existing.objectType === indexer.objectType)) {
      extraIndexers.push(indexer);
    }
  }
}

function buildRegistry(): Map<string, EntityIndexer> {
  return new Map<string, EntityIndexer>(
    [...ceIndexers, ...extraIndexers].map((indexer) => [indexer.objectType, indexer]),
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
