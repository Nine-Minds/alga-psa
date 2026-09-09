import { describe, expect, it } from 'vitest';
import {
  calculateDraftQuoteTotals,
  createCustomDraftQuoteItem,
  createDraftDiscountQuoteItem,
  resolveDraftDiscountAmounts,
  type DraftQuoteItem,
} from './quoteLineItemDraft';

const asDraftItem = (item: DraftQuoteItem): DraftQuoteItem => item;

const serviceItem = (overrides: Partial<DraftQuoteItem> & { local_id: string }): DraftQuoteItem =>
  asDraftItem({
    service_id: `svc-${overrides.local_id}`,
    service_name: overrides.description ?? 'Service',
    description: overrides.description ?? 'Service',
    quantity: 1,
    unit_price: 0,
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

const customItem = (localId: string, unitPrice: number, overrides: Partial<DraftQuoteItem> = {}): DraftQuoteItem =>
  asDraftItem({
    ...createCustomDraftQuoteItem({ description: localId, unit_price: unitPrice, quantity: 1 }),
    local_id: localId,
    ...overrides,
  });

const fixedDiscount = (
  localId: string,
  amountMinor: number,
  overrides: Partial<DraftQuoteItem> = {}
): DraftQuoteItem =>
  asDraftItem({
    ...createDraftDiscountQuoteItem({
      description: `Discount ${localId}`,
      discount_type: 'fixed',
      fixed_amount: amountMinor,
    }),
    local_id: localId,
    ...overrides,
  });

describe('quoteLineItemDraft discount totals', () => {
  it('T004: baseline draft reproduces $50 monthly after two service-targeted $5 discounts', () => {
    const items = [
      serviceItem({ local_id: 'svc-a', description: 'Managed Support A', unit_price: 2500, is_recurring: true, billing_frequency: 'monthly' }),
      serviceItem({ local_id: 'svc-b', description: 'Managed Support B', unit_price: 3500, is_recurring: true, billing_frequency: 'monthly' }),
      fixedDiscount('disc-a', 500, { applies_to_service_id: 'svc-svc-a' }),
      fixedDiscount('disc-b', 500, { applies_to_service_id: 'svc-svc-b' }),
      customItem('onetime-0', 37353),
      customItem('onetime-1', 210863),
      customItem('onetime-2', 5581),
      customItem('onetime-3', 45000),
    ];

    const totals = calculateDraftQuoteTotals(items);

    expect(totals.subtotal).toBe(304797);
    expect(totals.discount_total).toBe(1000);
    expect(totals.tax).toBe(0);
    expect(totals.total_amount).toBe(303797);

    const amounts = resolveDraftDiscountAmounts(items);
    expect(amounts.get('disc-a')).toBe(500);
    expect(amounts.get('disc-b')).toBe(500);
  });

  it('T004: editing a discount target to a removed item resolves zero immediately', () => {
    const items = [
      serviceItem({ local_id: 'svc-a', description: 'Managed Support', unit_price: 2500, is_recurring: true, billing_frequency: 'monthly' }),
      fixedDiscount('disc-a', 500, { applies_to_item_id: 'svc-a' }),
    ];

    // The item is removed from the quote.
    const withoutTarget = items.filter((item) => item.local_id !== 'svc-a');
    const totals = calculateDraftQuoteTotals(withoutTarget);
    const amounts = resolveDraftDiscountAmounts(withoutTarget);

    expect(totals.discount_total).toBe(0);
    expect(amounts.get('disc-a')).toBe(0);
  });

  it('T004: optional unselected items contribute neither base nor allocation', () => {
    const items = [
      serviceItem({ local_id: 'svc-a', description: 'Managed Support', unit_price: 2500, is_recurring: true, billing_frequency: 'monthly' }),
      serviceItem({ local_id: 'svc-opt', description: 'Optional service', unit_price: 4000, is_recurring: true, billing_frequency: 'monthly', is_optional: true, is_selected: false }),
      fixedDiscount('disc-whole', 500),
    ];

    const totals = calculateDraftQuoteTotals(items);

    expect(totals.subtotal).toBe(2500);
    expect(totals.discount_total).toBe(500);
    expect(totals.total_amount).toBe(2000);
  });

  it('T004: editing price or quantity recomputes the derived discount total', () => {
    const base = (price: number) => [
      serviceItem({ local_id: 'svc-a', description: 'Managed Support', unit_price: price, is_recurring: true, billing_frequency: 'monthly' }),
      fixedDiscount('disc-a', 500, { applies_to_service_id: 'svc-svc-a' }),
    ];

    expect(calculateDraftQuoteTotals(base(2500)).total_amount).toBe(2500 - 500);
    // Raising the price above the discount keeps the full discount.
    expect(calculateDraftQuoteTotals(base(10000)).total_amount).toBe(10000 - 500);
    // Lowering the price below the discount caps the discount at the base.
    const capped = calculateDraftQuoteTotals(base(300));
    expect(capped.discount_total).toBe(300);
    expect(capped.total_amount).toBe(0);
  });

  it('T004: percentage discounts recompute from the eligible base on edit', () => {
    const items = [
      serviceItem({ local_id: 'svc-a', description: 'Managed Support', unit_price: 2500, is_recurring: true, billing_frequency: 'monthly' }),
      serviceItem({ local_id: 'svc-b', description: 'Managed Support B', unit_price: 3500, is_recurring: true, billing_frequency: 'monthly' }),
      {
        ...createDraftDiscountQuoteItem({
          description: '10% discount',
          discount_type: 'percentage',
          discount_percentage: 10,
        }),
        local_id: 'disc-pct',
        applies_to_service_id: 'svc-svc-a',
      } as DraftQuoteItem,
    ];

    const totals = calculateDraftQuoteTotals(items);
    expect(totals.discount_total).toBe(250); // 10% of the $25 service
    expect(totals.total_amount).toBe(6000 - 250);
  });
});
