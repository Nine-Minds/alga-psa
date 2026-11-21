import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue, MobileSession } from "../auth/AuthContext";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  auth: null as AuthContextValue | null,
  navRef: { current: null },
  storedHost: null as string | null,
  baseUrl: "https://tenant.example.com" as string | null,
  storedSession: null as unknown,
  biometricEnabled: false,
  offline: false,
  heldDeepLink: false,
  pendingDeepLink: false,
  resumeCallbacks: [] as Array<() => void>,
  hydrateAppConfig: vi.fn(),
  setActiveBaseUrl: vi.fn(),
  saveStoredHost: vi.fn(),
  clearStoredHost: vi.fn(),
  setDeepLinkSignedIn: vi.fn(),
  getStoredSession: vi.fn(),
  storeSession: vi.fn(),
  clearStoredSession: vi.fn(),
  createApiClient: vi.fn(),
  refreshSessionApi: vi.fn(),
  revokeSession: vi.fn(),
  unregisterPushToken: vi.fn(),
  getStableDeviceId: vi.fn(),
  clearPendingMobileAuth: vi.fn(),
  clearReceivedOtt: vi.fn(),
  clearWebSignInSession: vi.fn(),
  clearPushRegistration: vi.fn(),
  getSecureJson: vi.fn(),
  setSecureJson: vi.fn(),
  clearRecentSearches: vi.fn(),
  readCachedTheme: vi.fn(),
  clearCachedTheme: vi.fn(),
  setSentryUser: vi.fn(),
  registerNavigationContainer: vi.fn(),
  trackEvent: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@react-navigation/native", async () => {
  const ReactLocal = await import("react");
  return {
    NavigationContainer: (props: Record<string, unknown>) =>
      ReactLocal.createElement(
        "NavigationContainer",
        { initialState: props.initialState, onStateChange: props.onStateChange, onReady: props.onReady },
        props.children as React.ReactNode,
      ),
    useNavigationContainerRef: () => mocks.navRef,
  };
});
vi.mock("../navigation/RootNavigator", async () => {
  const ReactLocal = await import("react");
  const { AuthContext } = await import("../auth/AuthContext");
  return {
    RootNavigator: (props: { isSignedIn: boolean }) => {
      mocks.auth = ReactLocal.useContext(AuthContext);
      return ReactLocal.createElement("RootNavigator", props);
    },
  };
});
vi.mock("../navigation/linking", () => ({
  linking: {},
  hasHeldDeepLink: () => mocks.heldDeepLink,
  hasPendingDeepLink: async () => mocks.pendingDeepLink,
  setDeepLinkSignedIn: (v: boolean) => mocks.setDeepLinkSignedIn(v),
}));
vi.mock("../navigation/navStatePersistence", () => ({ stripTransientRouteParams: (s: unknown) => s }));
vi.mock("../config/appConfig", () => ({
  hydrateAppConfig: (h: string | null) => mocks.hydrateAppConfig(h),
  setActiveBaseUrl: (u: string | null) => {
    mocks.setActiveBaseUrl(u);
    mocks.baseUrl = u ?? "https://algapsa.com";
  },
  getAppConfig: () => (mocks.baseUrl ? { ok: true, baseUrl: mocks.baseUrl } : { ok: false, error: "none" }),
}));
vi.mock("../config/hostStore", () => ({
  loadStoredHost: async () => mocks.storedHost,
  saveStoredHost: (u: string) => mocks.saveStoredHost(u),
  clearStoredHost: () => mocks.clearStoredHost(),
}));
vi.mock("../auth/sessionStorage", () => ({
  getStoredSession: () => mocks.getStoredSession(),
  storeSession: (s: unknown) => mocks.storeSession(s),
  clearStoredSession: () => mocks.clearStoredSession(),
}));
vi.mock("../hooks/useAppResume", () => ({
  useAppResume: (cb: () => void) => {
    mocks.resumeCallbacks.push(cb);
  },
}));
vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () => (mocks.offline ? { isConnected: false } : { isConnected: true, isInternetReachable: true }),
}));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/mobileAuth", () => ({
  refreshSession: (...args: unknown[]) => mocks.refreshSessionApi(...args),
  revokeSession: (...args: unknown[]) => mocks.revokeSession(...args),
}));
vi.mock("../api/pushToken", () => ({ unregisterPushToken: (...args: unknown[]) => mocks.unregisterPushToken(...args) }));
vi.mock("../device/clientMetadata", () => ({ getStableDeviceId: () => mocks.getStableDeviceId() }));
vi.mock("../auth/mobileAuth", () => ({
  clearPendingMobileAuth: () => mocks.clearPendingMobileAuth(),
  clearReceivedOtt: () => mocks.clearReceivedOtt(),
}));
vi.mock("../auth/webSession", () => ({ clearWebSignInSession: (u: string) => mocks.clearWebSignInSession(u) }));
vi.mock("../notifications/pushRegistration", () => ({ clearPushRegistration: () => mocks.clearPushRegistration() }));
vi.mock("../auth/biometricGate", () => ({
  BIOMETRIC_GRACE_MS: 15 * 60 * 1000,
  getBiometricGateEnabled: async () => mocks.biometricEnabled,
}));
vi.mock("./BiometricLockView", async () => {
  const ReactLocal = await import("react");
  return { BiometricLockView: (props: { onUnlocked: () => void }) => ReactLocal.createElement("BiometricLockView", props) };
});
vi.mock("../analytics/analytics", () => ({ analytics: { trackEvent: mocks.trackEvent } }));
vi.mock("../errors/sentry", () => ({
  setUser: (u: unknown) => mocks.setSentryUser(u),
  reactNavigationIntegration: { registerNavigationContainer: mocks.registerNavigationContainer },
}));
vi.mock("../storage/secureStorage", () => ({
  getSecureJson: (k: string) => mocks.getSecureJson(k),
  setSecureJson: (k: string, v: unknown) => mocks.setSecureJson(k, v),
}));
vi.mock("../features/search/recentSearches", () => ({
  clearRecentSearches: (...args: unknown[]) => mocks.clearRecentSearches(...args),
}));
vi.mock("../ui/themeCache", () => ({
  readCachedTheme: (...args: unknown[]) => mocks.readCachedTheme(...args),
  clearCachedTheme: (...args: unknown[]) => mocks.clearCachedTheme(...args),
}));
vi.mock("../logging/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error, info: vi.fn(), debug: vi.fn() } }));
vi.mock("../ui/states", async () => {
  const ReactLocal = await import("react");
  return { LoadingState: (props: Record<string, unknown>) => ReactLocal.createElement("LoadingState", props) };
});
vi.mock("../ui/components/OfflineBanner", async () => {
  const ReactLocal = await import("react");
  return { OfflineBanner: () => ReactLocal.createElement("OfflineBanner") };
});
vi.mock("../ui/ThemeContext", async () => {
  const ReactLocal = await import("react");
  return {
    ThemeProvider: (props: { initialTenantTheme: unknown; children: React.ReactNode }) =>
      ReactLocal.createElement("ThemeProvider", { initialTenantTheme: props.initialTenantTheme }, props.children),
  };
});
vi.mock("../i18n/I18nProvider", () => ({ I18nProvider: (p: { children: React.ReactNode }) => p.children }));
vi.mock("../ui/toast/ToastProvider", () => ({ ToastProvider: (p: { children: React.ReactNode }) => p.children }));
vi.mock("../features/timer/TimerContext", () => ({ TimerProvider: (p: { children: React.ReactNode }) => p.children }));
vi.mock("../capabilities/CapabilitiesContext", () => ({
  CapabilitiesProvider: (p: { children: React.ReactNode }) => p.children,
}));

import { AppRoot } from "./AppRoot";
import { MobileAnalyticsEvents } from "../analytics/events";

const NOW = new Date("2026-11-18T10:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;

function makeSession(overrides: Partial<MobileSession> = {}): MobileSession {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAtMs: NOW + HOUR,
    tenantId: "tenant-1",
    user: { id: "user-1", email: "tech@example.com" },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

let renderer: ReactTestRenderer | null = null;

async function mount(): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(<AppRoot />);
  });
  await flush();
  await flush();
  return renderer!;
}

