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
 * Yearly profiles are always whole cells from one start to the next. end_month and
 * end_day_of_month do not create a seasonal (shorter than a year) cell.
 */
export function yearBoundary(setting: ITimePeriodSettings, year: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year, month: setting.start_month || 1, day: 1 });
  return first.with({ day: Math.min(setting.start_day_of_month || 1, first.daysInMonth) });
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
      return yearBoundary(setting, start.year + frequency);
    default:
      throw new Error(`Unsupported frequency unit: ${setting.frequency_unit}`);
  }
}
