/**
 * Locale-aware date formatting shared by the client formatter hook
 * (`useFormatters` in ./client.tsx) and the server formatter (./serverOnly.ts).
 *
 * Date-only strings (`YYYY-MM-DD`) are CALENDAR DATES, not instants: passing
 * one through `new Date()` parses it as midnight UTC, which
 * `Intl.DateTimeFormat` then shifts into the viewer's timezone — rendering the
 * prior day everywhere west of UTC (a PostgreSQL `invoice_date` of 2026-09-30
 * displayed as 29/09/2026 in America/New_York). A calendar date has no
 * timezone, so it is formatted in UTC to preserve the written day for every
 * viewer. Anything else (a `Date`, a datetime string) is an instant and keeps
 * the existing behavior: formatted in the viewer's local timezone.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnlyString(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value);
}

export function formatDateValue(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (isDateOnlyString(date)) {
    const [year, month, day] = date.split('-').map(Number);
    // Force UTC AFTER spreading options: any caller-supplied timeZone would
    // reintroduce the day shift, and a timezone is meaningless for a value
    // that never carried one.
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, options).format(dateObj);
}
