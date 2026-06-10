import type { ScheduleEntry } from "../../api/schedule";
import { getDateTimeLocale } from "../../ui/formatters/dateTime";

export const WEEK_LENGTH = 7;

export type ScheduleEntryKind = "ticket" | "adhoc" | "project_task" | "other";

const ADHOC_TYPES = new Set(["ad_hoc", "meeting", "break", "other"]);

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfWeek(date: Date, weekStartsOn = 1): Date {
  const day = startOfDay(date);
  const diff = (day.getDay() - weekStartsOn + 7) % 7;
  return addDays(day, -diff);
}

export function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: WEEK_LENGTH }, (_, i) => addDays(weekStart, i));
}

export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateFromKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

export function weekQueryRange(weekStart: Date): { startIso: string; endIso: string } {
  const start = startOfDay(weekStart);
  const end = new Date(addDays(start, WEEK_LENGTH).getTime() - 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function groupEntriesByDay(entries: ScheduleEntry[]): Map<string, ScheduleEntry[]> {
  const sorted = [...entries].sort((a, b) => {
    const diff = new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
    return diff !== 0 ? diff : a.entry_id.localeCompare(b.entry_id);
  });

  const byDay = new Map<string, ScheduleEntry[]>();
  for (const entry of sorted) {
    const start = new Date(entry.scheduled_start);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(entry.scheduled_end);
    const effectiveEnd =
      !Number.isNaN(end.getTime()) && end.getTime() > start.getTime()
        ? new Date(end.getTime() - 1)
        : start;

    let day = startOfDay(start);
    const lastDay = startOfDay(effectiveEnd);
    for (let i = 0; i < 31 && day.getTime() <= lastDay.getTime(); i++) {
      const key = dateKey(day);
      const list = byDay.get(key);
      if (list) list.push(entry);
      else byDay.set(key, [entry]);
      day = addDays(day, 1);
    }
  }
  return byDay;
}

export function hasRecurrence(entry: Pick<ScheduleEntry, "recurrence_pattern">): boolean {
  const pattern = entry.recurrence_pattern;
  if (pattern == null) return false;
  if (typeof pattern === "string") {
    const trimmed = pattern.trim();
    return trimmed !== "" && trimmed !== "null";
  }
  if (typeof pattern === "object") return Object.keys(pattern).length > 0;
  return Boolean(pattern);
}

export function entryKindOf(entry: Pick<ScheduleEntry, "work_item_type">): ScheduleEntryKind {
  const type = entry.work_item_type;
  if (type === "ticket") return "ticket";
  if (type === "project_task") return "project_task";
  if (type == null || ADHOC_TYPES.has(type)) return "adhoc";
  return "other";
}

export function belongsToUser(entry: ScheduleEntry, userId: string): boolean {
  if (entry.created_by === userId) return true;
  return entry.assigned_users?.some((u) => u.user_id === userId) ?? false;
}

export function isEntryEditable(entry: ScheduleEntry, currentUserId: string | null | undefined): boolean {
  if (!currentUserId) return false;
  if (hasRecurrence(entry)) return false;
  const kind = entryKindOf(entry);
  if (kind !== "ticket" && kind !== "adhoc") return false;
  return belongsToUser(entry, currentUserId);
}

export function combineDateAndTime(date: Date, hhmm: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

export function toHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(getDateTimeLocale(), { timeStyle: "short" }).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}
