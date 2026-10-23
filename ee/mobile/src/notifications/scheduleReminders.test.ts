import { describe, expect, it, vi } from "vitest";
import type { ScheduleEntry } from "../api/schedule";

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  cancelScheduledNotificationAsync: vi.fn(async () => undefined),
  scheduleNotificationAsync: vi.fn(async () => "id"),
  setNotificationChannelAsync: vi.fn(async () => null),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

vi.mock("../settings/notificationPreferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/notificationPreferences")>()),
  getReminderLeadMinutes: async () => [15],
}));

import {
  MAX_PENDING_SCHEDULE_REMINDERS,
  REMINDER_LEAD_MINUTES,
  diffScheduleReminders,
  parseReminderIdentifier,
  planScheduleReminders,
  reminderIdentifier,
} from "./scheduleReminders";

const NOW = new Date("2026-06-12T10:00:00.000Z");

function makeEntry(id: string, startIso: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    entry_id: id,
    title: `Entry ${id}`,
    scheduled_start: startIso,
    scheduled_end: startIso,
    work_item_id: null,
    work_item_type: null,
    notes: null,
    is_private: false,
    ...over,
  };
}

describe("reminderIdentifier", () => {
  it("round-trips through parseReminderIdentifier", () => {
    const startMs = Date.parse("2026-06-12T12:00:00.000Z");
    const id = reminderIdentifier("entry-1", startMs, 10);
    expect(parseReminderIdentifier(id)).toEqual({ entryId: "entry-1", startMs, leadMinutes: 10 });
  });

  it("still parses identifiers written before leads were configurable", () => {
    const startMs = Date.parse("2026-06-12T12:00:00.000Z");
    expect(parseReminderIdentifier(`schedule-reminder:entry-1:${startMs}`)).toEqual({ entryId: "entry-1", startMs, leadMinutes: null });
  });

  it("rejects foreign identifiers", () => {
    expect(parseReminderIdentifier("something-else")).toBeNull();
    expect(parseReminderIdentifier("schedule-reminder:no-time")).toBeNull();
  });
});

describe("planScheduleReminders", () => {
  it("plans a reminder with the lead time before the start", () => {
    const start = "2026-06-12T12:00:00.000Z";
    const planned = planScheduleReminders([makeEntry("e1", start)], { now: NOW });
    expect(planned).toHaveLength(1);
    expect(planned[0].fireAt.getTime()).toBe(Date.parse(start) - REMINDER_LEAD_MINUTES * 60 * 1000);
    expect(planned[0].entryId).toBe("e1");
  });

  it("skips entries whose reminder time has already passed", () => {
    const planned = planScheduleReminders(
      [
        makeEntry("past", "2026-06-12T09:00:00.000Z"),
        makeEntry("too-soon", "2026-06-12T10:10:00.000Z"),
        makeEntry("future", "2026-06-12T11:00:00.000Z"),
      ],
      { now: NOW },
    );
    expect(planned.map((p) => p.entryId)).toEqual(["future"]);
  });

  it("skips entries with invalid or missing start dates", () => {
    const planned = planScheduleReminders(
      [makeEntry("bad", "not-a-date"), makeEntry("empty", "")],
      { now: NOW },
    );
    expect(planned).toEqual([]);
  });

  it("dedupes occurrences with the same entry and start", () => {
    const start = "2026-06-12T12:00:00.000Z";
    const planned = planScheduleReminders([makeEntry("e1", start), makeEntry("e1", start)], { now: NOW });
    expect(planned).toHaveLength(1);
  });

  it("plans one reminder per configured lead, soonest first", () => {
    const start = "2026-06-12T12:00:00.000Z";
    const planned = planScheduleReminders([makeEntry("e1", start)], { now: NOW, leadMinutes: [15, 5] });
    expect(planned.map((p) => p.leadMinutes)).toEqual([15, 5]);
    expect(planned.map((p) => p.fireAt.toISOString())).toEqual(["2026-06-12T11:45:00.000Z", "2026-06-12T11:55:00.000Z"]);
    expect(new Set(planned.map((p) => p.identifier)).size).toBe(2);
  });

  it("plans nothing when reminders are turned off", () => {
    expect(planScheduleReminders([makeEntry("e1", "2026-06-12T12:00:00.000Z")], { now: NOW, leadMinutes: [] })).toEqual([]);
  });

  it("caps pending reminders to the soonest ones", () => {
    const entries = Array.from({ length: 30 }, (_, i) => makeEntry(`e${i}`, new Date(NOW.getTime() + (i + 2) * 60 * 60 * 1000).toISOString()));
    const planned = planScheduleReminders(entries, { now: NOW, leadMinutes: [15, 5], limit: 10 });
    expect(planned).toHaveLength(10);
    expect(planned.every((p, i) => i === 0 || p.fireAt >= planned[i - 1].fireAt)).toBe(true);
    expect(planned[0].entryId).toBe("e0");
    expect(MAX_PENDING_SCHEDULE_REMINDERS).toBeLessThan(64);
  });
});

describe("diffScheduleReminders", () => {
  const windowStart = Date.parse("2026-06-08T00:00:00.000Z");
  const windowEnd = Date.parse("2026-06-15T00:00:00.000Z");
  const window = { startMs: windowStart, endMs: windowEnd };

  it("schedules new reminders and keeps existing matches", () => {
    const planned = planScheduleReminders(
      [makeEntry("e1", "2026-06-12T12:00:00.000Z"), makeEntry("e2", "2026-06-13T09:00:00.000Z")],
      { now: NOW },
    );
    const { toCancel, toSchedule } = diffScheduleReminders([planned[0].identifier], planned, window);
    expect(toCancel).toEqual([]);
    expect(toSchedule.map((p) => p.entryId)).toEqual(["e2"]);
  });

  it("cancels reminders for entries removed within the synced window", () => {
    const stale = reminderIdentifier("gone", Date.parse("2026-06-12T15:00:00.000Z"), 15);
    const { toCancel } = diffScheduleReminders([stale], [], window);
    expect(toCancel).toEqual([stale]);
  });

  it("reschedules when an entry start time changed", () => {
    const oldId = reminderIdentifier("e1", Date.parse("2026-06-12T12:00:00.000Z"), 15);
    const planned = planScheduleReminders([makeEntry("e1", "2026-06-12T14:00:00.000Z")], { now: NOW });
    const { toCancel, toSchedule } = diffScheduleReminders([oldId], planned, window);
    expect(toCancel).toEqual([oldId]);
    expect(toSchedule).toHaveLength(1);
  });

  it("never cancels reminders for entries outside the synced window", () => {
    const nextWeek = reminderIdentifier("later", Date.parse("2026-06-20T12:00:00.000Z"), 15);
    const { toCancel } = diffScheduleReminders([nextWeek], [], window);
    expect(toCancel).toEqual([]);
  });
});
