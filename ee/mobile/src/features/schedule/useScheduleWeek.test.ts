import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
  return { t, list: vi.fn(), sync: vi.fn(), warn: vi.fn() };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../api/schedule", () => ({ listScheduleEntries: (...args: unknown[]) => mocks.list(...args) }));
vi.mock("../../notifications/scheduleReminders", () => ({ syncScheduleReminders: (...args: unknown[]) => mocks.sync(...args) }));
vi.mock("../../logging/logger", () => ({ logger: { warn: (...args: unknown[]) => mocks.warn(...args), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import type { ApiClient } from "../../api";
import { clearScheduleCache, getCachedScheduleWeek, scheduleWeekCacheKey } from "../../cache/scheduleCache";
import { useScheduleWeek } from "./useScheduleWeek";

const client = { request: vi.fn() } as unknown as ApiClient;
const WEEK = "2026-11-16";

function entry(id: string, day: number, hour: number) {
  return {
    entry_id: id,
    title: id,
    scheduled_start: new Date(2026, 10, day, hour).toISOString(),
    scheduled_end: new Date(2026, 10, day, hour + 1).toISOString(),
    work_item_id: null,
    work_item_type: "meeting",
    notes: null,
    is_private: false,
  };
}

type Args = Parameters<typeof useScheduleWeek>[0];
type Result = ReturnType<typeof useScheduleWeek>;

async function renderHook(overrides: Partial<Args> = {}) {
  const latest: { current: Result } = { current: undefined as unknown as Result };
  let args: Args = { client, apiKey: "key-1", userId: "u-1", weekStartKey: WEEK, ...overrides };
  function Wrapper(props: Args) {
    latest.current = useScheduleWeek(props);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(Wrapper, args));
  });
  return {
    get result() {
      return latest.current;
    },
    rerender: async (next: Partial<Args>) => {
      args = { ...args, ...next };
      await act(async () => renderer.update(React.createElement(Wrapper, args)));
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

describe("useScheduleWeek", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearScheduleCache();
    mocks.list.mockResolvedValue({ ok: true, data: { data: [entry("b", 17, 10), entry("a", 17, 9), entry("c", 18, 9)] } });
    mocks.sync.mockResolvedValue(undefined);
  });

  it("fetches the week window for the user, groups by day, caches and syncs reminders", async () => {
    const hook = await renderHook();
    const start = new Date(2026, 10, 16).toISOString();
    const end = new Date(new Date(2026, 10, 23).getTime() - 1).toISOString();
    expect(mocks.list).toHaveBeenCalledWith(client, expect.objectContaining({ apiKey: "key-1", startDate: start, endDate: end, userId: "u-1" }));
    expect(hook.result.loading).toBe(false);
    expect(hook.result.error).toBeNull();
    expect(hook.result.entries).toHaveLength(3);
    expect(hook.result.entriesByDay.get("2026-11-17")?.map((e) => e.entry_id)).toEqual(["a", "b"]);
    expect(hook.result.entriesByDay.get("2026-11-18")?.map((e) => e.entry_id)).toEqual(["c"]);
    expect(getCachedScheduleWeek(scheduleWeekCacheKey("u-1", WEEK))).toHaveLength(3);
    expect(mocks.sync).toHaveBeenCalledWith(hook.result.entries, { startIso: start, endIso: end });
  });

  it("serves a cached week without refetching", async () => {
    await renderHook();
    mocks.list.mockClear();
    const hook = await renderHook();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(hook.result.entries).toHaveLength(3);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it("refresh bypasses the cache", async () => {
    const hook = await renderHook();
    mocks.list.mockResolvedValue({ ok: true, data: { data: [entry("z", 19, 9)] } });
    await act(async () => hook.result.refresh());
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(hook.result.entries.map((e) => e.entry_id)).toEqual(["z"]);
  });

  it("treats a non-array payload as empty", async () => {
    mocks.list.mockResolvedValue({ ok: true, data: { data: null } });
    const hook = await renderHook();
    expect(hook.result.entries).toEqual([]);
  });

  it("flags no access on permission errors", async () => {
    mocks.list.mockResolvedValue({ ok: false, error: { kind: "permission", message: "no" } });
    const hook = await renderHook();
    expect(hook.result.noAccess).toBe(true);
    expect(hook.result.error).toBeNull();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("surfaces an error message on other failures and keeps prior entries", async () => {
    const hook = await renderHook();
    mocks.list.mockResolvedValue({ ok: false, error: { kind: "server", message: "boom" } });
    await act(async () => hook.result.refresh());
    expect(hook.result.error).toBe("We couldn't load your schedule. Pull to refresh or try again.");
    expect(hook.result.entries).toHaveLength(3);
  });

  it("ignores canceled requests", async () => {
    mocks.list.mockResolvedValue({ ok: false, error: { kind: "canceled" } });
    const hook = await renderHook();
    expect(hook.result.error).toBeNull();
    expect(hook.result.noAccess).toBe(false);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("does nothing without a client or with a bad week key", async () => {
    await renderHook({ client: null });
    await renderHook({ apiKey: null });
    await renderHook({ weekStartKey: "nope" });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("uses an anonymous cache key and no user filter without a user", async () => {
    await renderHook({ userId: null });
    expect(mocks.list.mock.calls[0][1].userId).toBeUndefined();
    expect(getCachedScheduleWeek(scheduleWeekCacheKey("anon", WEEK))).toHaveLength(3);
  });

  it("drops a stale response when the week changes mid-flight", async () => {
    let resolveFirst!: (v: unknown) => void;
    mocks.list.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    mocks.list.mockResolvedValueOnce({ ok: true, data: { data: [entry("next", 24, 9)] } });
    const hook = await renderHook();
    expect(hook.result.loading).toBe(true);
    const firstSignal = mocks.list.mock.calls[0][1].signal as AbortSignal;
    await hook.rerender({ weekStartKey: "2026-11-23" });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => resolveFirst({ ok: true, data: { data: [entry("old", 17, 9)] } }));
    expect(hook.result.entries.map((e) => e.entry_id)).toEqual(["next"]);
  });

  it("aborts the in-flight request on unmount", async () => {
    mocks.list.mockReturnValueOnce(new Promise(() => undefined));
    const hook = await renderHook();
    const signal = mocks.list.mock.calls[0][1].signal as AbortSignal;
    hook.unmount();
    expect(signal.aborted).toBe(true);
  });
});
