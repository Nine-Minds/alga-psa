import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, test } from 'vitest';
import type { ITimePeriodSettings } from '@alga-psa/types';
import { endOfConfiguredTimePeriod } from '../src/lib/timePeriodCadence';
import { TimePeriodSuggester, periodContaining } from '../src/lib/timePeriodSuggester';

function makeSettings(overrides: Partial<ITimePeriodSettings>): ITimePeriodSettings {
  return {
    time_period_settings_id: 'settings-1',
    frequency: 1,
    frequency_unit: 'month',
    is_active: true,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: undefined,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    tenant: 'tenant-1',
    ...overrides,
  } as ITimePeriodSettings;
}

const d = (value: string) => Temporal.PlainDate.from(value);
const end = (start: string, overrides: Partial<ITimePeriodSettings>) =>
  endOfConfiguredTimePeriod(d(start), makeSettings(overrides)).toString();

describe('endOfConfiguredTimePeriod', () => {
  test('monthly end_day is the last INCLUDED day, so the exclusive end is end_day + 1', () => {
    expect(end('2026-03-01', { start_day: 1, end_day: 15 })).toBe('2026-03-16');
    // The sibling profile starts on the 16th and runs to the end of the month: they tile.
    expect(end('2026-03-16', { start_day: 16, end_day: 0 })).toBe('2026-04-01');
  });

  test('monthly end_day is clamped to short months (inclusive of the last day)', () => {
    expect(end('2026-02-01', { start_day: 1, end_day: 31 })).toBe('2026-03-01');
    expect(end('2024-02-01', { start_day: 1, end_day: 30 })).toBe('2024-03-01');
  });

  test('monthly end_day before the start day rolls into the next month', () => {
    expect(end('2026-03-16', { start_day: 16, end_day: 15 })).toBe('2026-04-16');
  });

  test('monthly frequency > 1 spans whole months', () => {
    expect(end('2026-01-01', { frequency: 3, end_day: 0 })).toBe('2026-04-01');
    expect(end('2026-01-01', { frequency: 2, start_day: 1, end_day: 15 })).toBe('2026-02-16');
  });

  test('day and week cadences are fixed lengths', () => {
    expect(end('2026-03-02', { frequency_unit: 'week', frequency: 2 })).toBe('2026-03-16');
    expect(end('2026-03-02', { frequency_unit: 'day', frequency: 10 })).toBe('2026-03-12');
  });

  test('yearly cells end at end_month / end_day_of_month (exclusive), so a profile can be seasonal', () => {
    // A July fiscal year is configured as July 1 .. end of June.
    const fiscal = { frequency_unit: 'year' as const, start_month: 7, start_day_of_month: 1, end_month: 6, end_day_of_month: 0 };
    expect(end('2026-07-01', fiscal)).toBe('2027-07-01');
    expect(end('2026-07-01', { ...fiscal, frequency: 2 })).toBe('2028-07-01');
    // July 1 .. end of December is a half-year profile; a sibling can cover January .. June.
    expect(end('2026-07-01', { frequency_unit: 'year', start_month: 7, start_day_of_month: 1, end_month: 12, end_day_of_month: 0 })).toBe('2027-01-01');
    expect(end('2026-01-01', { frequency_unit: 'year', start_month: 1, start_day_of_month: 1, end_month: 6, end_day_of_month: 0 })).toBe('2026-07-01');
    // end_day_of_month is an exclusive boundary.
    expect(end('2026-01-01', { frequency_unit: 'year', end_month: 3, end_day_of_month: 15 })).toBe('2026-03-15');
    // Defaults (end_month unset) are the calendar year.
    expect(end('2026-01-01', { frequency_unit: 'year' })).toBe('2027-01-01');
  });

  test('rejects an unsupported unit', () => {
    expect(() => end('2026-01-01', { frequency_unit: 'decade' as any })).toThrow();
  });
});

describe('suggester agrees with the shared cadence and skips inactive settings', () => {
  test('a yearly profile aligns to its configured month', () => {
    const yearly = makeSettings({
      frequency_unit: 'year',
      start_month: 7,
      start_day_of_month: 1,
      end_month: 6,
      end_day_of_month: 0,
      effective_from: '2025-07-01T00:00:00.000Z',
    });
    expect(periodContaining(yearly, d('2026-03-10'))).toEqual({ start: d('2025-07-01'), end: d('2026-07-01') });
  });

  test('a seasonal yearly profile has no cell outside its season', () => {
    const secondHalf = makeSettings({
      frequency_unit: 'year',
      start_month: 7,
      start_day_of_month: 1,
      end_month: 12,
      end_day_of_month: 0,
      effective_from: '2025-07-01T00:00:00.000Z',
    });
    expect(periodContaining(secondHalf, d('2025-10-10'))).toEqual({ start: d('2025-07-01'), end: d('2026-01-01') });
    expect(periodContaining(secondHalf, d('2026-03-10'))).toBeNull();
  });

  test('semi-monthly profiles tile without gap or overlap', () => {
    const first = makeSettings({ start_day: 1, end_day: 15 });
    const second = makeSettings({ time_period_settings_id: 'settings-2', start_day: 16, end_day: 0 });
    expect(periodContaining(first, d('2026-03-05'))).toEqual({ start: d('2026-03-01'), end: d('2026-03-16') });
    expect(periodContaining(second, d('2026-03-16'))).toEqual({ start: d('2026-03-16'), end: d('2026-04-01') });
  });

  test('an inactive setting yields no cell and is never suggested', () => {
    const inactive = makeSettings({ is_active: false, end_day: 0 });
    expect(periodContaining(inactive, d('2026-03-05'))).toBeNull();

    const active = makeSettings({ time_period_settings_id: 'settings-2', frequency_unit: 'week', start_day: 1 });
    const result = TimePeriodSuggester.suggestNewTimePeriod([inactive, active], [], { today: d('2026-03-05') });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ start_date: '2026-03-02', end_date: '2026-03-09' });

    expect(TimePeriodSuggester.suggestNewTimePeriod([inactive], [], { today: d('2026-03-05') }).success).toBe(false);
  });
});
