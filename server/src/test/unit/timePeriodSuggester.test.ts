import { describe, it, expect } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { TimePeriodSuggester } from '../../lib/timePeriodSuggester';
import { ITimePeriodSettings, ITimePeriod } from 'server/src/interfaces/timeEntry.interfaces';

const createTestSettings = (
  unit: 'day' | 'week' | 'month' | 'year',
  frequency: number,
  start_day?: number,
  end_day?: number
): ITimePeriodSettings => ({
  time_period_settings_id: 'test-settings-id',
  frequency_unit: unit,
  frequency,
  start_day,
  end_day,
  is_active: true,
  effective_from: Temporal.PlainDate.from('2024-01-01').toString(),
  created_at: Temporal.Now.plainDateTimeISO().toString(),
  updated_at: Temporal.Now.plainDateTimeISO().toString(),
  tenant: 'test-tenant-id'
});

describe('TimePeriodSuggester', () => {
  describe('suggestNewTimePeriod', () => {
    it('should suggest monthly periods with no existing periods', () => {
      const settings = [createTestSettings('month', 1)];
      const existingPeriods: ITimePeriod[] = [];
      const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
      expect(result.success).toBe(true);
      const period = result.data;

      expect(period?.start_date).toBe(Temporal.Now.plainDateISO().toString());
      expect(period?.end_date).toBe(
        Temporal.Now.plainDateISO().add({ months: 1 }).with({ day: 1 }).toString()
      );
    });

    it('should suggest monthly periods with existing periods', () => {
      const settings = [createTestSettings('month', 1)];
      const existingPeriods: ITimePeriod[] = [{
        period_id: 'test-period-1',
        start_date: '2025-01-01',
        end_date: '2025-02-01'
      }];
      const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
      expect(result.success).toBe(true);
      const period = result.data;

      expect(period?.start_date).toBe('2025-02-01');
      expect(period?.end_date).toBe('2025-03-01');
    });

    it('should suggest weekly periods', () => {
      const settings = [createTestSettings('week', 1)];
      const result = TimePeriodSuggester.suggestNewTimePeriod(settings);
      expect(result.success).toBe(true);
      const period = result.data;

      expect(period?.start_date).toBe(Temporal.Now.plainDateISO().toString());
      expect(period?.end_date).toBe(
        Temporal.Now.plainDateISO().add({ weeks: 1 }).toString()
      );
    });

    it('should suggest yearly periods', () => {
      const settings = [createTestSettings('year', 1)];
      const result = TimePeriodSuggester.suggestNewTimePeriod(settings);
      expect(result.success).toBe(true);
      const period = result.data;

      expect(period?.start_date).toBe(Temporal.Now.plainDateISO().toString());
      expect(period?.end_date).toBe(
        Temporal.Now.plainDateISO().add({ years: 1 }).toString()
      );
    });

    it('should handle multiple semi-monthly settings together', () => {
      const settings = [
        createTestSettings('month', 1, 1, 15),
        createTestSettings('month', 1, 16, 0)
      ];

      const existingPeriod: ITimePeriod[] = [{
        period_id: 'test-period-1',
        start_date: '2024-12-16',
        end_date: '2025-01-01'
      }];

      // Generate first period using first setting
      const period1Result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriod);
      expect(period1Result.success).toBe(true);
      const period1 = period1Result.data;
      expect(period1?.start_date).toBe('2025-01-01');
      expect(period1?.end_date).toBe('2025-01-16');

      // Generate second period using second setting
      const period2Result = TimePeriodSuggester.suggestNewTimePeriod(settings, [period1 as ITimePeriod]);
      expect(period2Result.success).toBe(true);
      const period2 = period2Result.data;
      expect(period2?.start_date).toBe('2025-01-16');
      expect(period2?.end_date).toBe('2025-02-01');

      // Generate next month's first period
      const period3Result = TimePeriodSuggester.suggestNewTimePeriod(settings, [period1 as ITimePeriod, period2 as ITimePeriod]);
      expect(period3Result.success).toBe(true);
      const period3 = period3Result.data;
      expect(period3?.start_date).toBe('2025-02-01');
      expect(period3?.end_date).toBe('2025-02-16');

      // Generate next month's second period
      const period4Result = TimePeriodSuggester.suggestNewTimePeriod(settings, [period1 as ITimePeriod, period2 as ITimePeriod, period3 as ITimePeriod]);
      expect(period4Result.success).toBe(true);
      const period4 = period4Result.data;
      expect(period4?.start_date).toBe('2025-02-16');
      expect(period4?.end_date).toBe('2025-03-01');
    });

    it('should handle February correctly in leap years', () => {
      const settings = [
        createTestSettings('month', 1, 1, 15),
        createTestSettings('month', 1, 16, 0)
      ];
      const existingPeriods: ITimePeriod[] = [{
        period_id: 'test-period-1',
        start_date: '2024-01-16',
        end_date: '2024-02-01'
      }];
      const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
      expect(result.success).toBe(true);
      const period = result.data;

      expect(period?.start_date).toBe('2024-02-01');
      expect(period?.end_date).toBe('2024-02-16');
    });

    it('should select settings based on period start date, not current date', () => {
      const settings = [
        createTestSettings('month', 1, 1, 15),  // First half of month
        createTestSettings('month', 1, 16, 0)   // Second half of month
      ];
      const existingPeriods: ITimePeriod[] = [{
        period_id: 'test-period-1',
        start_date: '2025-01-01',
        end_date: '2025-01-15'
      }];

      // Mock current date to be in the second half of the month
      const realNow = Temporal.Now.plainDateISO;
      Temporal.Now.plainDateISO = () => Temporal.PlainDate.from('2025-01-20');

      try {
        const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
        expect(result.success).toBe(true);
        const period = result.data;
        
        // Should use second half settings since period starts on the 16th,
        // even though current date is the 20th
        expect(period?.start_date).toBe('2025-01-15');
        expect(period?.end_date).toBe('2025-02-01');
      } finally {
        // Restore the real Now.plainDateISO
        Temporal.Now.plainDateISO = realNow;
      }
    });

    it('should handle current date before next period start date in semi-monthly periods', () => {
      const settings = [
        createTestSettings('month', 1, 1, 15),  // First half of month
        createTestSettings('month', 1, 16, 0)   // Second half of month
      ];
      const existingPeriods: ITimePeriod[] = [{
        period_id: 'test-period-1',
        start_date: '2025-01-01',
        end_date: '2025-01-15'
      }];

      // Mock current date to be before the next period's start date (16th)
      const realNow = Temporal.Now.plainDateISO;
      Temporal.Now.plainDateISO = () => Temporal.PlainDate.from('2025-01-13');

      try {
        const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
        expect(result.success).toBe(true);
        const period = result.data;
        
        // Should use second half settings (16-EOM) for the next period
        // This verifies that we're not using the current date (14th) to select settings,
        // because if we were, it would incorrectly use first half settings (1-15)
        expect(period?.start_date).toBe('2025-01-15');
        expect(period?.end_date).toBe('2025-02-01');

        // This test will fail because the current implementation incorrectly uses
        // the current date (14th) to select settings, which makes it choose
        // first half settings (1-15) when it should be using second half (16-EOM)
      } finally {
        // Restore the real Now.plainDateISO
        Temporal.Now.plainDateISO = realNow;
      }
    });

    it('should suggest next period after existing periods', () => {
      const settings = [createTestSettings('month', 1)];
      const existingPeriods: ITimePeriod[] = [
        {
          period_id: 'test-period-1',
          start_date: '2024-12-25',
          end_date: '2025-01-14'
        },
        {
          period_id: 'test-period-2',
          start_date: '2024-12-17',
          end_date: '2024-12-24'
        },
        {
          period_id: 'test-period-3',
          start_date: '2024-11-01',
          end_date: '2024-11-30'
        }
      ];
      const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
      expect(result.success).toBe(true);
      const period = result.data;

      expect(period?.start_date).toBe('2025-01-14');
    });

    it('should suggest period starting in the future after current date', () => {
      const settings = [createTestSettings('month', 1)];
      const futureDate = '2025-06-01';
      const existingPeriods: ITimePeriod[] = [
        {
          period_id: 'test-period-1',
          start_date: '2025-05-01',
        end_date: futureDate
      }
      ];
      const result = TimePeriodSuggester.suggestNewTimePeriod(settings, existingPeriods);
      expect(result.success).toBe(true);
      const period = result.data;

      expect(period?.start_date).toBe(futureDate);
      expect(period?.end_date).toBe('2025-07-01');
    });
  });
});
