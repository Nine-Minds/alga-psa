import { describe, expect, it } from 'vitest';
import type { PublicQuoteReviewItem } from './PublicQuoteReview';
import { computePublicQuotePreview } from './publicQuotePreview';

const items: PublicQuoteReviewItem[] = [
  {
    publicRef: 'item-0', locationRef: null, description: 'Firewall',
    quantity: 1, unit_price: 1000, total_price: 1000, display_order: 0,
    is_optional: false, is_selected: true, tax_amount_if_included: 100,
  },
  {
    publicRef: 'item-1', locationRef: 'location-0', description: 'Support',
    quantity: 2, unit_price: 500, total_price: 1000, display_order: 1,
    is_optional: true, is_selected: false, tax_amount_if_included: 200,
  },
];

function previewRows(selected: boolean) {
  return items.map((item) => ({
    ...item,
    quote_item_id: item.publicRef,
    location_id: item.locationRef,
    is_selected: item.is_optional ? selected : item.is_selected,
  }));
}

describe('public quote preview', () => {
  it('computes selection totals and location subtotals from the public projection', () => {
    expect(computePublicQuotePreview(previewRows(false))).toMatchObject({
      subtotal: 1000, tax: 100, totalAmount: 1100,
    });
    const selected = computePublicQuotePreview(previewRows(true));
    expect(selected).toMatchObject({ subtotal: 2000, tax: 300, totalAmount: 2300 });
    expect(selected?.perGroup.get('location-0')).toEqual({
      subtotal: 1000, discountTotal: 0, tax: 200, totalAmount: 1200,
    });
    expect(selected?.perGroup.get('__unassigned__')).toEqual({
      subtotal: 1000, discountTotal: 0, tax: 100, totalAmount: 1100,
    });
  });

  it('falls back to persisted totals when a public row lacks resolved tax', () => {
    const rows = previewRows(true);
    delete rows[1].tax_amount_if_included;
    expect(computePublicQuotePreview(rows)).toBeNull();
  });
});
