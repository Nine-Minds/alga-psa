import { describe, expect, it } from 'vitest';
import {
  allocateCentsByWeights,
  fixedMemberContributionCents,
  fixedRateBasisOf,
  FixedMemberRatePairError,
  fixedMemberRateProvenance,
  resolveFixedMemberRatePair,
  resolveFixedMemberRatePatch,
} from '../fixedMemberRate';

describe('fixedRateBasisOf', () => {
  it('reads seats as per_unit even when labelled share', () => {
    expect(fixedRateBasisOf({ pricing_basis: 'unit', base_rate_basis: 'share' })).toBe('per_unit');
    expect(fixedRateBasisOf({ pricing_basis: 'unit' })).toBe('per_unit');
  });

  it('honours explicit labels on bundle members', () => {
    expect(fixedRateBasisOf({ pricing_basis: 'bundle', base_rate_basis: 'share' })).toBe('share');
    expect(fixedRateBasisOf({ pricing_basis: null, base_rate_basis: 'share' })).toBe('share');
    expect(fixedRateBasisOf({ base_rate_basis: 'per_unit' })).toBe('per_unit');
  });

  it('defaults a missing or unknown label to per_unit', () => {
    expect(fixedRateBasisOf({})).toBe('per_unit');
    expect(fixedRateBasisOf({ pricing_basis: 'bundle', base_rate_basis: null })).toBe('per_unit');
    expect(fixedRateBasisOf({ base_rate_basis: 'bogus' })).toBe('per_unit');
  });
});

describe('fixedMemberContributionCents', () => {
  it('per_unit multiplies by quantity', () => {
    expect(fixedMemberContributionCents(225, 'per_unit', 3)).toBe(675);
  });

  it('per_unit rounds fractional results', () => {
    expect(fixedMemberContributionCents(333, 'per_unit', 1.5)).toBe(500); // 499.5 -> 500
    expect(fixedMemberContributionCents(100, 'per_unit', 0.333)).toBe(33);
  });

  it('share ignores quantity', () => {
    expect(fixedMemberContributionCents(675, 'share', 3)).toBe(675);
    expect(fixedMemberContributionCents(675, 'share', 0)).toBe(675);
    expect(fixedMemberContributionCents(675, 'share', 1.5)).toBe(675);
  });
});

describe('allocateCentsByWeights', () => {
  it('splits proportionally', () => {
    expect(allocateCentsByWeights(900, [
      { key: 'a', weight: 225 },
      { key: 'b', weight: 675 },
    ]).amounts).toEqual([225, 675]);
  });

  it('always sums exactly to the total', () => {
    const { amounts } = allocateCentsByWeights(1000, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
      { key: 'c', weight: 1 },
    ]);
    expect(amounts.reduce((s, v) => s + v, 0)).toBe(1000);
  });

  it('breaks remainder ties by key, not row order', () => {
    const forward = allocateCentsByWeights(100, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
      { key: 'c', weight: 1 },
    ]);
    const reversed = allocateCentsByWeights(100, [
      { key: 'c', weight: 1 },
      { key: 'b', weight: 1 },
      { key: 'a', weight: 1 },
    ]);
    expect(forward.amounts).toEqual([34, 33, 33]);
    expect(reversed.amounts).toEqual([33, 33, 34]);
  });

  it('reports proportions', () => {
    const { proportions } = allocateCentsByWeights(100, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 3 },
    ]);
    expect(proportions).toEqual([0.25, 0.75]);
  });
});

describe('resolveFixedMemberRatePair', () => {
  it('drops any stated basis for a NULL rate (catalog-priced)', () => {
    expect(resolveFixedMemberRatePair({ base_rate: null, base_rate_basis: 'per_unit', pricing_basis: 'unit' }))
      .toEqual({ base_rate: null, base_rate_basis: null });
    expect(resolveFixedMemberRatePair({ base_rate_basis: 'share' })).toEqual({ base_rate: null, base_rate_basis: null });
  });

  it('keeps a stated basis with a rate, else the stored one; seats are per_unit', () => {
    expect(resolveFixedMemberRatePair({ base_rate: 1500, base_rate_basis: 'share', pricing_basis: 'bundle' }))
      .toEqual({ base_rate: 1500, base_rate_basis: 'share' });
    expect(resolveFixedMemberRatePair({ base_rate: 1500, pricing_basis: 'bundle', storedBasis: 'share' }))
      .toEqual({ base_rate: 1500, base_rate_basis: 'share' });
    expect(resolveFixedMemberRatePair({ base_rate: 0, pricing_basis: 'unit' }))
      .toEqual({ base_rate: 0, base_rate_basis: 'per_unit' });
  });

  it('refuses a rate with no meaning and a seat priced as a share, by name', () => {
    expect(() => resolveFixedMemberRatePair({ base_rate: 100, pricing_basis: 'bundle' })).toThrow(FixedMemberRatePairError);
    const error = (() => {
      try { resolveFixedMemberRatePair({ base_rate: 100, base_rate_basis: 'share', pricing_basis: 'unit' }); }
      catch (e) { return e as FixedMemberRatePairError; }
    })();
    expect(error).toBeInstanceOf(FixedMemberRatePairError);
    expect(error?.statusCode).toBe(400);
  });
});

describe('resolveFixedMemberRatePatch', () => {
  const inherited = { base_rate: null, base_rate_basis: null, pricing_basis: 'unit' } as const;
  const custom = { base_rate: '1500.00', base_rate_basis: 'per_unit', pricing_basis: 'bundle' } as const;

  it('ignores a patch that touches neither column', () => {
    expect(resolveFixedMemberRatePatch({}, custom)).toBeUndefined();
  });

  it('refuses a basis alone on a NULL-rate member (the incident shape)', () => {
    expect(() => resolveFixedMemberRatePatch({ base_rate_basis: 'per_unit' }, inherited))
      .toThrow('A fixed member base_rate_basis requires base_rate');
  });

  it('a NULL rate with an invented basis resolves to NULL/NULL', () => {
    expect(resolveFixedMemberRatePatch({ base_rate: null, base_rate_basis: 'per_unit' }, inherited))
      .toEqual({ base_rate: null, base_rate_basis: null });
  });

  it('re-states a basis for the stored rate', () => {
    expect(resolveFixedMemberRatePatch({ base_rate_basis: 'share' }, custom)).toEqual({ base_rate: 1500, base_rate_basis: 'share' });
  });

  it('clearing the basis alone never drops a stored rate', () => {
    expect(resolveFixedMemberRatePatch({ base_rate_basis: null }, custom)).toEqual({ base_rate: 1500, base_rate_basis: 'per_unit' });
    expect(resolveFixedMemberRatePatch({ base_rate_basis: null }, inherited)).toEqual({ base_rate: null, base_rate_basis: null });
  });

  it('a new rate keeps the stored basis unless one is stated', () => {
    expect(resolveFixedMemberRatePatch({ base_rate: 900 }, { ...custom, base_rate_basis: 'share' }))
      .toEqual({ base_rate: 900, base_rate_basis: 'share' });
    expect(resolveFixedMemberRatePatch({ base_rate: 900 }, inherited)).toEqual({ base_rate: 900, base_rate_basis: 'per_unit' });
  });
});

describe('fixedMemberRateProvenance', () => {
  it('a stored number is custom, NULL is inherited', () => {
    expect(fixedMemberRateProvenance({ base_rate: 1, base_rate_basis: 'per_unit' })).toBe('custom');
    expect(fixedMemberRateProvenance({ base_rate: null, base_rate_basis: null })).toBe('inherited');
  });
});
