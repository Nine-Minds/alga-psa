import React from "react";
import { Platform, Pressable, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  baseUrl: "https://algapsa.com" as string | null,
  hostLocked: false,
  navigate: vi.fn(),
  openAuthSessionAsync: vi.fn(),
  getAuthCapabilities: vi.fn(),
  createApiClient: vi.fn(),
  signInWithAppleOnServer: vi.fn(),
  isAppleSignInAvailable: vi.fn(),
  signInWithApple: vi.fn(),
  createPendingMobileAuth: vi.fn(),
  attachPendingAppleLinkToState: vi.fn(),
  storePendingAppleLink: vi.fn(),
  clearPendingAppleLink: vi.fn(),
  trackEvent: vi.fn(),
  logError: vi.fn(),
}));

// Stable identity, like production react-i18next.
const stableT = (key: string, def?: string) => (typeof def === "string" ? def : key);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT }),
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mocks.navigate }) }));
vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mocks.openAuthSessionAsync(...args),
}));
vi.mock("expo-apple-authentication", async () => {
  const ReactLocal = await import("react");
  return {
    AppleAuthenticationButton: (props: Record<string, unknown>) => ReactLocal.createElement("AppleButton", props),
    AppleAuthenticationButtonType: { SIGN_IN: 0 },
    AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 2 },
  };
});
vi.mock("expo-linking", () => ({ createURL: (path: string) => `alga://${path}` }));
vi.mock("../config/appConfig", () => ({
  isDefaultHost: (url: string | null) => url === "https://algapsa.com",
  isHostLocked: () => mocks.hostLocked,
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ baseUrl: mocks.baseUrl }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/mobileAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/mobileAuth")>()),
  createPendingMobileAuth: () => mocks.createPendingMobileAuth(),
  attachPendingAppleLinkToState: (...args: unknown[]) => mocks.attachPendingAppleLinkToState(...args),
  storePendingAppleLink: (...args: unknown[]) => mocks.storePendingAppleLink(...args),
  clearPendingAppleLink: () => mocks.clearPendingAppleLink(),
}));
vi.mock("../auth/appleSignIn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/appleSignIn")>()),
  isAppleSignInAvailable: () => mocks.isAppleSignInAvailable(),
  signInWithApple: () => mocks.signInWithApple(),
}));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => mocks.createApiClient(...args) }));
vi.mock("../api/mobileAuth", () => ({ getAuthCapabilities: (...args: unknown[]) => mocks.getAuthCapabilities(...args) }));
vi.mock("../api/appleAuth", () => ({
  signInWithAppleOnServer: (...args: unknown[]) => mocks.signInWithAppleOnServer(...args),
}));
vi.mock("../analytics/analytics", () => ({ analytics: { trackEvent: mocks.trackEvent } }));
vi.mock("../logging/logger", () => ({ logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { SignInScreen } from "./SignInScreen";
import { AppleSignInCancelledError, AppleSignInUnavailableError } from "../auth/appleSignIn";
import { MobileAnalyticsEvents } from "../analytics/events";

const platform = Platform as { OS: string };
const originalOS = platform.OS;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SignInScreen />);
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

function signInButton(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(Pressable).find((p) => p.props.accessibilityLabel === "signIn.cta")!;
}

async function press(onPress: () => void) {
  await act(async () => {
    onPress();
  });
  await flush();
}

function pressText(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root.findAllByType(Text).find((t) => t.props.accessibilityLabel === label);
  if (!node) throw new Error(`no text ${label}`);
  return press(node.props.onPress);
}

describe("SignInScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.OS = "web";
    mocks.baseUrl = "https://algapsa.com";
    mocks.hostLocked = false;
    mocks.createApiClient.mockReturnValue({ request: vi.fn() });
    mocks.getAuthCapabilities.mockResolvedValue({
      ok: true,
      data: { providers: { microsoft: true, google: false }, hostedDomainAllowlist: [] },
    });
    mocks.createPendingMobileAuth.mockResolvedValue({ state: "state-1", createdAtMs: 0 });
    mocks.attachPendingAppleLinkToState.mockResolvedValue(null);
    mocks.storePendingAppleLink.mockResolvedValue(undefined);
    mocks.clearPendingAppleLink.mockResolvedValue(undefined);
    mocks.isAppleSignInAvailable.mockResolvedValue(true);
  });

  afterEach(() => {
    platform.OS = originalOS;
  });

  describe("web sign-in", () => {
    it("checks server capabilities and enables sign-in", async () => {
      const renderer = await renderScreen();
      expect(mocks.getAuthCapabilities).toHaveBeenCalledTimes(1);
      expect(mocks.createApiClient.mock.calls[0][0].baseUrl).toBe("https://algapsa.com");
      expect(signInButton(renderer).props.disabled).toBe(false);
      expect(texts(renderer)).toContain("https://algapsa.com");
    });

    it("opens the browser with a state-bound handoff URL and forwards the callback", async () => {
      mocks.openAuthSessionAsync.mockResolvedValue({
        type: "success",
        url: "alga://auth/callback?ott=ott-1&state=state-1",
      });
      const renderer = await renderScreen();
      await press(signInButton(renderer).props.onPress);

      expect(mocks.attachPendingAppleLinkToState).toHaveBeenCalledWith("state-1");
      const [loginUrl, redirectUri] = mocks.openAuthSessionAsync.mock.calls[0];
      expect(redirectUri).toBe("alga://auth/callback");
      const callback = new URL(new URL(loginUrl).searchParams.get("callbackUrl")!);
      expect(callback.pathname).toBe("/auth/mobile/handoff");
      expect(callback.searchParams.get("state")).toBe("state-1");
      expect(mocks.navigate).toHaveBeenCalledWith("AuthCallback", { ott: "ott-1", state: "state-1", error: undefined });
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authSignInOpenedBrowser);
    });

    it("stays put when the user cancels the browser", async () => {
      mocks.openAuthSessionAsync.mockResolvedValue({ type: "cancel" });
      const renderer = await renderScreen();
      await press(signInButton(renderer).props.onPress);
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authSignInOpenFailed, { reason: "user_cancelled" });
      expect(signInButton(renderer).props.disabled).toBe(false);
    });

    it("shows an error when the browser cannot open", async () => {
      mocks.openAuthSessionAsync.mockRejectedValue(new Error("no browser"));
      const renderer = await renderScreen();
      await press(signInButton(renderer).props.onPress);
      expect(texts(renderer)).toContain("signIn.errors.failedOpenBrowser");
      expect(mocks.logError).toHaveBeenCalled();
    });

    it("shows a retry when capabilities cannot be verified", async () => {
      mocks.getAuthCapabilities.mockResolvedValueOnce({ ok: false, error: { kind: "network", message: "x" } });
      const renderer = await renderScreen();
      expect(texts(renderer)).toContain("signIn.errors.verifySupport");

      const retry = renderer.root
        .findAllByType(Pressable)
        .find((p) => p.findAllByType(Text).some((t) => t.props.children === "common:retry"))!;
      await press(retry.props.onPress);
      expect(mocks.getAuthCapabilities).toHaveBeenCalledTimes(2);
      expect(texts(renderer)).not.toContain("signIn.errors.verifySupport");
    });

    it("treats a thrown capabilities request like a failed one", async () => {
      mocks.getAuthCapabilities.mockRejectedValue(new Error("boom"));
      const renderer = await renderScreen();
      expect(texts(renderer)).toContain("signIn.errors.verifySupport");
    });

    it("shows the checking message while capabilities load", async () => {
      mocks.getAuthCapabilities.mockReturnValue(new Promise(() => undefined));
      const renderer = await renderScreen();
      expect(texts(renderer)).toContain("signIn.checkingServer");
    });

    it("disables sign-in when the server turned mobile off", async () => {
      mocks.getAuthCapabilities.mockResolvedValue({ ok: true, data: { enabled: false, providers: { microsoft: true, google: true } } });
      const renderer = await renderScreen();
      expect(signInButton(renderer).props.disabled).toBe(true);
      expect(texts(renderer)).toContain("signIn.errors.mobileNotAvailable");
    });

    it("blocks a host that is not on the server allowlist", async () => {
      mocks.getAuthCapabilities.mockResolvedValue({
        ok: true,
        data: { providers: { microsoft: true, google: false }, hostedDomainAllowlist: ["Other.Example.com"] },
      });
      const renderer = await renderScreen();
      expect(signInButton(renderer).props.disabled).toBe(true);
      expect(texts(renderer)).toContain("signIn.errors.domainNotAllowed");

      await press(signInButton(renderer).props.onPress);
      expect(texts(renderer)).toContain("signIn.errors.hostNotAllowed");
      expect(mocks.openAuthSessionAsync).not.toHaveBeenCalled();
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authSignInBlocked, { reason: "host_not_allowlisted" });
    });

    it("allows a host on the allowlist regardless of case", async () => {
      mocks.getAuthCapabilities.mockResolvedValue({
        ok: true,
        data: { providers: { microsoft: true, google: false }, hostedDomainAllowlist: ["ALGAPSA.com"] },
      });
      const renderer = await renderScreen();
      expect(signInButton(renderer).props.disabled).toBe(false);
    });

    it("notes when no SSO provider is configured", async () => {
      mocks.getAuthCapabilities.mockResolvedValue({ ok: true, data: { providers: { microsoft: false, google: false } } });
      const renderer = await renderScreen();
      expect(texts(renderer)).toContain("signIn.errors.ssoNotConfigured");
    });

    it("refuses to sign in without a configured server", async () => {
      mocks.baseUrl = null;
      const renderer = await renderScreen();
      expect(mocks.getAuthCapabilities).not.toHaveBeenCalled();
      expect(signInButton(renderer).props.disabled).toBe(true);
      await press(signInButton(renderer).props.onPress);
      expect(texts(renderer)).toContain("signIn.errors.missingConfig");
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authSignInBlocked, { reason: "missing_base_url" });
    });

    it("navigates to server entry unless the host is locked", async () => {
      const renderer = await renderScreen();
      await pressText(renderer, "Change server");
      expect(mocks.navigate).toHaveBeenCalledWith("ServerEntry");

      mocks.hostLocked = true;
      const locked = await renderScreen();
      expect(texts(locked)).not.toContain("Change server");
    });

    it("hides Apple sign-in and workspace creation off iOS", async () => {
      const renderer = await renderScreen();
      expect(renderer.root.findAllByType("AppleButton" as never)).toHaveLength(0);
      expect(texts(renderer)).not.toContain("Create a new workspace");
      expect(mocks.isAppleSignInAvailable).not.toHaveBeenCalled();
    });
  });

  describe("on iOS", () => {
    beforeEach(() => {
      platform.OS = "ios";
      mocks.signInWithApple.mockResolvedValue({
        identityToken: "id-token",
        authorizationCode: "auth-code",
        fullName: { givenName: "Ada", familyName: "Lovelace" },
        user: "apple-user",
        email: null,
      });
    });

    function appleButton(renderer: ReactTestRenderer) {
      return renderer.root.findByType("AppleButton" as never);
    }

    it("offers workspace creation on the default host", async () => {
      const renderer = await renderScreen();
      await pressText(renderer, "Create a new workspace");
      expect(mocks.navigate).toHaveBeenCalledWith("CreateWorkspace");
    });

    it("hides Apple sign-in on a custom host", async () => {
      mocks.baseUrl = "https://psa.customer.com";
      const renderer = await renderScreen();
      expect(renderer.root.findAllByType("AppleButton" as never)).toHaveLength(0);
      expect(texts(renderer)).not.toContain("Create a new workspace");
    });

    it("hides Apple sign-in when the device does not support it", async () => {
      mocks.isAppleSignInAvailable.mockResolvedValue(false);
      const renderer = await renderScreen();
      expect(renderer.root.findAllByType("AppleButton" as never)).toHaveLength(0);
    });

    it("signs in with Apple and continues to the callback with the server OTT", async () => {
      mocks.signInWithAppleOnServer.mockResolvedValue({ ok: true, data: { ott: "apple-ott" } });
      const renderer = await renderScreen();
      await press(appleButton(renderer).props.onPress);

      expect(mocks.signInWithAppleOnServer).toHaveBeenCalledWith(expect.anything(), {
        identityToken: "id-token",
        authorizationCode: "auth-code",
        firstName: "Ada",
        lastName: "Lovelace",
        state: "state-1",
      });
      expect(mocks.clearPendingAppleLink).toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith("AuthCallback", { ott: "apple-ott", state: "state-1" });
    });

    it("keeps the Apple identity to link after a regular sign-in when no account exists", async () => {
      mocks.signInWithAppleOnServer.mockResolvedValue({
        ok: false,
        status: 404,
        error: { kind: "http", status: 404, message: "no account" },
      });
      const renderer = await renderScreen();
      await press(appleButton(renderer).props.onPress);

      expect(mocks.storePendingAppleLink).toHaveBeenCalledWith({ identityToken: "id-token", authorizationCode: "auth-code" });
      expect(texts(renderer)).toContain("signIn.errors.appleNoAccount");
      expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it("shows a failure for other server errors", async () => {
      mocks.signInWithAppleOnServer.mockResolvedValue({
        ok: false,
        status: 500,
        error: { kind: "server", status: 500, message: "boom" },
      });
      const renderer = await renderScreen();
      await press(appleButton(renderer).props.onPress);
      expect(mocks.storePendingAppleLink).not.toHaveBeenCalled();
      expect(texts(renderer)).toContain("signIn.errors.appleFailed");
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authAppleFailed, { status: 500, errorKind: "server" });
    });

    it("does nothing visible when the user cancels the Apple sheet", async () => {
      mocks.signInWithApple.mockRejectedValue(new AppleSignInCancelledError());
      const renderer = await renderScreen();
      await press(appleButton(renderer).props.onPress);
      expect(texts(renderer)).not.toContain("signIn.errors.appleFailed");
      expect(mocks.trackEvent).toHaveBeenCalledWith(MobileAnalyticsEvents.authAppleCancelled);
      expect(mocks.signInWithAppleOnServer).not.toHaveBeenCalled();
    });

    it("hides the Apple button when Apple reports it unavailable", async () => {
      mocks.signInWithApple.mockRejectedValue(new AppleSignInUnavailableError());
      const renderer = await renderScreen();
      await press(appleButton(renderer).props.onPress);
      expect(renderer.root.findAllByType("AppleButton" as never)).toHaveLength(0);
    });

    it("shows a failure when Apple sign-in throws unexpectedly", async () => {
      mocks.signInWithApple.mockRejectedValue(new Error("native crash"));
      const renderer = await renderScreen();
      await press(appleButton(renderer).props.onPress);
      expect(texts(renderer)).toContain("signIn.errors.appleFailed");
      expect(mocks.logError).toHaveBeenCalledWith("Apple sign-in failed", expect.anything());
    });

    it("ignores Apple presses while the host is not allowed", async () => {
      mocks.getAuthCapabilities.mockResolvedValue({
        ok: true,
        data: { providers: { microsoft: true, google: false }, hostedDomainAllowlist: ["other.example.com"] },
      });
      const renderer = await renderScreen();
      expect(appleButton(renderer).props.style.opacity).toBe(0.5);
      await press(appleButton(renderer).props.onPress);
      expect(mocks.signInWithApple).not.toHaveBeenCalled();
    });
  });
});
