import { describe, expect, it } from 'vitest';
import type { IQuoteItem } from '@alga-psa/types';
import { deriveAcceptedQuoteValues } from '../src/lib/quoteLifecycleHooks';
import { deriveOpportunityStage } from '../src/lib/stageEngine';

let sequence = 0;
const item = (overrides: Partial<IQuoteItem>): IQuoteItem => ({
  tenant: 'tenant-1', quote_item_id: `item-${++sequence}`, quote_id: 'quote-1', description: 'Line',
  quantity: 1, unit_price: 0, total_price: 0, net_amount: 0, tax_amount: 0, display_order: 0,
  is_optional: false, is_selected: true, is_recurring: false, ...overrides,
});

describe('quote lifecycle behavior', () => {
  it('derives recurring, hardware, and non-recurring values from selected accepted lines', () => {
    expect(deriveAcceptedQuoteValues([
      item({ net_amount: 12000, is_recurring: true, service_item_kind: 'service' }),
      item({ net_amount: 50000, service_item_kind: 'product' }),
      item({ net_amount: 8000, service_item_kind: 'service' }),
      item({ net_amount: 99999, is_selected: false, is_recurring: true }),
    ])).toEqual({ mrr_cents: 12000, nrr_cents: 8000, hardware_cents: 50000 });
  });

  it('derives the furthest active checkpoint and permits skipped checkpoints', () => {
    expect(deriveOpportunityStage({ status: 'open' }, [
      { checkpoint: 'proposed', corrected_at: null },
      { checkpoint: 'verbal', corrected_at: new Date().toISOString() },
    ])).toBe('proposed');
    expect(deriveOpportunityStage({ status: 'open' }, [{ checkpoint: 'verbal', corrected_at: null }])).toBe('verbal');
  });
});
