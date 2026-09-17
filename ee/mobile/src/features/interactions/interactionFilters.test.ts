import { describe, expect, it } from "vitest";
import { DEFAULT_INTERACTION_FILTERS, filtersToQuery, hasActiveInteractionFilters, whenToDateRange } from "./interactionFilters";

const now = new Date("2026-09-16T15:30:00"); // a Wednesday, local time

describe("interactionFilters", () => {
  it("maps 'when' presets to local-day windows", () => {
    expect(whenToDateRange("today", now)).toEqual({
      dateFrom: new Date("2026-09-16T00:00:00").toISOString(),
      dateTo: new Date("2026-09-16T23:59:59.999").toISOString(),
    });
    expect(whenToDateRange("thisWeek", now)).toEqual({
      dateFrom: new Date("2026-09-14T00:00:00").toISOString(),
      dateTo: new Date("2026-09-20T23:59:59.999").toISOString(),
    });
    expect(whenToDateRange("upcoming", now)).toEqual({ dateFrom: now.toISOString() });
    expect(whenToDateRange("past30", now)).toEqual({
      dateFrom: new Date("2026-08-17T00:00:00").toISOString(),
      dateTo: now.toISOString(),
    });
    expect(whenToDateRange("any", now)).toEqual({});
  });

  it("builds the API query from filters, scoping to me by default", () => {
    expect(filtersToQuery(DEFAULT_INTERACTION_FILTERS, "me-1", now)).toEqual({ userId: "me-1" });
    expect(filtersToQuery({ scope: "everyone", status: "open", when: "any", typeId: "t-call" }, "me-1", now))
      .toEqual({ typeId: "t-call", isClosed: false });
    expect(filtersToQuery({ scope: "mine", status: "closed", when: "upcoming", typeId: null }, null, now))
      .toEqual({ isClosed: true, dateFrom: now.toISOString() });
  });

  it("does not count the scope as an active filter", () => {
    expect(hasActiveInteractionFilters(DEFAULT_INTERACTION_FILTERS)).toBe(false);
    expect(hasActiveInteractionFilters({ ...DEFAULT_INTERACTION_FILTERS, scope: "everyone" })).toBe(false);
    expect(hasActiveInteractionFilters({ ...DEFAULT_INTERACTION_FILTERS, when: "today" })).toBe(true);
  });
});
