/**
 * Value normalizers for spreadsheet cells. Every normalizer either returns a
 * canonical value or `undefined`; callers turn `undefined` into a warning
 * diagnostic and drop the value — locale-formatted junk never reaches a
 * package.
 */

import { decimalTextToMinorUnits, isSupportedCurrency, MoneyInputError } from '@alga-psa/core/formatters';

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

export type MoneyParseFailure = 'currency' | 'negative' | 'precision' | 'invalid' | 'overflow';
export type MoneyParseResult =
  | { ok: true; minor: number }
  | { ok: false; reason: MoneyParseFailure };

const GROUPED_THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * Convert a spreadsheet money cell (major-unit decimal text, e.g. `1299.00`)
 * into integer minor units using the currency's own minor-unit exponent
 * (JPY has none, BHD has three). Delegates to the shared strict parser, so
 * negative, non-numeric and over-precise values are rejected rather than
 * rounded. The only leniency is `1,299.00`-style comma grouping; currency
 * symbols are never guessed at.
 */
export function parseMoneyToMinorUnits(raw: string, currency: string): MoneyParseResult {
  let text = raw.trim();
  if (GROUPED_THOUSANDS.test(text)) {
    text = text.replace(/,/g, '');
  }
  try {
    const minor = decimalTextToMinorUnits(text, currency);
    if (minor === null) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, minor };
  } catch (error) {
    if (error instanceof MoneyInputError) {
      return { ok: false, reason: error.code };
    }
    throw error;
  }
}

/** Normalize an ISO 4217 currency cell; returns `undefined` for unsupported codes. */
export function normalizeCurrencyCode(raw: string): string | undefined {
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && isSupportedCurrency(code) ? code : undefined;
}

/** Normalize a whole-number day count (`5`, `05`); decimals and text are rejected. */
export function normalizeWholeNumber(raw: string, max: number): number | undefined {
  const value = raw.trim();
  if (!/^\d{1,9}$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return parsed <= max ? parsed : undefined;
}
