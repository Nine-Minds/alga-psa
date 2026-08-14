/**
 * Text parsing and formatting shared by the date / time / date+time field family.
 *
 * Typing is the fast path in every variant, so the rules live here rather than
 * inside a component: the same parser has to serve the date field, the time
 * field and the tests that pin arbitrary-minute precision.
 */

export type TimeFormatPreference = '12h' | '24h';
export type DateFieldPart = 'day' | 'month' | 'year';

/** 22 Nov 2033 — day, month and year are all distinct, so part order is unambiguous. */
const DATE_ORDER_SAMPLE = new Date(2033, 10, 22);
const DEFAULT_ORDER: DateFieldPart[] = ['month', 'day', 'year'];

/** Pseudo-locales used for translation QA have no date convention of their own. */
function resolveIntlLocale(locale?: string): string {
  if (!locale || locale === 'xx' || locale === 'yy') return 'en';
  return locale;
}

function dateParts(locale?: string): Intl.DateTimeFormatPart[] | null {
  try {
    return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(DATE_ORDER_SAMPLE);
  } catch {
    return null;
  }
}

/** Which of day/month/year comes first in this locale's short date. */
export function getDateFieldOrder(locale?: string): DateFieldPart[] {
  const parts = dateParts(locale);
  if (!parts) return DEFAULT_ORDER;

  const order = parts
    .filter((part): part is Intl.DateTimeFormatPart & { type: DateFieldPart } =>
      part.type === 'day' || part.type === 'month' || part.type === 'year')
    .map((part) => part.type);

  return order.length === 3 ? order : DEFAULT_ORDER;
}

export function getDateSeparator(locale?: string): string {
  const parts = dateParts(locale);
  const literal = parts?.find((part) => part.type === 'literal' && /\S/.test(part.value));
  const trimmed = literal?.value.replace(/\s/g, '');
  return trimmed && trimmed.length > 0 ? trimmed : '/';
}

