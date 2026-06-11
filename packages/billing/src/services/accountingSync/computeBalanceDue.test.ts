import { describe, expect, it } from 'vitest';
import { computeBalanceDue } from './recordExternalPayment';

describe('computeBalanceDue', () => {
  it('returns totalAmount minus totalPaid (slice-1: credit not subtracted)', () => {
    expect(computeBalanceDue({ totalAmount: 10000, creditApplied: 0, totalPaid: 3000 })).toBe(7000);
  });

  it('returns 0 when fully paid', () => {
    expect(computeBalanceDue({ totalAmount: 5000, creditApplied: 0, totalPaid: 5000 })).toBe(0);
  });

  it('creditApplied is ignored in slice-1 semantics', () => {
    // credit does NOT reduce the balance in slice-1
    expect(computeBalanceDue({ totalAmount: 10000, creditApplied: 2000, totalPaid: 4000 })).toBe(6000);
  });
});
