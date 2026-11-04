import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StopwatchSession } from "../../api/stopwatch";
import { AuthContext, type AuthContextValue, type MobileSession } from "../../auth/AuthContext";

const {
  getActiveStopwatchMock,
  startStopwatchMock,
  pauseStopwatchMock,
  resumeStopwatchMock,
  discardStopwatchMock,
  logStopwatchMock,
  getLastUsedServiceMock,
  setLastUsedServiceMock,
  syncTimerNotificationsMock,
  showToastMock,
  translateMock,
  stopModalProps,
} = vi.hoisted(() => ({
  getActiveStopwatchMock: vi.fn(),
  startStopwatchMock: vi.fn(),
  pauseStopwatchMock: vi.fn(),
  resumeStopwatchMock: vi.fn(),
  discardStopwatchMock: vi.fn(),
  logStopwatchMock: vi.fn(),
  getLastUsedServiceMock: vi.fn(),
  setLastUsedServiceMock: vi.fn(),
  syncTimerNotificationsMock: vi.fn(),
  showToastMock: vi.fn(),
  translateMock: vi.fn((key: string) => key),
  stopModalProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translateMock }),
}));

vi.mock("../../api", () => ({
  createApiClient: () => ({ request: vi.fn() }),
}));

vi.mock("../../api/stopwatch", () => ({
  getActiveStopwatch: (...args: unknown[]) => getActiveStopwatchMock(...args),
  startStopwatch: (...args: unknown[]) => startStopwatchMock(...args),
  pauseStopwatch: (...args: unknown[]) => pauseStopwatchMock(...args),
  resumeStopwatch: (...args: unknown[]) => resumeStopwatchMock(...args),
  discardStopwatch: (...args: unknown[]) => discardStopwatchMock(...args),
  logStopwatch: (...args: unknown[]) => logStopwatchMock(...args),
  getOpenSessionFromConflict: (body: any) => body?.error?.details?.open_session ?? null,
}));

vi.mock("../../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("../../notifications/timerNotifications", () => ({
  syncTimerNotifications: (...args: unknown[]) => syncTimerNotificationsMock(...args),
}));

vi.mock("../../device/clientMetadata", () => ({
  getClientMetadataHeaders: async () => ({ "x-device-id": "device-1" }),
}));

vi.mock("./lastUsedService", () => ({
  getLastUsedService: (...args: unknown[]) => getLastUsedServiceMock(...args),
  setLastUsedService: (...args: unknown[]) => setLastUsedServiceMock(...args),
}));

vi.mock("./components/StopTimerModal", () => ({
  StopTimerModal: (props: Record<string, unknown>) => {
    stopModalProps.push(props);
    return null;
  },
}));

import { activeMs } from "./stopwatchMath";
import { TimerProvider, useTimer, type TimerContextValue } from "./TimerContext";

const NOW = new Date(2026, 6, 2, 12, 0, 0);

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function makeSession(over: Partial<StopwatchSession> = {}): StopwatchSession {
  return {
    session_id: "session-1",
    user_id: "user-1",
    work_item_id: "ticket-1",
    work_item_type: "ticket",
    service_id: "svc-1",
    notes: "",
    status: "running",
    time_entry_id: null,
    closed_at: null,
    created_at: isoMinutesAgo(30),
    updated_at: isoMinutesAgo(30),
    segments: [{ segment_id: "seg-1", started_at: isoMinutesAgo(30), ended_at: null }],
    active_ms: 30 * 60_000,
    server_now: NOW.toISOString(),
    ticket_number: "T-1",
    work_item_title: "Printer down",
    project_name: null,
    client_name: null,
    service_name: "Remote Support",
    ...over,
  };
}

function pausedSession(over: Partial<StopwatchSession> = {}): StopwatchSession {
  return makeSession({
    status: "paused",
    segments: [{ segment_id: "seg-1", started_at: isoMinutesAgo(30), ended_at: isoMinutesAgo(10) }],
    active_ms: 20 * 60_000,
    ...over,
  });
}

function ok<T>(data: T) {
  return { ok: true as const, status: 200, data: { data } };
}

const authSession: MobileSession = {
  accessToken: "token-1",
  refreshToken: "refresh-1",
  expiresAtMs: NOW.getTime() + 3_600_000,
  tenantId: "tenant-1",
  user: { id: "user-1" },
};

function authValue(session: MobileSession | null): AuthContextValue {
  return {
    session,
    setSession: vi.fn(),
    refreshSession: vi.fn(async () => null),
    logout: vi.fn(async () => undefined),
    baseUrl: "http://localhost:3000",
    setHost: vi.fn(async () => undefined),
    clearHost: vi.fn(async () => undefined),
  };
}

let ctx: TimerContextValue | null = null;

