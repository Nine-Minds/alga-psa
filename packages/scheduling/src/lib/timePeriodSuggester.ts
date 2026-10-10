import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import type { ITimePeriod, ITimePeriodSettings, ITimePeriodView } from '@alga-psa/types';

export type TimePeriodSettings = ITimePeriodSettings;

function parseDateValue(date: string | Temporal.PlainDate): Temporal.PlainDate {
  if (date instanceof Temporal.PlainDate) {
    return date;
  }
  return Temporal.PlainDate.from(date.split('T')[0]);
}

type Cell = { start: Temporal.PlainDate; end: Temporal.PlainDate };

// LEVERAGE: pattern period-grid — the suggester grid (alignedPeriodStart/cellEnd/periodContaining) and
// generateTimePeriods/alignToWeekday/alignToMonthDay in timePeriodsActions.ts are two period grids.
// Once the end-day convention (issue item 3) settles, re-express the generator through these helpers.

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function monthIndex(date: Temporal.PlainDate): number {
  return date.year * 12 + (date.month - 1);
}

/** Day `day` of the month at `index` (see monthIndex), clamped to the month's length. */
function clampedMonthDay(index: number, day: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year: floorDiv(index, 12), month: (((index % 12) + 12) % 12) + 1, day: 1 });
  return first.with({ day: Math.min(day, first.daysInMonth) });
}

function monthStartDay(setting: ITimePeriodSettings): number {
  return typeof setting.start_day === 'number' && setting.start_day > 0 ? setting.start_day : 1;
}

function weekStartDay(setting: ITimePeriodSettings): number {
  return typeof setting.start_day === 'number' && setting.start_day >= 1 && setting.start_day <= 7 ? setting.start_day : 1;
}

function yearBoundary(setting: ITimePeriodSettings, year: number): Temporal.PlainDate {
  const first = Temporal.PlainDate.from({ year, month: setting.start_month || 1, day: 1 });
  return first.with({ day: Math.min(setting.start_day_of_month || 1, first.daysInMonth) });
}

/** Is the setting in force on date D? effective_from <= D <= effective_to (date parts). */
// LEVERAGE: pattern period-grid — see note above
export function isSettingEffectiveOn(setting: ITimePeriodSettings, date: Temporal.PlainDate): boolean {
  if (setting.effective_from && Temporal.PlainDate.compare(parseDateValue(setting.effective_from), date) > 0) {
    return false;
  }
  if (setting.effective_to && Temporal.PlainDate.compare(date, parseDateValue(setting.effective_to)) > 0) {
    return false;
  }
  return true;
}

/**
 * Most recent grid boundary on or before D. Phase for frequency > 1 is anchored at the most recent
 * natural boundary on or before effective_from. Null only if the unit is unsupported.
 */
// LEVERAGE: pattern period-grid — see note above
export function alignedPeriodStart(setting: ITimePeriodSettings, date: Temporal.PlainDate): Temporal.PlainDate | null {
  const frequency = Math.max(1, setting.frequency || 1);
  const from = setting.effective_from ? parseDateValue(setting.effective_from) : date;

  switch (setting.frequency_unit) {
    case 'day': {
      const diff = from.until(date, { largestUnit: 'day' }).days;
      return from.add({ days: floorDiv(diff, frequency) * frequency });
    }
    case 'week': {
      const startDay = weekStartDay(setting);
      const natural = (d: Temporal.PlainDate) => d.subtract({ days: (d.dayOfWeek - startDay + 7) % 7 });
      const anchor = natural(from);
      const boundary = natural(date);
      const weeks = floorDiv(anchor.until(boundary, { largestUnit: 'day' }).days / 7, frequency) * frequency;
      return anchor.add({ weeks });
    }
    case 'month': {
      const startDay = monthStartDay(setting);
      const natural = (d: Temporal.PlainDate) => {
        const candidate = clampedMonthDay(monthIndex(d), startDay);
        return Temporal.PlainDate.compare(candidate, d) > 0 ? clampedMonthDay(monthIndex(d) - 1, startDay) : candidate;
      };
      const anchorIdx = monthIndex(natural(from));
      const boundaryIdx = monthIndex(natural(date));
      const steps = floorDiv(boundaryIdx - anchorIdx, frequency) * frequency;
      return clampedMonthDay(anchorIdx + steps, startDay);
    }
    case 'year': {
      const natural = (d: Temporal.PlainDate) => {
        const candidate = yearBoundary(setting, d.year);
        return Temporal.PlainDate.compare(candidate, d) > 0 ? yearBoundary(setting, d.year - 1) : candidate;
      };
      const anchorYear = natural(from).year;
      const steps = floorDiv(natural(date).year - anchorYear, frequency) * frequency;
      return yearBoundary(setting, anchorYear + steps);
    }
    default:
      return null;
  }
}

