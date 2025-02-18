import { Temporal } from '@js-temporal/polyfill';
import { vi } from 'vitest';

/**
 * Options for creating test dates
 */
export interface TestDateOptions {
  /**
   * Year for the test date
   * @default current year
   */
  year?: number;

  /**
   * Month for the test date (1-12)
   * @default current month
   */
  month?: number;

  /**
   * Day of month for the test date
   * @default current day
   */
  day?: number;

  /**
   * Hour for the test date (0-23)
   * @default 0
   */
  hour?: number;

  /**
   * Minute for the test date
   * @default 0
   */
  minute?: number;

  /**
   * Second for the test date
   * @default 0
   */
  second?: number;

  /**
   * Millisecond for the test date
   * @default 0
   */
  millisecond?: number;

  /**
   * Time zone for the test date
   * @default 'UTC'
   */
  timeZone?: string;
}

/**
 * Creates a Temporal.ZonedDateTime for testing
 * @param options Test date options
 * @returns Temporal.ZonedDateTime instance
 */
export function createTestDate(options: TestDateOptions = {}): Temporal.ZonedDateTime {
  const now = Temporal.Now.zonedDateTimeISO();
  const {
    year = now.year,
    month = now.month,
    day = now.day,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
    timeZone = 'UTC'
  } = options;

  return Temporal.ZonedDateTime.from({
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
    timeZone
  });
}

/**
 * Creates an ISO string from test date options
 * @param options Test date options
 * @returns ISO string
 */
export function createTestDateISO(options: TestDateOptions = {}): string {
  return createTestDate(options).toInstant().toString();
}

/**
 * Sets up a fixed test date using Vitest's fake timers
 * @param date Date to freeze time at
 */
export function freezeTime(date: Date | string | TestDateOptions = {}): void {
  let frozenDate: Date;

  if (date instanceof Date) {
    frozenDate = date;
  } else if (typeof date === 'string') {
    frozenDate = new Date(date);
  } else {
    frozenDate = new Date(createTestDateISO(date));
  }

  vi.useFakeTimers();
  vi.setSystemTime(frozenDate);
}

/**
 * Restores the system time to normal
 */
export function unfreezeTime(): void {
  vi.useRealTimers();
}

/**
 * Creates test date helpers for a specific time zone
 * @param timeZone Time zone to use for dates
 * @returns Object with date helper functions
 */
export function createDateHelpers(timeZone: string) {
  return {
    /**
     * Creates a date in the specified time zone
     * @param options Test date options (timeZone will be overridden)
     */
    createDate: (options: Omit<TestDateOptions, 'timeZone'> = {}) => 
      createTestDate({ ...options, timeZone }),

    /**
     * Creates an ISO string in the specified time zone
     * @param options Test date options (timeZone will be overridden)
     */
    createDateISO: (options: Omit<TestDateOptions, 'timeZone'> = {}) =>
      createTestDateISO({ ...options, timeZone }),

    /**
     * Adds a duration to a date
     * @param date Base date
     * @param duration Duration to add (e.g., { days: 1, hours: 2 })
     */
    addDuration: (
      date: Temporal.ZonedDateTime,
      duration: Temporal.DurationLike
    ): Temporal.ZonedDateTime => date.add(duration),

    /**
     * Subtracts a duration from a date
     * @param date Base date
     * @param duration Duration to subtract
     */
    subtractDuration: (
      date: Temporal.ZonedDateTime,
      duration: Temporal.DurationLike
    ): Temporal.ZonedDateTime => date.subtract(duration),

    /**
     * Gets the start of a period relative to a date
     * @param date Base date
     * @param unit Time unit ('day', 'week', 'month', 'year')
     */
    startOf: (
      date: Temporal.ZonedDateTime,
      unit: 'day' | 'week' | 'month' | 'year'
    ): Temporal.ZonedDateTime => {
      switch (unit) {
        case 'day':
          return date.startOfDay();
        case 'week':
          return date.subtract({ days: date.dayOfWeek - 1 }).startOfDay();
        case 'month':
          return date.with({ day: 1 }).startOfDay();
        case 'year':
          return date.with({ month: 1, day: 1 }).startOfDay();
      }
    },

    /**
     * Gets the end of a period relative to a date
     * @param date Base date
     * @param unit Time unit ('day', 'week', 'month', 'year')
     */
    endOf: (
      date: Temporal.ZonedDateTime,
      unit: 'day' | 'week' | 'month' | 'year'
    ): Temporal.ZonedDateTime => {
      const endTime = { hour: 23, minute: 59, second: 59, millisecond: 999 };
      switch (unit) {
        case 'day':
          return date.with(endTime);
        case 'week':
          return date.add({ days: 7 - date.dayOfWeek }).with(endTime);
        case 'month':
          return date.with({ day: date.daysInMonth, ...endTime });
        case 'year':
          return date.with({ month: 12, day: 31, ...endTime });
      }
    }
  };
}

/**
 * Default date helpers in UTC
 */
export const dateHelpers = createDateHelpers('UTC');