import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  config: { ok: true, baseUrl: "https://example.com" } as { ok: boolean; baseUrl?: string; error?: string },
  clearPendingAppleLink: vi.fn(),
  clearPendingMobileAuth: vi.fn(),
  clearReceivedOtt: vi.fn(),
  createApiClient: vi.fn(),
  exchangeOttWithRetry: vi.fn(),
  getPendingAppleLink: vi.fn(),
  getPendingMobileAuth: vi.fn(),
  getTicketStats: vi.fn(),
  linkAppleId: vi.fn(),
  setSession: vi.fn(),
  storeReceivedOtt: vi.fn(),
  trackEvent: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-application", () => ({ nativeApplicationVersion: "1.6.5", nativeBuildVersion: "39" }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ setSession: mocks.setSession }) }));
vi.mock("../auth/mobileAuth", () => ({
  clearPendingAppleLink: () => mocks.clearPendingAppleLink(),
  clearPendingMobileAuth: () => mocks.clearPendingMobileAuth(),
  clearReceivedOtt: () => mocks.clearReceivedOtt(),
  getPendingAppleLink: () => mocks.getPendingAppleLink(),
  getPendingMobileAuth: () => mocks.getPendingMobileAuth(),
  storeReceivedOtt: (...args: unknown[]) => mocks.storeReceivedOtt(...args),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => mocks.config }));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/mobileAuth", () => ({
  exchangeOttWithRetry: (...args: unknown[]) => mocks.exchangeOttWithRetry(...args),
}));
vi.mock("../api/appleAuth", () => ({ linkAppleId: (...args: unknown[]) => mocks.linkAppleId(...args) }));
vi.mock("../api/tickets", () => ({ getTicketStats: (...args: unknown[]) => mocks.getTicketStats(...args) }));
vi.mock("../device/clientMetadata", () => ({ getStableDeviceId: async () => "device-1" }));
vi.mock("../analytics/analytics", () => ({ analytics: { trackEvent: mocks.trackEvent } }));
vi.mock("../logging/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error, info: vi.fn(), debug: vi.fn() } }));
vi.mock("../ui/states", async () => {
  const ReactLocal = await import("react");
  return {
    ErrorState: (props: { title: string; description: string; action: React.ReactNode }) =>
      ReactLocal.createElement("MockErrorState", { title: props.title, description: props.description }, props.action),
    LoadingState: (props: Record<string, unknown>) => ReactLocal.createElement("MockLoadingState", props),
  };
});
vi.mock("../ui/components/PrimaryButton", async () => {
  const ReactLocal = await import("react");
  return {
    PrimaryButton: (props: Record<string, unknown>) =>
      ReactLocal.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
  };
});

import { AuthCallbackScreen } from "./AuthCallbackScreen";
import { MobileAnalyticsEvents } from "../analytics/events";

const EXCHANGED = {
  ok: true,
  data: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresInSec: 60,
    tenantId: "tenant-1",
    user: { id: "user-1" },
  },
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderScreen(params: Record<string, unknown>) {
  const navigation = { reset: vi.fn() };
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(AuthCallbackScreen, {
        navigation,
        route: { key: "AuthCallback-1", name: "AuthCallback", params },
      } as never),
    );
  });
  await flush();
  return { renderer, navigation };
}

function errorDescription(renderer: ReactTestRenderer): string | null {
  const found = renderer.root.findAllByType("MockErrorState" as never);
  return found.length ? (found[0].props.description as string) : null;
}

