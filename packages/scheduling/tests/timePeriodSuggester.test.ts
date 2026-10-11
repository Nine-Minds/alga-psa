import { describe, expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { TimePeriodSuggester } from '../src/lib/timePeriodSuggester';
import type { ITimePeriod, ITimePeriodSettings } from '@alga-psa/types';

function makeSettings(overrides: Partial<ITimePeriodSettings>): ITimePeriodSettings {
  return {
    time_period_settings_id: 'settings-1',
    frequency: 1,
    frequency_unit: 'week',
    is_active: true,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: undefined,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    tenant: 'tenant-1',
    ...overrides,
  };
}

describe('TimePeriodSuggester', () => {
  test('suggests next weekly period from latest end_date', () => {
    const settings = [makeSettings({ frequency_unit: 'week', frequency: 1, start_day: 1 })];

    const existingPeriods: ITimePeriod[] = [
      {
        tenant: 'tenant-1',
        period_id: 'p1',
        start_date: '2025-12-25',
        end_date: '2026-01-01',
      },
    ];

    const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
    expect(result.success).toBe(true);
    expect(result.data?.start_date).toBe('2026-01-01');
    expect(result.data?.end_date).toBe('2026-01-08');
  });

  test('supports semi-monthly month settings using start_day/end_day', () => {
    const settings = [makeSettings({ frequency_unit: 'month', frequency: 1, start_day: 1, end_day: 16 })];

    const existingPeriods: ITimePeriod[] = [
      {
        tenant: 'tenant-1',
        period_id: 'p1',
        start_date: '2026-01-01',
        end_date: '2026-02-01',
      },
    ];

    const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
    expect(result.success).toBe(true);
    expect(result.data?.start_date).toBe('2026-02-01');
    // Code uses half-open intervals; first period ends at end_day + 1 day.
    expect(result.data?.end_date).toBe('2026-02-17');
  });

  test('returns an error when no applicable setting matches', () => {
    const settings = [makeSettings({ frequency_unit: 'week', frequency: 1, start_day: 7, end_day: 7 })];

    const existingPeriods: ITimePeriod[] = [
      {
        tenant: 'tenant-1',
        period_id: 'p1',
        start_date: '2026-01-05', // Monday
        end_date: '2026-01-12', // Monday
      },
    ];

    const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No applicable time period settings found');
  });

  describe('calculateEndDate (exclusive end)', () => {
    const d = (v: string) => Temporal.PlainDate.from(v);
    const end = (start: string, o: Partial<ITimePeriodSettings>) =>
      TimePeriodSuggester.calculateEndDate(d(start), makeSettings(o)).toString();

    test('day f=1 and f=7', () => {
      expect(end('2026-01-01', { frequency_unit: 'day', frequency: 1 })).toBe('2026-01-02');
      expect(end('2026-01-01', { frequency_unit: 'day', frequency: 7 })).toBe('2026-01-08');
    });

    test('week f=1 and f=2', () => {
      expect(end('2026-01-01', { frequency_unit: 'week', frequency: 1 })).toBe('2026-01-08');
      expect(end('2026-01-01', { frequency_unit: 'week', frequency: 2 })).toBe('2026-01-15');
    });

    test('month without end_day', () => {
      expect(end('2026-01-01', { frequency_unit: 'month', frequency: 1 })).toBe('2026-02-01');
    });

    test('month end_day=0 (end of month)', () => {
      expect(end('2026-01-01', { frequency_unit: 'month', frequency: 1, end_day: 0 })).toBe('2026-02-01');
      expect(end('2026-01-10', { frequency_unit: 'month', frequency: 2, end_day: 0 })).toBe('2026-03-01');
    });

    test('month end_day=15 from the 1st ends after the 15th', () => {
      expect(end('2026-01-01', { frequency_unit: 'month', frequency: 1, end_day: 15 })).toBe('2026-01-16');
    });

    test('month end_day=15 from the 16th rolls to next month', () => {
      expect(end('2026-01-16', { frequency_unit: 'month', frequency: 1, end_day: 15 })).toBe('2026-02-16');
    });

    test('month end_day=31 in a 30-day month clamps to the last day', () => {
      expect(end('2026-04-01', { frequency_unit: 'month', frequency: 1, end_day: 31 })).toBe('2026-05-01');
    });

    test('year', () => {
      expect(end('2026-01-01', { frequency_unit: 'year', frequency: 1 })).toBe('2027-01-01');
    });

    test.each([
      ['day', { frequency_unit: 'day', frequency: 7 }],
      ['week', { frequency_unit: 'week', frequency: 2 }],
      ['month', { frequency_unit: 'month', frequency: 1, start_day: 1, end_day: 15 }],
      ['year', { frequency_unit: 'year', frequency: 1 }],
    ] as const)('matches suggestNewTimePeriod end (%s)', (_unit, overrides) => {
      const setting = makeSettings(overrides as Partial<ITimePeriodSettings>);
      const existing: ITimePeriod[] = [
        { tenant: 'tenant-1', period_id: 'p0', start_date: '2025-12-01', end_date: '2026-01-01' },
      ];
      const suggestion = TimePeriodSuggester.suggestNewTimePeriod([setting], existing);
      expect(suggestion.success).toBe(true);
      const start = d(suggestion.data!.start_date as string);
      expect(TimePeriodSuggester.calculateEndDate(start, setting).toString()).toBe(suggestion.data!.end_date);
    });
  });
});
