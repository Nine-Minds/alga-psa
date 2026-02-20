import { describe, expect, it } from 'vitest';
import { EntraSyncResultAggregator } from '@ee/lib/integrations/entra/sync/syncResultAggregator';

describe('EntraSyncResultAggregator', () => {
  it('T108: tracks created counter accurately across increment and add operations', () => {
    const aggregator = new EntraSyncResultAggregator();

    aggregator.increment('created');
    aggregator.increment('created', 2);
    aggregator.add({ created: 3 });
    aggregator.increment('created', 0);
    aggregator.increment('created', -5);

    expect(aggregator.toJSON()).toEqual({
      created: 6,
      linked: 0,
      updated: 0,
      ambiguous: 0,
      inactivated: 0,
    });
  });

  it('T109: tracks linked counter accurately across increment and add operations', () => {
    const aggregator = new EntraSyncResultAggregator();

    aggregator.increment('linked', 2);
    aggregator.add({ linked: 4 });
    aggregator.increment('linked');
    aggregator.increment('linked', NaN);

    expect(aggregator.toJSON()).toEqual({
      created: 0,
      linked: 7,
      updated: 0,
      ambiguous: 0,
      inactivated: 0,
    });
  });
});