/** Exclusive end of the cell that starts at boundary B. */
// LEVERAGE: pattern period-grid — see note above
export function cellEnd(setting: ITimePeriodSettings, boundary: Temporal.PlainDate): Temporal.PlainDate {
  const frequency = Math.max(1, setting.frequency || 1);

  switch (setting.frequency_unit) {
    case 'day':
      return boundary.add({ days: frequency });
    case 'week':
      return boundary.add({ weeks: frequency });
    case 'month': {
      const startDay = monthStartDay(setting);
      const endDay = typeof setting.end_day === 'number' ? setting.end_day : 0;
      const idx = monthIndex(boundary);
      if (endDay === 0) {
        return clampedMonthDay(idx + frequency, 1);
      }
      // end_day is inclusive; storage is exclusive, hence +1 day.
      const monthOffset = endDay >= startDay ? frequency - 1 : frequency;
      return clampedMonthDay(idx + monthOffset, endDay).add({ days: 1 });
    }
    case 'year':
      return yearBoundary(setting, boundary.year + frequency);
    default:
      throw new Error(`Unsupported frequency unit: ${setting.frequency_unit}`);
  }
}

/** The cell containing D: { start: max(B, effective_from), end }, or null. */
// LEVERAGE: pattern period-grid — see note above
export function periodContaining(setting: ITimePeriodSettings, date: Temporal.PlainDate): Cell | null {
  if (!isSettingEffectiveOn(setting, date)) return null;
  const boundary = alignedPeriodStart(setting, date);
  if (!boundary) return null;
  const end = cellEnd(setting, boundary);
  if (Temporal.PlainDate.compare(date, end) >= 0) return null;
  const from = setting.effective_from ? parseDateValue(setting.effective_from) : boundary;
  const start = Temporal.PlainDate.compare(boundary, from) < 0 ? from : boundary;
  return { start, end };
}

function maxCycleDays(settings: ITimePeriodSettings[]): number {
  const perUnit = { day: 1, week: 7, month: 31, year: 366 } as const;
  return settings.reduce((max, s) => Math.max(max, perUnit[s.frequency_unit] * Math.max(1, s.frequency || 1)), 1);
}

export class TimePeriodSuggester {
  // Define a result type that includes success status and error message
  static suggestNewTimePeriod(
    settings: TimePeriodSettings[],
    existingPeriods: ITimePeriod[] = [],
    options: { today?: Temporal.PlainDate | string } = {}
  ): { success: boolean; data?: ITimePeriodView; error?: string; errorKey?: string } {
    const today = options.today ? parseDateValue(options.today) : Temporal.Now.plainDateISO();

    const latestPeriod =
      existingPeriods.length > 0
        ? existingPeriods.reduce((latest, period) =>
            Temporal.PlainDate.compare(parseDateValue(period.end_date), parseDateValue(latest.end_date)) > 0 ? period : latest
          , existingPeriods[0])
        : null;

    const target = latestPeriod ? parseDateValue(latestPeriod.end_date) : today;

    let cell: Cell | null = null;
    for (const setting of settings) {
      cell = periodContaining(setting, target);
      if (cell) break;
    }

    let startDate: Temporal.PlainDate;
    let endDate: Temporal.PlainDate;

    if (cell) {
      // Bootstrap returns the whole current cell; otherwise bridge from the latest end to the cell's end.
      startDate = latestPeriod ? target : cell.start;
      endDate = cell.end;
    } else {
      // No cell contains the target: earliest cell starting after it, within a bounded horizon.
      const horizon = 2 * maxCycleDays(settings);
      let found: Cell | null = null;
      for (let offset = 1; offset <= horizon && !found; offset++) {
        const day = target.add({ days: offset });
        for (const setting of settings) {
          const candidate = periodContaining(setting, day);
          if (candidate && Temporal.PlainDate.compare(candidate.start, day) === 0) {
            found = candidate;
            break;
          }
        }
      }
      if (!found) {
        return {
          success: false,
          error: 'No applicable time period settings found.',
          errorKey: 'timeEntry.periods.errors.noApplicableSettings',
        };
      }
      startDate = found.start;
      endDate = found.end;
    }

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

