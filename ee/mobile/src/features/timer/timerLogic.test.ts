import { describe, expect, it } from "vitest";
import {
  TIMER_REMINDER_THRESHOLDS_MINUTES,
  computeServerClockOffsetMs,
  diffTimerReminders,
  elapsedMsAt,
  formatElapsedClock,
  formatMinutesDuration,
  parseTimerReminderIdentifier,
  planTimerReminders,
  timerReminderIdentifier,
  type RunningTimerSnapshot,
} from "./timerLogic";

const START_ISO = "2026-07-02T10:00:00.000Z";
const START_MS = Date.parse(START_ISO);

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

describe("computeServerClockOffsetMs", () => {
  it("returns 0 when clocks agree", () => {
    const localNow = START_MS + 10 * 60_000;
    expect(computeServerClockOffsetMs(START_ISO, 10, localNow)).toBe(0);
  });

  it("treats sub-90s offsets as noise from minute rounding", () => {
    const localNow = START_MS + 10 * 60_000 + 80_000;
    expect(computeServerClockOffsetMs(START_ISO, 10, localNow)).toBe(0);
  });

  it("returns the real offset when the device clock is far off", () => {
    const localNow = START_MS + 10 * 60_000 - 10 * 60_000; // device 10m behind
    expect(computeServerClockOffsetMs(START_ISO, 10, localNow)).toBe(10 * 60_000);
  });

  it("returns 0 for an unparseable start time", () => {
    expect(computeServerClockOffsetMs("not-a-date", 5, START_MS)).toBe(0);
  });
});

describe("elapsedMsAt", () => {
  it("computes elapsed from the local clock plus offset", () => {
    expect(elapsedMsAt(START_MS + 90_000, START_MS, 0)).toBe(90_000);
    expect(elapsedMsAt(START_MS, START_MS, 120_000)).toBe(120_000);
  });

  it("never goes negative", () => {
    expect(elapsedMsAt(START_MS - 5_000, START_MS, 0)).toBe(0);
  });
});

describe("formatElapsedClock", () => {
  it("formats minutes and seconds under an hour", () => {
    expect(formatElapsedClock(0)).toBe("0:00");
    expect(formatElapsedClock(7_000)).toBe("0:07");
    expect(formatElapsedClock(12 * 60_000 + 34_000)).toBe("12:34");
  });

  it("formats hours past an hour", () => {
    expect(formatElapsedClock(3600_000 + 2 * 60_000 + 3_000)).toBe("1:02:03");
    expect(formatElapsedClock(26 * 3600_000)).toBe("26:00:00");
  });
});

describe("formatMinutesDuration", () => {
  it("formats minutes, hours, and mixes", () => {
    expect(formatMinutesDuration(0)).toBe("0m");
    expect(formatMinutesDuration(45)).toBe("45m");
    expect(formatMinutesDuration(60)).toBe("1h");
    expect(formatMinutesDuration(135)).toBe("2h 15m");
    expect(formatMinutesDuration(-5)).toBe("0m");
  });
});

describe("reminder identifiers", () => {
  it("round-trips", () => {
    const id = timerReminderIdentifier("session-1", 120);
    expect(parseTimerReminderIdentifier(id)).toEqual({
      sessionId: "session-1",
      thresholdMinutes: 120,
    });
  });

  it("rejects foreign identifiers", () => {
    expect(parseTimerReminderIdentifier("schedule-reminder:x:1")).toBeNull();
    expect(parseTimerReminderIdentifier("timer-reminder:no-threshold")).toBeNull();
  });
});

describe("planTimerReminders", () => {
  it("plans all thresholds for a fresh session", () => {
    const planned = planTimerReminders(snapshot(), START_MS + 1_000);
    expect(planned.map((p) => p.thresholdMinutes)).toEqual(
      TIMER_REMINDER_THRESHOLDS_MINUTES,
    );
    expect(planned[0].fireAt.getTime()).toBe(START_MS + 60 * 60_000);
  });

  it("skips thresholds already passed", () => {
    const planned = planTimerReminders(snapshot(), START_MS + 3 * 3600_000);
    expect(planned.map((p) => p.thresholdMinutes)).toEqual([240, 480]);
  });

  it("shifts fire times into the local clock when offset is set", () => {
    const planned = planTimerReminders(
      snapshot({ offsetMs: 10 * 60_000 }),
      START_MS,
    );
    expect(planned[0].fireAt.getTime()).toBe(START_MS + 50 * 60_000);
  });
});

describe("diffTimerReminders", () => {
  it("cancels stale identifiers from older sessions and schedules new ones", () => {
    const planned = planTimerReminders(snapshot(), START_MS + 1_000);
    const stale = [
      timerReminderIdentifier("old-session", 60),
      timerReminderIdentifier("session-1", 60),
    ];
    const { toCancel, toSchedule } = diffTimerReminders(stale, planned);
    expect(toCancel).toEqual([timerReminderIdentifier("old-session", 60)]);
    expect(toSchedule.map((p) => p.thresholdMinutes)).toEqual([120, 240, 480]);
  });

  it("cancels everything when nothing is planned", () => {
    const stale = [timerReminderIdentifier("session-1", 60)];
    const { toCancel, toSchedule } = diffTimerReminders(stale, []);
    expect(toCancel).toEqual(stale);
    expect(toSchedule).toEqual([]);
  });
});
