import type { IScheduleEntry, IHoliday } from '@alga-psa/types';
import { Frequency, RRule, Weekday } from 'rrule';

/**
 * Helper to format a date as YYYY-MM-DD string.
 */
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date falls on a holiday.
 * Handles both one-time and recurring (annual) holidays.
 */
export function isHolidayDate(date: Date, holidays: IHoliday[]): boolean {
  if (!holidays || holidays.length === 0) return false;

  const dateStr = formatDateString(date);

  return holidays.some(holiday => {
    if (holiday.is_recurring) {
      // For recurring holidays, compare only month and day (MM-DD)
      const holidayMonthDay = holiday.holiday_date.slice(5);
      const dateMonthDay = dateStr.slice(5);
      return holidayMonthDay === dateMonthDay;
    }
    return holiday.holiday_date === dateStr;
  });
}

export interface GenerateOccurrencesOptions {
  /** Holidays to exclude from generated occurrences */
  holidays?: IHoliday[];
}

export function generateOccurrences(
  entry: IScheduleEntry,
  start: Date,
  end: Date,
  options?: GenerateOccurrencesOptions
): Date[] {
  try {
    if (!entry.recurrence_pattern) {
      return [new Date(entry.scheduled_start)];
    }
    const pattern = entry.recurrence_pattern;

    // Validate and normalize start date
    const dtstart = new Date(pattern.startDate);
    if (isNaN(dtstart.getTime())) {
      console.error('[generateOccurrences] Invalid start date:', pattern.startDate);
      return [new Date(entry.scheduled_start)];
    }
    dtstart.setHours(0, 0, 0, 0);

    // If end date exists, validate and normalize it
    let until: Date | undefined;
    if (pattern.endDate) {
      until = new Date(pattern.endDate);
      if (isNaN(until.getTime())) {
        console.error('[generateOccurrences] Invalid end date:', pattern.endDate);
        return [new Date(entry.scheduled_start)];
      }
      until.setHours(23, 59, 59, 999);
    }

    // Create RRule with error handling for frequency
    const freqKey = pattern.frequency.toUpperCase() as keyof typeof RRule;
    if (!(freqKey in RRule)) {
      console.error('[generateOccurrences] Invalid frequency:', pattern.frequency);
      return [new Date(entry.scheduled_start)];
    }
    const rrule = new RRule({
      freq: RRule[freqKey] as Frequency,
      interval: pattern.interval,
      dtstart,
      until,
      byweekday: pattern.daysOfWeek?.map((day): Weekday => {
        const days = 'MO TU WE TH FR SA SU'.split(' ');
        if (day < 0 || day >= days.length) {
          console.error('[generateOccurrences] Invalid day of week:', day);
          return RRule.MO;
        }
        return RRule[days[day] as keyof typeof RRule] as Weekday;
      }),
      bymonthday: pattern.dayOfMonth,
      bymonth: pattern.monthOfYear,
      count: pattern.count
    });

    // Normalize and validate range dates
    const rangeStart = new Date(start);
    if (isNaN(rangeStart.getTime())) {
      console.error('[generateOccurrences] Invalid range start date:', start);
      return [new Date(entry.scheduled_start)];
    }
    rangeStart.setHours(0, 0, 0, 0);
    rangeStart.setSeconds(rangeStart.getSeconds() - 1);

    const rangeEnd = new Date(end);
    if (isNaN(rangeEnd.getTime())) {
      console.error('[generateOccurrences] Invalid range end date:', end);
      return [new Date(entry.scheduled_start)];
    }
    rangeEnd.setHours(23, 59, 59, 999);

    // Get the base occurrences using normalized dates
    const baseOccurrences = rrule.between(rangeStart, rangeEnd);

    // Validate and get the original time
    const originalTime = new Date(entry.scheduled_start);
    if (isNaN(originalTime.getTime())) {
      console.error('[generateOccurrences] Invalid scheduled start time:', entry.scheduled_start);
      return baseOccurrences;
    }

    // Filter out the master entry's start date and apply the original time to each occurrence
    const masterStartDate = new Date(entry.scheduled_start);
    const occurrencesWithTime = baseOccurrences
      .filter((date): boolean => {
        const dateStr = date.toISOString().split('T')[0];
        const masterStr = masterStartDate.toISOString().split('T')[0];
        return dateStr !== masterStr;
      })
      .map((date): Date => applyTimeToDate(date, originalTime));

    // Apply exceptions with validation
    let filteredOccurrences = occurrencesWithTime;
    if (pattern.exceptions && Array.isArray(pattern.exceptions)) {
      try {
        const validExceptions = pattern.exceptions
          .map((d): Date | null => {
            try {
              const date = d instanceof Date ? d : new Date(d);
              if (isNaN(date.getTime())) {
                return null;
              }
              return date;
            } catch {
              return null;
            }
          })
          .filter((d): d is Date => d !== null);

        const exceptionDates = validExceptions.map((d): string => d.toISOString().split('T')[0]);

        filteredOccurrences = occurrencesWithTime.filter((date: Date): boolean => {
          const dateStr = date.toISOString().split('T')[0];
          return !exceptionDates.includes(dateStr);
        });
      } catch (error) {
        console.error('[generateOccurrences] Error processing exceptions:', error);
      }
    }

    // Filter out holidays (unified holidays table - used by SLA and scheduling)
    if (options?.holidays && options.holidays.length > 0) {
      filteredOccurrences = filteredOccurrences.filter(
        (date: Date): boolean => !isHolidayDate(date, options.holidays!)
      );
    }

    return filteredOccurrences;
  } catch (error) {
    console.error('[generateOccurrences] Unexpected error:', error);
    return [new Date(entry.scheduled_start)];
  }
}

export function applyTimeToDate(date: Date, time: Date): Date {
  try {
    const result = new Date(date);
    result.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());
    return result;
  } catch (error) {
    console.error('[applyTimeToDate] Error applying time:', error);
    return date;
  }
}
