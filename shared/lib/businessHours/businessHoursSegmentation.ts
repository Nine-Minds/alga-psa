/**
 * Business-hours segmentation primitive — CANONICAL home of the business-hours
 * classification math, shared by @alga-psa/sla and the weighted bucket burn
 * calculator.
 *
 * Dependency direction: @alga-psa/sla depends on @alga-psa/shared (not the
 * reverse), so `shared/billingClients` cannot import the SLA evaluator without
 * creating a package cycle. Per the weighted-burn plan (§2) the primitive is
 * inverted into `shared/` and @alga-psa/sla re-exports it. Do NOT fork this
 * math elsewhere — import `segmentSpanByBusinessHours` /
 * `isWithinBusinessHours` from here (directly, or via `@alga-psa/sla`).
 */

import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/** Structural subset of @alga-psa/sla's IBusinessHoursEntry used by the math. */
export interface BusinessHoursEntryInput {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
}

/** Structural subset of @alga-psa/sla's IHoliday used by the math. */
export interface BusinessHoursHolidayInput {
  holiday_date: string;
  is_recurring: boolean;
}

/**
 * Structural subset of @alga-psa/sla's IBusinessHoursScheduleWithEntries.
 * @alga-psa/sla's type is structurally assignable to this.
 */
export interface BusinessHoursScheduleInput {
  timezone: string;
  is_24x7: boolean;
  entries: BusinessHoursEntryInput[];
  holidays?: BusinessHoursHolidayInput[];
}

/** A maximal sub-span of a wall-clock span with a constant in/out classification. */
export interface BusinessHourSegment {
  /** Inclusive start instant (UTC). */
  start: Date;
  /** Exclusive end instant (UTC). */
  end: Date;
  /** Whether this segment lies inside the schedule's business hours. */
  isBusinessHours: boolean;
}

/**
 * Check if a given instant is within business hours for a schedule.
 * Same semantics as @alga-psa/sla's `isWithinBusinessHours` (24x7 always true;
 * holidays are out-of-hours; missing/disabled day entry is out-of-hours;
 * `start_time <= wall-clock < end_time`).
 */
export function isWithinBusinessHours(
  schedule: BusinessHoursScheduleInput,
  datetime: Date
): boolean {
  if (schedule.is_24x7) {
    return true;
  }

  const localTime = toZonedTime(datetime, schedule.timezone);
  const dayOfWeek = localTime.getDay();
  const timeString = formatTimeString(localTime);

  if (isHoliday(schedule.holidays || [], localTime)) {
    return false;
  }

  const entry = schedule.entries.find((e) => e.day_of_week === dayOfWeek);
  if (!entry || !entry.is_enabled) {
    return false;
  }

  return timeString >= entry.start_time && timeString < entry.end_time;
}

/**
 * Split a wall-clock span into maximal in/out-of-business-hours segments,
 * evaluated in the schedule's timezone. Used by the weighted burn calculator
 * to prorate `billable_duration` across after-hours boundaries.
 *
 * - A 24x7 schedule yields one in-hours segment covering the whole span.
 * - A zero-length span (end <= start) yields one segment classified by
 *   `start` — callers with positive `billable_duration` but no elapsed wall
 *   clock (e.g. usage-tracking draws) rely on this.
 * - Day boundaries without an enabled (non-holiday) entry contribute no
 *   transitions; the whole day classifies as out-of-hours.
 *
 * @returns Consecutive, non-overlapping segments covering exactly [start, end].
 */
