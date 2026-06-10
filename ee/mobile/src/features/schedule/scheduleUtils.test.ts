import { describe, expect, it } from "vitest";
import type { ScheduleEntry } from "../../api/schedule";
import {
  addDays,
  combineDateAndTime,
  dateFromKey,
  dateKey,
  entryKindOf,
  getWeekDays,
  groupEntriesByDay,
  hasRecurrence,
  isEntryEditable,
  isSameDay,
  startOfWeek,
  toHHMM,
  weekQueryRange,
} from "./scheduleUtils";

function entry(overrides: Partial<ScheduleEntry>): ScheduleEntry {
  return {
    entry_id: "se-1",
    title: "Entry",
    scheduled_start: "2026-06-10T09:00:00.000Z",
    scheduled_end: "2026-06-10T10:00:00.000Z",
    work_item_id: null,
    work_item_type: null,
    notes: null,
    is_private: false,
    recurrence_pattern: null,
    created_by: "user-1",
    assigned_users: [{ user_id: "user-1" }],
    ...overrides,
  };
}

describe("week math", () => {
  it("startOfWeek returns the Monday at local midnight", () => {
    const wednesday = new Date(2026, 5, 10, 15, 30);
    const monday = startOfWeek(wednesday);
    expect(dateKey(monday)).toBe("2026-06-08");
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
  });

  it("startOfWeek is identity for a Monday", () => {
    const monday = new Date(2026, 5, 8, 0, 0);
    expect(dateKey(startOfWeek(monday))).toBe("2026-06-08");
  });

  it("startOfWeek rolls a Sunday back to the previous Monday", () => {
    const sunday = new Date(2026, 5, 14, 23, 59);
    expect(dateKey(startOfWeek(sunday))).toBe("2026-06-08");
  });

  it("getWeekDays returns 7 consecutive days", () => {
    const days = getWeekDays(new Date(2026, 5, 8));
    expect(days).toHaveLength(7);
    expect(days.map(dateKey)).toEqual([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
  });

  it("addDays crosses month boundaries", () => {
    expect(dateKey(addDays(new Date(2026, 5, 29), 7))).toBe("2026-07-06");
    expect(dateKey(addDays(new Date(2026, 6, 6), -7))).toBe("2026-06-29");
  });

  it("weekQueryRange spans the full local week", () => {
    const { startIso, endIso } = weekQueryRange(new Date(2026, 5, 8));
    const start = new Date(startIso);
    const end = new Date(endIso);
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000 - 1);
    expect(isSameDay(start, new Date(2026, 5, 8))).toBe(true);
  });

  it("dateFromKey round-trips dateKey", () => {
    const d = dateFromKey("2026-06-10");
    expect(d).not.toBeNull();
    expect(dateKey(d as Date)).toBe("2026-06-10");
    expect(dateFromKey("nope")).toBeNull();
  });
});

describe("groupEntriesByDay", () => {
  it("groups entries under their local start day sorted by start", () => {
    const later = entry({
      entry_id: "se-2",
      scheduled_start: new Date(2026, 5, 10, 14, 0).toISOString(),
      scheduled_end: new Date(2026, 5, 10, 15, 0).toISOString(),
    });
    const earlier = entry({
      entry_id: "se-1",
      scheduled_start: new Date(2026, 5, 10, 9, 0).toISOString(),
      scheduled_end: new Date(2026, 5, 10, 10, 0).toISOString(),
    });
    const otherDay = entry({
      entry_id: "se-3",
      scheduled_start: new Date(2026, 5, 11, 9, 0).toISOString(),
      scheduled_end: new Date(2026, 5, 11, 10, 0).toISOString(),
    });

    const grouped = groupEntriesByDay([later, otherDay, earlier]);
    expect(grouped.get("2026-06-10")?.map((e) => e.entry_id)).toEqual(["se-1", "se-2"]);
    expect(grouped.get("2026-06-11")?.map((e) => e.entry_id)).toEqual(["se-3"]);
  });

  it("includes a multi-day entry on each day it spans", () => {
    const spanning = entry({
      entry_id: "se-span",
      scheduled_start: new Date(2026, 5, 10, 22, 0).toISOString(),
      scheduled_end: new Date(2026, 5, 12, 2, 0).toISOString(),
    });

    const grouped = groupEntriesByDay([spanning]);
    expect([...grouped.keys()]).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
  });

  it("does not bleed into the next day when the entry ends at midnight", () => {
    const untilMidnight = entry({
      entry_id: "se-mid",
      scheduled_start: new Date(2026, 5, 10, 22, 0).toISOString(),
      scheduled_end: new Date(2026, 5, 11, 0, 0).toISOString(),
    });

    const grouped = groupEntriesByDay([untilMidnight]);
    expect([...grouped.keys()]).toEqual(["2026-06-10"]);
  });

  it("skips entries with invalid start dates", () => {
    const broken = entry({ entry_id: "se-bad", scheduled_start: "not-a-date" });
    expect(groupEntriesByDay([broken]).size).toBe(0);
  });
});

describe("isEntryEditable", () => {
  it("allows the user's own ticket-linked entry", () => {
    const e = entry({ work_item_type: "ticket", work_item_id: "ticket-1" });
    expect(isEntryEditable(e, "user-1")).toBe(true);
  });

  it("allows the user's own meeting entry", () => {
    const e = entry({ work_item_type: "meeting" });
    expect(isEntryEditable(e, "user-1")).toBe(true);
  });

  it("allows ad_hoc entries as stored by the server", () => {
    const e = entry({ work_item_type: "ad_hoc" });
    expect(isEntryEditable(e, "user-1")).toBe(true);
  });

  it("allows entries with no work item type", () => {
    const e = entry({ work_item_type: null });
    expect(isEntryEditable(e, "user-1")).toBe(true);
  });

  it("rejects the user's own recurring entry", () => {
    const asString = entry({ recurrence_pattern: '{"frequency":"weekly"}' });
    const asObject = entry({ recurrence_pattern: { frequency: "weekly" } });
    expect(isEntryEditable(asString, "user-1")).toBe(false);
    expect(isEntryEditable(asObject, "user-1")).toBe(false);
  });

  it("rejects project_task entries", () => {
    const e = entry({ work_item_type: "project_task", work_item_id: "task-1" });
    expect(isEntryEditable(e, "user-1")).toBe(false);
  });

  it("rejects someone else's entry", () => {
    const e = entry({ created_by: "user-2", assigned_users: [{ user_id: "user-2" }] });
    expect(isEntryEditable(e, "user-1")).toBe(false);
  });

  it("accepts an assigned entry created by someone else", () => {
    const e = entry({ created_by: "user-2", assigned_users: [{ user_id: "user-1" }] });
    expect(isEntryEditable(e, "user-1")).toBe(true);
  });

  it("rejects when there is no current user", () => {
    expect(isEntryEditable(entry({}), null)).toBe(false);
    expect(isEntryEditable(entry({}), undefined)).toBe(false);
  });
});

describe("hasRecurrence", () => {
  it("treats null, empty and 'null' strings, and empty objects as non-recurring", () => {
    expect(hasRecurrence({ recurrence_pattern: null })).toBe(false);
    expect(hasRecurrence({ recurrence_pattern: undefined })).toBe(false);
    expect(hasRecurrence({ recurrence_pattern: "" })).toBe(false);
    expect(hasRecurrence({ recurrence_pattern: "null" })).toBe(false);
    expect(hasRecurrence({ recurrence_pattern: {} })).toBe(false);
  });

  it("treats non-empty patterns as recurring", () => {
    expect(hasRecurrence({ recurrence_pattern: "weekly" })).toBe(true);
    expect(hasRecurrence({ recurrence_pattern: { frequency: "daily" } })).toBe(true);
  });
});

describe("entryKindOf", () => {
  it("maps work item types to kinds", () => {
    expect(entryKindOf({ work_item_type: "ticket" })).toBe("ticket");
    expect(entryKindOf({ work_item_type: "project_task" })).toBe("project_task");
    expect(entryKindOf({ work_item_type: "meeting" })).toBe("adhoc");
    expect(entryKindOf({ work_item_type: "break" })).toBe("adhoc");
    expect(entryKindOf({ work_item_type: "other" })).toBe("adhoc");
    expect(entryKindOf({ work_item_type: "ad_hoc" })).toBe("adhoc");
    expect(entryKindOf({ work_item_type: null })).toBe("adhoc");
    expect(entryKindOf({ work_item_type: "interaction" })).toBe("other");
  });
});

describe("combineDateAndTime / toHHMM", () => {
  it("combines a date with HH:MM into a local datetime", () => {
    const combined = combineDateAndTime(new Date(2026, 5, 10), "09:30");
    expect(combined).not.toBeNull();
    expect(combined?.getHours()).toBe(9);
    expect(combined?.getMinutes()).toBe(30);
    expect(dateKey(combined as Date)).toBe("2026-06-10");
  });

  it("rejects invalid times", () => {
    expect(combineDateAndTime(new Date(2026, 5, 10), "24:00")).toBeNull();
    expect(combineDateAndTime(new Date(2026, 5, 10), "9:99")).toBeNull();
    expect(combineDateAndTime(new Date(2026, 5, 10), "abc")).toBeNull();
  });

  it("toHHMM zero-pads", () => {
    expect(toHHMM(new Date(2026, 5, 10, 7, 5))).toBe("07:05");
    expect(toHHMM(new Date(2026, 5, 10, 23, 59))).toBe("23:59");
  });
});
