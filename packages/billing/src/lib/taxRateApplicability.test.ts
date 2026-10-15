import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { ITaxRate } from '@alga-psa/types';
import {
  formatTaxPercentage,
  summarizeRatesByRegion,
  summarizeRegionRates,
  taxRateStatusOn,
} from './taxRateApplicability';

const asOf = Temporal.PlainDate.from('2026-09-14');

const rate = (overrides: Partial<ITaxRate>): ITaxRate => ({
  tenant: 't',
  tax_rate_id: overrides.tax_rate_id ?? 'r',
  region_code: 'US-FL',
  tax_percentage: 6,
  start_date: '2020-01-01',
  end_date: null,
  is_active: true,
  ...overrides,
});

describe('taxRateStatusOn', () => {
  it('reports inactive before looking at dates', () => {
    expect(taxRateStatusOn(rate({ is_active: false, start_date: '2030-01-01' }), asOf)).toBe('inactive');
  });

  it('reports scheduled when the start is after the date', () => {
    expect(taxRateStatusOn(rate({ start_date: '2026-09-15' }), asOf)).toBe('scheduled');
  });

  it('treats a start on the date as current', () => {
    expect(taxRateStatusOn(rate({ start_date: '2026-09-14' }), asOf)).toBe('current');
  });

  it('treats the end date as exclusive, like the engine', () => {
    expect(taxRateStatusOn(rate({ end_date: '2026-09-14' }), asOf)).toBe('expired');
    expect(taxRateStatusOn(rate({ end_date: '2026-09-15' }), asOf)).toBe('current');
  });

  it('treats an undefined is_active as active, matching the column default', () => {
    expect(taxRateStatusOn(rate({ is_active: undefined }), asOf)).toBe('current');
  });
});

describe('summarizeRegionRates', () => {
  it('sums every applicable rate, including string percentages from the driver', () => {
    const summary = summarizeRegionRates([
      rate({ tax_rate_id: 'a', tax_percentage: 6 }),
      rate({ tax_rate_id: 'b', tax_percentage: '7.5' as unknown as number }),
      rate({ tax_rate_id: 'c', tax_percentage: 4, is_active: false }),
      rate({ tax_rate_id: 'd', tax_percentage: 1, end_date: '2021-01-01' }),
    ], asOf);
    expect(summary.applicable.map((r) => r.tax_rate_id)).toEqual(['a', 'b']);
    expect(summary.effectivePercentage).toBe(13.5);
  });

  it('returns null when a region has rates but none apply today', () => {
    const summary = summarizeRegionRates([rate({ end_date: '2021-01-01' })], asOf);
    expect(summary.rates).toHaveLength(1);
    expect(summary.applicable).toHaveLength(0);
    expect(summary.effectivePercentage).toBeNull();
  });
});

describe('summarizeRatesByRegion', () => {
  it('groups by region code and leaves regions without rates absent', () => {
    const byRegion = summarizeRatesByRegion([
      rate({ tax_rate_id: 'a', region_code: 'US-FL', tax_percentage: 6 }),
      rate({ tax_rate_id: 'b', region_code: 'US-CA', tax_percentage: 8.25 }),
      rate({ tax_rate_id: 'c', region_code: 'US-FL', tax_percentage: 1 }),
    ], asOf);
    expect(byRegion.get('US-FL')?.effectivePercentage).toBe(7);
    expect(byRegion.get('US-CA')?.effectivePercentage).toBe(8.25);
    expect(byRegion.has('US-NY')).toBe(false);
  });
});

describe('formatTaxPercentage', () => {
  it('drops trailing zeros and keeps meaningful precision', () => {
    expect(formatTaxPercentage('8.2500')).toBe('8.25%');
    expect(formatTaxPercentage(17.5)).toBe('17.5%');
    expect(formatTaxPercentage(0)).toBe('0%');
  });
});
