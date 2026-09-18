/**
 * Value normalizers for spreadsheet cells. Every normalizer either returns a
 * canonical value or `undefined`; callers turn `undefined` into a warning
 * diagnostic and drop the value — locale-formatted junk never reaches a
 * package.
 */

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_NO_OFFSET = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
const DATE_TIME_WITH_OFFSET =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/;

/** RFC 3339 UTC at seconds precision, e.g. `2026-08-25T12:00:00Z`. */
export function toRfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Normalize a source timestamp into RFC 3339 UTC.
 *
 * - Already-valid RFC 3339 UTC values pass through unchanged.
 * - `YYYY-MM-DD HH:MM[:SS]` (and the `T`-separated ISO form) without an
 *   offset is treated as UTC — deliberately not host-local time, so the same
 *   file converts identically on every machine.
 * - ISO date-times with an explicit offset are converted to UTC.
 * - A bare `YYYY-MM-DD` becomes midnight UTC.
 *
 * Anything else returns `undefined`.
 */
export function normalizeTimestamp(raw: string): string | undefined {
  const value = raw.trim();
  if (RFC3339_UTC.test(value)) {
    return value;
  }
  const noOffset = value.match(DATE_TIME_NO_OFFSET);
  if (noOffset) {
    const seconds = noOffset[3] ?? '00';
    return `${noOffset[1]}T${noOffset[2]}:${seconds}Z`;
  }
  const withOffset = value.match(DATE_TIME_WITH_OFFSET);
  if (withOffset) {
    const parsed = new Date(`${withOffset[1]}T${withOffset[2]}${withOffset[3]}`);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return toRfc3339Seconds(parsed);
  }
  if (DATE_ONLY.test(value)) {
    return `${value}T00:00:00Z`;
  }
  return undefined;
}

/** Normalize a date-only value; only `YYYY-MM-DD` is accepted. */
export function normalizeDateOnly(raw: string): string | undefined {
  const value = raw.trim();
  return DATE_ONLY.test(value) ? value : undefined;
}

/** Normalize a boolean-ish flag (`Y`/`N`, `1`/`0`, `true`/`false`, …) to 1 or 0. */
export function normalizeBooleanFlag(raw: string): number | undefined {
  const value = raw.trim().toLowerCase();
  if (['1', 'y', 'yes', 'true', 't'].includes(value)) {
    return 1;
  }
  if (['0', 'n', 'no', 'false', 'f'].includes(value)) {
    return 0;
  }
  return undefined;
}