function rootNavigator(r: ReactTestRenderer) {
  return r.root.findAllByType("RootNavigator" as never)[0];
}

async function resume() {
  const latest = mocks.resumeCallbacks.slice(-2);
  await act(async () => {
    latest.forEach((cb) => cb());
  });
  await flush();
}

describe("AppRoot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshSessionApi.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.auth = null;
    mocks.storedHost = null;
    mocks.baseUrl = "https://tenant.example.com";
    mocks.biometricEnabled = false;
    mocks.offline = false;
    mocks.heldDeepLink = false;
    mocks.pendingDeepLink = false;
    mocks.resumeCallbacks = [];
    mocks.getStoredSession.mockImplementation(async () => mocks.storedSession);
    mocks.storedSession = null;
    mocks.storeSession.mockResolvedValue(undefined);
    mocks.clearStoredSession.mockResolvedValue(undefined);
    mocks.createApiClient.mockReturnValue({ request: vi.fn() });
    mocks.getSecureJson.mockResolvedValue(null);
    mocks.setSecureJson.mockResolvedValue(undefined);
    mocks.readCachedTheme.mockResolvedValue(null);
    mocks.clearCachedTheme.mockResolvedValue(undefined);
    mocks.clearRecentSearches.mockResolvedValue(undefined);
    mocks.clearPushRegistration.mockResolvedValue(undefined);
    mocks.clearPendingMobileAuth.mockResolvedValue(undefined);
    mocks.clearReceivedOtt.mockResolvedValue(undefined);
    mocks.clearWebSignInSession.mockResolvedValue(undefined);
    mocks.getStableDeviceId.mockResolvedValue("device-1");
    mocks.unregisterPushToken.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    mocks.revokeSession.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.saveStoredHost.mockImplementation(async (u: string) => u);
    mocks.clearStoredHost.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (renderer) act(() => renderer!.unmount());
    renderer = null;
    vi.useRealTimers();
  });

  describe("boot", () => {
    it("shows a loading state until boot completes", async () => {
      const host = deferred<string | null>();
      const hostStore = await import("../config/hostStore");
      vi.spyOn(hostStore, "loadStoredHost").mockReturnValueOnce(host.promise);
      await act(async () => {
        renderer = create(<AppRoot />);
      });
      expect(renderer!.root.findAllByType("LoadingState" as never)).toHaveLength(1);
      expect(renderer!.root.findAllByType("RootNavigator" as never)).toHaveLength(0);
      await act(async () => host.resolve(null));
      await flush();
      expect(rootNavigator(renderer!).props.isSignedIn).toBe(false);
    });

    it("boots signed out without a stored session", async () => {
      mocks.storedHost = "https://stored.example.com";
      const r = await mount();
      expect(mocks.hydrateAppConfig).toHaveBeenCalledWith("https://stored.example.com");
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
      expect(mocks.auth?.baseUrl).toBe("https://tenant.example.com");
      expect(mocks.auth?.session).toBeNull();
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.appStartupReady, expect.objectContaining({ signedIn: false }));
    });

    it("restores a stored session, the tenant theme and the last screen", async () => {
      mocks.storedSession = makeSession();
      const navState = { index: 0, routes: [{ name: "Tabs" }] };
      mocks.getSecureJson.mockResolvedValue(navState);
      mocks.readCachedTheme.mockResolvedValue({ mode: "light", name: "forest" });
      const r = await mount();

      expect(rootNavigator(r).props.isSignedIn).toBe(true);
      expect(mocks.auth?.session?.accessToken).toBe("access-1");
      expect(mocks.setDeepLinkSignedIn).toHaveBeenCalledWith(true);
      expect(mocks.readCachedTheme).toHaveBeenCalledWith("https://tenant.example.com", "tenant-1");
      expect(r.root.findByType("ThemeProvider" as never).props.initialTenantTheme).toEqual({ mode: "light", name: "forest" });
      expect(mocks.getSecureJson).toHaveBeenCalledWith("alga.mobile.navState.user-1");
      expect(r.root.findByType("NavigationContainer" as never).props.initialState).toEqual(navState);
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.appStartupReady, expect.objectContaining({ signedIn: true }));
    });

    it("skips the restored screen when a deep link is pending", async () => {
      mocks.storedSession = makeSession();
      mocks.pendingDeepLink = true;
      mocks.getSecureJson.mockResolvedValue({ index: 0, routes: [{ name: "Tabs" }] });
      const r = await mount();
      expect(mocks.getSecureJson).not.toHaveBeenCalled();
      expect(r.root.findByType("NavigationContainer" as never).props.initialState).toBeUndefined();
    });

    it("discards a stored session without a refresh token", async () => {
      mocks.storedSession = makeSession({ refreshToken: "" });
      const r = await mount();
      expect(mocks.clearStoredSession).toHaveBeenCalled();
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("locks a restored session behind biometrics when enabled", async () => {
      mocks.storedSession = makeSession();
      mocks.biometricEnabled = true;
      const r = await mount();
      const lock = r.root.findByType("BiometricLockView" as never);
      expect(r.root.findAllByType("RootNavigator" as never)).toHaveLength(0);

      await act(async () => lock.props.onUnlocked());
      expect(r.root.findAllByType("BiometricLockView" as never)).toHaveLength(0);
      expect(rootNavigator(r).props.isSignedIn).toBe(true);
    });

    it("shows the offline banner when the network is down", async () => {
      mocks.offline = true;
      const r = await mount();
      expect(r.root.findAllByType("OfflineBanner" as never)).toHaveLength(1);
    });
  });

  describe("sign-in and navigation state", () => {
    it("stores a new session, tags Sentry and opens Home instead of the last screen", async () => {
      const r = await mount();
      mocks.getSecureJson.mockResolvedValue({ index: 0, routes: [{ name: "Old" }] });
      const session = makeSession();
      await act(async () => mocks.auth!.setSession(session));
      await flush();

      expect(mocks.storeSession).toHaveBeenCalledWith(session);
      expect(mocks.setSentryUser).toHaveBeenCalledWith({ id: "user-1", email: "tech@example.com", tenantId: "tenant-1" });
      expect(rootNavigator(r).props.isSignedIn).toBe(true);
      expect(mocks.getSecureJson).not.toHaveBeenCalled();
      expect(r.root.findByType("NavigationContainer" as never).props.initialState).toBeUndefined();
    });

    it("persists navigation state debounced, skipping auth screens", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      const container = () => r.root.findByType("NavigationContainer" as never);

      await act(async () => {
        container().props.onStateChange({ index: 0, routes: [{ name: "SignIn" }] });
      });
      await act(async () => {
        container().props.onStateChange({ index: 0, routes: [{ name: "Tabs" }] });
        container().props.onStateChange({ index: 0, routes: [{ name: "TicketDetail" }] });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(mocks.setSecureJson).toHaveBeenCalledTimes(1);
      expect(mocks.setSecureJson).toHaveBeenCalledWith("alga.mobile.navState.user-1", {
        index: 0,
        routes: [{ name: "TicketDetail" }],
      });
    });

    it("registers the navigation container with Sentry when ready", async () => {
      const r = await mount();
      r.root.findByType("NavigationContainer" as never).props.onReady();
      expect(mocks.registerNavigationContainer).toHaveBeenCalledWith(mocks.navRef);
    });
  });

  describe("refreshSession", () => {
    it("rotates tokens and keeps the same session handle", async () => {
      mocks.storedSession = makeSession();
      await mount();
      const handle = mocks.auth!.session;
      mocks.refreshSessionApi.mockResolvedValue({
        ok: true,
        status: 200,
        data: { accessToken: "access-2", refreshToken: "refresh-2", expiresInSec: 900 },
      });

      let token: string | null = null;
      await act(async () => {
        token = await mocks.auth!.refreshSession();
      });
      expect(token).toBe("access-2");
      expect(mocks.refreshSessionApi).toHaveBeenCalledWith(expect.anything(), {
        refreshToken: "refresh-1",
        device: { platform: "web" },
      });
      expect(mocks.storeSession).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "access-2", refreshToken: "refresh-2", expiresAtMs: NOW + 900_000 }),
      );
      expect(mocks.auth!.session).toBe(handle);
      expect(mocks.auth!.session?.accessToken).toBe("access-2");
    });

    it("shares one request between concurrent callers", async () => {
      mocks.storedSession = makeSession();
      await mount();
      const pending = deferred<unknown>();
      mocks.refreshSessionApi.mockReturnValue(pending.promise);

      const a = mocks.auth!.refreshSession();
      const b = mocks.auth!.refreshSession();
      expect(a).toBe(b);
      await act(async () =>
        pending.resolve({ ok: true, status: 200, data: { accessToken: "x", refreshToken: "y", expiresInSec: 60 } }),
      );
      await expect(a).resolves.toBe("x");
      expect(mocks.refreshSessionApi).toHaveBeenCalledTimes(1);
    });

    it("returns null when signed out", async () => {
      await mount();
      await expect(mocks.auth!.refreshSession()).resolves.toBeNull();
      expect(mocks.refreshSessionApi).not.toHaveBeenCalled();
    });

    it("signs out when the refresh token is revoked", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      mocks.refreshSessionApi.mockResolvedValue({ ok: false, status: 401, error: { kind: "auth", status: 401, message: "revoked" } });
      await act(async () => {
        await mocks.auth!.refreshSession();
      });
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authRefreshRevoked, { status: 401 });
      expect(mocks.clearStoredSession).toHaveBeenCalled();
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("keeps the session on a transient refresh failure", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      mocks.refreshSessionApi.mockResolvedValue({ ok: false, error: { kind: "network", message: "offline" } });
      let token: string | null = "unset";
      await act(async () => {
        token = await mocks.auth!.refreshSession();
      });
      expect(token).toBeNull();
      expect(rootNavigator(r).props.isSignedIn).toBe(true);
    });

    it("keeps the session when the refresh request throws", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      mocks.refreshSessionApi.mockRejectedValue(new Error("boom"));
      await act(async () => {
        await expect(mocks.auth!.refreshSession()).resolves.toBeNull();
      });
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authRefreshFailed, { errorKind: "exception" });
      expect(rootNavigator(r).props.isSignedIn).toBe(true);
    });

    it("signs out when the refreshed session cannot be persisted", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      mocks.refreshSessionApi.mockResolvedValue({
        ok: true,
        status: 200,
        data: { accessToken: "access-2", refreshToken: "refresh-2", expiresInSec: 900 },
      });
      mocks.storeSession.mockRejectedValueOnce(new Error("keychain"));
      await act(async () => {
        await expect(mocks.auth!.refreshSession()).resolves.toBeNull();
      });
      expect(mocks.error).toHaveBeenCalledWith("Failed to persist refreshed session", expect.anything());
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("discards a refresh that finishes after logout", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      const pending = deferred<unknown>();
      mocks.refreshSessionApi.mockReturnValue(pending.promise);
      const refreshing = mocks.auth!.refreshSession();
      await act(async () => mocks.auth!.setSession(null));
      await act(async () =>
        pending.resolve({ ok: true, status: 200, data: { accessToken: "late", refreshToken: "late-r", expiresInSec: 60 } }),
      );
      await expect(refreshing).resolves.toBeNull();
      expect(mocks.storeSession).not.toHaveBeenCalled();
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("refreshes a minute before the access token expires", async () => {
      mocks.storedSession = makeSession({ expiresAtMs: NOW + 5 * 60_000 });
      await mount();
      mocks.refreshSessionApi.mockResolvedValue({
        ok: true,
        status: 200,
        data: { accessToken: "access-2", refreshToken: "refresh-2", expiresInSec: 900 },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4 * 60_000 - 1);
      });
      expect(mocks.refreshSessionApi).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(mocks.refreshSessionApi).toHaveBeenCalledTimes(1);
    });

    it("keeps the session at expiry when the refresh fails transiently", async () => {
      mocks.storedSession = makeSession({ expiresAtMs: NOW + 1000 });
      mocks.refreshSessionApi.mockResolvedValue({ ok: false, status: 500, error: { kind: "server", status: 500, message: "x" } });
      const r = await mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      await flush();
      expect(mocks.refreshSessionApi.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(rootNavigator(r).props.isSignedIn).toBe(true);
    });

    it("keeps the session at expiry when the device is offline", async () => {
      mocks.storedSession = makeSession({ expiresAtMs: NOW + 1000 });
      mocks.refreshSessionApi.mockResolvedValue({ ok: false, error: { kind: "network", message: "offline" } });
      const r = await mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      await flush();
      expect(rootNavigator(r).props.isSignedIn).toBe(true);
    });

    it("signs out at expiry when the refresh token is rejected", async () => {
      mocks.storedSession = makeSession({ expiresAtMs: NOW + 1000 });
      mocks.refreshSessionApi.mockResolvedValue({ ok: false, status: 401, error: { kind: "auth", status: 401, message: "revoked" } });
      const r = await mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      await flush();
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("refreshes on resume only when the token is near expiry", async () => {
      mocks.storedSession = makeSession();
      await mount();
      mocks.refreshSessionApi.mockResolvedValue({ ok: false, error: { kind: "network", message: "x" } });
      await resume();
      expect(mocks.refreshSessionApi).not.toHaveBeenCalled();

      vi.setSystemTime(NOW + HOUR - 60_000);
      await resume();
      expect(mocks.refreshSessionApi).toHaveBeenCalledTimes(1);
    });
  });

  describe("biometric relock on resume", () => {
    it("relocks on resume when the gate is on", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      mocks.biometricEnabled = true;
      await resume();
      expect(r.root.findAllByType("BiometricLockView" as never)).toHaveLength(1);
    });

    it("does not relock within the grace period after an unlock", async () => {
      mocks.storedSession = makeSession();
      mocks.biometricEnabled = true;
      const r = await mount();
      await act(async () => r.root.findByType("BiometricLockView" as never).props.onUnlocked());

      vi.setSystemTime(NOW + 10 * 60_000);
      await resume();
      expect(r.root.findAllByType("BiometricLockView" as never)).toHaveLength(0);

      vi.setSystemTime(NOW + 16 * 60_000);
      await resume();
      expect(r.root.findAllByType("BiometricLockView" as never)).toHaveLength(1);
    });

    it("does not lock while signed out", async () => {
      mocks.biometricEnabled = true;
      const r = await mount();
      await resume();
      expect(r.root.findAllByType("BiometricLockView" as never)).toHaveLength(0);
    });
  });

  describe("logout", () => {
    it("unregisters push, revokes the session, ends the web session and clears local state", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      await act(async () => {
        await mocks.auth!.logout();
      });

      expect(mocks.unregisterPushToken).toHaveBeenCalledWith(expect.anything(), { apiKey: "access-1", deviceId: "device-1" });
      expect(mocks.revokeSession).toHaveBeenCalledWith(expect.anything(), { refreshToken: "refresh-1" });
      expect(mocks.unregisterPushToken.mock.invocationCallOrder[0]).toBeLessThan(mocks.revokeSession.mock.invocationCallOrder[0]);
      expect(mocks.clearWebSignInSession).toHaveBeenCalledWith("https://tenant.example.com");
      expect(mocks.clearPendingMobileAuth).toHaveBeenCalled();
      expect(mocks.clearReceivedOtt).toHaveBeenCalled();
      expect(mocks.clearPushRegistration).toHaveBeenCalled();
      expect(mocks.clearCachedTheme).toHaveBeenCalledWith("https://tenant.example.com", "tenant-1");
      expect(mocks.clearRecentSearches).toHaveBeenCalledWith("https://tenant.example.com", "user-1");
      expect(mocks.clearStoredSession).toHaveBeenCalled();
      expect(mocks.setSentryUser).toHaveBeenLastCalledWith(null);
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("still signs out locally when the server calls fail", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      mocks.unregisterPushToken.mockResolvedValue({ ok: false, error: { kind: "network", message: "x" } });
      mocks.revokeSession.mockRejectedValue(new Error("offline"));
      await act(async () => {
        await mocks.auth!.logout();
      });
      expect(mocks.warn).toHaveBeenCalledWith("Push token unregister failed", expect.anything());
      expect(mocks.warn).toHaveBeenCalledWith("Logout revoke failed", expect.anything());
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("skips the push unregister without a device id", async () => {
      mocks.storedSession = makeSession();
      mocks.getStableDeviceId.mockResolvedValue(undefined);
      await mount();
      await act(async () => {
        await mocks.auth!.logout();
      });
      expect(mocks.unregisterPushToken).not.toHaveBeenCalled();
      expect(mocks.revokeSession).toHaveBeenCalled();
    });

    it("makes no server calls when already signed out", async () => {
      await mount();
      await act(async () => {
        await mocks.auth!.logout();
      });
      expect(mocks.revokeSession).not.toHaveBeenCalled();
      expect(mocks.clearWebSignInSession).not.toHaveBeenCalled();
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authLogout, { hadSession: false });
    });
  });

  describe("server host", () => {
    it("switches host, clears per-server state and signs out", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      await act(async () => {
        await mocks.auth!.setHost("https://new.example.com");
      });
      expect(mocks.saveStoredHost).toHaveBeenCalledWith("https://new.example.com");
      expect(mocks.clearPushRegistration).toHaveBeenCalled();
      expect(mocks.clearRecentSearches).toHaveBeenCalledWith("https://tenant.example.com", "user-1");
      expect(mocks.clearCachedTheme).toHaveBeenCalledWith("https://tenant.example.com", "tenant-1");
      expect(mocks.setActiveBaseUrl).toHaveBeenCalledWith("https://new.example.com");
      expect(mocks.auth!.baseUrl).toBe("https://new.example.com");
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });

    it("clears the host back to the default", async () => {
      mocks.storedSession = makeSession();
      const r = await mount();
      await act(async () => {
        await mocks.auth!.clearHost();
      });
      expect(mocks.clearStoredHost).toHaveBeenCalled();
      expect(mocks.setActiveBaseUrl).toHaveBeenCalledWith(null);
      expect(mocks.auth!.baseUrl).toBe("https://algapsa.com");
      expect(rootNavigator(r).props.isSignedIn).toBe(false);
    });
  });
});
