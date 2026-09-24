import { describe, expect, it } from 'vitest';

import {
  toDateOnly,
  toDisplayDiscountValue,
  toStoredDiscountValue,
  validateDiscountInput,
  type DiscountAuthoringInput,
} from '../../src/lib/billing/discountAuthoring';

const base: DiscountAuthoringInput = {
  discount_name: 'Loyalty 10%',
  discount_type: 'percentage',
  value: 10,
  start_date: '2026-01-01',
  end_date: null,
  contract_line_id: 'line-1',
  scope: 'invoice',
};

describe('validateDiscountInput', () => {
  it('accepts a valid percentage and a valid fixed discount', () => {
    expect(validateDiscountInput(base)).toBeNull();
    expect(validateDiscountInput({ ...base, discount_type: 'fixed', value: 50 })).toBeNull();
    expect(validateDiscountInput({ ...base, scope: 'contract' })).toBeNull();
    expect(validateDiscountInput({ ...base, scope: 'service', scope_service_id: 'svc-1' })).toBeNull();
  });

  it('rejects percentages outside (0, 100] and negative/NaN fixed values', () => {
    expect(validateDiscountInput({ ...base, value: 0 })).toMatch(/greater than 0/);
    expect(validateDiscountInput({ ...base, value: 100.01 })).toMatch(/at most 100/);
    expect(validateDiscountInput({ ...base, discount_type: 'fixed', value: -1 })).toMatch(/not be negative/);
    expect(validateDiscountInput({ ...base, discount_type: 'fixed', value: Number.NaN })).toMatch(/finite/);
  });

  it('rejects inverted or malformed dates', () => {
    expect(validateDiscountInput({ ...base, start_date: '01/01/2026' })).toMatch(/valid start date/);
    expect(validateDiscountInput({ ...base, start_date: '2026-02-30' })).toMatch(/valid start date/);
    expect(validateDiscountInput({ ...base, start_date: '2026-13-01' })).toMatch(/valid start date/);
    expect(validateDiscountInput({ ...base, end_date: '2025-12-31' })).toMatch(/after the start date/);
    expect(validateDiscountInput({ ...base, end_date: '2026-02-30' })).toMatch(/valid date/);
    expect(validateDiscountInput({ ...base, end_date: '2026-12-31' })).toBeNull();
  });

  it('requires a contract line and a service for service scope', () => {
    expect(validateDiscountInput({ ...base, contract_line_id: '' })).toMatch(/contract line/);
    expect(validateDiscountInput({ ...base, scope: 'service', scope_service_id: null })).toMatch(/Select the service/);
  });

  it('rejects item scope as non-authorable', () => {
    expect(
      validateDiscountInput({ ...base, scope: 'item', applies_to_item_id: 'item-1' }),
    ).toMatch(/Item-scoped discounts cannot be authored/);
  });

  it('rejects non-integer priority', () => {
    expect(validateDiscountInput({ ...base, priority: 1.5 })).toMatch(/whole number/);
  });
});

describe('discount value conversion', () => {
  it('stores a percentage as a fraction (including fractional percents) and a fixed value as decimal currency', () => {
    expect(toStoredDiscountValue({ discount_type: 'percentage', value: 10 })).toBeCloseTo(0.1);
    expect(toStoredDiscountValue({ discount_type: 'percentage', value: 12.5 })).toBeCloseTo(0.125);
    expect(toStoredDiscountValue({ discount_type: 'percentage', value: 7.25 })).toBeCloseTo(0.0725);
    expect(toStoredDiscountValue({ discount_type: 'fixed', value: 50 })).toBe(50);
    expect(toStoredDiscountValue({ discount_type: 'fixed', value: 12.346 })).toBe(12.35);
  });

  it('reads stored values back into authoring units, including legacy two-place fractions', () => {
    expect(toDisplayDiscountValue('percentage', 0.1)).toBeCloseTo(10);
    expect(toDisplayDiscountValue('percentage', 0.125)).toBeCloseTo(12.5);
    expect(toDisplayDiscountValue('fixed', 50)).toBe(50);
  });

  it('normalizes date-ish values to a date-only string', () => {
    expect(toDateOnly('2026-04-01T00:00:00.000Z')).toBe('2026-04-01');
    expect(toDateOnly(null)).toBeNull();
  });
});
