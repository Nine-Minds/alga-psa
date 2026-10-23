import { describe, expect, it } from 'vitest';
import {
  allocateCentsByWeights,
  fixedMemberContributionCents,
  fixedRateBasisOf,
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
