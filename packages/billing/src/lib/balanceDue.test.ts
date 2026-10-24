import { describe, expect, it } from 'vitest';
import { computeBalanceDue } from './balanceDue';
import { computeBalanceDue as reExported } from '../services/accountingSync/recordExternalPayment';

describe('computeBalanceDue (shared pure module)', () => {
  it('subtracts credit and net payments, in cents, without clamping', () => {
    expect(computeBalanceDue({ totalAmount: 100000, creditApplied: 20000, totalPaid: 30000 })).toBe(50000);
    expect(computeBalanceDue({ totalAmount: 100000, creditApplied: 0, totalPaid: 100000 })).toBe(0);
    expect(computeBalanceDue({ totalAmount: 100000, creditApplied: 0, totalPaid: 120000 })).toBe(-20000);
  });

  it('is the same function accounting sync re-exports', () => {
    expect(reExported).toBe(computeBalanceDue);
  });
});
