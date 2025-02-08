import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { ITimePeriodSettings, ITimePeriod, ITimePeriodView } from '@/interfaces/timeEntry.interfaces';


export type TimePeriodSettings = ITimePeriodSettings;

export class TimePeriodSuggester {
  private static parseDateValue(date: string | Temporal.PlainDate): Temporal.PlainDate {
    if (date instanceof Temporal.PlainDate) {
      return date;
    }
    return Temporal.PlainDate.from(date.split('T')[0]);
  }  
  static suggestNewTimePeriod(
    settings: TimePeriodSettings[],
    existingPeriods: ITimePeriod[] = []
  ): ITimePeriodView {
    let currentDate = Temporal.Now.plainDateISO();

    if (existingPeriods.length > 0) {
      const latestEndDate = existingPeriods.reduce((maxDate, period) => {
        const endDate = this.parseDateValue(period.end_date);
        return Temporal.PlainDate.compare(endDate, maxDate) > 0 ? endDate : maxDate;
      }, this.parseDateValue(existingPeriods[0].end_date));
      currentDate = latestEndDate;
    }

    // Find the next applicable setting based on the next period's start date
    const nextPeriodStartDate = existingPeriods.length > 0
      ? existingPeriods.reduce((maxDate, period) => {
          const endDate = this.parseDateValue(period.end_date);
          return Temporal.PlainDate.compare(endDate, maxDate) > 0 ? endDate : maxDate;
        }, this.parseDateValue(existingPeriods[0].end_date))
      : currentDate;

    const applicableSettings = settings.filter(setting => {
      if (!setting.start_day) return true;
      
      const startDay = setting.start_day;
      
      // If setting has an end_day, check if the next period's start date falls within this setting's range
      if (setting.end_day) {
        const endDay = setting.end_day === 0 ? nextPeriodStartDate.daysInMonth : setting.end_day;
        return nextPeriodStartDate.day >= startDay && nextPeriodStartDate.day <= endDay;
      }
      
      return nextPeriodStartDate.day >= startDay;
    });

    if (applicableSettings.length === 0) {
      throw new Error('No applicable time period settings found');
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
      case 'month':
        // if (setting.end_day) {
          // Handle semi-monthly periods
          const daysInMonth = startDate.daysInMonth;
          const endDay = setting.end_day === 0 ? daysInMonth : Math.min(setting.end_day || 1, daysInMonth);
          
          // Determine base date for month calculations
          const baseDate = setting.start_day === 1 ?
            startDate :
            startDate.with({ day: 1 });

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
        // } else {
        //   // Regular monthly period
        //   endDate = startDate.add({ months: setting.frequency });
        // }
        break;
      case 'year':
        endDate = startDate.add({ years: setting.frequency });
        break;
      default:
        throw new Error(`Unsupported frequency unit: ${setting.frequency_unit}`);
    }

    // Find the period with the latest end date to use its ID
    const latestPeriod = existingPeriods.length > 0
      ? existingPeriods.reduce((latest, period) => {
          const endDate = this.parseDateValue(period.end_date);
          const latestEndDate = this.parseDateValue(latest.end_date);
          return Temporal.PlainDate.compare(endDate, latestEndDate) > 0 ? period : latest;
        }, existingPeriods[0])
      : null;

    // Return view type with string dates
    return {
      period_id: latestPeriod ? latestPeriod.period_id : uuidv4(),
      start_date: startDate.toString(),
      end_date: endDate.toString()
    };
  }

  static calculateEndDate(
    startDate: Temporal.PlainDate,
    settings: TimePeriodSettings
  ): Temporal.PlainDate {
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
        if (settings.end_day) {
          endDate = endDate.with({ day: settings.end_day });
        }
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
