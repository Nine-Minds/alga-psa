import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, test } from 'vitest';
import { TimePeriodSuggester, periodContaining, cellEnd, alignedPeriodStart, isSettingEffectiveOn } from '../src/lib/timePeriodSuggester';
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
        start_date: '2025-12-29', // Monday
        end_date: '2026-01-05', // Monday: on the grid
      },
    ];

    const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods, { today: '2026-01-05' });
    expect(result.success).toBe(true);
    expect(result.data?.start_date).toBe('2026-01-05');
    expect(result.data?.end_date).toBe('2026-01-12');
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

    const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods, { today: '2026-02-01' });
    expect(result.success).toBe(true);
    expect(result.data?.start_date).toBe('2026-02-01');
    // Code uses half-open intervals; first period ends at end_day + 1 day.
    expect(result.data?.end_date).toBe('2026-02-17');
  });

  test('bridges to the grid when the latest period ended off the grid', () => {
    const settings = [makeSettings({ frequency_unit: 'week', frequency: 1, start_day: 7, end_day: 7 })];
    const existingPeriods: ITimePeriod[] = [
      { tenant: 'tenant-1', period_id: 'p1', start_date: '2026-01-05', end_date: '2026-01-12' }, // Monday
    ];
    const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods, { today: '2026-01-12' });
    expect(result.success).toBe(true);
    expect(result.data?.start_date).toBe('2026-01-12');
    expect(result.data?.end_date).toBe('2026-01-18');
  });
});

const suggest = (
  settings: ITimePeriodSettings[],
  today: string,
  periods: ITimePeriod[] = []
) => TimePeriodSuggester.suggestNewTimePeriod(settings, periods, { today });

const period = (start: string, end: string): ITimePeriod => ({ tenant: 'tenant-1', period_id: `p-${start}`, start_date: start, end_date: end });

