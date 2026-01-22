/**
 * Business Hours Calculator Service
 *
 * Provides utilities for calculating elapsed time within business hours,
 * considering:
 * - Business hours schedules (daily start/end times)
 * - Holidays
 * - Timezone handling
 * - 24x7 mode (always counting)
 *
 * This service is used by the SLA system to calculate:
 * - When SLA timers should be running vs paused
 * - Elapsed business time for tickets
 * - SLA deadline calculations
 */

import { IBusinessHoursScheduleWithEntries, IBusinessHoursEntry, IHoliday } from '../types';

/**
 * Result of a business hours calculation
 */
export interface BusinessTimeResult {
  /** Total business minutes elapsed */
  businessMinutes: number;
  /** Whether we're currently within business hours */
  isWithinBusinessHours: boolean;
  /** Next time business hours start (if not currently in business hours) */
  nextBusinessHoursStart?: Date;
}

/**
 * Check if a given date/time is within business hours for a schedule.
 *
 * @param schedule - The business hours schedule with entries and holidays
 * @param datetime - The datetime to check (in any timezone, will be converted)
 * @returns true if the datetime is within business hours
 */
export function isWithinBusinessHours(
  schedule: IBusinessHoursScheduleWithEntries,
  datetime: Date
): boolean {
  // 24x7 schedules are always within business hours
  if (schedule.is_24x7) {
    return true;
  }

  // Convert to schedule timezone
  const localTime = convertToTimezone(datetime, schedule.timezone);
  const dayOfWeek = localTime.getDay(); // 0 = Sunday
  const timeString = formatTimeString(localTime);

  // Check if it's a holiday
  if (isHoliday(schedule.holidays || [], localTime)) {
    return false;
  }

  // Find the entry for this day
  const entry = schedule.entries.find(e => e.day_of_week === dayOfWeek);
  if (!entry || !entry.is_enabled) {
    return false;
  }

  // Check if time is within range
  return timeString >= entry.start_time && timeString < entry.end_time;
}

/**
 * Get the next time business hours start, given a datetime.
 *
 * @param schedule - The business hours schedule with entries and holidays
 * @param datetime - The starting datetime
 * @returns The next datetime when business hours begin (or the input if already in business hours)
 */
export function getNextBusinessHoursStart(
  schedule: IBusinessHoursScheduleWithEntries,
  datetime: Date
): Date {
  // 24x7 schedules are always "now"
  if (schedule.is_24x7) {
    return datetime;
  }

  const localTime = convertToTimezone(datetime, schedule.timezone);
  let currentDate = new Date(localTime);

  // Search up to 14 days ahead (2 weeks should be enough to find a business day)
  for (let i = 0; i < 14; i++) {
    const dayOfWeek = currentDate.getDay();
    const timeString = formatTimeString(currentDate);

    // Skip holidays
    if (!isHoliday(schedule.holidays || [], currentDate)) {
      const entry = schedule.entries.find(e => e.day_of_week === dayOfWeek);

      if (entry && entry.is_enabled) {
        // If we're before start time on a business day
        if (timeString < entry.start_time) {
          // Return start time today
          const [hours, minutes] = entry.start_time.split(':').map(Number);
          currentDate.setHours(hours, minutes, 0, 0);
          return convertFromTimezone(currentDate, schedule.timezone);
        }

        // If we're still within business hours
        if (timeString < entry.end_time) {
          return convertFromTimezone(currentDate, schedule.timezone);
        }
      }
    }

    // Move to start of next day
    currentDate.setDate(currentDate.getDate() + 1);
    currentDate.setHours(0, 0, 0, 0);
  }

  // Fallback: return original datetime (shouldn't happen with valid schedules)
  return datetime;
}

/**
 * Calculate elapsed business minutes between two datetimes.
 *
 * This is the core calculation for SLA tracking. It counts only the minutes
 * that fall within business hours, excluding holidays.
 *
 * @param schedule - The business hours schedule with entries and holidays
 * @param startTime - Start of the period
 * @param endTime - End of the period
 * @returns Object containing business minutes and current status
 */
