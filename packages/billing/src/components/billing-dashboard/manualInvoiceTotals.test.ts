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

  it('preserves fixed discounts and quantity-derived credits', () => {
    expect(calculateManualInvoiceEditorTotal([
      { item_id: 'charge', quantity: 1, rate: 10000 },
      { item_id: 'fixed', quantity: 1, rate: 500, is_discount: true, discount_type: 'fixed' },
      { item_id: 'credit', quantity: 3, rate: -100, is_discount: true, discount_type: 'fixed', is_manual_credit: true },
    ])).toBe(9200);
  });
});
