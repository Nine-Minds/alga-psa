import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TYPE_FILTERS,
  DEFAULT_ACTIVITY_FILTERS,
  activitiesApiParams,
  countActiveFilters,
  dueRange,
  groupFieldsFor,
  hasNonDefaultView,
  scopedPriorityItemType,
  type ActivitiesFilterState,
} from "./activityFilters";

// A fixed "now" so the due-window assertions are deterministic: 2026-06-15T14:30 local.
const NOW = new Date(2026, 5, 15, 14, 30, 0, 0);
const START_OF_DAY = new Date(2026, 5, 15, 0, 0, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("dueRange", () => {
  it("returns an empty window for 'any'", () => {
    expect(dueRange("any", NOW)).toEqual({});
  });

  it("'overdue' ends just before the start of today", () => {
    const { dueDateStart, dueDateEnd } = dueRange("overdue", NOW);
    expect(dueDateStart).toBeUndefined();
    expect(dueDateEnd).toBe(new Date(START_OF_DAY - 1).toISOString());
  });

  it("'today' spans the start to the end of today", () => {
    expect(dueRange("today", NOW)).toEqual({
      dueDateStart: new Date(START_OF_DAY).toISOString(),
      dueDateEnd: new Date(START_OF_DAY + DAY - 1).toISOString(),
    });
  });

  it("'week' spans today through the next 7 days", () => {
    expect(dueRange("week", NOW)).toEqual({
      dueDateStart: new Date(START_OF_DAY).toISOString(),
      dueDateEnd: new Date(START_OF_DAY + 7 * DAY - 1).toISOString(),
    });
  });
});

describe("scopedPriorityItemType", () => {
  it("is null with no type or multiple types selected", () => {
    expect(scopedPriorityItemType(DEFAULT_ACTIVITY_FILTERS)).toBeNull();
    expect(scopedPriorityItemType({ ...DEFAULT_ACTIVITY_FILTERS, types: ["ticket", "projectTask"] })).toBeNull();
  });

  it("maps a single prioritized type to its item_type", () => {
    expect(scopedPriorityItemType({ ...DEFAULT_ACTIVITY_FILTERS, types: ["ticket"] })).toBe("ticket");
    expect(scopedPriorityItemType({ ...DEFAULT_ACTIVITY_FILTERS, types: ["projectTask"] })).toBe("project_task");
  });

  it("is null for a single non-prioritized type (e.g. schedule)", () => {
    expect(scopedPriorityItemType({ ...DEFAULT_ACTIVITY_FILTERS, types: ["schedule"] })).toBeNull();
  });
});

describe("groupFieldsFor", () => {
  it("drops the priority grouping option when not single-type scoped", () => {
    expect(groupFieldsFor(DEFAULT_ACTIVITY_FILTERS)).not.toContain("priority");
  });

  it("offers priority grouping when scoped to tickets", () => {
    expect(groupFieldsFor({ ...DEFAULT_ACTIVITY_FILTERS, types: ["ticket"] })).toContain("priority");
  });
});

describe("activitiesApiParams", () => {
  it("sends status + the default work-type set (notifications excluded) by default", () => {
    expect(activitiesApiParams(DEFAULT_ACTIVITY_FILTERS, NOW)).toEqual({
      status: "open",
      type: ACTIVITY_TYPE_FILTERS,
    });
    expect(ACTIVITY_TYPE_FILTERS).not.toContain("notification");
  });

  it("includes exact priorityIds only when scoped to a single prioritized type", () => {
    const scoped: ActivitiesFilterState = {
      ...DEFAULT_ACTIVITY_FILTERS,
      status: "all",
      types: ["ticket"],
      priorityIds: ["p1", "p2"],
      due: "today",
      sortField: "dueDate",
      sortOrder: "desc",
      groupBy: "priority",
    };
    expect(activitiesApiParams(scoped, NOW)).toEqual({
      status: "all",
      type: ["ticket"],
      priorityIds: ["p1", "p2"],
      dueDateStart: new Date(START_OF_DAY).toISOString(),
      dueDateEnd: new Date(START_OF_DAY + DAY - 1).toISOString(),
      sortBy: "dueDate",
      sortDirection: "desc",
    });
  });

  it("drops priorityIds when not scoped (multiple types), keeping them out of the query", () => {
    const unscoped: ActivitiesFilterState = {
      ...DEFAULT_ACTIVITY_FILTERS,
      types: ["ticket", "projectTask"],
      priorityIds: ["p1"],
    };
    const params = activitiesApiParams(unscoped, NOW);
    expect(params.priorityIds).toBeUndefined();
    expect(params.type).toEqual(["ticket", "projectTask"]);
  });

  it("omits sortBy/sortDirection when the sort field is the default", () => {
    const params = activitiesApiParams({ ...DEFAULT_ACTIVITY_FILTERS, sortField: "default", sortOrder: "desc" }, NOW);
    expect(params.sortBy).toBeUndefined();
    expect(params.sortDirection).toBeUndefined();
  });
});

describe("countActiveFilters", () => {
  it("is zero for the defaults", () => {
    expect(countActiveFilters(DEFAULT_ACTIVITY_FILTERS)).toBe(0);
  });

  it("counts each narrowing dimension but not sort or grouping", () => {
    const filters: ActivitiesFilterState = {
      status: "closed",
      types: ["ticket"],
      priorityIds: ["p1", "p2"],
      due: "overdue",
      sortField: "title",
      sortOrder: "asc",
      groupBy: "status",
    };
    // status + types + priorityIds + due = 4 (sort/groupBy excluded).
    expect(countActiveFilters(filters)).toBe(4);
  });
});

describe("hasNonDefaultView", () => {
  it("is false for defaults and empty search", () => {
    expect(hasNonDefaultView(DEFAULT_ACTIVITY_FILTERS, "")).toBe(false);
  });

  it("is true when only grouping changed", () => {
    expect(hasNonDefaultView({ ...DEFAULT_ACTIVITY_FILTERS, groupBy: "type" }, "")).toBe(true);
  });

  it("is true when only the search term is set", () => {
    expect(hasNonDefaultView(DEFAULT_ACTIVITY_FILTERS, "vpn")).toBe(true);
  });
});
