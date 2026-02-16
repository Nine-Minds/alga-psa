import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "./ttlCache";

describe("TtlCache", () => {
  it("returns null after expiry and evicts expired entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-03T00:00:00.000Z"));

    const cache = new TtlCache<{ v: number }>({ defaultTtlMs: 1000 });
    cache.set("a", { v: 1 });
    expect(cache.get("a")).toEqual({ v: 1 });

    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toEqual({ v: 1 });

    vi.advanceTimersByTime(1);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("a")).toBeNull();

    vi.useRealTimers();
  });

  it("supports explicit ttl override", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-03T00:00:00.000Z"));

    const cache = new TtlCache<number>({ defaultTtlMs: 1000 });
    cache.set("a", 1, 10_000);

    vi.advanceTimersByTime(1001);
    expect(cache.get("a")).toBe(1);

    vi.advanceTimersByTime(8999);
    expect(cache.get("a")).toBeNull();

    vi.useRealTimers();
  });
});

