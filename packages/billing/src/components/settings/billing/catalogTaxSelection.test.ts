import { describe, expect, it } from 'vitest';
import {
  INHERIT_TAX_RATE_VALUE,
  NON_TAXABLE_VALUE,
  fromTaxRateSelectionValue,
  toTaxRateCreateField,
  toTaxRateSelectionValue,
} from './catalogTaxSelection';

describe('catalog tax selection sentinels', () => {
  it('maps an omitted selection to inherit and omits the payload field', () => {
    // The quick-add create forms start with tax_rate_id undefined (inherit).
    expect(toTaxRateSelectionValue(undefined)).toBe(INHERIT_TAX_RATE_VALUE);
    expect(fromTaxRateSelectionValue(INHERIT_TAX_RATE_VALUE)).toBeUndefined();
    expect(toTaxRateCreateField(undefined)).toEqual({});
  });

  it('maps a null selection to the explicit non-taxable sentinel and payload null', () => {
    expect(toTaxRateSelectionValue(null)).toBe(NON_TAXABLE_VALUE);
    expect(fromTaxRateSelectionValue(NON_TAXABLE_VALUE)).toBeNull();
    expect(toTaxRateCreateField(null)).toEqual({ tax_rate_id: null });
  });

  it('passes an explicit rate override through unchanged', () => {
    const rateId = '11111111-1111-4111-8111-111111111111';
    expect(toTaxRateSelectionValue(rateId)).toBe(rateId);
    expect(fromTaxRateSelectionValue(rateId)).toBe(rateId);
    expect(toTaxRateCreateField(rateId)).toEqual({ tax_rate_id: rateId });
  });

  it('round-trips every selection state so a reset returns to inherit', () => {
    for (const selection of [undefined, null, '22222222-2222-4222-8222-222222222222'] as const) {
      expect(fromTaxRateSelectionValue(toTaxRateSelectionValue(selection))).toBe(selection);
    }
  });
});