export function calculateElapsedBusinessMinutes(
  schedule: IBusinessHoursScheduleWithEntries,
  startTime: Date,
  endTime: Date
): BusinessTimeResult {
  // 24x7 mode: just count all minutes
  if (schedule.is_24x7) {
    const totalMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / 60000);
    return {
      businessMinutes: Math.max(0, totalMinutes),
      isWithinBusinessHours: true
    };
  }

  let businessMinutes = 0;
  let currentTime = new Date(startTime);

  // Convert to schedule timezone for calculations
  const localStart = convertToTimezone(startTime, schedule.timezone);
  const localEnd = convertToTimezone(endTime, schedule.timezone);
  let localCurrent = new Date(localStart);

  // Iterate minute by minute (for accuracy with partial hours)
  // Optimization: we could iterate by larger chunks when fully within business hours
  while (localCurrent < localEnd) {
    const dayOfWeek = localCurrent.getDay();
    const timeString = formatTimeString(localCurrent);

    // Check if this minute is within business hours
    if (!isHoliday(schedule.holidays || [], localCurrent)) {
      const entry = schedule.entries.find(e => e.day_of_week === dayOfWeek);

      if (entry && entry.is_enabled) {
        if (timeString >= entry.start_time && timeString < entry.end_time) {
          businessMinutes++;
        }
      }
    }

    // Move to next minute
    localCurrent = new Date(localCurrent.getTime() + 60000);
  }

  const isCurrentlyWithinBusinessHours = isWithinBusinessHours(schedule, endTime);
  const result: BusinessTimeResult = {
    businessMinutes,
    isWithinBusinessHours: isCurrentlyWithinBusinessHours
  };

  if (!isCurrentlyWithinBusinessHours) {
    result.nextBusinessHoursStart = getNextBusinessHoursStart(schedule, endTime);
  }

  return result;
}

/**
 * Calculate the deadline datetime given a start time and target minutes.
 *
 * This calculates when a deadline will be reached, accounting for business hours.
 * For example, if start is Friday 4pm and target is 120 minutes, the deadline
 * might be Monday 10am (if business hours are Mon-Fri 8am-5pm).
 *
 * @param schedule - The business hours schedule with entries and holidays
 * @param startTime - When the timer starts
 * @param targetMinutes - Target time in business minutes
 * @returns The deadline datetime
 */
export function calculateDeadline(
  schedule: IBusinessHoursScheduleWithEntries,
  startTime: Date,
  targetMinutes: number
): Date {
  // 24x7 mode: just add the minutes
  if (schedule.is_24x7) {
    return new Date(startTime.getTime() + targetMinutes * 60000);
  }

  let remainingMinutes = targetMinutes;
  let localCurrent = convertToTimezone(startTime, schedule.timezone);

  // Fast-forward to next business hours start if not currently in business hours
  if (!isWithinBusinessHours(schedule, startTime)) {
    const nextStart = getNextBusinessHoursStart(schedule, startTime);
    localCurrent = convertToTimezone(nextStart, schedule.timezone);
  }

  // Safety limit: don't search more than 365 days
  const maxIterations = 365 * 24 * 60; // 1 year in minutes
  let iterations = 0;

  while (remainingMinutes > 0 && iterations < maxIterations) {
    const dayOfWeek = localCurrent.getDay();
    const timeString = formatTimeString(localCurrent);

    // Check if this minute is within business hours
    if (!isHoliday(schedule.holidays || [], localCurrent)) {
      const entry = schedule.entries.find(e => e.day_of_week === dayOfWeek);

      if (entry && entry.is_enabled) {
        if (timeString >= entry.start_time && timeString < entry.end_time) {
          remainingMinutes--;
        }
      }
    }

    // Move to next minute
    localCurrent = new Date(localCurrent.getTime() + 60000);
    iterations++;
  }

  return convertFromTimezone(localCurrent, schedule.timezone);
}

