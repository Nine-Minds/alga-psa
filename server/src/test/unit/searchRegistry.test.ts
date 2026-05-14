import { describe, expect, it } from 'vitest';

import { eeIndexers } from '@ee/lib/search/indexers';
import { allIndexers, getIndexer, registeredObjectTypes } from '../../lib/search';
import { ceIndexers } from '../../lib/search/indexers';

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

  it('T200 resolves the CE eeIndexers stub to an empty array', () => {
    expect(eeIndexers).toEqual([]);
    expect(allIndexers()).toHaveLength(ceIndexers.length);
    expect(ceIndexers).toHaveLength(27);
  });
});
