import { describe, expect, it } from 'vitest';
import { calculateManualInvoiceEditorTotal } from './manualInvoiceTotals';

describe('manual invoice editor totals', () => {
  const generated = { item_id: 'generated', quantity: 1, rate: 390000, net_amount: 390000, is_manual: false, is_discount: false };

  it('shows $3,645 for generated $3,900 + manual $150 with a new invoice-wide 10% discount', () => {
    expect(calculateManualInvoiceEditorTotal([
      { item_id: 'manual', quantity: 1, rate: 15000, is_manual: true },
      { item_id: 'discount', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
    ], [generated]) + generated.net_amount).toBe(364500);
  });

  it('keeps a targeted percentage discount limited to its target even when generated charges exist', () => {
    expect(calculateManualInvoiceEditorTotal([
      { item_id: 'manual', quantity: 1, rate: 15000, is_manual: true },
      { item_id: 'discount', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10, applies_to_item_id: 'manual' },
    ], [generated]) + generated.net_amount).toBe(403500);
  });

  it('includes a charge entered in the same save only once in an invoice-wide percentage base', () => {
    expect(calculateManualInvoiceEditorTotal([
      { item_id: 'new-charge', quantity: 2, rate: 5000, is_manual: true },
      { item_id: 'discount', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
    ], [generated]) + generated.net_amount).toBe(360000);
  });

  it('matches server rounding for each fractional-cent percentage discount', () => {
    const smallGenerated = { item_id: 'generated-105', quantity: 1, rate: 105, net_amount: 105, is_manual: false, is_discount: false };
    const oneDiscount = calculateManualInvoiceEditorTotal([
      { item_id: 'discount-1', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
    ], [smallGenerated]);
    const twoDiscounts = calculateManualInvoiceEditorTotal([
      { item_id: 'discount-1', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
      { item_id: 'discount-2', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
    ], [smallGenerated]);

    expect(oneDiscount + 105).toBe(94);
    expect(twoDiscounts + 105).toBe(83);
  });

  it('rounds each editable charge to minor units before building the percentage base', () => {
    const total = calculateManualInvoiceEditorTotal([
      { item_id: 'fractional-charge', quantity: 1, rate: 105.4, is_manual: true },
      { item_id: 'discount', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10 },
    ]);

    // The server persists the charge as 105, then rounds its 10% discount to 11.
    expect(total).toBe(94);
  });

  it('does not use a removed manual target from the stale invoice projection', () => {
    const persistedManualTarget = {
      item_id: 'removed-target', quantity: 1, rate: 15000, net_amount: 15000,
      is_manual: true, is_discount: false,
    };
    const generatedCharge = { ...generated, net_amount: 390000, rate: 390000 };
    const total = calculateManualInvoiceEditorTotal([
      { ...persistedManualTarget, isRemoved: true },
      { item_id: 'discount', quantity: 1, rate: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10, applies_to_item_id: 'removed-target' },
    ], [persistedManualTarget, generatedCharge]);

    expect(total + generatedCharge.net_amount).toBe(390000);
  });

  it('preserves fixed discounts and quantity-derived credits', () => {
    expect(calculateManualInvoiceEditorTotal([
      { item_id: 'charge', quantity: 1, rate: 10000 },
      { item_id: 'fixed', quantity: 1, rate: 500, is_discount: true, discount_type: 'fixed' },
      { item_id: 'credit', quantity: 3, rate: -100, is_discount: true, discount_type: 'fixed', is_manual_credit: true },
    ])).toBe(9200);
  });
});
