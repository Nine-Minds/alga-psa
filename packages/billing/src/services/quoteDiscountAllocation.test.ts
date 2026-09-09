import { describe, expect, it } from 'vitest';
import {
  allocateQuoteDiscounts,
  type DiscountBaseItemInput,
  type QuoteDiscountInput,
} from './quoteDiscountAllocation';

const baseItem = (overrides: Partial<DiscountBaseItemInput> & { id: string }): DiscountBaseItemInput => ({
  serviceId: null,
  amount: 0,
  isRecurring: false,
  ...overrides,
});

const discount = (overrides: Partial<QuoteDiscountInput> & { id: string }): QuoteDiscountInput => ({
  discountType: 'fixed',
  fixedAmount: 0,
  discountPercentage: null,
  appliesToItemId: null,
  appliesToServiceId: null,
  ...overrides,
});

describe('allocateQuoteDiscounts', () => {
  it('allocates an item-targeted fixed discount only to the matching item', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-b', amount: 3500, isRecurring: true }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 500, appliesToItemId: 'item-a' }),
    ]);

    expect(result.totalDiscount).toBe(500);
    expect(result.discounts[0]?.resolvedAmount).toBe(500);
    expect(result.discounts[0]?.allocations).toEqual([
      { baseItemId: 'item-a', amount: 500, isRecurring: true },
    ]);
    expect(result.discounts[0]?.recurringAmount).toBe(500);
    expect(result.discounts[0]?.onetimeAmount).toBe(0);
  });

  it('allocates a service-targeted discount across every matching eligible item', () => {
    const bases = [
      baseItem({ id: 'item-a', serviceId: 'svc-1', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-b', serviceId: 'svc-1', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-c', serviceId: 'svc-2', amount: 3500, isRecurring: true }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 1000, appliesToServiceId: 'svc-1' }),
    ]);

    expect(result.totalDiscount).toBe(1000);
    // 1000 * 2500/5000 = 500 exactly for each.
    expect(result.discounts[0]?.allocations).toEqual([
      { baseItemId: 'item-a', amount: 500, isRecurring: true },
      { baseItemId: 'item-b', amount: 500, isRecurring: true },
    ]);
  });

  it('allocates a whole-quote discount across every eligible base item', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-b', amount: 3500, isRecurring: true }),
      baseItem({ id: 'item-c', amount: 4000, isRecurring: false }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 1000 }),
    ]);

    expect(result.totalDiscount).toBe(1000);
    // 1000 * 25/100, 35/100, 40/100 -> 250, 350, 400 exactly.
    expect(result.discounts[0]?.allocations).toEqual([
      { baseItemId: 'item-a', amount: 250, isRecurring: true },
      { baseItemId: 'item-b', amount: 350, isRecurring: true },
      { baseItemId: 'item-c', amount: 400, isRecurring: false },
    ]);
    expect(result.discounts[0]?.recurringAmount).toBe(600);
    expect(result.discounts[0]?.onetimeAmount).toBe(400);
  });

  it('computes percentage discounts with existing rounding before capping', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-b', amount: 3500, isRecurring: true }),
    ];
    // 10% of $60 = $6.00 (600), split 250/350 exactly.
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', discountType: 'percentage', discountPercentage: 10 }),
    ]);

    expect(result.totalDiscount).toBe(600);
    expect(result.discounts[0]?.allocations).toEqual([
      { baseItemId: 'item-a', amount: 250, isRecurring: true },
      { baseItemId: 'item-b', amount: 350, isRecurring: true },
    ]);
  });

  it('splits a mixed-cadence service target proportionally by base amount', () => {
    const bases = [
      baseItem({ id: 'rec-item', serviceId: 'svc-1', amount: 3000, isRecurring: true }),
      baseItem({ id: 'one-item', serviceId: 'svc-1', amount: 1000, isRecurring: false }),
    ];
    // $4 fixed on a service spanning $30 recurring + $10 onetime = $40 base.
    // Split is 3000/4000 and 1000/4000 of 400 -> 300 recurring / 100 onetime.
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 400, appliesToServiceId: 'svc-1' }),
    ]);

    expect(result.discounts[0]?.resolvedAmount).toBe(400);
    expect(result.discounts[0]?.recurringAmount).toBe(300);
    expect(result.discounts[0]?.onetimeAmount).toBe(100);
    expect(result.totalDiscount).toBe(400);
  });

  it('conserves integer cents with deterministic largest-remainder rounding', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-b', amount: 3500, isRecurring: true }),
    ];
    // 500 * 25/60 = 208.333..., 500 * 35/60 = 291.666...
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 500 }),
    ]);

    expect(result.totalDiscount).toBe(500);
    expect(result.discounts[0]?.allocations).toEqual([
      { baseItemId: 'item-a', amount: 208, isRecurring: true },
      { baseItemId: 'item-b', amount: 292, isRecurring: true },
    ]);
  });

  it('returns a stable allocation independent of base iteration order for exact splits', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-b', amount: 3500, isRecurring: true }),
    ];
    const once = allocateQuoteDiscounts(bases, [discount({ id: 'd', fixedAmount: 500 })]);
    const twice = allocateQuoteDiscounts(bases, [discount({ id: 'd', fixedAmount: 500 })]);

    expect(once).toEqual(twice);
  });

  it('allocates zero for removed or unmatched targets', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-missing-item', fixedAmount: 500, appliesToItemId: 'item-gone' }),
      discount({ id: 'disc-missing-service', fixedAmount: 500, appliesToServiceId: 'svc-gone' }),
    ]);

    expect(result.discounts[0]?.resolvedAmount).toBe(0);
    expect(result.discounts[0]?.allocations).toEqual([]);
    expect(result.discounts[1]?.resolvedAmount).toBe(0);
    expect(result.totalDiscount).toBe(0);
  });

  it('allocates zero when the only eligible base has a zero amount', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 0, isRecurring: true }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 500, appliesToItemId: 'item-a' }),
    ]);

    expect(result.discounts[0]?.resolvedAmount).toBe(0);
    expect(result.totalDiscount).toBe(0);
  });

  it('caps a fixed discount at the eligible base value', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 3000, appliesToItemId: 'item-a' }),
    ]);

    expect(result.totalDiscount).toBe(2500);
    expect(result.discounts[0]?.resolvedAmount).toBe(2500);
    expect(result.discounts[0]?.allocations).toEqual([
      { baseItemId: 'item-a', amount: 2500, isRecurring: true },
    ]);
  });

  it('caps stacked discounts so aggregate reductions never exceed the base', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 2000, appliesToItemId: 'item-a' }),
      discount({ id: 'disc-2', fixedAmount: 2000, appliesToItemId: 'item-a' }),
    ]);

    expect(result.discounts[0]?.resolvedAmount).toBe(2000);
    expect(result.discounts[1]?.resolvedAmount).toBe(500);
    expect(result.totalDiscount).toBe(2500);
  });

  it('does not let later whole-quote discounts double-apply consumed base value', () => {
    const bases = [
      baseItem({ id: 'item-a', amount: 2500, isRecurring: true }),
      baseItem({ id: 'item-b', amount: 3500, isRecurring: true }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 2500, appliesToItemId: 'item-a' }),
      discount({ id: 'disc-2', discountType: 'percentage', discountPercentage: 10 }),
    ]);

    // Whole-quote 10% nominal = 600 (existing rounding against the original
    // eligible base). item-a is fully consumed, so the entire 600 lands on
    // item-b and never pushes item-a below zero.
    expect(result.discounts[0]?.resolvedAmount).toBe(2500);
    expect(result.discounts[1]?.resolvedAmount).toBe(600);
    expect(result.discounts[1]?.allocations).toEqual([
      { baseItemId: 'item-b', amount: 600, isRecurring: true },
    ]);
    expect(result.totalDiscount).toBe(3100);
  });

  it('keeps discount cadence splits aligned with recurring membership of bases', () => {
    const bases = [
      baseItem({ id: 'rec-a', amount: 2500, isRecurring: true }),
      baseItem({ id: 'rec-b', amount: 3500, isRecurring: true }),
      baseItem({ id: 'one-c', amount: 5000, isRecurring: false }),
    ];
    const result = allocateQuoteDiscounts(bases, [
      discount({ id: 'disc-1', fixedAmount: 1000 }),
    ]);

    // 1000 split over a $110 base: rec-a 227, rec-b 318, one-c 455
    // (one-cent leftover to the largest remainder).
    expect(result.discounts[0]?.allocations).toEqual([
      { baseItemId: 'rec-a', amount: 227, isRecurring: true },
      { baseItemId: 'rec-b', amount: 318, isRecurring: true },
      { baseItemId: 'one-c', amount: 455, isRecurring: false },
    ]);
    expect(result.discounts[0]?.recurringAmount).toBe(545);
    expect(result.discounts[0]?.onetimeAmount).toBe(455);
  });
});
