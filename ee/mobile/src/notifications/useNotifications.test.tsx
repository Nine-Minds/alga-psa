import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

type Listener = (payload: unknown) => void;

const mocks = vi.hoisted(() => ({
  enabled: true,
  session: null as null | { accessToken: string; tenantId?: string; user?: { id: string } },
  refreshSession: vi.fn(),
  navigate: vi.fn(),
  showToast: vi.fn(),
  handler: null as null | { handleNotification: (n: unknown) => Promise<unknown> },
  receivedListeners: [] as Listener[],
  responseListeners: [] as Listener[],
  removeReceived: vi.fn(),
  removeResponse: vi.fn(),
  lastResponse: null as unknown,
  resumeCallbacks: [] as Array<() => void>,
  requestPushPermission: vi.fn(),
  getExpoPushToken: vi.fn(),
  getStableDeviceId: vi.fn(),
  config: { ok: true, baseUrl: "https://tenant.example.com" } as { ok: boolean; baseUrl?: string },
  readPushRegistration: vi.fn(),
  writePushRegistration: vi.fn(),
  createApiClient: vi.fn(),
  registerPushToken: vi.fn(),
  getPushPriorityThreshold: vi.fn(),
  resyncScheduleReminders: vi.fn(),
  getInteraction: vi.fn(),
  openURL: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
  AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
  setNotificationHandler: (h: typeof mocks.handler) => {
    mocks.handler = h;
  },
  setNotificationChannelAsync: vi.fn(),
  addNotificationReceivedListener: (fn: Listener) => {
    mocks.receivedListeners.push(fn);
    return { remove: mocks.removeReceived };
  },
  addNotificationResponseReceivedListener: (fn: Listener) => {
    mocks.responseListeners.push(fn);
    return { remove: mocks.removeResponse };
  },
  getLastNotificationResponseAsync: async () => mocks.lastResponse,
}));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "1.6.5" }));
vi.mock("expo-linking", () => ({ openURL: (url: string) => mocks.openURL(url) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mocks.navigate }) }));
vi.mock("../features/phase2", () => ({
  phase2Features: {
    get notifications() {
      return mocks.enabled;
    },
  },
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ session: mocks.session, refreshSession: mocks.refreshSession }),
}));
vi.mock("../hooks/useAppResume", () => ({
  useAppResume: (cb: () => void) => {
    mocks.resumeCallbacks.push(cb);
  },
}));
vi.mock("../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("./pushTokenService", () => ({
  requestPushPermission: () => mocks.requestPushPermission(),
  getExpoPushToken: () => mocks.getExpoPushToken(),
}));
vi.mock("../api/pushToken", () => ({ registerPushToken: (...args: unknown[]) => mocks.registerPushToken(...args) }));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/interactions", () => ({ getInteraction: (...args: unknown[]) => mocks.getInteraction(...args) }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../device/clientMetadata", () => ({ getStableDeviceId: () => mocks.getStableDeviceId() }));
vi.mock("./pushRegistration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pushRegistration")>()),
  readPushRegistration: () => mocks.readPushRegistration(),
  writePushRegistration: (...args: unknown[]) => mocks.writePushRegistration(...args),
}));
vi.mock("../settings/notificationPreferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/notificationPreferences")>()),
  getPushPriorityThreshold: () => mocks.getPushPriorityThreshold(),
}));
vi.mock("./reminderSync", () => ({ resyncScheduleReminders: (...args: unknown[]) => mocks.resyncScheduleReminders(...args) }));
vi.mock("../logging/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error, debug: vi.fn() } }));

import { REMINDER_RESYNC_INTERVAL_MS, shouldResyncReminders, useNotifications } from "./useNotifications";

const SESSION = { accessToken: "tok", tenantId: "t-1", user: { id: "u-1" } };
const CLIENT = { request: vi.fn() };

function Harness() {
  useNotifications();
  return null;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Harness />);
  });
  await flush();
  return renderer;
}

function notification(data: Record<string, unknown>, title = "Ticket assigned", body = "T-100") {
  return { request: { content: { title, body, data } } };
}

async function emitReceived(n: unknown) {
  await act(async () => {
    mocks.receivedListeners[mocks.receivedListeners.length - 1](n);
  });
}

async function emitTap(data: Record<string, unknown>) {
  await act(async () => {
    mocks.responseListeners[mocks.responseListeners.length - 1]({ notification: notification(data) });
  });
  await flush();
}

