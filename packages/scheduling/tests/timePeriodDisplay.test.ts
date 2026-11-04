import { describe, expect, test } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
  exclusiveEndToLastIncludedDay,
  lastIncludedDayToExclusiveEnd,
  formatPeriodLastDay,
  toDialogDates,
  toStoredPeriod,
  validateDialogPeriod,
} from '../src/lib/timePeriodDisplay';
import { TimePeriodSuggester } from '../src/lib/timePeriodSuggester';
import type { ITimePeriodSettings } from '@alga-psa/types';

const d = (s: string) => Temporal.PlainDate.from(s);

describe('conversion helpers', () => {
  test('exclusive end <-> last included day', () => {
    expect(exclusiveEndToLastIncludedDay('2026-08-23').toString()).toBe('2026-08-22');
    expect(lastIncludedDayToExclusiveEnd(d('2026-08-22')).toString()).toBe('2026-08-23');
  });
});

describe('create', () => {
  test('start 8/16 + last day 8/22 saves end_date 8/23 (issue repro)', () => {
    expect(toStoredPeriod({ startDate: d('2026-08-16'), lastDay: d('2026-08-22') })).toEqual({
      start_date: '2026-08-16',
      end_date: '2026-08-23',
    });
  });

  test('weekly suggester prefill shows last day 1/07', () => {
    const settings = {
      time_period_settings_id: 's',
      frequency: 1,
      frequency_unit: 'week',
      is_active: true,
      effective_from: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      tenant: 't',
    } as ITimePeriodSettings;
    const end = TimePeriodSuggester.calculateEndDate(d('2026-01-01'), settings);
    expect(end.toString()).toBe('2026-01-08');
    const dialog = toDialogDates({ start_date: '2026-01-01', end_date: end });
    expect(dialog.startDate.toString()).toBe('2026-01-01');
    expect(dialog.lastDay.toString()).toBe('2026-01-07');
  });
});

describe('edit round-trip', () => {
  test.each([
    ['simple', '2026-08-16', '2026-08-23', '2026-08-22'],
    ['month boundary', '2026-01-26', '2026-02-01', '2026-01-31'],
    ['leap-year Feb 29', '2028-02-23', '2028-03-01', '2028-02-29'],
    ['ends after Feb 29', '2028-02-26', '2028-02-29', '2028-02-28'],
  ])('%s', (_name, start, end, expectedLast) => {
    const dialog = toDialogDates({ start_date: start, end_date: end });
    expect(dialog.lastDay.toString()).toBe(expectedLast);
    expect(toStoredPeriod(dialog)).toEqual({ start_date: start, end_date: end });
  });
});

describe('validateDialogPeriod', () => {
  const existing = [
    { period_id: 'a', start_date: '2026-08-09', end_date: '2026-08-16' },
    { period_id: 'b', start_date: '2026-08-23', end_date: '2026-08-30' },
  ];

  test('requires a start date', () => {
    expect(validateDialogPeriod({ startDate: null, lastDay: d('2026-08-22') }, [])).toBe('startDateRequired');
  });

  test('one-day period is valid', () => {
    expect(validateDialogPeriod({ startDate: d('2026-08-16'), lastDay: d('2026-08-16') }, [])).toBeNull();
  });

  test('last day before start -> startAfterEnd', () => {
    expect(validateDialogPeriod({ startDate: d('2026-08-16'), lastDay: d('2026-08-15') }, [])).toBe('startAfterEnd');
  });

  test('touching periods are allowed', () => {
    // 8/16-8/22 stored [8/16, 8/23) touches a (ends 8/16) and b (starts 8/23)
    expect(validateDialogPeriod({ startDate: d('2026-08-16'), lastDay: d('2026-08-22') }, existing)).toBeNull();
  });

  test('last day equal to existing start -> overlap', () => {
    expect(validateDialogPeriod({ startDate: d('2026-08-16'), lastDay: d('2026-08-23') }, existing)).toBe('overlap');
  });

  test('start inside existing last day -> overlap', () => {
    expect(validateDialogPeriod({ startDate: d('2026-08-15'), lastDay: d('2026-08-22') }, existing)).toBe('overlap');
  });

  test('edit mode excludes the period being edited', () => {
    const dialog = { startDate: d('2026-08-09'), lastDay: d('2026-08-15') };
    expect(validateDialogPeriod(dialog, existing)).toBe('overlap');
    expect(validateDialogPeriod(dialog, existing, 'a')).toBeNull();
  });
});

describe('formatPeriodLastDay', () => {
  test('accepts YYYY-MM-DD', () => {
    expect(formatPeriodLastDay('2026-08-23')).toBe('2026-08-22');
  });
  test('accepts full ISO timestamps', () => {
    expect(formatPeriodLastDay('2026-08-23T00:00:00.000Z')).toBe('2026-08-22');
  });
});
