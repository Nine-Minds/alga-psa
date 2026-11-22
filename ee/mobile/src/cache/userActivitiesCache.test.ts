import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearUserActivitiesCache, getCachedUserActivities, setCachedUserActivities } from "./userActivitiesCache";

const value = { items: [], page: 2, hasNext: true, lastRefreshedAtIso: "2026-11-18T00:00:00.000Z" };

describe("userActivitiesCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00.000Z"));
    clearUserActivitiesCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores paging state for 60s and clears on demand", () => {
    setCachedUserActivities("k", value);
    expect(getCachedUserActivities("k")).toEqual(value);
    vi.advanceTimersByTime(60_000);
    expect(getCachedUserActivities("k")).toBeNull();

    setCachedUserActivities("k", value);
    clearUserActivitiesCache();
    expect(getCachedUserActivities("k")).toBeNull();
  });
});
