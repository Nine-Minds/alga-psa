import * as Localization from "expo-localization";

const locale = Localization.getLocales()[0]?.languageTag || "en-US";

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
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed.date);
  } catch {
    return parsed.date.toLocaleDateString();
  }
}

export function formatDateTime(value: unknown): string {
  const parsed = parseDate(value);
  if (!parsed) return "—";
  try {
    if (parsed.kind === "date") {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(parsed.date);
    }
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed.date);
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
