import { describe, expect, it } from 'vitest';
import { computeBalanceDue } from './recordExternalPayment';

describe('computeBalanceDue', () => {
  it('returns totalAmount minus totalPaid when no credits', () => {
    expect(computeBalanceDue({ totalAmount: 10000, creditApplied: 0, totalPaid: 3000 })).toBe(7000);
  });

  it('returns 0 when fully paid (no credits)', () => {
    expect(computeBalanceDue({ totalAmount: 5000, creditApplied: 0, totalPaid: 5000 })).toBe(0);
  });

  it('subtracts creditApplied from balance (credit reshape semantics)', () => {
    // total=10000, credit=2000, paid=4000 → balance = 10000 - 2000 - 4000 = 4000
    expect(computeBalanceDue({ totalAmount: 10000, creditApplied: 2000, totalPaid: 4000 })).toBe(4000);
  });

  it('returns 0 when credits alone fully cover the invoice', () => {
    expect(computeBalanceDue({ totalAmount: 5000, creditApplied: 5000, totalPaid: 0 })).toBe(0);
  });

  it('returns 0 when credits plus payments cover the invoice', () => {
    expect(computeBalanceDue({ totalAmount: 10000, creditApplied: 3000, totalPaid: 7000 })).toBe(0);
  });
});
