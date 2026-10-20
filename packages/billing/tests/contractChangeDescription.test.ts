import { describe, expect, it } from 'vitest';
import { describeContractChange } from '../src/lib/billing/contractChangeDescription';

describe('automatic contract change customer description', () => {
  const source = {
    adjustment_period_start: '2026-10-01', mid_period_effective_date: '2026-10-13', adjustment_period_end: '2026-11-01',
    unit_rate_cents: 12000, covered_days: 19, full_period_days: 31,
  };

  it.each([
    { quantity_delta: 1, amount_cents: 7355, direction: 'increase', signed: '+1' },
    { quantity_delta: -1, amount_cents: -7355, direction: 'credit', signed: '-1' },
  ])('describes a $direction with signed source calculation', (row) => {
    const text = describeContractChange('Cabling', { ...source, ...row }, 'AUD');
    expect(text).toContain(`Cabling: ${row.direction} (${row.signed} units)`);
    expect(text).toContain('2026-10-13 through 2026-11-01 (end date exclusive)');
    expect(text).toContain('AUD $120.00');
    expect(text).toContain('19/31 days');
  });

  it('does not invent missing legacy source calculations', () => {
    expect(describeContractChange('Cabling', {}, undefined)).toBe('Mid-period quantity change: Cabling');
  });

  it('safely falls back when a canonical effective date is an invalid Date', () => {
    expect(describeContractChange('Cabling', {
      ...source, mid_period_effective_date: new Date(Number.NaN), quantity_delta: 1, amount_cents: 7355,
    }, 'AUD')).toBe('Mid-period quantity change: Cabling');
  });

  it.each([
    { ...source, quantity_delta: null, amount_cents: 0 },
    { ...source, quantity_delta: 1, amount_cents: 7355, adjustment_period_start: '2026-02-30' },
    { ...source, quantity_delta: 1, amount_cents: 7355, adjustment_period_end: '2026-10-13' },
  ])('degrades without inventing incomplete canonical metadata', (row) => {
    expect(describeContractChange('Cabling', row, 'AUD')).toBe('Mid-period quantity change: Cabling');
  });

  it.each([undefined, null])('does not imply coverage when the effective date is %s', (effectiveDate) => {
    expect(describeContractChange('Cabling', {
      ...source, mid_period_effective_date: effectiveDate, quantity_delta: 1, amount_cents: 7355,
    }, 'AUD')).toBe('Mid-period quantity change: Cabling');
  });

  it('does not substitute a default for an unknown currency', () => {
    expect(describeContractChange('Cabling', {
      ...source, quantity_delta: 1, amount_cents: 7355,
    }, 'ZZZ')).toBe('Mid-period quantity change: Cabling');
  });
});
