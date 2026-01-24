import { describe, expect, test } from 'vitest';
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
});

