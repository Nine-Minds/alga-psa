import {
  SYSTEM_DATE_FORMAT,
  type CountryDateFormat,
  type DateFieldPart,
} from '@alga-psa/core/i18n/countryDateFormat';

/**
 * Country-aware date formatting shared by the client formatter hook
 * (`useFormatters` in ./client.tsx) and the server formatter (./serverOnly.ts).
 *
 * Two inputs, two jobs. The COUNTRY decides digit order, separator and whether
 * the clock is 12- or 24-hour; the LANGUAGE decides names — months, weekdays,
 * AM/PM wording, numerals. Intl bundles both into one locale tag and would let
 * the language reorder the digits (a French UI writing 22/11 where the tenant's
 * country writes 11/22), so the numeric parts are re-assembled afterwards in the
 * country's order and the hour cycle is forced from the country.
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

const DATE_PART_TYPES: ReadonlySet<string> = new Set<DateFieldPart>(['day', 'month', 'year']);

export function isDateOnlyString(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value);
}

/**
 * Intl options with the clock forced to the country's.
 *
 * `hourCycle` is dropped because it silently wins over `hour12` when both are
 * present, which would let a caller reintroduce the language's clock.
 */
function withCountryClock(
  options: Intl.DateTimeFormatOptions | undefined,
  dateFormat: CountryDateFormat,
): Intl.DateTimeFormatOptions {
  const { hourCycle: _ignored, ...rest } = options ?? {};
  return { ...rest, hour12: dateFormat.hour12 };
}

/**
 * Re-assemble a formatted date in the country's field order and separator.
 *
 * Only applies when day and month came out as digits: once Intl has written a
 * month or weekday NAME the order is part of the language's grammar ("22 août
 * 2025"), and reshuffling it would produce something no language writes. Parts
 * outside the date group (weekday, time, timezone) are left exactly where the
 * language put them.
 */
function applyCountryOrder(
  parts: Intl.DateTimeFormatPart[],
  dateFormat: CountryDateFormat,
): string {
  const indexed = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => DATE_PART_TYPES.has(part.type));

  if (indexed.length < 2) {
    return parts.map((part) => part.value).join('');
  }

  const numeric = indexed.every(({ part }) => /^\d+$/.test(part.value));
  if (!numeric) {
    return parts.map((part) => part.value).join('');
  }

  const byType = new Map(indexed.map(({ part }) => [part.type, part.value]));
  const first = indexed[0].index;
  const last = indexed[indexed.length - 1].index;

  const reordered = dateFormat.order
    .filter((type) => byType.has(type))
    .map((type) => byType.get(type) as string)
    .join(dateFormat.separator);

  const head = parts.slice(0, first).map((part) => part.value).join('');
  const tail = parts.slice(last + 1).map((part) => part.value).join('');

  return `${head}${reordered}${tail}`;
}

function formatWithCountry(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions | undefined,
  dateFormat: CountryDateFormat,
): string {
  const resolved = withCountryClock(options, dateFormat);

  try {
    const formatter = new Intl.DateTimeFormat(locale, resolved);
    return applyCountryOrder(formatter.formatToParts(date), dateFormat);
  } catch {
    // An option combination Intl rejects (or a locale it cannot build) must not
    // take the page down: fall back to the caller's own options untouched.
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

export function formatDateValue(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
  dateFormat: CountryDateFormat = SYSTEM_DATE_FORMAT,
): string {
  if (isDateOnlyString(date)) {
    const [year, month, day] = date.split('-').map(Number);
    // Force UTC AFTER spreading options: any caller-supplied timeZone would
    // reintroduce the day shift, and a timezone is meaningless for a value
    // that never carried one.
    return formatWithCountry(
      new Date(Date.UTC(year, month - 1, day)),
      locale,
      { ...options, timeZone: 'UTC' },
      dateFormat,
    );
  }

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return formatWithCountry(dateObj, locale, options, dateFormat);
}
