/**
 * The one place that turns a time period setting plus a cell start into the cell's end.
 *
 * Deliberately NOT in a 'use server' module. Pure calendar arithmetic, no database access.
 */
import { Temporal } from '@js-temporal/polyfill';
import type { ITimePeriodSettings } from '@alga-psa/types';

function monthStartDay(setting: ITimePeriodSettings): number {
  return typeof setting.start_day === 'number' && setting.start_day > 0 ? setting.start_day : 1;
}

/** Day `day` of the month `monthsFromFirst` months after the first of `from`'s month, clamped to its length. */
function clampedDayOfMonth(from: Temporal.PlainDate, monthsFromFirst: number, day: number): Temporal.PlainDate {
  const first = from.with({ day: 1 }).add({ months: monthsFromFirst });
  return first.with({ day: Math.min(day, first.daysInMonth) });
}

/**
 * Start of the yearly cell that begins in `year`: start_month / start_day_of_month (default Jan 1).
 */
export function yearBoundary(setting: ITimePeriodSettings, year: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year, month: setting.start_month || 1, day: 1 });
  return first.with({ day: Math.min(setting.start_day_of_month || 1, first.daysInMonth) });
}

/**
 * EXCLUSIVE end of the yearly cell starting at `start`. A yearly profile is a range inside the
 * year, start_month/start_day_of_month to end_month/end_day_of_month (the same reading the
 * settings overlap check uses), so two profiles can split a year. end_day_of_month is an
 * exclusive boundary; 0 or unset means the first day after end_month. Stored settings default
 * to end_month 12 / end_day_of_month 0. A range that wraps the new year ends in the next year.
 */
function endOfYearlyCell(start: Temporal.PlainDate, setting: ITimePeriodSettings, frequency: number): Temporal.PlainDate {
  const endIn = (year: number) => {
    const month = Temporal.PlainDate.from({ year, month: setting.end_month || 12, day: 1 });
    return setting.end_day_of_month
      ? month.with({ day: Math.min(setting.end_day_of_month, month.daysInMonth) })
      : month.add({ months: 1 });
  };
  // First configured end after the start (next calendar year when the range wraps), then
  // frequency - 1 further years. Re-clamp by recomputing in the target year (Feb 29).
  const firstEndYear = Temporal.PlainDate.compare(endIn(start.year), start) > 0 ? start.year : start.year + 1;
  return endIn(firstEndYear + frequency - 1);
}

/**
 * EXCLUSIVE end (the first day after the period) of the cell starting at `start`.
 *
 * A monthly `end_day` is the last INCLUDED day (1st-15th, then 16th-end), so the stored
 * [start, end) end is end_day + 1; 0 or unset means the end of the month. When end_day is
 * earlier than the cell's start day (16th to the 15th) the cell rolls into the next month.
 * This is the single place that interprets an inclusive end_day.
 */
export function endOfConfiguredTimePeriod(start: Temporal.PlainDate, setting: ITimePeriodSettings): Temporal.PlainDate {
  const frequency = Math.max(1, setting.frequency || 1);

  switch (setting.frequency_unit) {
    case 'day':
      return start.add({ days: frequency });
    case 'week':
      return start.add({ weeks: frequency });
    case 'month': {
      const endDay = typeof setting.end_day === 'number' ? setting.end_day : 0;
      if (endDay <= 0) {
        return start.with({ day: 1 }).add({ months: frequency });
      }
      const monthOffset = endDay >= monthStartDay(setting) ? frequency - 1 : frequency;
      return clampedDayOfMonth(start, monthOffset, endDay).add({ days: 1 });
    }
    case 'year':
      return endOfYearlyCell(start, setting, frequency);
    default:
      throw new Error(`Unsupported frequency unit: ${setting.frequency_unit}`);
  }
}
