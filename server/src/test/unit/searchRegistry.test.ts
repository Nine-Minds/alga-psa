import { describe, expect, it } from 'vitest';

import { allIndexers, getIndexer, registeredObjectTypes } from '../../lib/search';

describe('search indexer registry', () => {
  it('T022 exposes the CE indexer set and resolves the client indexer', () => {
    const indexers = allIndexers();
    const objectTypes = registeredObjectTypes();

    expect(indexers).toHaveLength(27);
    expect(new Set(indexers.map((indexer) => indexer.objectType)).size).toBe(27);
    expect(objectTypes).toHaveLength(27);
    expect(objectTypes).toContain('client');
    expect(getIndexer('client')?.objectType).toBe('client');
  });
});
