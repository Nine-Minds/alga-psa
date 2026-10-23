import type {
  MappingCoercionResult,
  MappingFieldDataType,
  MappingValidationResult,
} from './types';

/**
 * Coercion + validation primitives shared by every destination provider. Each
 * target field declares its `dataType`, `coerce` and `validate`; these helpers
 * implement the common cases so providers only spell out their allowlists.
 */

export function coerceToString(raw: unknown): MappingCoercionResult {
  if (raw === null || raw === undefined) {
    return { ok: false, error: 'Value is empty' };
  }
  if (typeof raw === 'string') {
    return { ok: true, value: raw };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { ok: true, value: String(raw) };
  }
  if (typeof raw === 'boolean') {
    return { ok: true, value: String(raw) };
  }
  return { ok: false, error: 'Value must be text' };
}

export function coerceToNumber(raw: unknown): MappingCoercionResult {
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, error: 'Value must be a finite number' };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, error: 'Value must be a number' };
  }
  return { ok: false, error: 'Value must be a number' };
}

// Integer strings are accepted only in plain decimal form: no fractions, no
// exponent, no thousands separators. Anything else is rejected rather than
// silently rounded or truncated.
const INTEGER_STRING_PATTERN = /^[+-]?\d+$/;

/**
 * Integer-valued coercion for targets stored in an integer/bigint column.
 * Fractional input (`"1200.50"`, `1200.5`), non-finite numbers and values
 * outside the safe-integer range are rejected — never rounded. Providers use
 * this for columns like `clients.credit_limit` (bigint) so preview and apply
 * agree and the value never reaches Postgres to fail there.
 */
export function coerceToInteger(raw: unknown): MappingCoercionResult {
  let parsed: number;
  if (typeof raw === 'number') {
    parsed = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const trimmed = raw.trim();
    if (!INTEGER_STRING_PATTERN.test(trimmed)) {
      return { ok: false, error: 'Value must be a whole number' };
    }
    parsed = Number(trimmed);
  } else {
    return { ok: false, error: 'Value must be a whole number' };
  }

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { ok: false, error: 'Value must be a whole number' };
  }
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, error: 'Value must be a whole number within the supported range' };
  }
  return { ok: true, value: parsed };
}

export function coerceToBoolean(raw: unknown): MappingCoercionResult {
  if (typeof raw === 'boolean') {
    return { ok: true, value: raw };
  }
  if (typeof raw === 'number') {
    if (raw === 1) return { ok: true, value: true };
    if (raw === 0) return { ok: true, value: false };
    return { ok: false, error: 'Value must be true or false' };
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', 'yes', '1', 'on'].includes(normalized)) return { ok: true, value: true };
    if (['false', 'no', '0', 'off'].includes(normalized)) return { ok: true, value: false };
  }
  return { ok: false, error: 'Value must be true or false' };
}

// The portal's `date` field submits a local calendar date as `YYYY-MM-DD`
// (RequestServiceForm.toIsoDateString). Full ISO datetimes are also accepted so
// stored/API answers round-trip. `new Date` alone is unusable here: it happily
// normalizes impossible dates ("2027-02-30" -> 2027-03-02), silently persisting
// a date the answer never named. We therefore parse the components explicitly
// and verify them against real calendar rules before constructing a Date.
const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:[Zz]|[+-]\d{2}:\d{2})?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= maxDay;
}

function utcDate(year: number, month: number, day: number): Date {
  // setUTCFullYear avoids Date.UTC's 0-99 -> 1900-1999 remap.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function parseStrictDate(raw: string): Date | null {
  const dateOnly = ISO_DATE_ONLY_PATTERN.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return isValidCalendarDate(year, month, day) ? utcDate(year, month, day) : null;
  }

  const datetime = ISO_DATETIME_PATTERN.exec(raw);
  if (datetime) {
    const year = Number(datetime[1]);
    const month = Number(datetime[2]);
    const day = Number(datetime[3]);
    const hour = Number(datetime[4]);
    const minute = Number(datetime[5]);
    const second = datetime[6] === undefined ? 0 : Number(datetime[6]);
    if (!isValidCalendarDate(year, month, day)) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    // Components are proven valid, so any remaining rejection (e.g. a bogus
    // timezone offset) is a genuine parse failure rather than normalization.
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function coerceToDate(raw: unknown): MappingCoercionResult {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime())
      ? { ok: false, error: 'Value must be a date' }
      : { ok: true, value: raw.toISOString() };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = parseStrictDate(raw.trim());
    return parsed
      ? { ok: true, value: parsed.toISOString() }
      : { ok: false, error: 'Value must be a valid calendar date (YYYY-MM-DD)' };
  }
  return { ok: false, error: 'Value must be a date' };
}

export function alwaysValid(): MappingValidationResult {
  return { ok: true };
}

export function validateEnum(values: string[]): (value: unknown) => MappingValidationResult {
  const allowed = new Set(values);
  return (value: unknown) => {
    if (typeof value !== 'string' || !allowed.has(value)) {
      return { ok: false, error: `Value must be one of: ${values.join(', ')}` };
    }
    return { ok: true };
  };
}

/** Structural equality used to detect converging replays (skipped_no_change). */
export function mappingValuesEqual(dataType: MappingFieldDataType, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }
  if (b === null || b === undefined) {
    return false;
  }
  switch (dataType) {
    case 'number': {
      const left = Number(a);
      const right = Number(b);
      return Number.isFinite(left) && Number.isFinite(right) && left === right;
    }
    case 'boolean':
      return Boolean(a) === Boolean(b);
    case 'date': {
      const left = new Date(a as string);
      const right = new Date(b as string);
      if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
        return false;
      }
      return left.getTime() === right.getTime();
    }
    default:
      return JSON.stringify(a) === JSON.stringify(b);
  }
}
