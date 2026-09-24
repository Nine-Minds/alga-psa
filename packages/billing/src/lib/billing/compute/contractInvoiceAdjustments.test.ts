import { describe, expect, it } from 'vitest';

import {
  allocateByLargestRemainder,
  computePartialPeriodAmount,
  evaluateContractInvoiceAdjustments,
  normalizeDiscountValue,
  storedDiscountValueToPolicyValue,
  type AutomaticDiscountPolicy,
  type InvoiceAdjustmentCharge,
} from './contractInvoiceAdjustments';

const charge = (overrides: Partial<InvoiceAdjustmentCharge>): InvoiceAdjustmentCharge => ({
  item_id: 'item-default',
  description: 'Recurring service',
  quantity: 1,
  unit_price: 0,
  net_amount: 0,
  ...overrides,
});

const invoiceDiscount = (overrides: Partial<AutomaticDiscountPolicy> = {}): AutomaticDiscountPolicy => ({
  discount_id: 'discount-1',
  discount_name: 'Loyalty 10%',
  discount_type: 'percentage',
  value: 0.1,
  scope: 'invoice',
  ...overrides,
});

describe('computePartialPeriodAmount', () => {
  it('resolves 3 x $100 x 15/30 to $150 in minor units', () => {
    expect(
      computePartialPeriodAmount({ units: 3, unitPrice: 10_000, coveredDays: 15, fullPeriodDays: 30 }),
    ).toBe(15_000);
  });

  it('uses configured day-count boundaries rather than a fixed 30', () => {
    expect(
      computePartialPeriodAmount({ units: 1, unitPrice: 10_000, coveredDays: 7, fullPeriodDays: 28 }),
    ).toBe(2_500);
  });

  it('rounds once to integer minor units', () => {
    expect(
      computePartialPeriodAmount({ units: 1, unitPrice: 1_000, coveredDays: 1, fullPeriodDays: 3 }),
    ).toBe(333);
  });

  it('rejects a zero-length period', () => {
    expect(() =>
      computePartialPeriodAmount({ units: 1, unitPrice: 1_000, coveredDays: 1, fullPeriodDays: 0 }),
    ).toThrow(/fullPeriodDays/);
  });

  it('resolves a decrease as a signed credit through the same calculator', () => {
    expect(
      computePartialPeriodAmount({ units: 3, unitPrice: -10_000, coveredDays: 15, fullPeriodDays: 30 }),
    ).toBe(-15_000);
  });
});

describe('normalizeDiscountValue', () => {
  it('converts stored fractions to percentage units', () => {
    expect(normalizeDiscountValue({ discount_type: 'percentage', value: 0.1 })).toBeCloseTo(10);
  });

  it('accepts already-normalized percentages', () => {
    expect(normalizeDiscountValue({ discount_type: 'percentage', value: 10, valueUnit: 'percent' })).toBe(10);
  });
});

describe('storedDiscountValueToPolicyValue', () => {
  it('converts a fixed decimal currency value to minor units exactly once', () => {
    expect(storedDiscountValueToPolicyValue('fixed', '50.00')).toBe(5_000);
    expect(storedDiscountValueToPolicyValue('fixed', 50)).toBe(5_000);
    expect(storedDiscountValueToPolicyValue('fixed', 12.34)).toBe(1_234);
  });

  it('keeps a percentage fraction readable for legacy rows', () => {
    expect(storedDiscountValueToPolicyValue('percentage', '0.10')).toBeCloseTo(0.1);
    expect(storedDiscountValueToPolicyValue('percentage', 10)).toBe(10);
  });

  it('resolves null, undefined and non-finite values to zero instead of NaN', () => {
    expect(storedDiscountValueToPolicyValue('fixed', null)).toBe(0);
    expect(storedDiscountValueToPolicyValue('fixed', undefined)).toBe(0);
    expect(storedDiscountValueToPolicyValue('percentage', Number.NaN)).toBe(0);
  });

  it('bills a configured $50 fixed discount as exactly $50 in USD and a non-USD currency', () => {
    const policy = (): AutomaticDiscountPolicy => ({
      discount_id: 'flat-fifty',
      discount_name: 'Flat $50',
      discount_type: 'fixed',
      value: storedDiscountValueToPolicyValue('fixed', '50.00'),
      scope: 'invoice',
    });

    for (const currency of ['USD', 'EUR']) {
      const result = evaluateContractInvoiceAdjustments({
        charges: [charge({ item_id: `${currency}-recurring`, net_amount: 390_000 })],
        automaticDiscounts: [policy()],
      });
      expect(result.automaticDiscountAmount).toBe(5_000);
      expect(result.netAmount).toBe(385_000);
    }
  });
});

