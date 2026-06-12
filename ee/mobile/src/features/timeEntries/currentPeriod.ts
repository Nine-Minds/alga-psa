// Server period semantics (TimePeriod.findByDate): start_date inclusive, end_date exclusive.

export type TimePeriodLike = {
  period_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type ResolvedPeriod = {
  periodId: string | null;
  startDate: string;
  endDateExclusive: string;
  isFallback: boolean;
};

export function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(value.trim());
  return match ? match[1] : null;
}

export function localDateOnly(date: Date = new Date()): string {
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function findCurrentPeriod(periods: TimePeriodLike[], today: string): ResolvedPeriod | null {
  for (const period of periods) {
    const start = toDateOnly(period.start_date);
    const end = toDateOnly(period.end_date);
    if (!start || !end) continue;
    if (start <= today && today < end) {
      return {
        periodId: period.period_id ?? null,
        startDate: start,
        endDateExclusive: end,
        isFallback: false,
      };
    }
  }
  return null;
}

export function calendarMonthPeriod(today: string): ResolvedPeriod {
  const [year, month] = today.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    periodId: null,
    startDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`,
    endDateExclusive: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`,
    isFallback: true,
  };
}

export function resolveCurrentPeriod(periods: TimePeriodLike[], today: string): ResolvedPeriod {
  return findCurrentPeriod(periods, today) ?? calendarMonthPeriod(today);
}

// Older servers mis-wired /time-periods/current to the timesheet list; only a
// non-array object with a period id and valid dates counts as a real period.
export function periodFromCurrentResponse(data: unknown): ResolvedPeriod | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as TimePeriodLike;
  if (typeof row.period_id !== "string" || !row.period_id) return null;
  const start = toDateOnly(row.start_date);
  const end = toDateOnly(row.end_date);
  if (!start || !end) return null;
  return {
    periodId: row.period_id,
    startDate: start,
    endDateExclusive: end,
    isFallback: false,
  };
}

export function inclusiveEndDate(endDateExclusive: string): string {
  const [year, month, day] = endDateExclusive.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatPeriodRange(startDate: string, endDateExclusive: string, locale = "en-US"): string {
  const endDate = inclusiveEndDate(endDateExclusive);
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return `${startDate} – ${endDate}`;
  try {
    const endLabel = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(end);
    if (startDate === endDate) return endLabel;
    const sameYear = start.getFullYear() === end.getFullYear();
    const startLabel = new Intl.DateTimeFormat(
      locale,
      sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
    ).format(start);
    return `${startLabel} – ${endLabel}`;
  } catch {
    return `${startDate} – ${endDate}`;
  }
}
