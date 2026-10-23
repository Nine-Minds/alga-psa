import * as Localization from "expo-localization";

export type DateFieldPart = "day" | "month" | "year";

/** Digit order, separator and clock — a property of the tenant's country. */
export type DateTimeFormatShape = {
  order: DateFieldPart[];
  separator: string;
  hour12: boolean;
};

/**
 * What we write before the server has told us otherwise, and for app versions
 * talking to a server that predates the capabilities field.
 *
 * Deliberately NOT the device locale: the phone's region says where the
 * technician bought it, not how their MSP writes dates, and the old behaviour
 * of following it is exactly what this replaces. Matches the web's fixed
 * system default (US-style).
 */
export const SYSTEM_DATE_FORMAT: DateTimeFormatShape = {
  order: ["month", "day", "year"],
  separator: "/",
  hour12: true,
};

// The device language still names the months and weekdays — that half never
// belonged to the country.
let locale = Localization.getLocales()[0]?.languageTag || "en-US";
let dateFormat: DateTimeFormatShape = SYSTEM_DATE_FORMAT;

/** Update the locale (names) and, optionally, the country shape (digits, clock). */
export function setDateTimeLocale(nextLocale: string, nextFormat?: DateTimeFormatShape | null): void {
  locale = nextLocale;
  dateFormat = nextFormat ?? SYSTEM_DATE_FORMAT;
}

/** Return the current locale used by date formatters. */
export function getDateTimeLocale(): string {
  return locale;
}

/** Return the current country date shape used by date formatters. */
export function getDateTimeFormat(): DateTimeFormatShape {
  return dateFormat;
}

const DATE_PART_TYPES = new Set<string>(["day", "month", "year"]);

/**
 * Re-assemble a formatted date in the country's field order and separator.
 *
 * Only when day and month came out as digits: once Intl has written a month
 * NAME the order is the language's grammar, and reshuffling it would produce
 * something no language writes. Mirrors the web's formatDateValue.
 */
function formatWithCountry(date: Date, options: Intl.DateTimeFormatOptions): string {
  const parts = new Intl.DateTimeFormat(locale, { ...options, hour12: dateFormat.hour12 }).formatToParts(date);
  const indexed = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => DATE_PART_TYPES.has(part.type));

  const joined = parts.map((part) => part.value).join("");
  if (indexed.length < 2 || !indexed.every(({ part }) => /^\d+$/.test(part.value))) {
    return joined;
  }

  const byType = new Map(indexed.map(({ part }) => [part.type, part.value]));
  const first = indexed[0].index;
  const last = indexed[indexed.length - 1].index;
  const reordered = dateFormat.order
    .filter((type) => byType.has(type))
    .map((type) => byType.get(type) as string)
    .join(dateFormat.separator);

  return (
    parts.slice(0, first).map((part) => part.value).join("") +
    reordered +
    parts.slice(last + 1).map((part) => part.value).join("")
  );
}

type ParsedDate = { date: Date; kind: "date" | "datetime" };

function parseDate(value: unknown): ParsedDate | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : { date: d, kind: "date" };
  }

  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : { date: d, kind: "datetime" };
}

export function formatDateShort(value: unknown): string {
  const parsed = parseDate(value);
  if (!parsed) return "—";
  try {
    return formatWithCountry(parsed.date, { dateStyle: "medium" });
  } catch {
    return parsed.date.toLocaleDateString();
  }
}

export function formatDateTime(value: unknown): string {
  const parsed = parseDate(value);
  if (!parsed) return "—";
  try {
    if (parsed.kind === "date") {
      return formatWithCountry(parsed.date, { dateStyle: "medium" });
    }
    return formatWithCountry(parsed.date, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return parsed.kind === "date" ? parsed.date.toLocaleDateString() : parsed.date.toLocaleString();
  }
}

export function formatRelativeTime(value: unknown): string {
  const parsed = parseDate(value);
  if (!parsed) return "";

  const diffMs = parsed.date.getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "";

  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const rtf =
    typeof Intl !== "undefined" && typeof (Intl as any).RelativeTimeFormat === "function"
      ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
      : null;

  const toUnit = (unit: Intl.RelativeTimeFormatUnit, msPerUnit: number) => {
    const value = Math.round(diffMs / msPerUnit);
    return rtf ? rtf.format(value, unit) : "";
  };

  if (abs < minute) return rtf ? rtf.format(0, "minute") : "just now";
  if (abs < hour) return toUnit("minute", minute);
  if (abs < day) return toUnit("hour", hour);
  return toUnit("day", day);
}

export function formatDateTimeWithRelative(value: unknown): string {
  const absolute = formatDateTime(value);
  if (absolute === "—") return "—";
  const rel = formatRelativeTime(value);
  return rel ? `${rel} • ${absolute}` : absolute;
}