describe('evaluateContractInvoiceAdjustments', () => {
  it('applies an all-eligible 10% discount to generated plus manual charges', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'recurring', net_amount: 390_000, is_manual: false }),
        charge({ item_id: 'manual', net_amount: 15_000, is_manual: true }),
      ],
      automaticDiscounts: [invoiceDiscount()],
    });

    expect(result.grossAmount).toBe(405_000);
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].amount).toBe(40_500);
    expect(result.netAmount).toBe(364_500);
    expect(result.discounts[0].base_amount).toBe(405_000);
  });

  it('excludes discount rows and negative credits from the eligible base', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'recurring', net_amount: 100_000 }),
        charge({ item_id: 'credit', net_amount: -20_000 }),
        charge({ item_id: 'existing-discount', net_amount: -10_000, is_discount: true }),
      ],
      automaticDiscounts: [invoiceDiscount()],
    });

    expect(result.grossAmount).toBe(100_000);
    expect(result.discounts[0].base_amount).toBe(100_000);
    expect(result.discounts[0].amount).toBe(10_000);
  });

  it('scopes an item discount to a single charge', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'a', net_amount: 100_000 }),
        charge({ item_id: 'b', net_amount: 50_000 }),
      ],
      automaticDiscounts: [
        invoiceDiscount({ discount_id: 'item-discount', scope: 'item', applies_to_item_id: 'b', value: 0.5 }),
      ],
    });

    expect(result.discounts[0].base_amount).toBe(50_000);
    expect(result.discounts[0].amount).toBe(25_000);
    expect(result.netAmount).toBe(125_000);
  });

  it('scopes a service discount to every matching row, not just the first', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'a', service_id: 'svc-1', net_amount: 100_000 }),
        charge({ item_id: 'b', service_id: 'svc-1', net_amount: 50_000 }),
        charge({ item_id: 'c', service_id: 'svc-2', net_amount: 40_000 }),
      ],
      automaticDiscounts: [
        invoiceDiscount({ discount_id: 'service-discount', scope: 'service', applies_to_service_id: 'svc-1', value: 0.1 }),
      ],
    });

    expect(result.discounts[0].base_amount).toBe(150_000);
    expect(result.discounts[0].amount).toBe(15_000);
    expect(result.netAmount).toBe(175_000);
  });

  it('scopes a contract discount to its contract assignment', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'a', client_contract_id: 'contract-1', net_amount: 100_000 }),
        charge({ item_id: 'b', client_contract_id: 'contract-2', net_amount: 80_000 }),
      ],
      automaticDiscounts: [
        invoiceDiscount({
          discount_id: 'contract-discount',
          scope: 'contract',
          client_contract_id: 'contract-1',
          value: 0.25,
        }),
      ],
    });

    expect(result.discounts[0].base_amount).toBe(100_000);
    expect(result.discounts[0].amount).toBe(25_000);
    expect(result.netAmount).toBe(155_000);
  });

  it('caps stacked discounts against remaining eligible value', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [charge({ item_id: 'a', net_amount: 100_000 })],
      automaticDiscounts: [
        invoiceDiscount({ discount_id: 'first', value: 0.6, priority: 1 }),
        invoiceDiscount({ discount_id: 'second', value: 0.6, priority: 2 }),
      ],
    });

    expect(result.discounts.map((discount) => discount.amount)).toEqual([60_000, 40_000]);
    expect(result.netAmount).toBe(0);
    expect(result.automaticDiscountAmount).toBe(100_000);
  });

  it('evaluates percentages against the original base without compounding', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [charge({ item_id: 'a', net_amount: 100_000 })],
      automaticDiscounts: [
        invoiceDiscount({ discount_id: 'first', value: 0.1, priority: 1 }),
        invoiceDiscount({ discount_id: 'second', value: 0.1, priority: 2 }),
      ],
    });

    expect(result.discounts.map((discount) => discount.amount)).toEqual([10_000, 10_000]);
    expect(result.netAmount).toBe(80_000);
  });

  it('orders discounts by persisted priority then stable id', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [charge({ item_id: 'a', net_amount: 100_000 })],
      automaticDiscounts: [
        invoiceDiscount({ discount_id: 'z', value: 0.1, priority: 2 }),
        invoiceDiscount({ discount_id: 'a', value: 0.1, priority: 1 }),
      ],
    });

    expect(result.discounts.map((discount) => discount.discount_id)).toEqual(['a', 'z']);
  });

  it('applies a fixed discount once per scope and caps it', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [
        charge({ item_id: 'a', net_amount: 3_000 }),
        charge({ item_id: 'b', net_amount: 4_000 }),
      ],
      automaticDiscounts: [
        invoiceDiscount({ discount_id: 'flat', discount_type: 'fixed', value: 5_000, scope: 'invoice' }),
      ],
    });

    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0].amount).toBe(5_000);
    expect(result.netAmount).toBe(2_000);
  });

  it('supports decimal percentages and rounds once', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [charge({ item_id: 'a', net_amount: 33_333 })],
      automaticDiscounts: [invoiceDiscount({ value: 0.075 })],
    });

    expect(result.discounts[0].amount).toBe(2_500);
    expect(result.netAmount).toBe(30_833);
  });

  it('ignores discounts that resolve no eligible charges', () => {
    const result = evaluateContractInvoiceAdjustments({
      charges: [charge({ item_id: 'a', service_id: 'svc-1', net_amount: 10_000 })],
      automaticDiscounts: [
        invoiceDiscount({ discount_id: 'missing-service', scope: 'service', applies_to_service_id: 'svc-9' }),
      ],
    });

    expect(result.discounts).toHaveLength(0);
    expect(result.netAmount).toBe(10_000);
  });
});

describe('allocateByLargestRemainder', () => {
  it('distributes a remainder deterministically and conserves the total', () => {
    const allocations = allocateByLargestRemainder(100, [
      { key: 'b', weight: 1 },
      { key: 'a', weight: 1 },
      { key: 'c', weight: 1 },
    ]);

    expect([...allocations.values()].reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(allocations.get('a')).toBe(34);
    expect(allocations.get('b')).toBe(33);
    expect(allocations.get('c')).toBe(33);
  });

  it('weights allocations proportionally', () => {
    const allocations = allocateByLargestRemainder(405_000, [
      { key: 'recurring', weight: 390_000 },
      { key: 'manual', weight: 15_000 },
    ]);

    expect(allocations.get('recurring')).toBe(390_000);
    expect(allocations.get('manual')).toBe(15_000);
  });
});