function Probe() {
  ctx = useTimer();
  return null;
}

function providerTree(session: MobileSession | null) {
  return (
    <AuthContext.Provider value={authValue(session)}>
      <TimerProvider>
        <Probe />
      </TimerProvider>
    </AuthContext.Provider>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderProvider(session: MobileSession | null = authSession): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(providerTree(session));
  });
  await flush();
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function latestModalProps(): Record<string, unknown> {
  const props = stopModalProps[stopModalProps.length - 1];
  if (!props) throw new Error("StopTimerModal was not rendered");
  return props;
}

describe("TimerProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    stopModalProps.length = 0;
    ctx = null;
    getActiveStopwatchMock.mockResolvedValue(ok(null));
    getLastUsedServiceMock.mockResolvedValue(null);
    pauseStopwatchMock.mockResolvedValue(ok(pausedSession()));
    syncTimerNotificationsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the active session on mount and computes the server clock offset", async () => {
    // The server clock is 10 minutes ahead of the device.
    getActiveStopwatchMock.mockResolvedValue(
      ok(makeSession({ server_now: new Date(NOW.getTime() + 10 * 60_000).toISOString() })),
    );

    await renderProvider();

    expect(ctx?.status).toBe("running");
    expect(ctx?.session?.session_id).toBe("session-1");
    expect(ctx?.offsetMs).toBe(10 * 60_000);
    expect(syncTimerNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        offsetMs: 10 * 60_000,
        // virtual start = server now - active time
        startTimeMs: NOW.getTime() + 10 * 60_000 - 30 * 60_000,
      }),
    );
  });

  it("settles on idle instead of loading forever when the active-session load fails", async () => {
    getActiveStopwatchMock.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });

    await renderProvider();

    expect(ctx?.status).toBe("idle");
  });

  it("starts a timer, remembers the service, and toasts", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(null));
    startStopwatchMock.mockResolvedValue(ok(makeSession()));
    await renderProvider();

    let started = false;
    await act(async () => {
      started = await ctx!.start({
        workItemId: "ticket-1",
        workItemType: "ticket",
        service: { service_id: "svc-1", service_name: "Remote Support" },
      });
    });

    expect(started).toBe(true);
    expect(ctx?.status).toBe("running");
    expect(startStopwatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        work_item_id: "ticket-1",
        work_item_type: "ticket",
        service_id: "svc-1",
        auditHeaders: { "x-device-id": "device-1" },
      }),
    );
    expect(setLastUsedServiceMock).toHaveBeenCalledWith("user-1", {
      service_id: "svc-1",
      service_name: "Remote Support",
    });
    expect(ctx?.defaultService).toEqual({ service_id: "svc-1", service_name: "Remote Support" });
    expect(translateMock).toHaveBeenCalledWith("timer.startedToast", { service: "Remote Support" });
    expect(showToastMock).toHaveBeenCalledWith({ message: "timer.startedToast", tone: "success" });
  });

  it("shows the blocking open session when a start conflicts (409 open_session)", async () => {
    getActiveStopwatchMock.mockResolvedValueOnce(ok(null));
    startStopwatchMock.mockResolvedValue({
      ok: false,
      error: {
        kind: "http",
        message: "Conflict",
        status: 409,
        body: { error: { details: { open_session: pausedSession({ session_id: "other-device", work_item_id: "ticket-9" }) } } },
      },
    });
    await renderProvider();

    let started = true;
    await act(async () => {
      started = await ctx!.start({
        workItemId: "ticket-1",
        workItemType: "ticket",
        service: { service_id: "svc-1", service_name: "Remote Support" },
      });
    });

    expect(started).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith({ message: "timer.errors.alreadyOpen", tone: "error" });
    expect(ctx?.status).toBe("paused");
    expect(ctx?.session?.session_id).toBe("other-device");
  });

  it("falls back to refetching when the 409 carries no open session", async () => {
    getActiveStopwatchMock
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(makeSession({ session_id: "other-device" })));
    startStopwatchMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", message: "Conflict", status: 409, body: {} },
    });
    await renderProvider();

    await act(async () => {
      await ctx!.start({
        workItemId: "ticket-1",
        workItemType: "ticket",
        service: { service_id: "svc-1", service_name: "Remote Support" },
      });
    });

    expect(getActiveStopwatchMock).toHaveBeenCalledTimes(2);
    expect(ctx?.session?.session_id).toBe("other-device");
  });

  it("loads a paused session without scheduling reminders, and elapsed does not advance", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(pausedSession()));

    await renderProvider();

    expect(ctx?.status).toBe("paused");
    expect(syncTimerNotificationsMock).toHaveBeenLastCalledWith(null);
    const first = activeMs(ctx!.session!.segments, Date.now() + ctx!.offsetMs);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(activeMs(ctx!.session!.segments, Date.now() + ctx!.offsetMs)).toBe(first);
    expect(first).toBe(20 * 60_000);
  });

  it("pauses a running session: cancels reminders and reports paused", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(makeSession()));
    pauseStopwatchMock.mockResolvedValue(ok(pausedSession()));
    await renderProvider();
    expect(syncTimerNotificationsMock).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "session-1" }));

    let done = false;
    await act(async () => {
      done = await ctx!.pause();
    });

    expect(done).toBe(true);
    expect(pauseStopwatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sessionId: "session-1" }));
    expect(ctx?.status).toBe("paused");
    expect(syncTimerNotificationsMock).toHaveBeenLastCalledWith(null);
  });

  it("resumes a paused session and reschedules reminders", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(pausedSession()));
    resumeStopwatchMock.mockResolvedValue(
      ok(makeSession({ segments: [
        { segment_id: "seg-1", started_at: isoMinutesAgo(30), ended_at: isoMinutesAgo(10) },
        { segment_id: "seg-2", started_at: NOW.toISOString(), ended_at: null },
      ], active_ms: 20 * 60_000 })),
    );
    await renderProvider();

    await act(async () => {
      await ctx!.resume();
    });

    expect(ctx?.status).toBe("running");
    // 20 active minutes so far: the 60 minute reminder fires in 40 minutes.
    expect(syncTimerNotificationsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ startTimeMs: NOW.getTime() - 20 * 60_000, offsetMs: 0 }),
    );
  });

  it("refreshes server truth when a pause fails", async () => {
    getActiveStopwatchMock
      .mockResolvedValueOnce(ok(makeSession()))
      .mockResolvedValueOnce(ok(pausedSession()));
    pauseStopwatchMock.mockResolvedValue({ ok: false, error: { kind: "http", message: "x", status: 409 } });
    await renderProvider();

    let done = true;
    await act(async () => {
      done = await ctx!.pause();
    });

    expect(done).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith({ message: "timer.errors.pause", tone: "error" });
    expect(ctx?.status).toBe("paused");
  });

  it("discards the session and clears state", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(pausedSession()));
    discardStopwatchMock.mockResolvedValue({ ok: true, status: 204, data: "" });
    await renderProvider();

    await act(async () => {
      await ctx!.discard();
    });

    expect(discardStopwatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sessionId: "session-1" }));
    expect(ctx?.status).toBe("idle");
    expect(syncTimerNotificationsMock).toHaveBeenLastCalledWith(null);
  });

  it("shows the permission toast when starting without the time-entry permission", async () => {
    startStopwatchMock.mockResolvedValue({
      ok: false,
      error: { kind: "permission", message: "Forbidden", status: 403 },
    });
    await renderProvider();

    await act(async () => {
      await ctx!.start({
        workItemId: "ticket-1",
        workItemType: "ticket",
        service: { service_id: "svc-1", service_name: "Remote Support" },
      });
    });

    expect(showToastMock).toHaveBeenCalledWith({ message: "timer.errors.permission", tone: "error" });
  });

  it("stops the timer: saves, clears state, records lastStopped, and closes the modal", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(makeSession()));
    logStopwatchMock.mockResolvedValue(
      ok({
        session: makeSession({ status: "logged" }),
        time_entry: { entry_id: "te-1", start_time: isoMinutesAgo(30), end_time: NOW.toISOString() },
      }),
    );
    pauseStopwatchMock.mockResolvedValue(ok(pausedSession()));
    await renderProvider();

    act(() => ctx!.openStopModal());
    expect(latestModalProps().visible).toBe(true);

    const onSubmit = latestModalProps().onSubmit as (overrides: Record<string, unknown>) => void;
    await act(async () => {
      onSubmit({ service_id: "svc-2", is_billable: false, notes: "rebooted" });
    });
    await flush();

    expect(logStopwatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "session-1",
        service_id: "svc-2",
        is_billable: false,
        notes: "rebooted",
        auditHeaders: { "x-device-id": "device-1" },
      }),
    );
    expect(ctx?.status).toBe("idle");
    expect(ctx?.lastStopped).toEqual({ at: NOW.getTime(), workItemId: "ticket-1" });
    expect(syncTimerNotificationsMock).toHaveBeenLastCalledWith(null);
    expect(latestModalProps().visible).toBe(false);
    expect(translateMock).toHaveBeenCalledWith("timer.stoppedToast", { duration: "30m" });
    expect(showToastMock).toHaveBeenCalledWith({ message: "timer.stoppedToast", tone: "success" });
  });

  it("keeps the modal open and shows the server message on a stop validation error", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(makeSession()));
    logStopwatchMock.mockResolvedValue({
      ok: false,
      error: {
        kind: "validation",
        message: "Bad request",
        status: 400,
        body: { error: { message: "End time overlaps another entry" } },
      },
    });
    await renderProvider();

    act(() => ctx!.openStopModal());
    const onSubmit = latestModalProps().onSubmit as (overrides: Record<string, unknown>) => void;
    await act(async () => {
      onSubmit({ service_id: "svc-1", is_billable: true });
    });
    await flush();

    expect(latestModalProps().visible).toBe(true);
    expect(latestModalProps().error).toBe("End time overlaps another entry");
    // Stop paused the clock first; the time stays intact on the paused session.
    expect(ctx?.status).toBe("paused");
    // No refresh: the session is still ours, only the overrides were rejected.
    expect(getActiveStopwatchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the timer paused with an error when the time sheet is locked (409)", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(makeSession()));
    logStopwatchMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", message: "Locked", status: 409, body: { error: { code: "CONFLICT" } } },
    });
    await renderProvider();

    act(() => ctx!.openStopModal());
    const onSubmit = latestModalProps().onSubmit as (overrides: Record<string, unknown>) => void;
    await act(async () => {
      onSubmit({ service_id: "svc-1", is_billable: true });
    });
    await flush();

    expect(pauseStopwatchMock).toHaveBeenCalledTimes(1);
    expect(latestModalProps().visible).toBe(true);
    expect(latestModalProps().error).toBe("timer.errors.sheetLocked");
    expect(ctx?.status).toBe("paused");
    expect(ctx?.session?.session_id).toBe("session-1");
  });

  it("logs a paused session without pausing again", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(pausedSession()));
    logStopwatchMock.mockResolvedValue(
      ok({
        session: pausedSession({ status: "logged" }),
        time_entry: { entry_id: "te-1", start_time: isoMinutesAgo(30), end_time: isoMinutesAgo(10) },
      }),
    );
    await renderProvider();

    act(() => ctx!.openStopModal());
    const onSubmit = latestModalProps().onSubmit as (overrides: Record<string, unknown>) => void;
    await act(async () => {
      onSubmit({ service_id: "svc-1", is_billable: true });
    });
    await flush();

    expect(pauseStopwatchMock).not.toHaveBeenCalled();
    expect(ctx?.status).toBe("idle");
  });

  it("refreshes on an unexpected stop failure and closes the modal when the session is gone", async () => {
    getActiveStopwatchMock
      .mockResolvedValueOnce(ok(makeSession()))
      .mockResolvedValueOnce(ok(null));
    logStopwatchMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", message: "Gone", status: 410 },
    });
    await renderProvider();

    act(() => ctx!.openStopModal());
    const onSubmit = latestModalProps().onSubmit as (overrides: Record<string, unknown>) => void;
    await act(async () => {
      onSubmit({ service_id: "svc-1", is_billable: true });
    });
    await flush();

    expect(getActiveStopwatchMock).toHaveBeenCalledTimes(2);
    expect(ctx?.status).toBe("idle");
    // The session vanished underneath the open modal, so it closes itself.
    expect(latestModalProps().visible).toBe(false);
  });

  it("chains a stop into a start when the modal was opened with thenStart", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(makeSession()));
    logStopwatchMock.mockResolvedValue(
      ok({
        session: makeSession({ status: "logged" }),
        time_entry: { entry_id: "te-1", start_time: isoMinutesAgo(30), end_time: NOW.toISOString() },
      }),
    );
    pauseStopwatchMock.mockResolvedValue(ok(pausedSession()));
    startStopwatchMock.mockResolvedValue(
      ok(makeSession({ session_id: "session-2", work_item_id: "ticket-2" })),
    );
    await renderProvider();

    act(() =>
      ctx!.openStopModal({
        thenStart: {
          workItemId: "ticket-2",
          workItemType: "ticket",
          service: { service_id: "svc-1", service_name: "Remote Support" },
        },
      }),
    );
    expect(latestModalProps().willStartNext).toBe(true);

    const onSubmit = latestModalProps().onSubmit as (overrides: Record<string, unknown>) => void;
    await act(async () => {
      onSubmit({ service_id: "svc-1", is_billable: true });
    });
    await flush();

    expect(startStopwatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ work_item_id: "ticket-2" }),
    );
    expect(ctx?.status).toBe("running");
    expect(ctx?.session?.work_item_id).toBe("ticket-2");
  });

  it("clears the timer and notifications on logout", async () => {
    getActiveStopwatchMock.mockResolvedValue(ok(makeSession()));
    const renderer = await renderProvider();
    expect(ctx?.status).toBe("running");

    act(() => {
      renderer.update(providerTree(null));
    });
    await flush();

    expect(ctx?.status).toBe("idle");
    expect(ctx?.session).toBeNull();
    expect(syncTimerNotificationsMock).toHaveBeenLastCalledWith(null);
  });
});
