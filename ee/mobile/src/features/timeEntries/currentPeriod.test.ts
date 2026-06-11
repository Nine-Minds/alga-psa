import { describe, expect, it } from "vitest";
import {
  calendarMonthPeriod,
  findCurrentPeriod,
  formatPeriodRange,
  inclusiveEndDate,
  localDateOnly,
  periodFromCurrentResponse,
  resolveCurrentPeriod,
  toDateOnly,
} from "./currentPeriod";

describe("toDateOnly", () => {
  it("keeps plain date strings", () => {
    expect(toDateOnly("2026-06-01")).toBe("2026-06-01");
  });

  it("strips the time portion from ISO datetimes", () => {
    expect(toDateOnly("2026-06-01T00:00:00.000Z")).toBe("2026-06-01");
    expect(toDateOnly("2026-06-01 00:00:00")).toBe("2026-06-01");
  });

  it("returns null for invalid input", () => {
    expect(toDateOnly("garbage")).toBeNull();
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly(undefined)).toBeNull();
  });
});

describe("localDateOnly", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(localDateOnly(new Date(2026, 5, 10))).toBe("2026-06-10");
    expect(localDateOnly(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

describe("findCurrentPeriod", () => {
  const periods = [
    { period_id: "p2", start_date: "2026-06-16", end_date: "2026-07-01" },
    { period_id: "p1", start_date: "2026-06-01", end_date: "2026-06-16" },
  ];

  it("treats start_date as inclusive", () => {
    expect(findCurrentPeriod(periods, "2026-06-01")?.periodId).toBe("p1");
  });

  it("treats end_date as exclusive", () => {
    expect(findCurrentPeriod(periods, "2026-06-15")?.periodId).toBe("p1");
    expect(findCurrentPeriod(periods, "2026-06-16")?.periodId).toBe("p2");
  });

  it("returns null when no period contains the date", () => {
    expect(findCurrentPeriod(periods, "2026-05-31")).toBeNull();
    expect(findCurrentPeriod([], "2026-06-10")).toBeNull();
  });

  it("handles datetime-serialized period boundaries", () => {
    const serialized = [
      { period_id: "p1", start_date: "2026-06-01T00:00:00.000Z", end_date: "2026-06-16T00:00:00.000Z" },
    ];
    expect(findCurrentPeriod(serialized, "2026-06-10")?.periodId).toBe("p1");
    expect(findCurrentPeriod(serialized, "2026-06-10")?.endDateExclusive).toBe("2026-06-16");
  });

  it("skips periods with missing boundaries", () => {
    const broken = [{ period_id: "px", start_date: null, end_date: "2026-06-16" }];
    expect(findCurrentPeriod(broken, "2026-06-10")).toBeNull();
  });
});

describe("calendarMonthPeriod", () => {
  it("covers the current month with an exclusive end", () => {
    expect(calendarMonthPeriod("2026-06-10")).toEqual({
      periodId: null,
      startDate: "2026-06-01",
      endDateExclusive: "2026-07-01",
      isFallback: true,
    });
  });

  it("rolls over December into the next year", () => {
    const period = calendarMonthPeriod("2026-12-25");
    expect(period.startDate).toBe("2026-12-01");
    expect(period.endDateExclusive).toBe("2027-01-01");
  });
});

describe("resolveCurrentPeriod", () => {
  it("prefers a matching server period", () => {
    const resolved = resolveCurrentPeriod(
      [{ period_id: "p1", start_date: "2026-06-01", end_date: "2026-06-16" }],
      "2026-06-10",
    );
    expect(resolved.periodId).toBe("p1");
    expect(resolved.isFallback).toBe(false);
  });

  it("falls back to the calendar month when nothing matches", () => {
    const resolved = resolveCurrentPeriod([], "2026-06-10");
    expect(resolved).toEqual({
      periodId: null,
      startDate: "2026-06-01",
      endDateExclusive: "2026-07-01",
      isFallback: true,
    });
  });
});

describe("periodFromCurrentResponse", () => {
  it("accepts a valid period and normalizes datetime strings", () => {
    expect(
      periodFromCurrentResponse({
        period_id: "p1",
        start_date: "2026-06-01T00:00:00.000Z",
        end_date: "2026-06-16",
      }),
    ).toEqual({
      periodId: "p1",
      startDate: "2026-06-01",
      endDateExclusive: "2026-06-16",
      isFallback: false,
    });
  });

  it("rejects array payloads from mis-wired older servers", () => {
    expect(periodFromCurrentResponse([{ period_id: "p1", start_date: "2026-06-01", end_date: "2026-06-16" }])).toBeNull();
  });

  it("rejects objects without a period id", () => {
    expect(periodFromCurrentResponse({ start_date: "2026-06-01", end_date: "2026-06-16" })).toBeNull();
  });

  it("rejects objects with invalid dates", () => {
    expect(periodFromCurrentResponse({ period_id: "p1", start_date: "not-a-date", end_date: "2026-06-16" })).toBeNull();
    expect(periodFromCurrentResponse({ period_id: "p1", start_date: "2026-06-01" })).toBeNull();
  });

  it("rejects null and primitive payloads", () => {
    expect(periodFromCurrentResponse(null)).toBeNull();
    expect(periodFromCurrentResponse(undefined)).toBeNull();
    expect(periodFromCurrentResponse("p1")).toBeNull();
  });
});

describe("inclusiveEndDate", () => {
  it("subtracts one day from the exclusive end", () => {
    expect(inclusiveEndDate("2026-06-16")).toBe("2026-06-15");
  });

  it("handles month and year rollovers", () => {
    expect(inclusiveEndDate("2026-07-01")).toBe("2026-06-30");
    expect(inclusiveEndDate("2026-01-01")).toBe("2025-12-31");
    expect(inclusiveEndDate("2026-03-01")).toBe("2026-02-28");
  });
});

describe("formatPeriodRange", () => {
  it("formats a same-year range with one year label", () => {
    expect(formatPeriodRange("2026-06-01", "2026-06-16", "en-US")).toBe("Jun 1 – Jun 15, 2026");
  });

  it("formats a cross-year range with both years", () => {
    expect(formatPeriodRange("2025-12-22", "2026-01-05", "en-US")).toBe("Dec 22, 2025 – Jan 4, 2026");
  });

  it("collapses a single-day period to one date", () => {
    expect(formatPeriodRange("2026-06-01", "2026-06-02", "en-US")).toBe("Jun 1, 2026");
  });
});
