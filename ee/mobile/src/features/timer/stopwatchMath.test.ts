import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeMs,
  clockOffset,
  firstStart,
  isRunning,
  toEntrySpan,
  type StopwatchSegmentLike,
} from "./stopwatchMath";

const MIN = 60_000;
const T0 = Date.parse("2026-07-02T10:00:30.000Z");

describe("stopwatchMath parity with packages/scheduling", () => {
  it("is byte-identical to the server copy", () => {
    const mobile = readFileSync(path.resolve(__dirname, "stopwatchMath.ts"), "utf8");
    const server = readFileSync(
      path.resolve(__dirname, "../../../../../packages/scheduling/src/lib/stopwatch/stopwatchMath.ts"),
      "utf8",
    );
    expect(mobile).toBe(server);
  });
});

describe("stopwatchMath behaviour (mobile copy)", () => {
  const segments: StopwatchSegmentLike[] = [
    { started_at: new Date(T0).toISOString(), ended_at: new Date(T0 + 30 * MIN).toISOString() },
    { started_at: new Date(T0 + 90 * MIN).toISOString(), ended_at: null },
  ];

  it("sums closed segments plus the open one", () => {
    expect(activeMs(segments, T0 + 150 * MIN)).toBe(90 * MIN);
    expect(isRunning(segments)).toBe(true);
    expect(firstStart(segments)?.getTime()).toBe(T0);
  });

  it("does not advance while paused", () => {
    const paused = [{ ...segments[0] }, { ...segments[1], ended_at: new Date(T0 + 120 * MIN).toISOString() }];
    expect(activeMs(paused, T0 + 500 * MIN)).toBe(60 * MIN);
  });

  it("builds a consistent entry span with pause time", () => {
    const span = toEntrySpan(segments, T0 + 150 * MIN);
    expect(span.start.toISOString()).toBe("2026-07-02T10:00:00.000Z");
    expect(span.billableMinutes).toBe(90);
    expect(span.end.getTime() - span.start.getTime()).toBe(90 * MIN);
    expect(span.pausedMs).toBe(60 * MIN);
    expect(span.segmentCount).toBe(2);
  });

  it("bills at least one minute", () => {
    const span = toEntrySpan([{ started_at: new Date(T0).toISOString(), ended_at: new Date(T0 + 5_000).toISOString() }], T0 + MIN);
    expect(span.billableMinutes).toBe(1);
  });

  it("computes the clock offset as server minus local", () => {
    expect(clockOffset(T0 + 10 * MIN, T0)).toBe(10 * MIN);
  });
});
