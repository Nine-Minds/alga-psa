/**
 * Builds a `Date` at LOCAL midnight for a `YYYY-MM-DD` calendar string.
 *
 * `new Date('2026-12-31')` parses as UTC midnight, which is the previous day in
 * any timezone west of UTC, so a date picker (which reads local calendar parts)
 * would show the wrong day. This is the inverse of `toCalendarDateString` from
 * `@alga-psa/core`, which reads the local Y/M/D of a picker `Date` (alga0002283).
 *
 * Returns `undefined` for empty or malformed input.
 */
export function calendarDateToLocalDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? undefined : date;
}
