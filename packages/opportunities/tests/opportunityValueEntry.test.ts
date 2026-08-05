import { describe, expect, it } from 'vitest';
import {
  amountsToCents,
  centsToAmounts,
} from '../src/components/dialogs/OpportunityValueFields';

describe('shared opportunity value entry', () => {
  it('converts major units with the chosen currency, not a hardcoded factor', () => {
    expect(amountsToCents({ mrr: 1000, nrr: 600, hardware: 400 }, 'USD')).toEqual({
      mrr_cents: 100000,
      nrr_cents: 60000,
      hardware_cents: 40000,
    });
    // Yen has no minor unit: 1000 JPY is 1000, not 100000.
    expect(amountsToCents({ mrr: 1000 }, 'JPY').mrr_cents).toBe(1000);
  });

  it('round-trips cents back to the amounts the user typed', () => {
    const amounts = { mrr: 1234.5, nrr: 0, hardware: 99 };
    expect(centsToAmounts(amountsToCents(amounts, 'GBP') as never, 'GBP')).toEqual(amounts);
  });

  it('treats omitted fields as zero cents', () => {
    expect(amountsToCents({}, 'USD')).toEqual({ mrr_cents: 0, nrr_cents: 0, hardware_cents: 0 });
  });
});

// The per-currency aggregation contract ("no total ever mixes currencies") is
// pinned behaviorally where the aggregations live: pipelineReporting.test.ts,
// workQueueActions.test.ts, and the EE forecast/rollup unit tests.
