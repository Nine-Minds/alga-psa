import { describe, it, expect } from 'vitest';
import {
  getBillingPeriodForDate,
  getNextBillingBoundaryAfter,
  normalizeAnchorSettingsForCycle,
} from 'server/src/lib/billing/billingCycleAnchors';

describe('billingCycleAnchors', () => {
  it('monthly anchor day=10 produces current period with end exclusive (2026-01-09 => 2025-12-10..2026-01-10)', () => {
    const anchor = normalizeAnchorSettingsForCycle('monthly', { dayOfMonth: 10 });
    const period = getBillingPeriodForDate('2026-01-09T00:00:00Z', 'monthly', anchor);
    expect(period).toEqual({
      periodStartDate: '2025-12-10T00:00:00Z',
      periodEndDate: '2026-01-10T00:00:00Z',
    });
  });

  it('monthly anchor day=1 matches calendar-aligned behavior (2026-01-09 => 2026-01-01..2026-02-01)', () => {
    const anchor = normalizeAnchorSettingsForCycle('monthly', { dayOfMonth: 1 });
    const period = getBillingPeriodForDate('2026-01-09T00:00:00Z', 'monthly', anchor);
    expect(period).toEqual({
      periodStartDate: '2026-01-01T00:00:00Z',
      periodEndDate: '2026-02-01T00:00:00Z',
    });
  });

  it('weekly anchor weekday=Mon produces correct rolling weekly boundaries with end exclusive', () => {
    const anchor = normalizeAnchorSettingsForCycle('weekly', { dayOfWeek: 1 });
    const period = getBillingPeriodForDate('2026-01-07T00:00:00Z', 'weekly', anchor);
    expect(period).toEqual({
      periodStartDate: '2026-01-05T00:00:00Z',
      periodEndDate: '2026-01-12T00:00:00Z',
    });
  });

  it('bi-weekly anchor with first-start date produces stable parity and end exclusive', () => {
    const anchor = normalizeAnchorSettingsForCycle('bi-weekly', {
      referenceDate: '2026-01-02T00:00:00Z',
    });
    const period = getBillingPeriodForDate('2026-01-20T00:00:00Z', 'bi-weekly', anchor);
    expect(period).toEqual({
      periodStartDate: '2026-01-16T00:00:00Z',
      periodEndDate: '2026-01-30T00:00:00Z',
    });
  });

  it('quarterly anchor produces correct boundaries (start month Jan, day=10)', () => {
    const anchor = normalizeAnchorSettingsForCycle('quarterly', { monthOfYear: 1, dayOfMonth: 10 });
    const period = getBillingPeriodForDate('2026-05-01T00:00:00Z', 'quarterly', anchor);
    expect(period).toEqual({
      periodStartDate: '2026-04-10T00:00:00Z',
      periodEndDate: '2026-07-10T00:00:00Z',
    });
  });

  it('semi-annual anchor produces correct 6-month boundaries', () => {
    const anchor = normalizeAnchorSettingsForCycle('semi-annually', { monthOfYear: 1, dayOfMonth: 10 });
    const period = getBillingPeriodForDate('2026-05-01T00:00:00Z', 'semi-annually', anchor);
    expect(period).toEqual({
      periodStartDate: '2026-01-10T00:00:00Z',
      periodEndDate: '2026-07-10T00:00:00Z',
    });
  });

  it('annual anchor produces correct year boundaries', () => {
    const anchor = normalizeAnchorSettingsForCycle('annually', { monthOfYear: 2, dayOfMonth: 10 });
    const period = getBillingPeriodForDate('2026-05-01T00:00:00Z', 'annually', anchor);
    expect(period).toEqual({
      periodStartDate: '2026-02-10T00:00:00Z',
      periodEndDate: '2027-02-10T00:00:00Z',
    });
  });

  it('monthly anchor next boundary supports transition periods (start=2026-01-01 => 2026-01-10)', () => {
    const anchor = normalizeAnchorSettingsForCycle('monthly', { dayOfMonth: 10 });
    const next = getNextBillingBoundaryAfter('2026-01-01T00:00:00Z', 'monthly', anchor);
    expect(next).toBe('2026-01-10T00:00:00Z');
  });
});