describe("notification foreground handler", () => {
  it("interrupts only for high priority pushes", async () => {
    const high = (await mocks.handler!.handleNotification(notification({ priority: "high" }))) as Record<string, boolean>;
    expect(high.shouldShowBanner).toBe(true);
    expect(high.shouldPlaySound).toBe(true);

    const local = (await mocks.handler!.handleNotification(notification({}))) as Record<string, boolean>;
    expect(local.shouldShowBanner).toBe(false);
    expect(local.shouldShowList).toBe(true);

    const low = (await mocks.handler!.handleNotification(notification({ priority: "low" }))) as Record<string, boolean>;
    expect(low.shouldShowList).toBe(false);
  });
});

describe("shouldResyncReminders", () => {
  it("resyncs at most once per interval", () => {
    expect(shouldResyncReminders(1000, 1000 + REMINDER_RESYNC_INTERVAL_MS - 1)).toBe(false);
    expect(shouldResyncReminders(1000, 1000 + REMINDER_RESYNC_INTERVAL_MS)).toBe(true);
  });
});

describe("useNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.session = SESSION;
    mocks.receivedListeners = [];
    mocks.responseListeners = [];
    mocks.resumeCallbacks = [];
    mocks.lastResponse = null;
    mocks.config = { ok: true, baseUrl: "https://tenant.example.com" };
    mocks.requestPushPermission.mockResolvedValue(true);
    mocks.getExpoPushToken.mockResolvedValue("ExponentPushToken[1]");
    mocks.getStableDeviceId.mockResolvedValue("device-1");
    mocks.readPushRegistration.mockResolvedValue(null);
    mocks.writePushRegistration.mockResolvedValue(undefined);
    mocks.createApiClient.mockReturnValue(CLIENT);
    mocks.registerPushToken.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    mocks.getPushPriorityThreshold.mockResolvedValue("normal");
    mocks.resyncScheduleReminders.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("push token registration", () => {
    it("registers the device token for the signed-in account", async () => {
      await mount();
      const clientOpts = mocks.createApiClient.mock.calls[0][0];
      expect(clientOpts.baseUrl).toBe("https://tenant.example.com");
      expect(clientOpts.getTenantId()).toBe("t-1");
      expect(clientOpts.getUserAgentTag()).toBe("mobile/push");
      expect(clientOpts.onAuthError).toBe(mocks.refreshSession);
      expect(mocks.registerPushToken).toHaveBeenCalledWith(CLIENT, {
        apiKey: "tok",
        expoPushToken: "ExponentPushToken[1]",
        deviceId: "device-1",
        platform: "web",
        appVersion: "1.6.5",
        priorityThreshold: "normal",
      });
      expect(mocks.writePushRegistration).toHaveBeenCalledWith({
        token: "ExponentPushToken[1]",
        baseUrl: "https://tenant.example.com",
        tenantId: "t-1",
        userId: "u-1",
      });
    });

    it("does nothing while signed out", async () => {
      mocks.session = null;
      await mount();
      expect(mocks.requestPushPermission).not.toHaveBeenCalled();
      expect(mocks.resyncScheduleReminders).not.toHaveBeenCalled();
    });

    it("does nothing when the notifications feature is off", async () => {
      mocks.enabled = false;
      await mount();
      expect(mocks.requestPushPermission).not.toHaveBeenCalled();
      expect(mocks.receivedListeners).toHaveLength(0);
    });

    it("stops when permission is denied", async () => {
      mocks.requestPushPermission.mockResolvedValue(false);
      await mount();
      expect(mocks.getExpoPushToken).not.toHaveBeenCalled();
      expect(mocks.registerPushToken).not.toHaveBeenCalled();
    });

    it("stops without a token or device id", async () => {
      mocks.getExpoPushToken.mockResolvedValue(null);
      await mount();
      expect(mocks.registerPushToken).not.toHaveBeenCalled();
    });

    it("stops when the app is not configured", async () => {
      mocks.config = { ok: false };
      await mount();
      expect(mocks.registerPushToken).not.toHaveBeenCalled();
    });

    it("skips the round trip when this token is already registered for the account", async () => {
      mocks.readPushRegistration.mockResolvedValue({
        token: "ExponentPushToken[1]",
        baseUrl: "https://tenant.example.com",
        tenantId: "t-1",
        userId: "u-1",
        registeredAt: Date.now(),
      });
      await mount();
      expect(mocks.registerPushToken).not.toHaveBeenCalled();
    });

    it("re-registers when the stored registration is for another account", async () => {
      mocks.readPushRegistration.mockResolvedValue({
        token: "ExponentPushToken[1]",
        baseUrl: "https://tenant.example.com",
        tenantId: "t-1",
        userId: "someone-else",
        registeredAt: Date.now(),
      });
      await mount();
      expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
    });

    it("does not record a registration the server rejected", async () => {
      mocks.registerPushToken.mockResolvedValue({ ok: false, status: 500, error: { kind: "server", status: 500, message: "x" } });
      await mount();
      expect(mocks.writePushRegistration).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledWith("[Notifications] Failed to register push token", expect.anything());
    });

    it("logs and recovers from a registration error so a later resume can retry", async () => {
      mocks.requestPushPermission.mockRejectedValueOnce(new Error("native"));
      await mount();
      expect(mocks.error).toHaveBeenCalledWith("[Notifications] Token registration error", expect.anything());

      await act(async () => {
        mocks.resumeCallbacks[mocks.resumeCallbacks.length - 1]();
      });
      await flush();
      expect(mocks.registerPushToken).toHaveBeenCalledTimes(1);
    });
  });

  describe("schedule reminder sync", () => {
    it("syncs reminders on mount with the session", async () => {
      await mount();
      expect(mocks.resyncScheduleReminders).toHaveBeenCalledWith({
        accessToken: "tok",
        tenantId: "t-1",
        userId: "u-1",
        refreshSession: mocks.refreshSession,
      });
    });

    it("resyncs on resume only after the interval has passed", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-18T09:00:00Z"));
      await mount();
      expect(mocks.resyncScheduleReminders).toHaveBeenCalledTimes(1);

      const resume = async () => {
        await act(async () => {
          mocks.resumeCallbacks[mocks.resumeCallbacks.length - 1]();
        });
        await flush();
      };

      vi.setSystemTime(new Date("2026-11-18T09:30:00Z"));
      await resume();
      expect(mocks.resyncScheduleReminders).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
      await resume();
      expect(mocks.resyncScheduleReminders).toHaveBeenCalledTimes(2);
    });
  });

  describe("foreground notifications", () => {
    it("toasts a normal push and opens its ticket", async () => {
      await mount();
      await emitReceived(notification({ ticketId: "tk-1" }));
      expect(mocks.showToast).toHaveBeenCalledWith({ message: "Ticket assigned", tone: "info", durationMs: 4000 });
      expect(mocks.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "tk-1" });
    });

    it("falls back to the body or a generic message", async () => {
      await mount();
      await emitReceived(notification({}, "", "Body only"));
      await emitReceived(notification({}, "", ""));
      expect(mocks.showToast.mock.calls.map(([arg]) => arg.message)).toEqual(["Body only", "New notification"]);
      expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it("does not toast high or low priority pushes", async () => {
      await mount();
      await emitReceived(notification({ priority: "high", taskId: "task-1" }));
      await emitReceived(notification({ priority: "low" }));
      expect(mocks.showToast).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith("ProjectTaskDetail", { taskId: "task-1" });
    });

    it("removes listeners on unmount", async () => {
      const renderer = await mount();
      act(() => renderer.unmount());
      expect(mocks.removeReceived).toHaveBeenCalled();
      expect(mocks.removeResponse).toHaveBeenCalled();
    });
  });

  describe("notification taps", () => {
    it("routes a tapped ticket push", async () => {
      await mount();
      await emitTap({ ticketId: "tk-9" });
      expect(mocks.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "tk-9" });
    });

    it("routes a cold-launch notification", async () => {
      mocks.lastResponse = { notification: notification({ assetId: "as-1" }) };
      await mount();
      expect(mocks.navigate).toHaveBeenCalledWith("AssetDetail", { assetId: "as-1" });
    });

    it("opens the ticket behind an interaction reminder", async () => {
      mocks.getInteraction.mockResolvedValue({ ok: true, data: { data: { ticket_id: "tk-from-interaction" } } });
      await mount();
      await emitTap({ kind: "schedule-reminder", workItemType: "interaction", workItemId: "int-1" });
      expect(mocks.getInteraction).toHaveBeenCalledWith(CLIENT, { apiKey: "tok", interactionId: "int-1" });
      expect(mocks.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "tk-from-interaction" });
    });

    it("opens the schedule when the interaction has no ticket", async () => {
      mocks.getInteraction.mockResolvedValue({ ok: false, error: { kind: "network", message: "x" } });
      await mount();
      await emitTap({ kind: "schedule-reminder", workItemType: "interaction", workItemId: "int-1" });
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.openURL).toHaveBeenCalledWith("alga://schedule");
    });

    it("does not look up interactions when the app is not configured", async () => {
      await mount();
      mocks.config = { ok: false };
      await emitTap({ kind: "schedule-reminder", workItemType: "interaction", workItemId: "int-1" });
      expect(mocks.getInteraction).not.toHaveBeenCalled();
      expect(mocks.openURL).toHaveBeenCalledWith("alga://schedule");
    });
  });
});
