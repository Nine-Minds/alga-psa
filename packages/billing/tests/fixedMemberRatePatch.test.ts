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
});
