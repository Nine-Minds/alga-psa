import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTimeSession } from "../../api/timeTracking";
import { AuthContext, type AuthContextValue, type MobileSession } from "../../auth/AuthContext";

const {
  getActiveTimeSessionMock,
  startTimeTrackingMock,
  stopTimeTrackingMock,
  getLastUsedServiceMock,
  setLastUsedServiceMock,
  syncTimerNotificationsMock,
  showToastMock,
  translateMock,
  stopModalProps,
} = vi.hoisted(() => ({
  getActiveTimeSessionMock: vi.fn(),
  startTimeTrackingMock: vi.fn(),
  stopTimeTrackingMock: vi.fn(),
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

vi.mock("../../api/timeTracking", () => ({
  getActiveTimeSession: (...args: unknown[]) => getActiveTimeSessionMock(...args),
  startTimeTracking: (...args: unknown[]) => startTimeTrackingMock(...args),
  stopTimeTracking: (...args: unknown[]) => stopTimeTrackingMock(...args),
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

import { TimerProvider, useTimer, type TimerContextValue } from "./TimerContext";

const NOW = new Date(2026, 6, 2, 12, 0, 0);

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function makeSession(over: Partial<ActiveTimeSession> = {}): ActiveTimeSession {
  return {
    session_id: "session-1",
    work_item_id: "ticket-1",
    work_item_type: "ticket",
    start_time: isoMinutesAgo(30),
    notes: null,
    service_id: "svc-1",
    user_id: "user-1",
    elapsed_minutes: 30,
    work_item_title: "Printer down",
    service_name: "Remote Support",
    ...over,
  };
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
    getActiveTimeSessionMock.mockResolvedValue(ok(null));
    getLastUsedServiceMock.mockResolvedValue(null);
    syncTimerNotificationsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the active session on mount and computes the server clock offset", async () => {
    // Server thinks 20 minutes elapsed on a timer that started 10 local minutes
    // ago: the device clock is 10 minutes behind the server.
    getActiveTimeSessionMock.mockResolvedValue(
      ok(makeSession({ start_time: isoMinutesAgo(10), elapsed_minutes: 20 })),
    );

    await renderProvider();

    expect(ctx?.status).toBe("running");
    expect(ctx?.session?.session_id).toBe("session-1");
    expect(ctx?.offsetMs).toBe(10 * 60_000);
    expect(syncTimerNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", offsetMs: 10 * 60_000 }),
    );
  });

  it("settles on idle instead of loading forever when the active-session load fails", async () => {
    getActiveTimeSessionMock.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });

    await renderProvider();

    expect(ctx?.status).toBe("idle");
  });

  it("starts a timer, remembers the service, and toasts", async () => {
    getActiveTimeSessionMock.mockResolvedValue(ok(null));
    startTimeTrackingMock.mockResolvedValue(ok(makeSession()));
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
    expect(startTimeTrackingMock).toHaveBeenCalledWith(
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

  it("refetches the server truth when a start conflicts with another device", async () => {
    getActiveTimeSessionMock
      .mockResolvedValueOnce(ok(null))
      .mockResolvedValueOnce(ok(makeSession({ session_id: "other-device", work_item_id: "ticket-9" })));
    startTimeTrackingMock.mockResolvedValue({
      ok: false,
      error: { kind: "http", message: "Conflict", status: 409 },
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
    expect(showToastMock).toHaveBeenCalledWith({ message: "timer.errors.start", tone: "error" });
    expect(getActiveTimeSessionMock).toHaveBeenCalledTimes(2);
    expect(ctx?.status).toBe("running");
    expect(ctx?.session?.session_id).toBe("other-device");
  });

  it("shows the permission toast when starting without the time-entry permission", async () => {
    startTimeTrackingMock.mockResolvedValue({
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
    getActiveTimeSessionMock.mockResolvedValue(ok(makeSession()));
    stopTimeTrackingMock.mockResolvedValue(
      ok({ entry_id: "te-1", start_time: isoMinutesAgo(30), end_time: NOW.toISOString() }),
    );
    await renderProvider();

    act(() => ctx!.openStopModal());
    expect(latestModalProps().visible).toBe(true);

    const onSubmit = latestModalProps().onSubmit as (overrides: Record<string, unknown>) => void;
    await act(async () => {
      onSubmit({ service_id: "svc-2", is_billable: false, notes: "rebooted" });
    });
    await flush();

    expect(stopTimeTrackingMock).toHaveBeenCalledWith(
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
    getActiveTimeSessionMock.mockResolvedValue(ok(makeSession()));
    stopTimeTrackingMock.mockResolvedValue({
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
    expect(ctx?.status).toBe("running");
    // No refresh: the session is still ours, only the overrides were rejected.
    expect(getActiveTimeSessionMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes on an unexpected stop failure and closes the modal when the session is gone", async () => {
    getActiveTimeSessionMock
      .mockResolvedValueOnce(ok(makeSession()))
      .mockResolvedValueOnce(ok(null));
    stopTimeTrackingMock.mockResolvedValue({
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

    expect(getActiveTimeSessionMock).toHaveBeenCalledTimes(2);
    expect(ctx?.status).toBe("idle");
    // The session vanished underneath the open modal, so it closes itself.
    expect(latestModalProps().visible).toBe(false);
  });

  it("chains a stop into a start when the modal was opened with thenStart", async () => {
    getActiveTimeSessionMock.mockResolvedValue(ok(makeSession()));
    stopTimeTrackingMock.mockResolvedValue(
      ok({ entry_id: "te-1", start_time: isoMinutesAgo(30), end_time: NOW.toISOString() }),
    );
    startTimeTrackingMock.mockResolvedValue(
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

    expect(startTimeTrackingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ work_item_id: "ticket-2" }),
    );
    expect(ctx?.status).toBe("running");
    expect(ctx?.session?.work_item_id).toBe("ticket-2");
  });

  it("clears the timer and notifications on logout", async () => {
    getActiveTimeSessionMock.mockResolvedValue(ok(makeSession()));
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
