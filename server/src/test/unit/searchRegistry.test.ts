import { describe, expect, it } from 'vitest';

import { eeIndexers } from '@ee/lib/search/indexers';
import { allIndexers, getIndexer, registeredObjectTypes } from '@alga-psa/search';
import { ceIndexers } from '@alga-psa/search/indexers';
import type { EntityIndexer } from '@alga-psa/types';

describe('search indexer registry', () => {
  it('T022 exposes the CE indexer set and resolves the client indexer', () => {
    const indexers = allIndexers();
    const objectTypes = registeredObjectTypes();

    expect(indexers).toHaveLength(31);
    expect(new Set(indexers.map((indexer) => indexer.objectType)).size).toBe(31);
    expect(objectTypes).toHaveLength(31);
    expect(objectTypes).toContain('client');
    expect(getIndexer('client')?.objectType).toBe('client');
  });

  it('T200 resolves the CE eeIndexers stub to an empty array', () => {
    expect(eeIndexers).toEqual([]);
    expect(allIndexers()).toHaveLength(ceIndexers.length);
    expect(ceIndexers).toHaveLength(31);
  });

  it('T201 reflects a synthetic indexer added to the CE indexer array', () => {
    const syntheticIndexer: EntityIndexer = {
      objectType: 'synthetic' as never,
      sourceEvents: [],
      loadOne: async () => null,
      loadBatch: async () => [],
    };

    ceIndexers.push(syntheticIndexer);
    try {
      expect(allIndexers()).toContain(syntheticIndexer);
      expect(getIndexer('synthetic')).toBe(syntheticIndexer);
      expect(registeredObjectTypes()).toContain('synthetic');
    } finally {
      ceIndexers.pop();
    }
  });
});