export function segmentSpanByBusinessHours(
  schedule: BusinessHoursScheduleInput,
  start: Date,
  end: Date
): BusinessHourSegment[] {
  if (schedule.is_24x7) {
    return [{ start, end, isBusinessHours: true }];
  }

  if (end.getTime() <= start.getTime()) {
    return [{ start, end, isBusinessHours: isWithinBusinessHours(schedule, start) }];
  }

  const boundaries = collectBusinessHourBoundaries(schedule, start, end);
  boundaries.sort((a, b) => a.getTime() - b.getTime());

  const uniqueBoundaries: Date[] = [];
  for (const boundary of boundaries) {
    const last = uniqueBoundaries[uniqueBoundaries.length - 1];
    if (!last || last.getTime() !== boundary.getTime()) {
      uniqueBoundaries.push(boundary);
    }
  }

  const segments: BusinessHourSegment[] = [];
  for (let i = 0; i < uniqueBoundaries.length - 1; i += 1) {
    const segmentStart = uniqueBoundaries[i];
    const segmentEnd = uniqueBoundaries[i + 1];
    if (segmentEnd.getTime() <= segmentStart.getTime()) {
      continue;
    }

    // Classify by the segment midpoint so we never straddle a boundary.
    const midpoint = new Date(segmentStart.getTime() + (segmentEnd.getTime() - segmentStart.getTime()) / 2);
    const isBusinessHours = isWithinBusinessHours(schedule, midpoint);

    const previous = segments[segments.length - 1];
    if (previous && previous.isBusinessHours === isBusinessHours && previous.end.getTime() === segmentStart.getTime()) {
      previous.end = segmentEnd;
    } else {
      segments.push({ start: segmentStart, end: segmentEnd, isBusinessHours });
    }
  }

  return segments;
}

/**
 * Collect every instant in [start, end] where the in/out classification can
 * change: the span's own endpoints plus each enabled non-holiday day's
 * business-hour start/end edges (in the schedule's timezone).
 */
function collectBusinessHourBoundaries(
  schedule: BusinessHoursScheduleInput,
  start: Date,
  end: Date
): Date[] {
  const boundaries: Date[] = [new Date(start), new Date(end)];
  const tz = schedule.timezone;
  const holidays = schedule.holidays || [];

  const localStart = toZonedTime(start, tz);
  const localEnd = toZonedTime(end, tz);

  let cursor = new Date(Date.UTC(localStart.getFullYear(), localStart.getMonth(), localStart.getDate()));
  const lastDay = new Date(Date.UTC(localEnd.getFullYear(), localEnd.getMonth(), localEnd.getDate()));

  while (cursor.getTime() <= lastDay.getTime()) {
    if (!isHoliday(holidays, cursor)) {
      const dayOfWeek = cursor.getUTCDay();
      const entry = schedule.entries.find((e) => e.day_of_week === dayOfWeek);
      if (entry && entry.is_enabled) {
        const entryStart = wallClockInstant(cursor, entry.start_time, tz);
        const entryEnd = wallClockInstant(cursor, entry.end_time, tz);
        if (entryStart.getTime() > start.getTime() && entryStart.getTime() < end.getTime()) {
          boundaries.push(entryStart);
        }
        if (entryEnd.getTime() > start.getTime() && entryEnd.getTime() < end.getTime()) {
          boundaries.push(entryEnd);
        }
      }
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
  }

  return boundaries;
}

/** Build the UTC instant for a wall-clock HH:MM on a given local calendar day. */
function wallClockInstant(day: Date, time: string, tz: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const local = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hours, minutes));
  return fromZonedTime(local, tz);
}

export function isHoliday(holidays: BusinessHoursHolidayInput[], date: Date): boolean {
  const dateStr = formatDateString(date);
  const monthDay = dateStr.slice(5); // MM-DD

  return holidays.some((holiday) => {
    if (holiday.is_recurring) {
      return holiday.holiday_date.slice(5) === monthDay;
    }
    return holiday.holiday_date === dateStr;
  });
}

function convertToTimezone(date: Date, timezone: string): Date {
  return toZonedTime(date, timezone);
}

function convertFromTimezone(localDate: Date, timezone: string): Date {
  return fromZonedTime(localDate, timezone);
}

function formatTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export { convertToTimezone, convertFromTimezone, formatTimeString, formatDateString };
