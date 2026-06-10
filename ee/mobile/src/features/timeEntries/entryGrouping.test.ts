import { describe, expect, it } from "vitest";
import {
  entryDayKey,
  entryDurationMinutes,
  formatMinutesDuration,
  groupEntriesByDay,
  totalLoggedMinutes,
} from "./entryGrouping";

describe("entryDurationMinutes", () => {
  it("derives minutes from start and end times", () => {
    expect(
      entryDurationMinutes({
        entry_id: "e1",
        start_time: "2026-06-09T09:00:00.000Z",
        end_time: "2026-06-09T09:30:00.000Z",
      }),
    ).toBe(30);
  });

  it("falls back to billable_duration when times are missing or invalid", () => {
    expect(entryDurationMinutes({ entry_id: "e1", billable_duration: 45 })).toBe(45);
    expect(
      entryDurationMinutes({
        entry_id: "e1",
        start_time: "2026-06-09T09:00:00.000Z",
        end_time: "2026-06-09T09:00:00.000Z",
        billable_duration: 60,
      }),
    ).toBe(60);
  });

  it("returns 0 when nothing usable is present", () => {
    expect(entryDurationMinutes({ entry_id: "e1" })).toBe(0);
    expect(entryDurationMinutes({ entry_id: "e1", billable_duration: -5 })).toBe(0);
  });
});

describe("totalLoggedMinutes", () => {
  it("sums per-entry durations", () => {
    expect(
      totalLoggedMinutes([
        { entry_id: "e1", start_time: "2026-06-09T09:00:00.000Z", end_time: "2026-06-09T10:00:00.000Z" },
        { entry_id: "e2", billable_duration: 15 },
      ]),
    ).toBe(75);
  });

  it("returns 0 for an empty list", () => {
    expect(totalLoggedMinutes([])).toBe(0);
  });
});

describe("entryDayKey", () => {
  it("prefers work_date", () => {
    expect(entryDayKey({ entry_id: "e1", work_date: "2026-06-09", start_time: "2026-06-08T23:00:00.000Z" })).toBe(
      "2026-06-09",
    );
  });

  it("normalizes datetime-serialized work_date", () => {
    expect(entryDayKey({ entry_id: "e1", work_date: "2026-06-09T00:00:00.000Z" })).toBe("2026-06-09");
  });

  it("falls back to the local date of start_time", () => {
    expect(entryDayKey({ entry_id: "e1", start_time: "2026-06-09T10:00:00" })).toBe("2026-06-09");
  });

  it("returns null when no date is derivable", () => {
    expect(entryDayKey({ entry_id: "e1" })).toBeNull();
    expect(entryDayKey({ entry_id: "e1", start_time: "garbage" })).toBeNull();
  });
});

describe("groupEntriesByDay", () => {
  it("groups by day with the newest day first", () => {
    const groups = groupEntriesByDay([
      { entry_id: "e1", work_date: "2026-06-08", billable_duration: 30 },
      { entry_id: "e2", work_date: "2026-06-09", billable_duration: 60 },
      { entry_id: "e3", work_date: "2026-06-08", billable_duration: 15 },
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-09", "2026-06-08"]);
    expect(groups[0].entries.map((e) => e.entry_id)).toEqual(["e2"]);
    expect(groups[1].entries.map((e) => e.entry_id)).toEqual(["e1", "e3"]);
    expect(groups[1].totalMinutes).toBe(45);
  });

  it("sorts entries within a day by start_time, newest first", () => {
    const groups = groupEntriesByDay([
      { entry_id: "early", work_date: "2026-06-09", start_time: "2026-06-09T08:00:00.000Z" },
      { entry_id: "late", work_date: "2026-06-09", start_time: "2026-06-09T15:00:00.000Z" },
    ]);
    expect(groups[0].entries.map((e) => e.entry_id)).toEqual(["late", "early"]);
  });

  it("puts entries without a derivable date last", () => {
    const groups = groupEntriesByDay([
      { entry_id: "e1" },
      { entry_id: "e2", work_date: "2026-06-09" },
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-09", null]);
  });

  it("returns an empty list unchanged", () => {
    expect(groupEntriesByDay([])).toEqual([]);
  });
});

describe("formatMinutesDuration", () => {
  it("formats minutes as Xh Ym", () => {
    expect(formatMinutesDuration(90)).toBe("1h 30m");
    expect(formatMinutesDuration(60)).toBe("1h");
    expect(formatMinutesDuration(45)).toBe("45m");
    expect(formatMinutesDuration(600)).toBe("10h");
  });

  it("clamps zero, negative, and invalid values to 0m", () => {
    expect(formatMinutesDuration(0)).toBe("0m");
    expect(formatMinutesDuration(-10)).toBe("0m");
    expect(formatMinutesDuration(Number.NaN)).toBe("0m");
  });

  it("rounds fractional minutes", () => {
    expect(formatMinutesDuration(59.6)).toBe("1h");
    expect(formatMinutesDuration(30.2)).toBe("30m");
  });
});
