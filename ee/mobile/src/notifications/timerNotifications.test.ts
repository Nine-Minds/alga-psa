import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunningTimerSnapshot } from "../features/timer/timerLogic";
import { timerReminderIdentifier } from "../features/timer/timerLogic";

const getPermissionsAsync = vi.fn();
const getAllScheduledNotificationsAsync = vi.fn();
const getPresentedNotificationsAsync = vi.fn();
const cancelScheduledNotificationAsync = vi.fn();
const dismissNotificationAsync = vi.fn();
const scheduleNotificationAsync = vi.fn();
const setNotificationChannelAsync = vi.fn();

vi.mock("expo-notifications", () => ({
  get getPermissionsAsync() { return getPermissionsAsync; },
  get getAllScheduledNotificationsAsync() { return getAllScheduledNotificationsAsync; },
  get getPresentedNotificationsAsync() { return getPresentedNotificationsAsync; },
  get cancelScheduledNotificationAsync() { return cancelScheduledNotificationAsync; },
  get dismissNotificationAsync() { return dismissNotificationAsync; },
  get scheduleNotificationAsync() { return scheduleNotificationAsync; },
  get setNotificationChannelAsync() { return setNotificationChannelAsync; },
  AndroidImportance: { LOW: 2, HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

const getHideSensitiveNotificationsEnabled = vi.fn();
vi.mock("../settings/privacyPreferences", () => ({
  get getHideSensitiveNotificationsEnabled() { return getHideSensitiveNotificationsEnabled; },
}));

import { Platform } from "react-native";
import { syncTimerNotifications, TIMER_NOTIFICATION_KIND } from "./timerNotifications";

const NOW = new Date("2026-07-02T10:00:00.000Z");
const START_MS = NOW.getTime() - 5 * 60_000;

function snapshot(over: Partial<RunningTimerSnapshot> = {}): RunningTimerSnapshot {
  return {
    sessionId: "session-1",
    startTimeMs: START_MS,
    offsetMs: 0,
    workItemId: "ticket-1",
    workItemType: "ticket",
    workItemTitle: "Printer down",
    ...over,
  };
}

describe("syncTimerNotifications", () => {
  const originalOs = Platform.OS;

  beforeEach(() => {
    vi.clearAllMocks();
    getPermissionsAsync.mockResolvedValue({ status: "granted" });
    getAllScheduledNotificationsAsync.mockResolvedValue([]);
    getPresentedNotificationsAsync.mockResolvedValue([]);
    scheduleNotificationAsync.mockResolvedValue("id");
    cancelScheduledNotificationAsync.mockResolvedValue(undefined);
    dismissNotificationAsync.mockResolvedValue(undefined);
    setNotificationChannelAsync.mockResolvedValue(null);
    getHideSensitiveNotificationsEnabled.mockResolvedValue(false);
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = originalOs;
  });

  it("does nothing without notification permission", async () => {
    getPermissionsAsync.mockResolvedValue({ status: "denied" });
    await syncTimerNotifications(snapshot(), NOW);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  it("schedules all future escalating reminders with ticket routing data", async () => {
    await syncTimerNotifications(snapshot(), NOW);

    const identifiers = scheduleNotificationAsync.mock.calls.map((c) => c[0].identifier);
    expect(identifiers).toEqual([
      timerReminderIdentifier("session-1", 60),
      timerReminderIdentifier("session-1", 120),
      timerReminderIdentifier("session-1", 240),
      timerReminderIdentifier("session-1", 480),
    ]);

    const first = scheduleNotificationAsync.mock.calls[0][0];
    expect(first.content.data).toEqual({ kind: TIMER_NOTIFICATION_KIND, ticketId: "ticket-1" });
    expect(first.content.body).toContain("Printer down");
    expect(first.trigger.date.getTime()).toBe(START_MS + 60 * 60_000);
  });

  it("cancels reminders from an older session", async () => {
    const stale = timerReminderIdentifier("old-session", 60);
    getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: stale, content: { data: { kind: TIMER_NOTIFICATION_KIND } } },
      { identifier: "schedule-reminder:x:1", content: { data: { kind: "schedule-reminder" } } },
    ]);

    await syncTimerNotifications(snapshot(), NOW);

    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith(stale);
  });

  it("clears reminders and presented notifications when the timer is idle", async () => {
    const reminder = timerReminderIdentifier("session-1", 120);
    getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: reminder, content: { data: { kind: TIMER_NOTIFICATION_KIND } } },
    ]);
    getPresentedNotificationsAsync.mockResolvedValue([
      {
        request: {
          identifier: "time-tracking-ongoing:session-1",
          content: { data: { kind: TIMER_NOTIFICATION_KIND } },
        },
      },
      {
        request: {
          identifier: "other",
          content: { data: { kind: "push" } },
        },
      },
    ]);

    await syncTimerNotifications(null, NOW);

    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith(reminder);
    expect(dismissNotificationAsync).toHaveBeenCalledTimes(1);
    expect(dismissNotificationAsync).toHaveBeenCalledWith("time-tracking-ongoing:session-1");
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("presents a sticky ongoing notification on Android", async () => {
    (Platform as { OS: string }).OS = "android";

    await syncTimerNotifications(snapshot(), NOW);

    const ongoing = scheduleNotificationAsync.mock.calls
      .map((c) => c[0])
      .find((call) => call.identifier === "time-tracking-ongoing:session-1");
    expect(ongoing).toBeDefined();
    expect(ongoing.content.sticky).toBe(true);
    expect(ongoing.content.autoDismiss).toBe(false);
    expect(ongoing.trigger).toEqual({ channelId: "time-tracking" });
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      "time-tracking",
      expect.objectContaining({ importance: 2 }),
    );
  });

  it("hides the work item title when sensitive notifications are hidden", async () => {
    getHideSensitiveNotificationsEnabled.mockResolvedValue(true);

    await syncTimerNotifications(snapshot(), NOW);

    const first = scheduleNotificationAsync.mock.calls[0][0];
    expect(first.content.body).not.toContain("Printer down");
  });
});