/** The format itself, used as the placeholder so nobody has to guess field order. */
export function getDatePlaceholder(locale?: string): string {
  const separator = getDateSeparator(locale);
  return getDateFieldOrder(locale)
    .map((part) => (part === 'year' ? 'yyyy' : part === 'month' ? 'mm' : 'dd'))
    .join(separator);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeWord(value: string): string {
  return value.trim().toLowerCase();
}

/** 2-digit years land in a 1970–2069 window; 4-digit years are taken as written. */
function expandYear(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  if (raw.length <= 2) {
    const value = parseInt(raw, 10);
    return value < 70 ? 2000 + value : 1900 + value;
  }
  if (raw.length === 4) return parseInt(raw, 10);
  return null;
}

export interface ParseDateInputOptions {
  /** Reference "now" for relative words and omitted years. */
  today?: Date;
  /** Localised spellings of today / tomorrow / yesterday, in addition to the English ones. */
  relativeWords?: Partial<Record<'today' | 'tomorrow' | 'yesterday', Array<string | undefined>>>;
}

/**
 * Parse what a user typed into a date field.
 *
 * Accepts locale-ordered numbers with any of `/ . -` (or none at all), the three
 * relative words, and signed day offsets. Deliberately refuses everything else:
 * a wrong guess on an invoice date is expensive, so `31/02/2026` is rejected
 * rather than rolled forward.
 */
export function parseDateInput(
  raw: string,
  locale?: string,
  options: ParseDateInputOptions = {},
): Date | null {
  const text = normalizeWord(raw);
  if (!text) return null;

  const today = startOfDay(options.today ?? new Date());
  const relative: Array<[number, Array<string | undefined>]> = [
    [0, ['today', ...(options.relativeWords?.today ?? [])]],
    [1, ['tomorrow', ...(options.relativeWords?.tomorrow ?? [])]],
    [-1, ['yesterday', ...(options.relativeWords?.yesterday ?? [])]],
  ];
  for (const [offset, words] of relative) {
    if (words.some((word) => word && normalizeWord(word) === text)) {
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    }
  }

  const signedOffset = text.match(/^([+-])(\d{1,4})$/);
  if (signedOffset) {
    const days = parseInt(signedOffset[2], 10) * (signedOffset[1] === '-' ? -1 : 1);
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  }

  const order = getDateFieldOrder(locale);
  const dayMonthOrder = order.filter((part) => part !== 'year');
  const values: Partial<Record<DateFieldPart, string>> = {};
  const tokens = text.split(/[^0-9]+/).filter(Boolean);

  if (tokens.length === 1) {
    const digits = tokens[0];
    if (digits.length === 4) {
      dayMonthOrder.forEach((part, index) => {
        values[part] = digits.slice(index * 2, index * 2 + 2);
      });
    } else if (digits.length === 6 || digits.length === 8) {
      const yearLength = digits.length === 8 ? 4 : 2;
      let cursor = 0;
      for (const part of order) {
        const length = part === 'year' ? yearLength : 2;
        values[part] = digits.slice(cursor, cursor + length);
        cursor += length;
      }
    } else {
      return null;
    }
  } else if (tokens.length === 2) {
    dayMonthOrder.forEach((part, index) => {
      values[part] = tokens[index];
    });
  } else if (tokens.length === 3) {
    // A leading 4-digit token can only be an ISO year, whatever the locale
    // orders — that is what gets pasted out of reports and spreadsheets.
    const isoOrder: DateFieldPart[] = ['year', 'month', 'day'];
    (tokens[0].length === 4 ? isoOrder : order).forEach((part, index) => {
      values[part] = tokens[index];
    });
  } else {
    return null;
  }

  const day = parseInt(values.day ?? '', 10);
  const month = parseInt(values.month ?? '', 10);
  const year = values.year === undefined ? today.getFullYear() : expandYear(values.year);

  if (year === null || Number.isNaN(day) || Number.isNaN(month)) return null;

  const parsed = new Date(year, month - 1, day);
  // Round-trip guard: rejects 31/02 instead of silently becoming 03/03.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

/**
 * Parse what a user typed into a time field.
 *
 * Lifted unchanged from TimePicker's `allowManualInput` branch, which two
 * surfaces had to opt into: `1435`, `14:35`, `14.35`, `235p`, `2:35 pm`, `9a`
 * all land, `25:00` does not.
 */
export function parseTimeInput(raw: string): string | null {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return null;

  const meridiemMatch = normalized.match(/(am?|pm?)$/);
  const meridiem = meridiemMatch?.[0]?.startsWith('p') ? 'PM' : meridiemMatch ? 'AM' : null;
  const numericPart = meridiemMatch
    ? normalized.slice(0, normalized.length - meridiemMatch[0].length)
    : normalized;

  const cleanedNumericPart = numericPart.replace('.', ':');
  let hour: number;
  let minute: number;

  if (cleanedNumericPart.includes(':')) {
    const [hourPart, minutePart = '0'] = cleanedNumericPart.split(':');
    if (!/^\d{1,2}$/.test(hourPart) || !/^\d{1,2}$/.test(minutePart)) {
      return null;
    }
    hour = parseInt(hourPart, 10);
    minute = parseInt(minutePart.padStart(2, '0'), 10);
  } else {
    if (!/^\d{1,4}$/.test(cleanedNumericPart)) {
      return null;
    }

    if (cleanedNumericPart.length <= 2) {
      hour = parseInt(cleanedNumericPart, 10);
      minute = 0;
    } else if (cleanedNumericPart.length === 3) {
      hour = parseInt(cleanedNumericPart.slice(0, 1), 10);
      minute = parseInt(cleanedNumericPart.slice(1), 10);
    } else {
      hour = parseInt(cleanedNumericPart.slice(0, 2), 10);
      minute = parseInt(cleanedNumericPart.slice(2), 10);
    }
  }

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return null;
  }

  let hour24: number;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour24 = hour % 12;
    if (meridiem === 'PM') hour24 += 12;
  } else {
    if (hour < 0 || hour > 23) return null;
    hour24 = hour;
  }

  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function isValidTimeValue(value?: string): boolean {
  return !!value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

const BASE_DATE_SEPARATORS = ['/', '.', '-', ' '];

function escapeForCharClass(value: string): string {
  return value.replace(/[\\\]^-]/g, '\\$&');
}

export interface TypableDateOptions {
  /** Separator the active locale writes, when it is none of `/ . -`. */
  separators?: Array<string | undefined>;
  /** Localised relative words, so they can still be spelled out. */
  words?: Array<string | undefined>;
}

/**
 * Whether text could still grow into something `parseDateInput` accepts.
 *
 * The field refuses characters that no valid entry can contain instead of
 * taking them and failing on commit: a letter in a date is a typo at the
 * keystroke, not a decision to be argued with later.
 */
export function isTypableDateText(raw: string, options: TypableDateOptions = {}): boolean {
  const text = raw.trim();
  if (!text) return true;

  const separators = Array.from(
    new Set([...BASE_DATE_SEPARATORS, ...(options.separators ?? [])].filter((s): s is string => !!s))
  );
  const separatorClass = separators.map(escapeForCharClass).join('');
  if (new RegExp(`^[+-]?\\d{0,8}(?:[${separatorClass}]\\d{0,4}){0,2}$`).test(text)) {
    return true;
  }

  const lower = text.toLowerCase();
  const words = ['today', 'tomorrow', 'yesterday', ...(options.words ?? [])];
  return words.some((word) => word && word.toLowerCase().startsWith(lower));
}

/** The same rule for the time half: digits, one separator, and a meridiem after a digit. */
export function isTypableTimeText(raw: string): boolean {
  const text = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return true;

  const meridiem = text.match(/(am?|pm?)$/);
  const numericPart = meridiem ? text.slice(0, text.length - meridiem[0].length) : text;
  // "2:35p" is on its way somewhere; a bare "p" is not.
  if (meridiem && !/^\d/.test(numericPart)) return false;

  return /^(\d{1,2}[:.]\d{0,2}|\d{0,4})$/.test(numericPart);
}

export function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':');
  return parseInt(hour, 10) * 60 + parseInt(minute, 10);
}

