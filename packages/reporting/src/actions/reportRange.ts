/**
 * Window resolution for the hand-written helpdesk reports.
 *
 * Kept free of server-only imports so the date math can be unit tested without
 * loading the 'use server' action module — which may only export async
 * functions anyway.
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
  /** The custom window that was asked for, or null for a rolling preset. */
  range: ReportDateRange | null;
}

const DEFAULT_RANGE_DAYS = 30;
/** A leap year and nothing more: enough for "the last full year", still scannable. */
const MAX_CUSTOM_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

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
 * Anything unreadable falls back to the 30-day preset instead of erroring —
 * the same defensive stance as normalizeRangeDays, because a report header is
 * not a form worth failing.
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
    const from = parseCalendarDay(input.from);
    const to = parseCalendarDay(input.to);
    if (from !== null && to !== null && from <= to) {
      const rangeDays = Math.round((to - from) / DAY_MS) + 1;
      if (rangeDays <= MAX_CUSTOM_RANGE_DAYS) {
        return { rangeDays, range: { from: input.from, to: input.to } };
      }
    }
    return { rangeDays: DEFAULT_RANGE_DAYS, range: null };
  }
  return { rangeDays: normalizeRangeDays(input), range: null };
}

/** Inclusive day count between two calendar days; 0 when the window is empty. */
export function inclusiveDayCount(from: string, to: string): number {
  const start = parseCalendarDay(from);
  const end = parseCalendarDay(to);
  if (start === null || end === null || end < start) return 0;
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * SQL for "this column falls inside the window", as a fragment plus its
 * bindings so it also drops into a CASE expression or a join condition. The
 * fragment is parenthesised so composing it with OR cannot re-bracket it.
 * Caller-supplied dates are always bound; only the column name — our own
 * constant — and the validated preset day count reach the text.
 */
export function rangeConditionSql(
  column: string,
  window: ResolvedReportRange,
): { sql: string; bindings: string[] } {
  if (window.range) {
    return {
      sql: `(${column} >= ?::date AND ${column} < ?::date + INTERVAL '1 day')`,
      bindings: [window.range.from, window.range.to],
    };
  }
  return { sql: `(${column} >= NOW() - INTERVAL '${window.rangeDays} days')`, bindings: [] };
}
