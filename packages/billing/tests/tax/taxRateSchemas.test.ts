import { describe, expect, it } from 'vitest';
import {
  createTaxRateSchema, updateTaxRateSchema, taxRateResponseSchema,
  taxRateAdvancedSchema, taxRateListQuerySchema,
} from '../../../../server/src/lib/api/schemas/financialSchemas';

const tenant = 'f90a2f58-f5ca-439a-b5b6-2811fa877ef9';
const base = { tenant, region_code: 'TEST', tax_percentage: 10, start_date: '2026-01-01' };

describe('public tax rate cap contract', () => {
  it('keeps uncapped create callers compatible and requires explicit currency for zero or positive caps', () => {
    expect(createTaxRateSchema.parse(base)).not.toHaveProperty('cap_amount');
    for (const cap_amount of [0, 500, Number.MAX_SAFE_INTEGER]) {
      expect(createTaxRateSchema.safeParse({ ...base, cap_amount }).success).toBe(false);
      expect(createTaxRateSchema.parse({ ...base, cap_amount, currency_code: 'BHD' }).cap_amount).toBe(cap_amount);
    }
  });
  it('preserves omitted, null and zero update fields without defaults', () => {
    expect(updateTaxRateSchema.parse({ description: 'Renamed' })).toEqual({ description: 'Renamed' });
    expect(updateTaxRateSchema.parse({ cap_amount: null })).toEqual({ cap_amount: null });
    expect(updateTaxRateSchema.parse({ cap_amount: 0 })).toEqual({ cap_amount: 0 });
    expect(updateTaxRateSchema.parse({ currency_code: null })).toEqual({ currency_code: null });
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '500', '5.00', '1e2'])('rejects invalid API cap %s', cap_amount => {
    expect(updateTaxRateSchema.safeParse({ cap_amount }).success).toBe(false);
    expect(createTaxRateSchema.safeParse({ ...base, cap_amount, currency_code: 'USD' }).success).toBe(false);
  });
  it.each(['ZZZ', 'usd', '', 'US', ' USD '])('rejects unsupported currency %s', currency_code => {
    expect(updateTaxRateSchema.safeParse({ currency_code }).success).toBe(false);
  });
  it('responses carry explicit nulls and legacy unresolved caps; bigint strings must be normalized first', () => {
    const response = { ...base, tax_rate_id: tenant, description: null, end_date: null, cap_amount: 0, currency_code: null };
    expect(taxRateResponseSchema.parse(response)).toMatchObject({ cap_amount: 0, currency_code: null });
    expect(taxRateResponseSchema.parse({ ...response, cap_amount: null })).toMatchObject({ cap_amount: null });
    expect(taxRateResponseSchema.safeParse({ ...response, cap_amount: '0' }).success).toBe(false);
    expect(taxRateResponseSchema.safeParse({ ...base, tax_rate_id: tenant }).success).toBe(false);
  });
  it('advanced schema exposes the same amount units and currency', () => {
    expect(taxRateAdvancedSchema.parse({ ...base, start_date: '2026-01-01T00:00:00.000Z', tax_type: 'VAT', country_code: 'BH', cap_amount: 1001, currency_code: 'BHD' }))
      .toMatchObject({ cap_amount: 1001, currency_code: 'BHD' });
  });
  it('accepts tax filters and rejects unrecognized sort columns', () => {
    expect(taxRateListQuerySchema.parse({ effective_date: '2026-01-01', is_active: 'false', sort: 'cap_amount' }))
      .toMatchObject({ effective_date: '2026-01-01', is_active: false, sort: 'cap_amount', page: 1, limit: 25 });
    expect(taxRateListQuerySchema.safeParse({ sort: 'transaction_id' }).success).toBe(false);
  });
});
