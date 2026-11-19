import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { ok: true, baseUrl: "https://tenant.example.com" } as { ok: boolean; baseUrl?: string; error?: string },
  createApiClient: vi.fn(),
  listScheduleEntries: vi.fn(),
  syncScheduleReminders: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/schedule", () => ({ listScheduleEntries: (...args: unknown[]) => mocks.listScheduleEntries(...args) }));
vi.mock("./scheduleReminders", () => ({
  syncScheduleReminders: (...args: unknown[]) => mocks.syncScheduleReminders(...args),
}));
vi.mock("../logging/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { REMINDER_SYNC_WEEKS, resyncScheduleReminders } from "./reminderSync";
import { startOfWeek, weekQueryRange } from "../features/schedule/scheduleUtils";

const CLIENT = { request: vi.fn() };

describe("resyncScheduleReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T12:00:00"));
    mocks.config = { ok: true, baseUrl: "https://tenant.example.com" };
    mocks.createApiClient.mockReturnValue(CLIENT);
    mocks.syncScheduleReminders.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches two weeks of the user's schedule and reschedules reminders", async () => {
    const entries = [{ entry_id: "e-1" }];
    mocks.listScheduleEntries.mockResolvedValue({ ok: true, data: { data: entries } });
    const refreshSession = vi.fn(async () => "new");

    await resyncScheduleReminders({ accessToken: "tok", tenantId: "t-1", userId: "u-1", refreshSession });

    const opts = mocks.createApiClient.mock.calls[0][0];
    expect(opts.baseUrl).toBe("https://tenant.example.com");
    expect(opts.getTenantId()).toBe("t-1");
    expect(opts.getUserAgentTag()).toBe("mobile/schedule-reminders");
    expect(opts.onAuthError).toBe(refreshSession);

    const weekStart = startOfWeek(new Date());
    const { startIso } = weekQueryRange(weekStart);
    const { endIso } = weekQueryRange(new Date(weekStart.getTime() + (REMINDER_SYNC_WEEKS - 1) * 7 * 86_400_000));
    expect(mocks.listScheduleEntries).toHaveBeenCalledWith(CLIENT, {
      apiKey: "tok",
      startDate: startIso,
      endDate: endIso,
      userId: "u-1",
    });
    expect(mocks.syncScheduleReminders).toHaveBeenCalledWith(entries, { startIso, endIso });
  });

  it("omits tenant and user when they are unknown", async () => {
    mocks.listScheduleEntries.mockResolvedValue({ ok: true, data: { data: [] } });
    await resyncScheduleReminders({ accessToken: "tok", tenantId: null, userId: undefined });
    expect(mocks.createApiClient.mock.calls[0][0].getTenantId()).toBeUndefined();
    expect(mocks.listScheduleEntries.mock.calls[0][1].userId).toBeUndefined();
  });

  it("does nothing when the app is not configured", async () => {
    mocks.config = { ok: false, error: "missing" };
    await resyncScheduleReminders({ accessToken: "tok", tenantId: "t", userId: "u" });
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it("leaves existing reminders alone when the fetch fails", async () => {
    mocks.listScheduleEntries.mockResolvedValue({ ok: false, error: { kind: "network", message: "x" } });
    await resyncScheduleReminders({ accessToken: "tok", tenantId: "t", userId: "u" });
    expect(mocks.syncScheduleReminders).not.toHaveBeenCalled();
  });

  it("swallows and logs errors", async () => {
    mocks.listScheduleEntries.mockRejectedValue(new Error("boom"));
    await expect(resyncScheduleReminders({ accessToken: "tok", tenantId: "t", userId: "u" })).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith("[Notifications] Schedule reminder sync failed", expect.anything());
  });
});
