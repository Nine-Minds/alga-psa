import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleEntry } from "../api/schedule";
import {
  clearScheduleCache,
  getCachedScheduleWeek,
  invalidateScheduleWeek,
  scheduleWeekCacheKey,
  setCachedScheduleWeek,
} from "./scheduleCache";

const entries = [{ entry_id: "e-1" }] as unknown as ScheduleEntry[];

describe("scheduleCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00.000Z"));
    clearScheduleCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a per-user, per-week key", () => {
    expect(scheduleWeekCacheKey("u-1", "2026-11-16")).toBe("alga.mobile.schedule.week.u-1.2026-11-16");
    expect(scheduleWeekCacheKey("u-2", "2026-11-16")).not.toBe(scheduleWeekCacheKey("u-1", "2026-11-16"));
  });

  it("stores a week for 60s", () => {
    const key = scheduleWeekCacheKey("u-1", "2026-11-16");
    setCachedScheduleWeek(key, entries);
    expect(getCachedScheduleWeek(key)).toBe(entries);
    vi.advanceTimersByTime(60_000);
    expect(getCachedScheduleWeek(key)).toBeNull();
  });

  it("invalidates a single week without touching others, and clears all", () => {
    setCachedScheduleWeek("a", entries);
    setCachedScheduleWeek("b", entries);
    invalidateScheduleWeek("a");
    expect(getCachedScheduleWeek("a")).toBeNull();
    expect(getCachedScheduleWeek("b")).toBe(entries);
    clearScheduleCache();
    expect(getCachedScheduleWeek("b")).toBeNull();
  });
});
