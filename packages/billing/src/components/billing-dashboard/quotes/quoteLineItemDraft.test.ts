import { describe, expect, it } from 'vitest';

import {
  calculateDraftRecurringMonthlySubtotal,
  createDraftDiscountQuoteItem,
  type DraftQuoteItem,
} from './quoteLineItemDraft';

const buildDraftItem = (overrides: Partial<DraftQuoteItem> & { local_id: string }): DraftQuoteItem => ({
  service_id: null,
  service_item_kind: null,
  service_name: null,
  service_sku: null,
  billing_method: null,
  description: 'Item',
  quantity: 1,
  unit_price: 0,
  unit_of_measure: null,
  phase: null,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  billing_frequency: null,
  is_discount: false,
  discount_type: null,
  discount_percentage: null,
  applies_to_item_id: null,
  applies_to_service_id: null,
  is_taxable: true,
  tax_region: null,
  tax_rate: null,
  location_id: null,
  ...overrides,
});

describe('calculateDraftRecurringMonthlySubtotal', () => {
  it('subtracts fixed and percentage discounts that target monthly items', () => {
    const items: DraftQuoteItem[] = [
      buildDraftItem({
        local_id: 'monthly-a',
        service_id: 'service-a',
        unit_price: 3000,
        is_recurring: true,
        billing_frequency: 'monthly',
      }),
      buildDraftItem({
        local_id: 'monthly-b',
        service_id: 'service-b',
        unit_price: 3000,
        is_recurring: true,
        billing_frequency: 'monthly',
      }),
      buildDraftItem({ local_id: 'onetime', unit_price: 20000 }),
      buildDraftItem({
        local_id: 'discount-item',
        description: 'Discount',
        unit_price: 500,
        is_discount: true,
        discount_type: 'fixed',
        applies_to_item_id: 'monthly-a',
      }),
      buildDraftItem({
        local_id: 'discount-service',
        description: 'Discount (16%)',
        is_discount: true,
        discount_type: 'percentage',
        discount_percentage: 16,
        applies_to_service_id: 'service-b',
      }),
    ];

    // $30 + $30 − $5.00 − $4.80
    expect(calculateDraftRecurringMonthlySubtotal(items)).toBe(5020);
  });

  it('ignores discounts on one-time items and quote-wide discounts', () => {
    const items: DraftQuoteItem[] = [
      buildDraftItem({
        local_id: 'monthly-a',
        unit_price: 3000,
        is_recurring: true,
        billing_frequency: 'monthly',
      }),
      buildDraftItem({ local_id: 'onetime', unit_price: 20000 }),
      buildDraftItem({
        local_id: 'discount-onetime',
        description: 'Discount',
        unit_price: 2500,
        is_discount: true,
        discount_type: 'fixed',
        applies_to_item_id: 'onetime',
      }),
      buildDraftItem({
        local_id: 'discount-quote-wide',
        description: 'Discount (10%)',
        is_discount: true,
        discount_type: 'percentage',
        discount_percentage: 10,
      }),
    ];

    expect(calculateDraftRecurringMonthlySubtotal(items)).toBe(3000);
  });

  it('skips unselected optional items and non-monthly frequencies', () => {
    const items: DraftQuoteItem[] = [
      buildDraftItem({
        local_id: 'monthly-a',
        unit_price: 3000,
        is_recurring: true,
        billing_frequency: 'monthly',
      }),
      buildDraftItem({
        local_id: 'quarterly',
        unit_price: 9000,
        is_recurring: true,
        billing_frequency: 'quarterly',
      }),
      buildDraftItem({
        local_id: 'monthly-optional',
        unit_price: 1500,
        is_recurring: true,
        billing_frequency: 'monthly',
        is_optional: true,
        is_selected: false,
      }),
    ];

    expect(calculateDraftRecurringMonthlySubtotal(items)).toBe(3000);
  });
});

describe('createDraftDiscountQuoteItem', () => {
  it('carries the discounted item cadence onto the discount row', () => {
    const discount = createDraftDiscountQuoteItem({
      description: 'Discount',
      discount_type: 'fixed',
      fixed_amount: 500,
      applies_to_item_id: 'monthly-a',
      is_recurring: true,
      billing_frequency: 'monthly',
    });

    expect(discount.is_recurring).toBe(true);
    expect(discount.billing_frequency).toBe('monthly');
  });

  it('defaults to one-time when the discount has no recurring target', () => {
    const discount = createDraftDiscountQuoteItem({
      description: 'Discount (10%)',
      discount_type: 'percentage',
      discount_percentage: 10,
    });

    expect(discount.is_recurring).toBe(false);
    expect(discount.billing_frequency).toBeNull();
  });
});
