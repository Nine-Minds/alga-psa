/**
 * Window resolution for the hand-written helpdesk reports.
 *
 * Kept free of server-only imports so the date math can be unit tested without
 * loading the 'use server' action module — which may only export async
 * functions anyway — and so the reports page can run the same checks before it
 * asks for a window.
 */

/** The rolling presets the report header offers. */
export type ReportRangeDays = 7 | 30 | 90;

/** An inclusive custom window; both bounds are calendar days (YYYY-MM-DD). */
export interface ReportDateRange {
  from: string;
  to: string;
}

export type ReportRangeInput = number | ReportDateRange;

export interface ResolvedReportRange {
  /** Inclusive day count of the window: one of the presets unless `range` is set. */
  rangeDays: number;
  /** The custom window the report covers, or null for a rolling preset. */
  range: ReportDateRange | null;
}

const DEFAULT_RANGE_DAYS = 30;
/** A leap year and nothing more: enough for "the last full year", still scannable. */
export const MAX_CUSTOM_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

/** Why a custom window was refused. */
export type ReportRangeProblem = 'malformed' | 'backwards' | 'tooLong' | 'startsInFuture';

/**
 * English text and catalogue key per problem. The action boundary localizes the
 * message through the key; the reports page uses the same key before it asks.
 */
export const REPORT_RANGE_PROBLEMS: Record<
  ReportRangeProblem,
  {
    /** Key in the msp/reports namespace. */
    key: string;
    /** English text with the params filled in. */
    message: string;
    /** English text with {{placeholders}}, for a translation's defaultValue. */
    template: string;
    params?: Record<string, number>;
  }
> = {
  malformed: {
    key: 'errors.report.range.malformed',
    message: 'The custom date range could not be read. Pick both dates again.',
    template: 'The custom date range could not be read. Pick both dates again.',
  },
  backwards: {
    key: 'errors.report.range.backwards',
    message: 'The end date is before the start date.',
    template: 'The end date is before the start date.',
  },
  tooLong: {
    key: 'errors.report.range.tooLong',
    message: `A custom date range can cover at most ${MAX_CUSTOM_RANGE_DAYS} days.`,
    template: 'A custom date range can cover at most {{maxDays}} days.',
    params: { maxDays: MAX_CUSTOM_RANGE_DAYS },
  },
  startsInFuture: {
    key: 'errors.report.range.startsInFuture',
    message: 'The custom date range starts after today, so there is nothing to report yet.',
    template: 'The custom date range starts after today, so there is nothing to report yet.',
  },
};

/**
 * A custom window the caller asked for and the report cannot honour. Thrown
 * rather than swapped for the default window: a report labelled with dates it
 * was not filtered by is worse than an error that says why.
 */
export class ReportRangeError extends Error {
  constructor(readonly problem: ReportRangeProblem) {
    super(REPORT_RANGE_PROBLEMS[problem].message);
    this.name = 'ReportRangeError';
  }
}

export function normalizeRangeDays(value?: number): ReportRangeDays {
  return value === 7 || value === 90 ? value : DEFAULT_RANGE_DAYS;
}

/** Epoch millis of a strict YYYY-MM-DD calendar day, or null if it is not one. */
function parseCalendarDay(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  // A round-trip drops days that only look real (2026-02-31 and friends).
  return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

/**
 * What is wrong with a custom window, or null when it can be reported on.
 * `today` (YYYY-MM-DD in the viewer's timezone) is optional: without it a
 * window that starts in the future is not checked.
 */
export function checkReportDateRange(
  range: { from?: unknown; to?: unknown },
  today?: string,
): ReportRangeProblem | null {
  const from = parseCalendarDay(range.from);
  const to = parseCalendarDay(range.to);
  if (from === null || to === null) return 'malformed';
  if (to < from) return 'backwards';
  if (Math.round((to - from) / DAY_MS) + 1 > MAX_CUSTOM_RANGE_DAYS) return 'tooLong';
  if (today !== undefined && (range.from as string) > today) return 'startsInFuture';
  return null;
}

/**
 * A preset (or nothing) normalizes to one of the rolling windows, as before. A
 * custom window must be valid as asked: anything else throws a
 * {@link ReportRangeError} instead of quietly reporting on 30 days.
 */
export function resolveReportRange(input?: ReportRangeInput): ResolvedReportRange {
  // Two separate `typeof` checks, not one `&&`-joined guard: the ee/server
  // tsconfig runs with strictNullChecks off, where an `input !== null`
  // clause doesn't narrow and the compiler can't tell the fallthrough
  // below is number-only anymore.
  if (typeof input === 'object') {
    if (input === null) {
      return { rangeDays: DEFAULT_RANGE_DAYS, range: null };
    }
    const problem = checkReportDateRange(input);
    if (problem) throw new ReportRangeError(problem);
    return {
      rangeDays: inclusiveDayCount(input.from, input.to),
      range: { from: input.from, to: input.to },
    };
  }
  return { rangeDays: normalizeRangeDays(input), range: null };
}

/**
 * Cut a custom window off at `today`, so the window a report echoes (and labels
 * itself with) is the one its data can actually cover. A window that starts
 * after today has no data at all and is refused.
 */
export function clampReportRangeToToday(window: ResolvedReportRange, today: string): ResolvedReportRange {
  if (!window.range) return window;
  if (window.range.from > today) throw new ReportRangeError('startsInFuture');
  if (window.range.to <= today) return window;
  return {
    rangeDays: inclusiveDayCount(window.range.from, today),
    range: { from: window.range.from, to: today },
  };
}

/** Inclusive day count between two calendar days; 0 when the window is empty. */
export function inclusiveDayCount(from: string, to: string): number {
  const start = parseCalendarDay(from);
  const end = parseCalendarDay(to);
  if (start === null || end === null || end < start) return 0;
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * SQL for "this timestamp column falls inside the window", as a fragment plus
 * its bindings so it also drops into a CASE expression or a join condition. The
 * fragment is parenthesised so composing it with OR cannot re-bracket it.
 *
 * A custom window's days are calendar days in `timeZone` (the viewer's
 * effective zone), not in the database session's UTC: midnight of `from` in
 * that zone up to, but not including, midnight after `to`. Every value is
 * bound; only the column name — our own constant — reaches the text.
 */
export function rangeConditionSql(
  column: string,
  window: ResolvedReportRange,
  timeZone: string = 'UTC',
): { sql: string; bindings: Array<string | number> } {
  if (window.range) {
    return {
      sql: `(${column} >= ((?::date)::timestamp AT TIME ZONE ?) AND ${column} < ((?::date + 1)::timestamp AT TIME ZONE ?))`,
      bindings: [window.range.from, timeZone, window.range.to, timeZone],
    };
  }
  return { sql: `(${column} >= NOW() - (?::int * INTERVAL '1 day'))`, bindings: [window.rangeDays] };
}

/**
 * The same window for a DATE column that already holds the entry's own
 * calendar day (time entries' `work_date`). Custom windows compare days
 * directly; presets keep the rolling timestamp window on `fallbackColumn`.
 */
export function dayRangeConditionSql(
  dateColumn: string,
  fallbackColumn: string,
  window: ResolvedReportRange,
): { sql: string; bindings: Array<string | number> } {
  if (window.range) {
    return {
      sql: `(${dateColumn} >= ?::date AND ${dateColumn} <= ?::date)`,
      bindings: [window.range.from, window.range.to],
    };
  }
  return rangeConditionSql(fallbackColumn, window);
}
