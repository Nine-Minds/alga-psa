import { describe, expect, it } from 'vitest';

import { isPendingOptional, isQuoteItemIncluded, isSelected } from './quoteItemInclusion';
import { allocateIncludedQuoteDiscounts, buildQuoteDiscountAllocationInputs, summarizeQuoteTotals } from './quoteTotals';

type Row = {
  id: string;
  quantity: number;
  unit_price: number;
  is_optional?: boolean;
  is_selected?: boolean | null;
  is_discount?: boolean;
  is_recurring?: boolean;
  tax_rate?: number;
  discount_type?: 'fixed' | 'percentage';
  applies_to_item_id?: string | null;
};

// alga-2026-0002383 fixture: required $759 at 6% plus optional monthly $40 and
// optional annual $50. Selection states drive which add-ons count.
const fixture = (selection: { monthly: boolean | null; annual: boolean | null }, withOptionals = true): Row[] => [
  { id: 'monthly-req', quantity: 1, unit_price: 10000, is_recurring: true, tax_rate: 6 },
  { id: 'annual-req', quantity: 1, unit_price: 15900, is_recurring: true, tax_rate: 6 },
  { id: 'onetime-req', quantity: 1, unit_price: 50000, tax_rate: 6 },
  ...(withOptionals
    ? [
        { id: 'monthly-opt', quantity: 1, unit_price: 4000, is_recurring: true, tax_rate: 6, is_optional: true, is_selected: selection.monthly },
        { id: 'annual-opt', quantity: 1, unit_price: 5000, is_recurring: true, tax_rate: 6, is_optional: true, is_selected: selection.annual },
      ]
    : []),
];

const taxOf = (row: Row): number => Math.ceil((row.quantity * row.unit_price * (row.tax_rate ?? 0)) / 100);
const summarize = (rows: Row[]) =>
  summarizeQuoteTotals(rows, {
    amountOf: (row) => row.quantity * row.unit_price,
    taxOf,
    discountTotal: allocateIncludedQuoteDiscounts(rows, (row) => row.id).totalDiscount,
  });

describe('quoteItemInclusion', () => {
  it('counts required rows always and optional rows only while selected', () => {
    expect(isQuoteItemIncluded({ is_optional: false, is_selected: false })).toBe(true);
    expect(isQuoteItemIncluded({ is_optional: true, is_selected: true })).toBe(true);
    expect(isQuoteItemIncluded({ is_optional: true, is_selected: false })).toBe(false);
    // Only `true` is a selection: null/undefined never counts an add-on.
    expect(isQuoteItemIncluded({ is_optional: true, is_selected: null })).toBe(false);
    expect(isQuoteItemIncluded({ is_optional: true })).toBe(false);
    expect(isSelected({ is_selected: undefined })).toBe(false);
  });

  it('treats an unselected optional row as pending and never a required one', () => {
    expect(isPendingOptional({ is_optional: true, is_selected: false })).toBe(true);
    expect(isPendingOptional({ is_optional: true, is_selected: true })).toBe(false);
    expect(isPendingOptional({ is_optional: false, is_selected: false })).toBe(false);
  });
});

describe('summarizeQuoteTotals (alga-2026-0002383 one source of truth)', () => {
  it.each([
    ['no optional items', fixture({ monthly: false, annual: false }, false), { subtotal: 75900, tax: 4554, total: 80454, optional: 0 }],
    ['none selected', fixture({ monthly: false, annual: false }), { subtotal: 75900, tax: 4554, total: 80454, optional: 9540 }],
    ['some selected (monthly only)', fixture({ monthly: true, annual: false }), { subtotal: 79900, tax: 4794, total: 84694, optional: 5300 }],
    ['all selected', fixture({ monthly: true, annual: true }), { subtotal: 84900, tax: 5094, total: 89994, optional: 0 }],
  ])('%s: total = required + selected optional (price + tax); pending add-ons are the if-selected bucket', (_label, rows, expected) => {
    const totals = summarize(rows);
    expect(totals.subtotal).toBe(expected.subtotal);
    expect(totals.discount_total).toBe(0);
    expect(totals.tax).toBe(expected.tax);
    expect(totals.total_amount).toBe(expected.total);
    expect(totals.optional_total).toBe(expected.optional);
    expect(totals.optional_total).toBe(totals.optional_subtotal + totals.optional_tax);
  });

  it('allocates discounts across included bases only, so a pending add-on absorbs none', () => {
    const rows: Row[] = [
      ...fixture({ monthly: true, annual: false }),
      { id: 'disc', quantity: 1, unit_price: 1000, is_discount: true, discount_type: 'fixed', applies_to_item_id: 'annual-opt' },
    ];
    const { bases, discounts } = buildQuoteDiscountAllocationInputs(rows, (row) => row.id);
    expect(bases.map((base) => base.id)).toEqual(['monthly-req', 'annual-req', 'onetime-req', 'monthly-opt']);
    expect(discounts).toHaveLength(1);

    // The discount targets the pending annual add-on: it cannot resolve until
    // that row is selected, so the total and the if-selected figure both
    // ignore it.
    const totals = summarize(rows);
    expect(totals.discount_total).toBe(0);
    expect(totals.total_amount).toBe(84694);
    expect(totals.optional_total).toBe(5300);

    const selected = summarize(rows.map((row) => (row.id === 'annual-opt' ? { ...row, is_selected: true } : row)));
    expect(selected.discount_total).toBe(1000);
    expect(selected.total_amount).toBe(88994);
    expect(selected.optional_total).toBe(0);
  });

  it('never lets a discount row count as a base or a pending add-on', () => {
    const rows: Row[] = [
      { id: 'req', quantity: 1, unit_price: 10000 },
      { id: 'disc', quantity: 1, unit_price: 2000, is_discount: true, discount_type: 'fixed', is_optional: true, is_selected: false },
    ];
    const totals = summarize(rows);
    expect(totals.subtotal).toBe(10000);
    expect(totals.optional_subtotal).toBe(0);
  });
});
