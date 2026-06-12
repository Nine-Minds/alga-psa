import { TtlCache } from "./ttlCache";
import type { ScheduleEntry } from "../api/schedule";

const WEEK_TTL_MS = 60_000;

const scheduleWeekCache = new TtlCache<ScheduleEntry[]>({ defaultTtlMs: WEEK_TTL_MS });

export function scheduleWeekCacheKey(userId: string, weekStartKey: string): string {
  return `alga.mobile.schedule.week.${userId}.${weekStartKey}`;
}

export function getCachedScheduleWeek(key: string): ScheduleEntry[] | null {
  return scheduleWeekCache.get(key);
}

export function setCachedScheduleWeek(key: string, entries: ScheduleEntry[]): void {
  scheduleWeekCache.set(key, entries);
}

export function invalidateScheduleWeek(key: string): void {
  scheduleWeekCache.delete(key);
}

export function clearScheduleCache(): void {
  scheduleWeekCache.clear();
}
