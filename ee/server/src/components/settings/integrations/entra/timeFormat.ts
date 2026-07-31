/**
 * Staleness, scannably.
 *
 * A sync list is read by running an eye down one column asking "which of these
 * is old?" — a question `7/25/2026, 8:08:11 PM` makes the reader answer by
 * subtracting dates, once per row, at 200 rows. Seconds and the year are noise
 * on something that runs hourly at best.
 *
 * Uses Intl.RelativeTimeFormat rather than a handful of hand-written strings, so
 * the phrasing and the plural rules come from the locale instead of from ten
 * translations of "{{count}} hours ago".
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatEntraRelativeTime(
  value: string | null | undefined,
  options: { now?: number; locale?: string } = {}
): string | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  const now = options.now ?? Date.now();
  const elapsed = now - parsed;
  const formatter = new Intl.RelativeTimeFormat(options.locale, { numeric: 'auto' });

  // Under a minute is "now" in every practical sense; -0 would render "in 0
  // seconds", which reads as a future event.
  if (Math.abs(elapsed) < MINUTE) {
    return formatter.format(0, 'second');
  }
  if (Math.abs(elapsed) < HOUR) {
    return formatter.format(-Math.round(elapsed / MINUTE), 'minute');
  }
  if (Math.abs(elapsed) < DAY) {
    return formatter.format(-Math.round(elapsed / HOUR), 'hour');
  }
  if (Math.abs(elapsed) < 30 * DAY) {
    return formatter.format(-Math.round(elapsed / DAY), 'day');
  }

  // Past a month, "42 days ago" stops meaning anything; a date does.
  return new Date(parsed).toLocaleDateString(options.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The precise value, for the title attribute behind the relative one. */
export function formatEntraExactTime(
  value: string | null | undefined,
  locale?: string
): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString(locale);
}
