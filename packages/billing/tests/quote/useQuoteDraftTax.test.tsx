// @vitest-environment jsdom

/**
 * alga-2026-0003321: the editor never computes tax. The hook asks the server
 * action (debounced), keeps the last engine result while a newer request is in
 * flight, and drops a response a newer edit has superseded.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calculateQuoteDraftTax = vi.hoisted(() => vi.fn());
vi.mock('../../src/actions/quoteActions', () => ({ calculateQuoteDraftTax }));

import { QUOTE_DRAFT_TAX_DEBOUNCE_MS, useQuoteDraftTax } from '../../src/components/billing-dashboard/quotes/useQuoteDraftTax';
import type { DraftQuoteItem } from '../../src/components/billing-dashboard/quotes/quoteLineItemDraft';

const item = (overrides: Partial<DraftQuoteItem> = {}): DraftQuoteItem => ({
  local_id: 'a',
  quote_item_id: 'a',
  description: 'Managed service',
  quantity: 1,
  unit_price: 100000,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  is_taxable: true,
  tax_rate: 10, // stale persisted rate: must never be multiplied client-side
  ...overrides,
} as DraftQuoteItem);

const result = (tax: number, total: number) => ({
  rows: { a: { taxAmount: tax, taxPercentage: 10, taxRegion: 'QTX-CAP', taxUnresolved: false } },
  totals: { subtotal: total - tax, discount_total: 0, tax, total_amount: total, optional_subtotal: 0, optional_tax: 0, optional_total: 0 },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};

const flush = async (ms = QUOTE_DRAFT_TAX_DEBOUNCE_MS) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useQuoteDraftTax', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calculateQuoteDraftTax.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('returns exactly the action figures (capped tax), with no client-side rate math', async () => {
    calculateQuoteDraftTax.mockResolvedValue(result(3500, 113500));
    const { result: hook } = renderHook(() =>
      useQuoteDraftTax({ items: [item(), item({ local_id: 'b', quote_item_id: 'b', unit_price: 10000 })], clientId: 'c1', currencyCode: 'USD' }),
    );
    expect(hook.current.result).toBeNull();

    await flush();

    expect(hook.current.result?.totals.tax).toBe(3500);
    expect(hook.current.result?.totals.total_amount).toBe(113500);
    expect(hook.current.isLoading).toBe(false);
    expect(calculateQuoteDraftTax).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid edits into one request', async () => {
    calculateQuoteDraftTax.mockResolvedValue(result(3500, 113500));
    const { rerender } = renderHook(
      ({ price }) => useQuoteDraftTax({ items: [item({ unit_price: price })], clientId: 'c1', currencyCode: 'USD' }),
      { initialProps: { price: 100000 } },
    );
    await flush(100);
    rerender({ price: 110000 });
    await flush(100);
    rerender({ price: 120000 });
    await flush();

    expect(calculateQuoteDraftTax).toHaveBeenCalledTimes(1);
    expect(calculateQuoteDraftTax.mock.calls[0][0].items[0].unit_price).toBe(120000);
  });

  it('keeps the last engine result while a newer request is in flight and drops superseded responses', async () => {
    calculateQuoteDraftTax.mockResolvedValueOnce(result(3500, 113500));
    const { result: hook, rerender } = renderHook(
      ({ price }) => useQuoteDraftTax({ items: [item({ unit_price: price })], clientId: 'c1', currencyCode: 'USD' }),
      { initialProps: { price: 100000 } },
    );
    await flush();
    expect(hook.current.result?.totals.total_amount).toBe(113500);

    const slow = deferred<ReturnType<typeof result>>();
    calculateQuoteDraftTax.mockReturnValueOnce(slow.promise);
    rerender({ price: 200000 });
    await flush();
    // In flight: previous engine figures stay, flagged as loading.
    expect(hook.current.isLoading).toBe(true);
    expect(hook.current.result?.totals.total_amount).toBe(113500);

    const fast = deferred<ReturnType<typeof result>>();
    calculateQuoteDraftTax.mockReturnValueOnce(fast.promise);
    rerender({ price: 300000 });
    await flush();
    await act(async () => { fast.resolve(result(2500, 302500)); });
    expect(hook.current.result?.totals.total_amount).toBe(302500);
    await act(async () => { slow.resolve(result(1, 2)); });
    expect(hook.current.result?.totals.total_amount).toBe(302500);
    expect(hook.current.isLoading).toBe(false);
  });
});
