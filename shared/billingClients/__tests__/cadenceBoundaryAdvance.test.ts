import { describe, expect, it } from 'vitest';
import { normalizeAnchorSettingsForCycle } from '../billingCycleAnchors';
import { nthCadenceBoundaryAfter } from '../cadenceBoundaryAdvance';

describe('nthCadenceBoundaryAfter', () => {
  it('takes the next boundary after a boundary-aligned start', () => {
    expect(
      nthCadenceBoundaryAfter('2026-11-01', 1, {
        owner: 'contract',
        billingCycle: 'monthly',
        anchorDate: '2026-11-01',
      }),
    ).toBe('2026-12-01');
  });

  it('steps contract cadence from the assignment start, recovering from month-end clamping', () => {
    const rule = { owner: 'contract', billingCycle: 'monthly', anchorDate: '2026-01-31' } as const;
    expect(nthCadenceBoundaryAfter('2026-01-31', 1, rule)).toBe('2026-02-28');
    expect(nthCadenceBoundaryAfter('2026-02-28', 1, rule)).toBe('2026-03-31');
    expect(nthCadenceBoundaryAfter('2026-03-31', 2, rule)).toBe('2026-05-31');
  });

  it('counts whole cadence periods for a quarterly contract cadence', () => {
    expect(
      nthCadenceBoundaryAfter('2026-10-15', 2, {
        owner: 'contract',
        billingCycle: 'quarterly',
        anchorDate: '2026-01-15',
      }),
    ).toBe('2027-04-15');
  });

  it('measures from a mid-period start to the period boundary', () => {
    const anchor = normalizeAnchorSettingsForCycle('monthly', { dayOfMonth: 1 });
    const rule = { owner: 'client', billingCycle: 'monthly', anchor } as const;
    expect(nthCadenceBoundaryAfter('2026-11-16', 1, rule)).toBe('2026-12-01');
    expect(nthCadenceBoundaryAfter('2026-11-16', 2, rule)).toBe('2027-01-01');
  });

  it('steps client cadence on the client schedule anchor', () => {
    const anchor = normalizeAnchorSettingsForCycle('monthly', { dayOfMonth: 15 });
    expect(
      nthCadenceBoundaryAfter('2026-11-15', 2, { owner: 'client', billingCycle: 'monthly', anchor }),
    ).toBe('2027-01-15');
  });

  it('rejects a non-positive count', () => {
    expect(() =>
      nthCadenceBoundaryAfter('2026-11-01', 0, {
        owner: 'contract',
        billingCycle: 'monthly',
        anchorDate: '2026-11-01',
      }),
    ).toThrow();
  });
});
