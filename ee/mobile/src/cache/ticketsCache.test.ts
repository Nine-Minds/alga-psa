import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTicketsCache,
  getCachedTicketDetail,
  getCachedTicketsList,
  invalidateTicket,
  invalidateTicketDetail,
  invalidateTicketsListCache,
  setCachedTicketDetail,
  setCachedTicketsList,
} from "./ticketsCache";

describe("ticketsCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00.000Z"));
    clearTicketsCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps list entries for 30s and detail entries for 60s", () => {
    setCachedTicketsList("list", { items: [1] });
    setCachedTicketDetail("t-1", { id: "t-1" });

    vi.advanceTimersByTime(29_999);
    expect(getCachedTicketsList("list")).toEqual({ items: [1] });
    vi.advanceTimersByTime(1);
    expect(getCachedTicketsList("list")).toBeNull();
    expect(getCachedTicketDetail("t-1")).toEqual({ id: "t-1" });

    vi.advanceTimersByTime(30_000);
    expect(getCachedTicketDetail("t-1")).toBeNull();
  });

  it("invalidateTicket drops that detail and every list entry, but keeps other details", () => {
    setCachedTicketsList("a", 1);
    setCachedTicketsList("b", 2);
    setCachedTicketDetail("t-1", "one");
    setCachedTicketDetail("t-2", "two");

    invalidateTicket("t-1");

    expect(getCachedTicketDetail("t-1")).toBeNull();
    expect(getCachedTicketDetail("t-2")).toBe("two");
    expect(getCachedTicketsList("a")).toBeNull();
    expect(getCachedTicketsList("b")).toBeNull();
  });

  it("invalidateTicketDetail and invalidateTicketsListCache are independent", () => {
    setCachedTicketsList("a", 1);
    setCachedTicketDetail("t-1", "one");

    invalidateTicketDetail("t-1");
    expect(getCachedTicketsList("a")).toBe(1);

    setCachedTicketDetail("t-1", "one");
    invalidateTicketsListCache();
    expect(getCachedTicketDetail("t-1")).toBe("one");
    expect(getCachedTicketsList("a")).toBeNull();
  });

  it("clearTicketsCache empties both caches", () => {
    setCachedTicketsList("a", 1);
    setCachedTicketDetail("t-1", "one");
    clearTicketsCache();
    expect(getCachedTicketsList("a")).toBeNull();
    expect(getCachedTicketDetail("t-1")).toBeNull();
  });
});
