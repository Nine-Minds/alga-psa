import { describe, expect, it } from 'vitest';
import type { QuoteViewModel, QuoteViewModelLineItem } from './quote.interfaces';

type QuoteLineItemKindMatches =
  QuoteViewModelLineItem['service_item_kind'] extends 'service' | 'product' | null | undefined ? true : false;
type QuoteRecurringItemsMatch =
  QuoteViewModel['recurring_items'] extends QuoteViewModelLineItem[] | undefined ? true : false;
type QuoteAggregateFieldMatches =
  QuoteViewModel['recurring_total'] extends number | undefined ? true : false;

const quoteViewModelChecks = {
  lineItemKindMatches: true as QuoteLineItemKindMatches,
  recurringItemsMatch: true as QuoteRecurringItemsMatch,
  aggregateFieldMatches: true as QuoteAggregateFieldMatches,
};

describe('QuoteViewModel typing contract', () => {
  it('exposes filtered item arrays and aggregate fields used by quote template bindings', () => {
    const quote: QuoteViewModel = {
      quote_id: 'quote-1',
      quote_number: 'QT-001',
      title: 'Managed Services Proposal',
      version: 1,
      currency_code: 'USD',
      subtotal: 10000,
      discount_total: 0,
      tax: 800,
      total_amount: 10800,
      line_items: [],
      recurring_items: [],
      onetime_items: [],
      service_items: [],
      product_items: [],
      recurring_subtotal: 10000,
      recurring_tax: 800,
      recurring_total: 10800,
      onetime_subtotal: 0,
      onetime_tax: 0,
      onetime_total: 0,
      service_subtotal: 10000,
      service_tax: 800,
      service_total: 10800,
      product_subtotal: 0,
      product_tax: 0,
      product_total: 0,
    };

    expect(quote.recurring_items).toEqual([]);
    expect(quote.recurring_total).toBe(10800);
    expect(quote.product_total).toBe(0);
    expect(quoteViewModelChecks.lineItemKindMatches).toBe(true);
    expect(quoteViewModelChecks.recurringItemsMatch).toBe(true);
    expect(quoteViewModelChecks.aggregateFieldMatches).toBe(true);
  });
});
