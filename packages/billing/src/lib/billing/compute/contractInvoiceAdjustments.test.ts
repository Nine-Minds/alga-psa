import { describe, expect, it } from 'vitest';
import {
  evaluateContractInvoiceAdjustments,
  type AutomaticDiscountPolicy,
  type InvoiceAdjustmentCharge,
} from './contractInvoiceAdjustments';

const charge = (overrides: Partial<InvoiceAdjustmentCharge>): InvoiceAdjustmentCharge => ({
  item_id: 'item',
  description: 'charge',
  quantity: 1,
  unit_price: 0,
  net_amount: 0,
  ...overrides,
});

const percentage = (overrides: Partial<AutomaticDiscountPolicy> = {}): AutomaticDiscountPolicy => ({
  discount_id: 'discount',
  discount_name: 'Ten percent',
  discount_type: 'percentage',
  value: 0.1,
  scope: 'invoice',
  ...overrides,
});

describe('evaluateContractInvoiceAdjustments', () => {
  it('excludes a negative true-up credit from the positive discount base while still netting it out', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'recurring', net_amount: 390000 }),
        charge({ item_id: 'mid-period', net_amount: -51613 }),
      ],
      automaticDiscounts: [percentage()],
    });

    expect(result.grossAmount).toBe(390000);
    expect(result.discounts).toHaveLength(1);
    // 10% of the positive base only, not 10% of 338387.
    expect(result.discounts[0].amount).toBe(39000);
    expect(result.discounts[0].base_amount).toBe(390000);
    expect(result.automaticDiscountAmount).toBe(39000);
    expect(result.netAmount).toBe(351000);
    // The credit is not in the positive base but still reduces the final
    // invoice amount (gross + credit - discount).
    expect(result.grossAmount + -51613 - result.automaticDiscountAmount).toBe(299387);
  });

  it('applies a positive true-up to the percentage and fixed discount bases exactly once', () => {
    const charges = [
      charge({ item_id: 'recurring', service_id: 'users', net_amount: 390000 }),
      charge({ item_id: 'mid-period', service_id: 'users', net_amount: 15484 }),
    ];
    const percent = evaluateContractInvoiceAdjustments({
      charges,
      automaticDiscounts: [percentage()],
    });
    expect(percent.grossAmount).toBe(405484);
    expect(percent.discounts[0].amount).toBe(40548);
    expect(percent.discounts[0].allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(40548);

    const fixed = evaluateContractInvoiceAdjustments({
      charges,
      automaticDiscounts: [percentage({ discount_id: 'fixed', discount_type: 'fixed', value: 10000 })],
    });
    expect(fixed.discounts[0].amount).toBe(10000);
    expect(fixed.netAmount).toBe(405484 - 10000);
  });

  it('honours configured priority order and service scope', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'users', service_id: 'users', net_amount: 100000 }),
        charge({ item_id: 'endpoints', service_id: 'endpoints', net_amount: 50000 }),
      ],
      automaticDiscounts: [
        percentage({ discount_id: 'service', scope: 'service', applies_to_service_id: 'users', priority: 1 }),
        percentage({ discount_id: 'invoice', priority: 2 }),
      ],
    });
    expect(result.discounts.map((discount) => discount.discount_id)).toEqual(['service', 'invoice']);
    expect(result.discounts[0].amount).toBe(10000); // 10% of 100000
    expect(result.discounts[1].amount).toBe(15000); // 10% of 150000 (unchanged base)
  });
});
