import { describe, expect, it } from 'vitest';
import { buildFixedMemberRatePatch } from '../src/components/billing-dashboard/contracts/fixedMemberRatePatch';

describe('buildFixedMemberRatePatch', () => {
  it('sends no base_rate_basis for a null rate (catalog price)', () => {
    const patch = buildFixedMemberRatePatch(null, null);
    expect(patch).toEqual({ base_rate: null });
    expect('base_rate_basis' in patch).toBe(false);
    expect('base_rate_basis' in buildFixedMemberRatePatch(null, 'share')).toBe(false);
  });

  it('keeps the stored basis for a number, defaulting to per_unit', () => {
    expect(buildFixedMemberRatePatch(1200, 'share')).toEqual({ base_rate: 1200, base_rate_basis: 'share' });
    expect(buildFixedMemberRatePatch(1200, null)).toEqual({ base_rate: 1200, base_rate_basis: 'per_unit' });
    expect(buildFixedMemberRatePatch(0, undefined)).toEqual({ base_rate: 0, base_rate_basis: 'per_unit' });
  });

  it('accepts a numeric string from a numeric column and converts it', () => {
    expect(buildFixedMemberRatePatch('1500.00', 'share')).toEqual({ base_rate: 1500, base_rate_basis: 'share' });
  });

  it('treats only null, undefined and empty string as the catalog price', () => {
    for (const empty of [null, undefined, '']) {
      const patch = buildFixedMemberRatePatch(empty, 'share');
      expect(patch).toEqual({ base_rate: null });
      expect('base_rate_basis' in patch).toBe(false);
    }
  });

  it('rejects a non-numeric string instead of silently clearing the price', () => {
    expect(() => buildFixedMemberRatePatch('abc', 'share')).toThrow(/base_rate must be a number/);
    expect(() => buildFixedMemberRatePatch(Number.NaN, null)).toThrow();
  });
});
