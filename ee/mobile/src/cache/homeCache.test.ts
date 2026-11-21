import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHomeCache, getCachedHome, mergeCachedHome } from "./homeCache";

describe("homeCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00.000Z"));
    clearHomeCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges independently loaded cards into the same entry", () => {
    mergeCachedHome("day", { schedule: [] });
    mergeCachedHome("day", { tickets: { items: [], total: 4 } });
    expect(getCachedHome("day")).toEqual({ schedule: [], tickets: { items: [], total: 4 } });

    mergeCachedHome("day", { tickets: { items: [], total: 7 } });
    expect(getCachedHome("day")?.tickets?.total).toBe(7);
    expect(getCachedHome("day")?.schedule).toEqual([]);
  });

  it("expires after 5 minutes and starts fresh on the next merge", () => {
    mergeCachedHome("day", { schedule: [] });
    vi.advanceTimersByTime(5 * 60_000);
    expect(getCachedHome("day")).toBeNull();

    mergeCachedHome("day", { activities: [] });
    expect(getCachedHome("day")).toEqual({ activities: [] });
  });

  it("clearHomeCache drops everything", () => {
    mergeCachedHome("day", { schedule: [] });
    clearHomeCache();
    expect(getCachedHome("day")).toBeNull();
  });
});
