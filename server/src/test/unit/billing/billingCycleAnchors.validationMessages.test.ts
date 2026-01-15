import { describe, it, expect } from 'vitest';
import { validateAnchorSettingsForCycle } from 'server/src/lib/billing/billingCycleAnchors';

describe('Billing cycle anchor validation messaging', () => {
  it('rejects monthly day-of-month outside 1..28 with a clear message', () => {
    expect(() =>
      validateAnchorSettingsForCycle('monthly', { dayOfMonth: 31 })
    ).toThrow(/dayOfMonth must be in range 1\.\.28/i);
  });

  it('rejects weekly day-of-week outside 1..7 with a clear message', () => {
    expect(() =>
      validateAnchorSettingsForCycle('weekly', { dayOfWeek: 8 })
    ).toThrow(/dayOfWeek in range 1\.\.7/i);
  });

  it('rejects bi-weekly referenceDate that is not UTC midnight', () => {
    expect(() =>
      validateAnchorSettingsForCycle('bi-weekly', { referenceDate: '2026-01-01T12:00:00Z' })
    ).toThrow(/UTC midnight/i);
  });
});