/**
 * Get remaining business minutes until a deadline.
 *
 * @param schedule - The business hours schedule with entries and holidays
 * @param deadline - The deadline datetime
 * @param currentTime - Current time (defaults to now)
 * @returns Remaining business minutes (negative if past deadline)
 */
export function getRemainingBusinessMinutes(
  schedule: IBusinessHoursScheduleWithEntries,
  deadline: Date,
  currentTime: Date = new Date()
): number {
  if (currentTime >= deadline) {
    // Past deadline - calculate how much we've exceeded
    const elapsed = calculateElapsedBusinessMinutes(schedule, deadline, currentTime);
    return -elapsed.businessMinutes;
  }

  // Before deadline - calculate remaining
  const remaining = calculateElapsedBusinessMinutes(schedule, currentTime, deadline);
  return remaining.businessMinutes;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a date is a holiday in the given list.
 */
function isHoliday(holidays: IHoliday[], date: Date): boolean {
  const dateStr = formatDateString(date);
  const year = date.getFullYear();

  return holidays.some(holiday => {
    if (holiday.is_recurring) {
      // For recurring holidays, compare only month and day
      const holidayMonthDay = holiday.holiday_date.slice(5); // MM-DD
      const dateMonthDay = dateStr.slice(5);
      return holidayMonthDay === dateMonthDay;
    }
    return holiday.holiday_date === dateStr;
  });
}

/**
 * Convert a Date to a different timezone.
 * Returns a new Date object representing the same instant in the target timezone.
 */
function convertToTimezone(date: Date, timezone: string): Date {
  // Get the offset for the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';

  return new Date(
    parseInt(get('year')),
    parseInt(get('month')) - 1,
    parseInt(get('day')),
    parseInt(get('hour')),
    parseInt(get('minute')),
    parseInt(get('second'))
  );
}

/**
 * Convert a Date from a timezone back to UTC.
 * This is the inverse of convertToTimezone.
 */
function convertFromTimezone(localDate: Date, timezone: string): Date {
  // Create a date string in the local timezone
  const dateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}T${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}:${String(localDate.getSeconds()).padStart(2, '0')}`;

  // Parse it as if it's in the target timezone
  // This is a simplification - for production, consider using a library like date-fns-tz
  const options: Intl.DateTimeFormatOptions = { timeZone: timezone };
  const utcDate = new Date(dateStr);

  // Adjust for the timezone offset
  const utcString = utcDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzString = utcDate.toLocaleString('en-US', options);
  const utcTime = new Date(utcString).getTime();
  const tzTime = new Date(tzString).getTime();
  const offset = tzTime - utcTime;

  return new Date(localDate.getTime() - offset);
}

/**
 * Format time as HH:MM string (24-hour format).
 */
function formatTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Format date as YYYY-MM-DD string.
 */
function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Format remaining time as a human-readable string.
 *
 * @param minutes - Remaining minutes (can be negative for overdue)
 * @returns Formatted string like "2h 30m" or "45m" or "1d 4h"
 */
export function formatRemainingTime(minutes: number): string {
  const absMinutes = Math.abs(minutes);
  const isOverdue = minutes < 0;
  const prefix = isOverdue ? '-' : '';

  if (absMinutes < 60) {
    return `${prefix}${absMinutes}m`;
  }

  if (absMinutes < 1440) { // Less than 24 hours
    const hours = Math.floor(absMinutes / 60);
    const mins = absMinutes % 60;
    return mins > 0 ? `${prefix}${hours}h ${mins}m` : `${prefix}${hours}h`;
  }

  // 24 hours or more
  const days = Math.floor(absMinutes / 1440);
  const remainingHours = Math.floor((absMinutes % 1440) / 60);
  return remainingHours > 0 ? `${prefix}${days}d ${remainingHours}h` : `${prefix}${days}d`;
}
