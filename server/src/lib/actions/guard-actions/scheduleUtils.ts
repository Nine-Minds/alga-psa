/**
 * Alga Guard - Schedule Utility Functions
 *
 * Pure functions for schedule validation and date calculation.
 * These are NOT server actions.
 */

import {
  GuardScheduleFrequency,
  GuardDayOfWeek,
  DAY_OF_WEEK_MAP,
  MIN_DAY_OF_MONTH,
  MAX_DAY_OF_MONTH,
  TIME_FORMAT_REGEX,
} from '../../../interfaces/guard/schedule.interfaces';

/**
 * Validate time format (HH:MM, 24-hour)
 */
export function validateTimeFormat(time: string): boolean {
  return TIME_FORMAT_REGEX.test(time);
}

/**
 * Validate day of month (1-28)
 */
export function validateDayOfMonth(day: number): boolean {
  return Number.isInteger(day) && day >= MIN_DAY_OF_MONTH && day <= MAX_DAY_OF_MONTH;
}

/**
 * Calculate next run date based on schedule parameters
 * Uses UTC internally for consistency across timezones.
 * Note: In production, you would use a proper timezone library like luxon or date-fns-tz
 * to convert the timezone parameter to UTC offsets.
 */
export function calculateNextRunAt(
  frequency: GuardScheduleFrequency,
  timeOfDay: string,
  _timezone: string,  // TODO: Implement proper timezone support with luxon
  dayOfWeek?: GuardDayOfWeek,
  dayOfMonth?: number,
  fromDate: Date = new Date()
): Date {
  // Parse time
  const [hours, minutes] = timeOfDay.split(':').map(Number);

  // Create date using UTC methods for consistency
  const nextRun = new Date(fromDate);
  nextRun.setUTCHours(hours, minutes, 0, 0);

  // If time has passed today, start from tomorrow
  if (nextRun <= fromDate) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }

  switch (frequency) {
    case 'daily':
      // Already calculated above
      break;

    case 'weekly':
      if (dayOfWeek) {
        const targetDay = DAY_OF_WEEK_MAP[dayOfWeek];
        const currentDay = nextRun.getUTCDay();
        let daysUntilTarget = targetDay - currentDay;
        if (daysUntilTarget < 0) {
          daysUntilTarget += 7;
        }
        if (daysUntilTarget === 0 && nextRun <= fromDate) {
          daysUntilTarget = 7;
        }
        nextRun.setUTCDate(nextRun.getUTCDate() + daysUntilTarget);
      }
      break;

    case 'monthly':
      if (dayOfMonth) {
        // Set to the target day of month
        nextRun.setUTCDate(dayOfMonth);
        // If we've passed it this month, go to next month
        if (nextRun <= fromDate) {
          nextRun.setUTCMonth(nextRun.getUTCMonth() + 1);
        }
      }
      break;
  }

  return nextRun;
}
