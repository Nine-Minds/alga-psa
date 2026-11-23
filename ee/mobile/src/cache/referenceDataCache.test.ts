import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedTicketCategories,
  getCachedTicketPriorities,
  getCachedTicketStatuses,
  setCachedTicketCategories,
  setCachedTicketPriorities,
  setCachedTicketStatuses,
} from "./referenceDataCache";

describe("referenceDataCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps statuses, priorities and categories in separate stores for 10 minutes", () => {
    setCachedTicketStatuses("k", ["open"]);
    setCachedTicketPriorities("k", ["high"]);
    setCachedTicketCategories("k", ["hardware"]);

    expect(getCachedTicketStatuses("k")).toEqual(["open"]);
    expect(getCachedTicketPriorities("k")).toEqual(["high"]);
    expect(getCachedTicketCategories("k")).toEqual(["hardware"]);
    expect(getCachedTicketStatuses("other")).toBeNull();

    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(getCachedTicketStatuses("k")).toEqual(["open"]);
    vi.advanceTimersByTime(1);
    expect(getCachedTicketStatuses("k")).toBeNull();
    expect(getCachedTicketPriorities("k")).toBeNull();
    expect(getCachedTicketCategories("k")).toBeNull();
  });
});