export function minutesToTime(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** How a time reads in the field and in the rail: 14:35 or 2:35 PM. */
export function formatTimeDisplay(value: string | undefined, timeFormat: TimeFormatPreference): string {
  if (!isValidTimeValue(value)) return '';

  const [hourStr, minuteStr] = (value as string).split(':');
  if (timeFormat === '24h') return `${hourStr}:${minuteStr}`;

  const hourNum = parseInt(hourStr, 10);
  const displayHour = hourNum % 12 || 12;
  return `${displayHour}:${minuteStr} ${hourNum >= 12 ? 'PM' : 'AM'}`;
}

/**
 * The rail: every quarter hour, plus the value in play when it is not on one.
 *
 * That extra row is why the redesign can drop the 60-row minute lane without
 * losing :35 or :37 — timesheet minutes reach invoices, so they stay reachable.
 */
export function buildTimeOptions(value: string | undefined, stepMinutes = 15): string[] {
  const step = Math.min(60, Math.max(1, Math.floor(stepMinutes) || 15));
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    options.push(minutesToTime(minutes));
  }

  if (isValidTimeValue(value) && !options.includes(value as string)) {
    const target = timeToMinutes(value as string);
    const index = options.findIndex((option) => timeToMinutes(option) > target);
    options.splice(index === -1 ? options.length : index, 0, value as string);
  }

  return options;
}

/** True when a row is the user's own minute rather than one of ours. */
export function isExactMinuteOption(option: string, stepMinutes = 15): boolean {
  const step = Math.min(60, Math.max(1, Math.floor(stepMinutes) || 15));
  return timeToMinutes(option) % step !== 0;
}
