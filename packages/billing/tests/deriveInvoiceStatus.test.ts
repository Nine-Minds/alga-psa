import { describe, expect, it } from 'vitest';
import { deriveInvoiceStatus } from '../src/lib/balanceDue';

// T001 (alga-2026-0003329)
const base = { totalAmount: 10000, creditApplied: 0, totalPaid: 0, currentStatus: 'sent' };

describe('deriveInvoiceStatus', () => {
  it('returns paid when net payments cover the balance', () => {
    expect(deriveInvoiceStatus({ ...base, totalPaid: 10000 })).toBe('paid');
  });
  it('counts credit applied toward the balance', () => {
    expect(deriveInvoiceStatus({ ...base, creditApplied: 4000, totalPaid: 6000 })).toBe('paid');
    expect(deriveInvoiceStatus({ ...base, creditApplied: 4000, totalPaid: 5000 })).toBe('partially_applied');
  });
  it('returns partially_applied for partial payments', () => {
    expect(deriveInvoiceStatus({ ...base, totalPaid: 2500 })).toBe('partially_applied');
  });
  it('returns sent for zero net payments, including after a full reversal', () => {
    expect(deriveInvoiceStatus(base)).toBe('sent');
    expect(deriveInvoiceStatus({ ...base, currentStatus: 'paid' })).toBe('sent');
    expect(deriveInvoiceStatus({ ...base, currentStatus: 'partially_applied' })).toBe('sent');
  });
  it('returns paid for net payments above the balance (negative balance)', () => {
    expect(deriveInvoiceStatus({ ...base, totalPaid: 12000 })).toBe('paid');
  });
  it.each(['draft', 'cancelled', 'void'])('never overwrites %s', (currentStatus) => {
    expect(deriveInvoiceStatus({ ...base, currentStatus, totalPaid: 10000 })).toBe(currentStatus);
    expect(deriveInvoiceStatus({ ...base, currentStatus, totalPaid: 0 })).toBe(currentStatus);
  });
  it('never marks a zero-payment credit note, negative-total or zero-total invoice paid', () => {
    expect(deriveInvoiceStatus({ ...base, totalAmount: -5000 })).toBe('sent');
    expect(deriveInvoiceStatus({ ...base, totalAmount: 0 })).toBe('sent');
    expect(deriveInvoiceStatus({ ...base, totalAmount: 5000, creditApplied: 5000 })).toBe('sent');
  });
});