describe('TimePeriodSuggester grid (#3206)', () => {
  test('1. weekly Sunday start, end of week: any weekday gives the current Sun->Sun cell', () => {
    const settings = [makeSettings({ start_day: 7, end_day: 0 })];
    for (let d = 4; d <= 10; d++) {
      const r = suggest(settings, `2026-10-${String(d).padStart(2, '0')}`);
      expect(r.data?.start_date).toBe('2026-10-04');
      expect(r.data?.end_date).toBe('2026-10-11');
    }
  });

  test('2. wrapped weekly range Sun->Sat', () => {
    const r = suggest([makeSettings({ start_day: 7, end_day: 6 })], '2026-10-07');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-04', '2026-10-11']);
  });

  test('3. weekly Monday start on a Monday starts today', () => {
    const r = suggest([makeSettings({ start_day: 1, end_day: 0 })], '2026-10-05');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-05', '2026-10-12']);
  });

  test('4. monthly mid-month', () => {
    const r = suggest([makeSettings({ frequency_unit: 'month', start_day: 1, end_day: 0 })], '2026-10-17');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-01', '2026-11-01']);
  });

  test('5. semi-monthly pair', () => {
    const settings = [
      makeSettings({ frequency_unit: 'month', start_day: 1, end_day: 15 }),
      makeSettings({ frequency_unit: 'month', start_day: 16, end_day: 0 }),
    ];
    let r = suggest(settings, '2026-10-20');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-16', '2026-11-01']);
    r = suggest(settings, '2026-10-03');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-01', '2026-10-16']);
    r = suggest(settings, '2026-10-20', [period('2026-10-01', '2026-10-16')]);
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-16', '2026-11-01']);
  });

  test('6. wrapped monthly range 15th to 14th', () => {
    const r = suggest([makeSettings({ frequency_unit: 'month', start_day: 15, end_day: 14 })], '2026-10-03');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-09-15', '2026-10-15']);
  });

  test('7. start_day 31 clamps to the end of February', () => {
    const s = makeSettings({ frequency_unit: 'month', start_day: 31, end_day: 0 });
    expect(alignedPeriodStart(s, Temporal.PlainDate.from('2027-02-28'))?.toString()).toBe('2027-02-28');
    expect(alignedPeriodStart(s, Temporal.PlainDate.from('2028-02-29'))?.toString()).toBe('2028-02-29');
    expect(cellEnd(s, Temporal.PlainDate.from('2027-02-28')).toString()).toBe('2027-03-01');
    const r = suggest([s], '2027-02-28');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2027-02-28', '2027-03-01']);
  });

  test('8. effective_from after the aligned start clamps the first period', () => {
    const s = makeSettings({ start_day: 7, end_day: 0, effective_from: '2026-10-07T00:00:00.000Z' });
    const r = suggest([s], '2026-10-09');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-07', '2026-10-11']);
  });

  test('9. future effective_from yields the first cell starting there', () => {
    const s = makeSettings({ start_day: 7, end_day: 0, effective_from: '2026-10-20T00:00:00.000Z' });
    const r = suggest([s], '2026-10-09');
    expect(r.data?.start_date).toBe('2026-10-20');
    expect(r.data?.end_date).toBe('2026-10-25');
  });

  test('10. biweekly phase is anchored at effective_from week', () => {
    const s = makeSettings({ frequency: 2, start_day: 7, end_day: 0, effective_from: '2026-09-23T00:00:00.000Z' });
    // anchor boundary: Sun 2026-09-20; cells: 09-20, 10-04, 10-18
    let r = suggest([s], '2026-10-09');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-04', '2026-10-18']);
    r = suggest([s], '2026-10-20');
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-18', '2026-11-01']);
  });

  test('11. subsequent period on the grid is a full week', () => {
    const r = suggest([makeSettings({ start_day: 7, end_day: 0 })], '2026-10-10', [period('2026-09-27', '2026-10-04')]);
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-10-04', '2026-10-11']);
  });

  test('12. off-grid latest end bridges, then the next call is a full week', () => {
    const settings = [makeSettings({ start_day: 7, end_day: 0 })];
    const first = suggest(settings, '2026-10-10', [period('2026-09-28', '2026-10-05')]); // Mon
    expect([first.data?.start_date, first.data?.end_date]).toEqual(['2026-10-05', '2026-10-11']);
    const second = suggest(settings, '2026-10-10', [period('2026-09-28', '2026-10-05'), period('2026-10-05', '2026-10-11')]);
    expect([second.data?.start_date, second.data?.end_date]).toEqual(['2026-10-11', '2026-10-18']);
  });

  test('13. gap skip for a lone 1-15 setting', () => {
    const r = suggest([makeSettings({ frequency_unit: 'month', start_day: 1, end_day: 15 })], '2026-10-20', [period('2026-10-01', '2026-10-16')]);
    expect([r.data?.start_date, r.data?.end_date]).toEqual(['2026-11-01', '2026-11-16']);
  });

  test('14. effective_to in the past and no other setting gives noApplicableSettings', () => {
    const s = makeSettings({ start_day: 7, end_day: 0, effective_to: '2026-06-01T00:00:00.000Z' });
    const r = suggest([s], '2026-10-09');
    expect(r.success).toBe(false);
    expect(r.errorKey).toBe('timeEntry.periods.errors.noApplicableSettings');
  });

  test('helpers: effectiveness and containment', () => {
    const s = makeSettings({ start_day: 7, end_day: 0, effective_to: '2026-10-31T00:00:00.000Z' });
    expect(isSettingEffectiveOn(s, Temporal.PlainDate.from('2026-10-31'))).toBe(true);
    expect(isSettingEffectiveOn(s, Temporal.PlainDate.from('2026-11-01'))).toBe(false);
    expect(periodContaining(s, Temporal.PlainDate.from('2026-12-01'))).toBeNull();
  });

  // Ported from the removed server/src/test/unit/timePeriodSuggester.test.ts (assertions that still hold).
  describe('ported semi-monthly and monthly chains', () => {
    const semiMonthly = [
      makeSettings({ frequency_unit: 'month', start_day: 1, end_day: 15, effective_from: '2024-01-01T00:00:00.000Z' }),
      makeSettings({ frequency_unit: 'month', start_day: 16, end_day: 0, effective_from: '2024-01-01T00:00:00.000Z' }),
    ];
    const monthly = [makeSettings({ frequency_unit: 'month', start_day: 1, end_day: 0, effective_from: '2024-01-01T00:00:00.000Z' })];

    test('chains semi-monthly settings across months', () => {
      const p0 = period('2024-12-16', '2025-01-01');
      const p1 = suggest(semiMonthly, '2025-01-01', [p0]).data!;
      expect([p1.start_date, p1.end_date]).toEqual(['2025-01-01', '2025-01-16']);
      const p2 = suggest(semiMonthly, '2025-01-01', [p1 as ITimePeriod]).data!;
      expect([p2.start_date, p2.end_date]).toEqual(['2025-01-16', '2025-02-01']);
      const p3 = suggest(semiMonthly, '2025-01-01', [p1, p2] as ITimePeriod[]).data!;
      expect([p3.start_date, p3.end_date]).toEqual(['2025-02-01', '2025-02-16']);
      const p4 = suggest(semiMonthly, '2025-01-01', [p1, p2, p3] as ITimePeriod[]).data!;
      expect([p4.start_date, p4.end_date]).toEqual(['2025-02-16', '2025-03-01']);
    });

    test('semi-monthly in a leap-year February', () => {
      const r = suggest(semiMonthly, '2024-02-01', [period('2024-01-16', '2024-02-01')]);
      expect([r.data?.start_date, r.data?.end_date]).toEqual(['2024-02-01', '2024-02-16']);
    });

    test('monthly with existing periods', () => {
      const r = suggest(monthly, '2025-02-01', [period('2025-01-01', '2025-02-01')]);
      expect([r.data?.start_date, r.data?.end_date]).toEqual(['2025-02-01', '2025-03-01']);
    });

    test('next period starts at the latest end date regardless of list order', () => {
      const r = suggest(monthly, '2025-01-14', [
        period('2024-12-25', '2025-01-14'),
        period('2024-12-17', '2024-12-24'),
        period('2024-11-01', '2024-11-30'),
      ]);
      expect(r.data?.start_date).toBe('2025-01-14');
      expect(r.data?.end_date).toBe('2025-02-01');
    });

    test('period ending in the future still continues from its end date', () => {
      const r = suggest(monthly, '2025-05-10', [period('2025-05-01', '2025-06-01')]);
      expect([r.data?.start_date, r.data?.end_date]).toEqual(['2025-06-01', '2025-07-01']);
    });
  });
});
