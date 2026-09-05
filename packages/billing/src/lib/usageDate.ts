/**
 * Usage Tracking treats `usage_date` as a plain calendar date — the day the
 * usage happened — never an instant on a clock. The billing engine, invoice
 * period matching and the customer's own mental model all key off "which day",
 * so the UI must round-trip a calendar date without ever re-interpreting it
 * through the viewer's timezone.
 *
 * The footgun these helpers remove: initializing/rendering usage dates through
 * `new Date(value)` + `toLocaleDateString()`. A value stored at UTC midnight
 * (`2026-09-01T00:00:00.000Z`) renders as `2026-08-31` for any viewer west of
 * UTC, and `new Date().toISOString()` captures *tomorrow's* UTC date for any
 * evening east-of-UTC... i.e. the displayed day silently disagrees with the day
 * the operator picked. These helpers keep the calendar date invariant across
 * defaults, create/edit, reload and display regardless of `TZ`.
 *
 * Canonical stored form: `YYYY-MM-DDT00:00:00.000Z` (UTC midnight for the
 * chosen calendar day). `usage_tracking.usage_date` is a timestamptz, and the
 * write action passes date-only/ISO strings through unchanged, so anchoring at
 * UTC midnight makes the stored instant's date component *equal* the calendar
 * day everywhere.
 */

const PLAIN_DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The local calendar date (`YYYY-MM-DD`) for `now`. Uses the local Y/M/D
 * components — the operator's "today" is the day on their wall calendar, not the
 * current UTC date.
 */
export function todayUsageDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Recover the plain calendar date (`YYYY-MM-DD`) from any stored representation
 * — a full ISO instant, a date-only string, or the JS `Date` the pg driver
 * materializes a timestamptz into — WITHOUT a timezone shift.
 *
 * ISO/date-only strings: the calendar day is the leading `YYYY-MM-DD`, taken
 * verbatim. `Date` values: read back via `toISOString()` (UTC components), which
 * recovers the day for the UTC-midnight canonical form these helpers write.
 */
export function usageDateFromStored(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).match(PLAIN_DATE_RE);
  return match ? match[1] : '';
}

/**
 * Convert a plain calendar date (`YYYY-MM-DD`) to the canonical stored instant
 * (UTC midnight). Empty/blank input yields an empty string so a cleared date
 * field stays cleared rather than defaulting to the epoch.
 */
export function usageDateToStored(plain: string | null | undefined): string {
  if (!plain) return '';
  const match = String(plain).match(PLAIN_DATE_RE);
  return match ? `${match[1]}T00:00:00.000Z` : '';
}
