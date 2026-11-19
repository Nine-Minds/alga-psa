import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProjectsCache, getCachedProjects, setCachedProjects } from "./projectsCache";

describe("projectsCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00.000Z"));
    clearProjectsCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a list page for 60s and clears on demand", () => {
    setCachedProjects("k", { items: [], total: 3 });
    expect(getCachedProjects("k")).toEqual({ items: [], total: 3 });
    vi.advanceTimersByTime(59_999);
    expect(getCachedProjects("k")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(getCachedProjects("k")).toBeNull();

    setCachedProjects("k", { items: [], total: null });
    clearProjectsCache();
    expect(getCachedProjects("k")).toBeNull();
  });
});
