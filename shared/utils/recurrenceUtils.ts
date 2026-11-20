import type { IScheduleEntry, IHoliday, IRecurrencePattern } from '@alga-psa/types';
import * as rrulePkg from 'rrule';
import type { Frequency, Weekday } from 'rrule';
import { toCalendarDateString } from '@alga-psa/core';

type RRuleConstructor = typeof import('rrule').RRule;

const rruleExports = rrulePkg as unknown as {
  RRule?: RRuleConstructor;
  default?: { RRule?: RRuleConstructor };
};

function resolveRRule(): RRuleConstructor {
  const resolved = rruleExports.RRule ?? rruleExports.default?.RRule;
  if (!resolved) {
    throw new Error('Unable to resolve RRule export from rrule package');
  }
  return resolved;
}

const RRule = resolveRRule();

/**
 * Helper to format a date as YYYY-MM-DD string.
 */
function formatDateString(date: Date, utc = false): string {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = String((utc ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, '0');
  const day = String(utc ? date.getUTCDate() : date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date falls on a holiday.
 * Handles both one-time and recurring (annual) holidays.
 */
type HolidayDateInput = Omit<IHoliday, 'holiday_date'> & { holiday_date: string | Date };

export function isHolidayDate(date: Date, holidays: HolidayDateInput[], utc = false): boolean {
  if (!holidays || holidays.length === 0) return false;

  const dateStr = formatDateString(date, utc);

  return holidays.some(holiday => {
    let holidayDate: string | null;
    // LEVERAGE: pattern holiday-date-normalize — keep defensive DB DATE conversion at this matcher.
    try {
      holidayDate = toCalendarDateString(holiday.holiday_date);
    } catch {
      holidayDate = null;
    }
    if (!holidayDate) return false;
    if (holiday.is_recurring) {
      // For recurring holidays, compare only month and day (MM-DD)
      const holidayMonthDay = holidayDate.slice(5);
      const dateMonthDay = dateStr.slice(5);
      return holidayMonthDay === dateMonthDay;
    }
    return holidayDate === dateStr;
  });
}

/** Pattern day numbering: Monday = 0 … Sunday = 6 (matches the schedule UI). */
const WEEKDAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/**
 * byweekday for a pattern, carrying the nth-weekday ordinal when the pattern
 * has one ("first Thursday of each month" → TH.nth(1)).
 */
function buildByWeekday(pattern: IRecurrencePattern): Weekday[] | undefined {
  if (!pattern.daysOfWeek || pattern.daysOfWeek.length === 0) return undefined;
  return pattern.daysOfWeek.map((day): Weekday => {
    const key = WEEKDAY_KEYS[day];
    if (!key) {
      console.error('[generateOccurrences] Invalid day of week:', day);
      return RRule.MO;
    }
    const weekday = RRule[key] as Weekday;
    return pattern.weekOfMonth ? weekday.nth(pattern.weekOfMonth) : weekday;
  });
}

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of an instant in an IANA zone. Pure: Intl only, no deps. */
function zoneParts(date: Date, timeZone: string): ZoneParts {
  const parts = zoneFormatter(timeZone).formatToParts(date);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = zoneParts(at, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant whose wall clock in `timeZone` is exactly these fields. */
function instantFromZoneParts(parts: ZoneParts, timeZone: string, ms = 0): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, ms);
  let instant = asUtc - zoneOffsetMs(timeZone, new Date(asUtc));
  // The offset at the guess can differ from the offset at the naive instant
  // (DST boundary); one refinement settles every real zone.
  instant = asUtc - zoneOffsetMs(timeZone, new Date(instant));
  return new Date(instant);
}

function isSupportedTimeZone(timeZone: string): boolean {
  try {
    zoneFormatter(timeZone);
    return true;
  } catch {
    console.error('[generateOccurrences] Unknown time zone, falling back to UTC expansion:', timeZone);
    return false;
  }
}

function utcDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/** Floating (UTC-field) date rrule should expand from, for a zone-local day. */
function floatingDay(parts: ZoneParts, endOfDay = false): Date {
  return endOfDay
    ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999))
    : new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Expand a series anchored in an IANA zone: the local wall-clock time is held
 * constant so a 10:15 America/New_York series stays 10:15 across DST (14:15Z in
 * summer, 15:15Z in winter) instead of drifting with UTC arithmetic.
 */
function generateZonedOccurrences(
  entry: IScheduleEntry,
  pattern: IRecurrencePattern,
  start: Date,
  end: Date,
  timeZone: string,
  options?: GenerateOccurrencesOptions
): Date[] {
  const masterStart = new Date(entry.scheduled_start);
  const localMaster = zoneParts(masterStart, timeZone);
  const localPatternStart = zoneParts(new Date(pattern.startDate), timeZone);

  const freqKey = pattern.frequency.toUpperCase() as keyof typeof RRule;
  if (!(freqKey in RRule)) {
    console.error('[generateOccurrences] Invalid frequency:', pattern.frequency);
    return [masterStart];
  }

  const rrule = new RRule({
    freq: RRule[freqKey] as Frequency,
    interval: pattern.interval,
    dtstart: floatingDay(localPatternStart),
    until: pattern.endDate ? floatingDay(zoneParts(new Date(pattern.endDate), timeZone), true) : undefined,
    byweekday: buildByWeekday(pattern),
    bymonthday: pattern.dayOfMonth,
    bymonth: pattern.monthOfYear,
    count: pattern.count,
  });

  // Expand with a day of slack on each edge: the local day a UTC instant lands
  // on can differ from its UTC day.
  const windowStartParts = zoneParts(new Date(start), timeZone);
  const windowEndParts = zoneParts(new Date(end), timeZone);
  const floatingFrom = new Date(floatingDay(windowStartParts).getTime() - DAY_MS);
  const floatingTo = new Date(floatingDay(windowEndParts, true).getTime() + DAY_MS);

  const rangeStartInstant = instantFromZoneParts(
    { ...windowStartParts, hour: 0, minute: 0, second: 0 },
    timeZone
  );
  const rangeEndInstant = instantFromZoneParts(
    { ...windowEndParts, hour: 23, minute: 59, second: 59 },
    timeZone,
    999
  );

  const masterLocalDay = `${localMaster.year}-${String(localMaster.month).padStart(2, '0')}-${String(localMaster.day).padStart(2, '0')}`;

  const exceptionKeys = new Set(
    (pattern.exceptions ?? [])
      .map((value): string | null => {
        const date = value instanceof Date ? value : new Date(value);
        return isNaN(date.getTime()) ? null : utcDateKey(date);
      })
      .filter((key): key is string => key !== null)
  );

  const occurrences = rrule
    .between(floatingFrom, floatingTo, true)
    .filter((floating): boolean => {
      const day = utcDateKey(floating);
      return options?.includeMaster === true || day !== masterLocalDay;
    })
    .map((floating): Date =>
      instantFromZoneParts(
        {
          year: floating.getUTCFullYear(),
          month: floating.getUTCMonth() + 1,
          day: floating.getUTCDate(),
          hour: localMaster.hour,
          minute: localMaster.minute,
          second: localMaster.second,
        },
        timeZone
      )
    )
    .filter((instant): boolean => instant >= rangeStartInstant && instant <= rangeEndInstant)
    .filter((instant): boolean => !exceptionKeys.has(utcDateKey(instant)));

  if (options?.holidays && options.holidays.length > 0) {
    return occurrences.filter((date): boolean => !isHolidayDate(date, options.holidays!, false));
  }
  return occurrences;
}

export interface GenerateOccurrencesOptions {
  /** Holidays to exclude from generated occurrences */
  holidays?: IHoliday[];
  /** Include the master date when the caller materializes the whole series virtually. */
  includeMaster?: boolean;
}

// LEVERAGE: pattern recurrence-engine — schedule entries should move onto shared/lib/recurrence
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
    const allDay = entry.is_all_day === true;

    // A timed series imported from an external calendar carries the zone it is
    // anchored in; all-day series are date-only, so a zone adds nothing.
    if (!allDay && pattern.timeZone && isSupportedTimeZone(pattern.timeZone)) {
      const masterStart = new Date(entry.scheduled_start);
      if (!isNaN(new Date(pattern.startDate).getTime()) && !isNaN(masterStart.getTime())) {
        return generateZonedOccurrences(entry, pattern, start, end, pattern.timeZone, options);
      }
    }

    // Validate and normalize start date
    const dtstart = new Date(pattern.startDate);
    if (isNaN(dtstart.getTime())) {
      console.error('[generateOccurrences] Invalid start date:', pattern.startDate);
      return [new Date(entry.scheduled_start)];
    }
    if (allDay) dtstart.setUTCHours(0, 0, 0, 0);
    else dtstart.setHours(0, 0, 0, 0);

    // If end date exists, validate and normalize it
    let until: Date | undefined;
    if (pattern.endDate) {
      until = new Date(pattern.endDate);
      if (isNaN(until.getTime())) {
        console.error('[generateOccurrences] Invalid end date:', pattern.endDate);
        return [new Date(entry.scheduled_start)];
      }
      if (allDay) until.setUTCHours(23, 59, 59, 999);
      else until.setHours(23, 59, 59, 999);
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
      byweekday: buildByWeekday(pattern),
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
    if (allDay) rangeStart.setUTCHours(0, 0, 0, 0);
    else rangeStart.setHours(0, 0, 0, 0);
    if (allDay) rangeStart.setTime(rangeStart.getTime() - 1000);
    else rangeStart.setSeconds(rangeStart.getSeconds() - 1);

    const rangeEnd = new Date(end);
    if (isNaN(rangeEnd.getTime())) {
      console.error('[generateOccurrences] Invalid range end date:', end);
      return [new Date(entry.scheduled_start)];
    }
    if (allDay) rangeEnd.setUTCHours(23, 59, 59, 999);
    else rangeEnd.setHours(23, 59, 59, 999);

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
        return options?.includeMaster === true || dateStr !== masterStr;
      })
      .map((date): Date => allDay ? new Date(date.setUTCHours(0, 0, 0, 0)) : applyTimeToDate(date, originalTime));

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
        (date: Date): boolean => !isHolidayDate(date, options.holidays!, allDay)
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