describe("AuthCallbackScreen sign-in completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config = { ok: true, baseUrl: "https://example.com" };
    mocks.clearPendingAppleLink.mockResolvedValue(undefined);
    mocks.clearPendingMobileAuth.mockResolvedValue(undefined);
    mocks.clearReceivedOtt.mockResolvedValue(undefined);
    mocks.createApiClient.mockReturnValue({ request: vi.fn() });
    mocks.getPendingAppleLink.mockResolvedValue(null);
    mocks.getPendingMobileAuth.mockResolvedValue({ state: "state-1", createdAtMs: 0 });
    mocks.storeReceivedOtt.mockResolvedValue(undefined);
    mocks.exchangeOttWithRetry.mockResolvedValue(EXCHANGED);
    mocks.getTicketStats.mockResolvedValue({ ok: true, data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a loading state while completing sign-in", async () => {
    mocks.exchangeOttWithRetry.mockReturnValue(new Promise(() => undefined));
    const { renderer } = await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(renderer.root.findByType("MockLoadingState" as never).props.message).toBe("callback.completing");
  });

  it.each([
    ["invalid_redirect", "callback.errors.invalidRedirect"],
    [" RATE_LIMITED ", "callback.errors.rateLimited"],
    ["client_not_allowed", "callback.errors.clientNotAllowed"],
    ["host_not_allowlisted", "callback.errors.hostNotAllowlisted"],
    ["something_else", "something_else"],
  ])("maps the server error %s to a message", async (code, expected) => {
    const { renderer } = await renderScreen({ error: code });
    expect(errorDescription(renderer)).toBe(expected);
    expect(mocks.exchangeOttWithRetry).not.toHaveBeenCalled();
    expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authCallbackFailed, { reason: code });
  });

  it("returns to sign-in from the error state", async () => {
    const { renderer, navigation } = await renderScreen({ error: "invalid_redirect" });
    const button = renderer.root.findByType("MockPrimaryButton" as never);
    expect(button.props.children).toBe("callback.backToSignIn");
    act(() => {
      button.props.onPress();
    });
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "SignIn" }] });
  });

  it("rejects a callback missing the OTT or state", async () => {
    const { renderer } = await renderScreen({ ott: "ott-1" });
    expect(errorDescription(renderer)).toBe("callback.errors.missingParams");
    expect(mocks.getPendingMobileAuth).not.toHaveBeenCalled();
  });

  it("rejects a state that does not match the pending sign-in", async () => {
    const { renderer } = await renderScreen({ ott: "ott-1", state: "attacker-state" });
    expect(errorDescription(renderer)).toBe("callback.errors.stateMismatch");
    expect(mocks.storeReceivedOtt).not.toHaveBeenCalled();
    expect(mocks.exchangeOttWithRetry).not.toHaveBeenCalled();
  });

  it("rejects a callback when no sign-in is pending", async () => {
    mocks.getPendingMobileAuth.mockResolvedValue(null);
    const { renderer } = await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(errorDescription(renderer)).toBe("callback.errors.stateMismatch");
  });

  it("surfaces a configuration error", async () => {
    mocks.config = { ok: false, error: "No server configured" };
    const { renderer } = await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(errorDescription(renderer)).toBe("No server configured");
    expect(mocks.exchangeOttWithRetry).not.toHaveBeenCalled();
  });

  it("exchanges the OTT with device metadata and stores the session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    await renderScreen({ ott: "ott-1", state: "state-1" });

    expect(mocks.exchangeOttWithRetry).toHaveBeenCalledWith(
      expect.anything(),
      {
        ott: "ott-1",
        state: "state-1",
        device: { platform: "web", appVersion: "1.6.5", buildVersion: "39", deviceId: "device-1" },
      },
      { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000 },
      expect.any(AbortSignal),
    );
    expect(mocks.getTicketStats).toHaveBeenCalledWith(expect.anything(), { apiKey: "access-token" });
    expect(mocks.setSession).toHaveBeenCalledWith({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAtMs: Date.parse("2026-11-18T10:00:00Z") + 60_000,
      tenantId: "tenant-1",
      user: { id: "user-1" },
    });
    expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authExchangeSucceeded, { expiresInSec: 60 });
  });

  it("shows the exchange failure message and keeps the pending state", async () => {
    mocks.exchangeOttWithRetry.mockResolvedValue({
      ok: false,
      status: 401,
      error: { kind: "auth", status: 401, message: "OTT expired" },
    });
    const { renderer } = await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(errorDescription(renderer)).toBe("OTT expired");
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.clearPendingMobileAuth).not.toHaveBeenCalled();
    expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authExchangeFailed, { errorKind: "auth", status: 401 });
  });

  it("blocks users without ticket permission and clears the pending sign-in", async () => {
    mocks.getTicketStats.mockResolvedValue({
      ok: false,
      status: 403,
      error: { kind: "permission", status: 403, message: "forbidden" },
    });
    const { renderer } = await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(errorDescription(renderer)).toBe("callback.errors.noPermission");
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.clearPendingMobileAuth).toHaveBeenCalled();
    expect(mocks.clearReceivedOtt).toHaveBeenCalled();
  });

  it("still signs in when the ticket check fails for a non-permission reason", async () => {
    mocks.getTicketStats.mockResolvedValue({ ok: false, error: { kind: "network", message: "offline" } });
    await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(mocks.setSession).toHaveBeenCalled();
  });

  it("ignores a pending Apple link that belongs to another sign-in", async () => {
    mocks.getPendingAppleLink.mockResolvedValue({ identityToken: "id", createdAtMs: 0, state: "other" });
    await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(mocks.linkAppleId).not.toHaveBeenCalled();
    expect(mocks.clearPendingAppleLink).not.toHaveBeenCalled();
    expect(mocks.setSession).toHaveBeenCalled();
  });

  it("completes sign-in even when linking Apple fails", async () => {
    mocks.getPendingAppleLink.mockResolvedValue({ identityToken: "id", createdAtMs: 0, state: "state-1" });
    mocks.linkAppleId.mockResolvedValue({ ok: false, status: 409, error: { kind: "http", status: 409, message: "taken" } });
    await renderScreen({ ott: "ott-1", state: "state-1" });

    const appleClientOpts = mocks.createApiClient.mock.calls[2][0];
    expect(appleClientOpts.getAccessToken()).toBe("access-token");
    expect(appleClientOpts.getTenantId()).toBe("tenant-1");
    expect(mocks.warn).toHaveBeenCalledWith("Post-sign-in Apple link failed", { status: 409, errorKind: "http" });
    expect(mocks.clearPendingAppleLink).toHaveBeenCalled();
    expect(mocks.setSession).toHaveBeenCalled();
  });

  it("completes sign-in even when linking Apple throws", async () => {
    mocks.getPendingAppleLink.mockResolvedValue({ identityToken: "id", createdAtMs: 0, state: "state-1" });
    mocks.linkAppleId.mockRejectedValue(new Error("boom"));
    await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(mocks.warn).toHaveBeenCalledWith("Post-sign-in Apple link threw", expect.anything());
    expect(mocks.clearPendingAppleLink).toHaveBeenCalled();
    expect(mocks.setSession).toHaveBeenCalled();
  });

  it("shows a generic failure when completing sign-in throws", async () => {
    mocks.exchangeOttWithRetry.mockRejectedValue(new Error("crash"));
    const { renderer } = await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(errorDescription(renderer)).toBe("callback.errors.failedComplete");
    expect(mocks.error).toHaveBeenCalledWith("Failed to handle auth callback", expect.anything());
  });

  it("aborts the in-flight exchange when the screen unmounts", async () => {
    let signal: AbortSignal | undefined;
    mocks.exchangeOttWithRetry.mockImplementation((_c, _b, _o, s: AbortSignal) => {
      signal = s;
      return new Promise(() => undefined);
    });
    const { renderer } = await renderScreen({ ott: "ott-1", state: "state-1" });
    expect(signal?.aborted).toBe(false);
    act(() => renderer.unmount());
    expect(signal?.aborted).toBe(true);
  });
});
