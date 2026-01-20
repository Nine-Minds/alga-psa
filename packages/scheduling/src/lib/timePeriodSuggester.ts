import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import type { ITimePeriod, ITimePeriodSettings, ITimePeriodView } from '@alga-psa/types';

export type TimePeriodSettings = ITimePeriodSettings;

export class TimePeriodSuggester {
  private static parseDateValue(date: string | Temporal.PlainDate): Temporal.PlainDate {
    if (date instanceof Temporal.PlainDate) {
      return date;
    }
    return Temporal.PlainDate.from(date.split('T')[0]);
  }

  // Define a result type that includes success status and error message
  static suggestNewTimePeriod(
    settings: TimePeriodSettings[],
    existingPeriods: ITimePeriod[] = []
  ): { success: boolean; data?: ITimePeriodView; error?: string } {
    let currentDate = Temporal.Now.plainDateISO();

    if (existingPeriods.length > 0) {
      const latestEndDate = existingPeriods.reduce((maxDate, period) => {
        const endDate = this.parseDateValue(period.end_date);
        return Temporal.PlainDate.compare(endDate, maxDate) > 0 ? endDate : maxDate;
      }, this.parseDateValue(existingPeriods[0].end_date));
      currentDate = latestEndDate;
    }

    // Find the next applicable setting based on the next period's start date
    const nextPeriodStartDate =
      existingPeriods.length > 0
        ? existingPeriods.reduce((maxDate, period) => {
            const endDate = this.parseDateValue(period.end_date);
            return Temporal.PlainDate.compare(endDate, maxDate) > 0 ? endDate : maxDate;
          }, this.parseDateValue(existingPeriods[0].end_date))
        : currentDate;

    const applicableSettings = settings.filter((setting) => {
      // If no start_day is configured, the setting is always applicable
      if (setting.start_day === null || setting.start_day === undefined) return true;

      const startDay = setting.start_day;

      // For weekly settings, use dayOfWeek (1=Monday, 7=Sunday in ISO)
      // For monthly/yearly settings, use day of month
      if (setting.frequency_unit === 'week') {
        const dayOfWeek = nextPeriodStartDate.dayOfWeek;
        // end_day = 0 means "end of week" (Sunday = 7)
        if (typeof setting.end_day === 'number') {
          const endDay = setting.end_day === 0 ? 7 : setting.end_day;
          return dayOfWeek >= startDay && dayOfWeek <= endDay;
        }
        return dayOfWeek >= startDay;
      }

      // For monthly/yearly settings, check day of month
      // end_day = 0 means "end of month"
      if (typeof setting.end_day === 'number') {
        const endDay = setting.end_day === 0 ? nextPeriodStartDate.daysInMonth : setting.end_day;
        return nextPeriodStartDate.day >= startDay && nextPeriodStartDate.day <= endDay;
      }

      return nextPeriodStartDate.day >= startDay;
    });

    if (applicableSettings.length === 0) {
      return {
        success: false,
        error: 'No applicable time period settings found. Please check your time period settings.',
      };
    }

    // Use the first applicable setting (could be enhanced to handle multiple)
    const setting = applicableSettings[0];
    const startDate = currentDate;
    let endDate: Temporal.PlainDate;

    switch (setting.frequency_unit) {
      case 'day':
        endDate = startDate.add({ days: setting.frequency - 1 });
        break;
      case 'week':
        endDate = startDate.add({ weeks: setting.frequency });
        break;
      case 'month': {
        // Handle semi-monthly periods
        const daysInMonth = startDate.daysInMonth;
        const endDay = setting.end_day === 0 ? daysInMonth : Math.min(setting.end_day || 1, daysInMonth);

        // Determine base date for month calculations
        const baseDate = setting.start_day === 1 ? startDate : startDate.with({ day: 1 });

        if (setting.start_day === 1 && startDate.day === 1) {
          // First semi-monthly period (1st-16th)
          endDate = startDate.with({ day: endDay }).add({ days: 1 });
        } else {
          // Second semi-monthly period (16th-EOM) or mid-month start
          endDate = baseDate.add({ months: 1 }).with({ day: 1 });

          // If we're in the same month, use calculated end day
          if (endDate.month === startDate.month) {
            endDate = startDate.with({ day: endDay });
          }
        }
        break;
      }
      case 'year':
        endDate = startDate.add({ years: setting.frequency });
        break;
      default:
        throw new Error(`Unsupported frequency unit: ${setting.frequency_unit}`);
    }

    // Find the period with the latest end date to use its ID
    const latestPeriod =
      existingPeriods.length > 0
        ? existingPeriods.reduce((latest, period) => {
            const endDate = this.parseDateValue(period.end_date);
            const latestEndDate = this.parseDateValue(latest.end_date);
            return Temporal.PlainDate.compare(endDate, latestEndDate) > 0 ? period : latest;
          }, existingPeriods[0])
        : null;

    // Return view type with string dates
    return {
      success: true,
      data: {
        period_id: latestPeriod ? latestPeriod.period_id : uuidv4(),
        start_date: startDate.toString(),
        end_date: endDate.toString(),
        tenant: latestPeriod?.tenant,
      },
    };
  }

  static calculateEndDate(startDate: Temporal.PlainDate, settings: TimePeriodSettings): Temporal.PlainDate {
    let endDate: Temporal.PlainDate;

    switch (settings.frequency_unit) {
      case 'day':
        endDate = startDate.add({ days: settings.frequency - 1 });
        break;
      case 'week':
        endDate = startDate.add({ weeks: settings.frequency });
        break;
      case 'month':
        endDate = startDate.add({ months: settings.frequency }).subtract({ days: 1 });
        if (typeof settings.end_day === 'number' && settings.end_day !== 0) {
          endDate = endDate.with({ day: settings.end_day });
        }
        // end_day = 0 means "end of month", which is already handled by the subtract({ days: 1 }) above
        break;
      case 'year':
        endDate = startDate.add({ years: settings.frequency }).subtract({ days: 1 });
        break;
      default:
        throw new Error(`Unsupported frequency unit: ${settings.frequency_unit}`);
    }

    return endDate;
  }
}

