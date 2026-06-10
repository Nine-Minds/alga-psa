import { localDateOnly, toDateOnly } from "./currentPeriod";

export type GroupableTimeEntry = {
  entry_id: string;
  work_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  billable_duration?: number | null;
};

export type DayGroup<T extends GroupableTimeEntry> = {
  date: string | null;
  totalMinutes: number;
  entries: T[];
};

export function entryDurationMinutes(entry: GroupableTimeEntry): number {
  const start = entry.start_time ? new Date(entry.start_time).getTime() : NaN;
  const end = entry.end_time ? new Date(entry.end_time).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.round((end - start) / 60_000);
  }
  const billable = entry.billable_duration;
  if (typeof billable === "number" && Number.isFinite(billable) && billable > 0) {
    return Math.round(billable);
  }
  return 0;
}

export function totalLoggedMinutes(entries: GroupableTimeEntry[]): number {
  return entries.reduce((sum, entry) => sum + entryDurationMinutes(entry), 0);
}

export function entryDayKey(entry: GroupableTimeEntry): string | null {
  const workDate = toDateOnly(entry.work_date);
  if (workDate) return workDate;
  if (entry.start_time) {
    const d = new Date(entry.start_time);
    if (!Number.isNaN(d.getTime())) return localDateOnly(d);
  }
  return null;
}

function startTimestamp(entry: GroupableTimeEntry): number {
  if (!entry.start_time) return 0;
  const ts = new Date(entry.start_time).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function groupEntriesByDay<T extends GroupableTimeEntry>(entries: T[]): DayGroup<T>[] {
  const byDay = new Map<string | null, T[]>();
  for (const entry of entries) {
    const key = entryDayKey(entry);
    const list = byDay.get(key);
    if (list) list.push(entry);
    else byDay.set(key, [entry]);
  }

  const groups = Array.from(byDay.entries()).map(([date, list]) => ({
    date,
    totalMinutes: totalLoggedMinutes(list),
    entries: [...list].sort((a, b) => startTimestamp(b) - startTimestamp(a)),
  }));

  groups.sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : -1;
  });

  return groups;
}

export function formatMinutesDuration(minutes: number): string {
  const total = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  if (hours > 0 && remaining > 0) return `${hours}h ${remaining}m`;
  if (hours > 0) return `${hours}h`;
  return `${remaining}m`;
}
