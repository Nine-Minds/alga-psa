import { describe, expect, it } from 'vitest';
import { advanceMaintenanceDate, parseCustomRecurrence } from './maintenanceRecurrence';

const next = (from: string, interval: number, recurrence: Record<string, unknown>) =>
  advanceMaintenanceDate(from, 'custom', interval, { recurrence }).toISOString();

describe('advanceMaintenanceDate', () => {
  it('anchors a late completion to the actual completion date', () => {
    expect(advanceMaintenanceDate('2026-08-22T12:00:00.000Z', 'monthly', 1).toISOString())
      .toBe('2026-09-22T12:00:00.000Z');
  });

  it('supports interval and month-end cadence without overflowing the target month', () => {
    expect(advanceMaintenanceDate('2026-01-31T12:00:00.000Z', 'monthly', 1).toISOString())
      .toBe('2026-02-28T12:00:00.000Z');
    expect(advanceMaintenanceDate('2026-01-31T12:00:00.000Z', 'quarterly', 2).toISOString())
      .toBe('2026-07-31T12:00:00.000Z');
  });

  it('rejects custom cadence without a recurrence rule instead of treating it as daily', () => {
    expect(() => advanceMaintenanceDate('2026-08-22T12:00:00.000Z', 'custom', 1))
      .toThrow('requires schedule_config.recurrence');
    expect(() => advanceMaintenanceDate('2026-08-22T12:00:00.000Z', 'custom', 1, { recurrence: { unit: 'fortnights' } }))
      .toThrow('Invalid custom maintenance recurrence');
  });

  describe('custom recurrence', () => {
    it('multiplies the unit by frequency_interval and keeps the time of day', () => {
      expect(next('2026-08-22T12:00:00.000Z', 45, { unit: 'days' })).toBe('2026-10-06T12:00:00.000Z');
      expect(next('2026-08-22T12:00:00.000Z', 3, { unit: 'weeks' })).toBe('2026-09-12T12:00:00.000Z');
      expect(next('2026-01-31T12:00:00.000Z', 1, { unit: 'months' })).toBe('2026-02-28T12:00:00.000Z');
      expect(next('2024-02-29T12:00:00.000Z', 1, { unit: 'years' })).toBe('2025-02-28T12:00:00.000Z');
    });

    it('picks the next listed weekday in the same week, then jumps interval weeks', () => {
      // 2026-08-22 is a Saturday; Mon/Thu every 2 weeks.
      expect(next('2026-08-22', 2, { unit: 'weeks', weekdays: [1, 4] })).toBe('2026-08-31T00:00:00.000Z');
      // Monday → Thursday of the same week.
      expect(next('2026-08-31', 2, { unit: 'weeks', weekdays: [4, 1] })).toBe('2026-09-03T00:00:00.000Z');
      // Thursday → Monday two weeks on.
      expect(next('2026-09-03', 2, { unit: 'weeks', weekdays: [1, 4] })).toBe('2026-09-14T00:00:00.000Z');
      // Sunday is the first day of the week.
      expect(next('2026-08-23', 1, { unit: 'weeks', weekdays: [0] })).toBe('2026-08-30T00:00:00.000Z');
    });

    it('picks the next listed day of month, clamping to the month length', () => {
      expect(next('2026-02-10', 1, { unit: 'months', days_of_month: [1, 15] })).toBe('2026-02-15T00:00:00.000Z');
      expect(next('2026-02-15', 1, { unit: 'months', days_of_month: [1, 15] })).toBe('2026-03-01T00:00:00.000Z');
      expect(next('2026-02-10', 1, { unit: 'months', days_of_month: [31] })).toBe('2026-02-28T00:00:00.000Z');
      expect(next('2026-01-31', 3, { unit: 'months', days_of_month: [31] })).toBe('2026-04-30T00:00:00.000Z');
    });
  });
});

describe('parseCustomRecurrence', () => {
  it('rejects selectors that do not match the unit, duplicates, and unknown keys', () => {
    expect(() => parseCustomRecurrence({ recurrence: { unit: 'days', weekdays: [1] } })).toThrow('weekdays only applies');
    expect(() => parseCustomRecurrence({ recurrence: { unit: 'weeks', days_of_month: [1] } })).toThrow('days_of_month only applies');
    expect(() => parseCustomRecurrence({ recurrence: { unit: 'weeks', weekdays: [1, 1] } })).toThrow('unique');
    expect(() => parseCustomRecurrence({ recurrence: { unit: 'weeks', weekdays: [] } })).toThrow('Invalid custom');
    expect(() => parseCustomRecurrence({ recurrence: { unit: 'days', interval: 2 } })).toThrow('Unrecognized key');
    expect(() => parseCustomRecurrence({ checklist: ['x'] })).toThrow('requires schedule_config.recurrence');
    expect(parseCustomRecurrence({ recurrence: { unit: 'months', days_of_month: [15, 1] } }))
      .toEqual({ unit: 'months', days_of_month: [15, 1] });
  });
});
