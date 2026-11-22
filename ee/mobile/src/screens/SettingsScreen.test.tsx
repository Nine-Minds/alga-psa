import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

type AlertButton = { text?: string; style?: string; onPress?: () => void };

const mocks = vi.hoisted(() => ({
  os: "ios" as string,
  alert: vi.fn(),
  openURL: vi.fn(),
  openSettings: vi.fn(),
  navigate: vi.fn(),
  logout: vi.fn(),
  session: null as null | Record<string, any>,
  configOk: true,
  setPreference: vi.fn(),
  getBiometricGateEnabled: vi.fn(),
  canUseBiometrics: vi.fn(),
  setBiometricGateEnabled: vi.fn(),
  authenticateForUnlock: vi.fn(),
  getHideSensitive: vi.fn(),
  setHideSensitive: vi.fn(),
  getPushPriorityThreshold: vi.fn(),
  setPushPriorityThreshold: vi.fn(),
  getReminderLeadMinutes: vi.fn(),
  setReminderLeadMinutes: vi.fn(),
  resyncScheduleReminders: vi.fn(),
  requestPushPermission: vi.fn(),
  getExpoPushToken: vi.fn(),
  registerPushToken: vi.fn(),
  unregisterPushToken: vi.fn(),
  sendTestPushNotification: vi.fn(),
  updatePushPriorityThreshold: vi.fn(),
  createApiClient: vi.fn(() => ({ request: vi.fn() })),
  getStableDeviceId: vi.fn(),
  readPushRegistration: vi.fn(),
  writePushRegistration: vi.fn(),
  clearPushRegistration: vi.fn(),
  isRegisteredFor: vi.fn(),
  getAppleLinkStatus: vi.fn(),
  linkAppleId: vi.fn(),
  unlinkAppleId: vi.fn(),
  isAppleSignInAvailable: vi.fn(),
  signInWithApple: vi.fn(),
  clearTicketsCache: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  translate: (key: string, defOrOpts?: string | Record<string, unknown>, optsArg?: Record<string, unknown>) => {
    const def = typeof defOrOpts === "string" ? defOrOpts : undefined;
    const opts = typeof defOrOpts === "object" ? defOrOpts : optsArg;
    let out = def || key;
    if (opts) {
      for (const [name, value] of Object.entries(opts)) out = out.replaceAll(`{{${name}}}`, String(value));
    }
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return {
    ...actual,
    Platform: {
      get OS() {
        return mocks.os;
      },
    },
    Alert: { alert: (...args: unknown[]) => mocks.alert(...args) },
    Linking: {
      openURL: (...args: unknown[]) => mocks.openURL(...args),
      openSettings: (...args: unknown[]) => mocks.openSettings(...args),
    },
  };
});

vi.mock("expo-application", () => ({ nativeApplicationVersion: "1.6.5", nativeBuildVersion: "39" }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mocks.navigate }) }));
vi.mock("../config/appConfig", () => ({
  getAppConfig: () =>
    mocks.configOk ? { ok: true, env: "dev", baseUrl: "https://algapsa.com" } : { ok: false, error: "missing" },
}));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return {
    useTheme: () => lightTheme,
    useThemePreference: () => ({ preference: "system", setPreference: mocks.setPreference }),
    useTenantTheme: () => ({ label: "Ocean" }),
  };
});
vi.mock("../auth/biometricGate", () => ({
  getBiometricGateEnabled: () => mocks.getBiometricGateEnabled(),
  canUseBiometrics: () => mocks.canUseBiometrics(),
  setBiometricGateEnabled: (v: boolean) => mocks.setBiometricGateEnabled(v),
  authenticateForUnlock: () => mocks.authenticateForUnlock(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ session: mocks.session, logout: mocks.logout }) }));
vi.mock("../cache/ticketsCache", () => ({ clearTicketsCache: () => mocks.clearTicketsCache() }));
vi.mock("../ui/components/Avatar", () => ({ Avatar: (props: Record<string, unknown>) => React.createElement("Avatar", props) }));
vi.mock("../settings/privacyPreferences", () => ({
  getHideSensitiveNotificationsEnabled: () => mocks.getHideSensitive(),
  setHideSensitiveNotificationsEnabled: (v: boolean) => mocks.setHideSensitive(v),
}));
vi.mock("../settings/notificationPreferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/notificationPreferences")>()),
  getPushPriorityThreshold: () => mocks.getPushPriorityThreshold(),
  setPushPriorityThreshold: (v: unknown) => mocks.setPushPriorityThreshold(v),
  getReminderLeadMinutes: () => mocks.getReminderLeadMinutes(),
  setReminderLeadMinutes: (v: unknown) => mocks.setReminderLeadMinutes(v),
}));
vi.mock("../ui/components/Select", () => ({ Select: (props: Record<string, unknown>) => React.createElement("Select", props) }));
vi.mock("../ui/components/MultiSelect", () => ({
  MultiSelect: (props: Record<string, unknown>) => React.createElement("MultiSelect", props),
}));
vi.mock("../notifications/reminderSync", () => ({ resyncScheduleReminders: (a: unknown) => mocks.resyncScheduleReminders(a) }));
vi.mock("../notifications/pushTokenService", () => ({
  requestPushPermission: () => mocks.requestPushPermission(),
  getExpoPushToken: () => mocks.getExpoPushToken(),
}));
vi.mock("../api/pushToken", () => ({
  registerPushToken: (...a: unknown[]) => mocks.registerPushToken(...a),
  unregisterPushToken: (...a: unknown[]) => mocks.unregisterPushToken(...a),
  sendTestPushNotification: (...a: unknown[]) => mocks.sendTestPushNotification(...a),
  updatePushPriorityThreshold: (...a: unknown[]) => mocks.updatePushPriorityThreshold(...a),
}));
vi.mock("../api", () => ({ createApiClient: (...a: unknown[]) => (mocks.createApiClient as any)(...a) }));
vi.mock("../device/clientMetadata", () => ({ getStableDeviceId: () => mocks.getStableDeviceId() }));
vi.mock("../notifications/pushRegistration", () => ({
  readPushRegistration: () => mocks.readPushRegistration(),
  writePushRegistration: (a: unknown) => mocks.writePushRegistration(a),
  clearPushRegistration: () => mocks.clearPushRegistration(),
  isRegisteredFor: (...a: unknown[]) => mocks.isRegisteredFor(...a),
}));
vi.mock("../api/appleAuth", () => ({
  getAppleLinkStatus: (...a: unknown[]) => mocks.getAppleLinkStatus(...a),
  linkAppleId: (...a: unknown[]) => mocks.linkAppleId(...a),
  unlinkAppleId: (...a: unknown[]) => mocks.unlinkAppleId(...a),
}));
vi.mock("../auth/appleSignIn", () => {
  class AppleSignInCancelledError extends Error {}
  class AppleSignInUnavailableError extends Error {}
  return {
    AppleSignInCancelledError,
    AppleSignInUnavailableError,
    isAppleSignInAvailable: () => mocks.isAppleSignInAvailable(),
    signInWithApple: () => mocks.signInWithApple(),
  };
});
vi.mock("../logging/logger", () => ({ logger: mocks.logger }));

import { SettingsScreen, describeReminderLeads, describeTestPush } from "./SettingsScreen";
import { AppleSignInCancelledError, AppleSignInUnavailableError } from "../auth/appleSignIn";

const SESSION = {
  accessToken: "api-key",
  tenantId: "tenant-1",
  user: { id: "user-1", name: "Natalie Tech", email: "nat@example.com", avatarUrl: "/avatar.png" },
};

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(SettingsScreen));
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

function byLabelPrefix(renderer: ReactTestRenderer, prefix: string) {
  return renderer.root.find(
    (n) => typeof n.props?.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith(prefix) && !!n.props.onPress,
  );
}

async function press(renderer: ReactTestRenderer, prefix: string) {
  await act(async () => {
    byLabelPrefix(renderer, prefix).props.onPress();
  });
  await flush();
}

function lastAlertButtons(): AlertButton[] {
  const call = mocks.alert.mock.calls[mocks.alert.mock.calls.length - 1];
  return (call?.[2] ?? []) as AlertButton[];
}

async function pressAlertButton(text: string) {
  const button = lastAlertButtons().find((b) => b.text === text);
  if (!button?.onPress) throw new Error(`no alert button ${text}`);
  await act(async () => {
    button.onPress!();
  });
  await flush();
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.os = "ios";
    mocks.configOk = true;
    mocks.session = { ...SESSION };
    mocks.getBiometricGateEnabled.mockResolvedValue(false);
    mocks.canUseBiometrics.mockResolvedValue(true);
    mocks.setBiometricGateEnabled.mockResolvedValue(undefined);
    mocks.authenticateForUnlock.mockResolvedValue({ ok: true });
    mocks.getHideSensitive.mockResolvedValue(false);
    mocks.setHideSensitive.mockResolvedValue(undefined);
    mocks.readPushRegistration.mockResolvedValue(null);
    mocks.isRegisteredFor.mockReturnValue(false);
    mocks.getPushPriorityThreshold.mockResolvedValue("low");
    mocks.setPushPriorityThreshold.mockResolvedValue(undefined);
    mocks.getReminderLeadMinutes.mockResolvedValue([15]);
    mocks.setReminderLeadMinutes.mockResolvedValue(undefined);
    mocks.isAppleSignInAvailable.mockResolvedValue(false);
    mocks.getAppleLinkStatus.mockResolvedValue({ ok: true, data: { linked: false } });
    mocks.getStableDeviceId.mockResolvedValue("device-1");
    mocks.logout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mocks.os = "ios";
  });

  describe("account and about", () => {
    it("shows the signed-in user, email, tenant and an avatar with the absolute image URL", async () => {
      const renderer = await renderScreen();
      const all = texts(renderer);
      expect(all).toContain("Natalie Tech");
      expect(all).toContain("nat@example.com");
      expect(all).toContain("tenant-1");
      const avatar = renderer.root.find((n) => (n.type as unknown) === "Avatar");
      expect(avatar.props.imageUri).toBe("https://algapsa.com/avatar.png");
      expect(avatar.props.authToken).toBe("api-key");
    });

    it("shows version, platform, environment and base URL in About", async () => {
      const renderer = await renderScreen();
      const labels = renderer.root
        .findAll((n) => n.props?.accessibilityRole === "text")
        .map((n) => n.props.accessibilityLabel as string);
      expect(labels.some((l) => l.includes("1.6.5"))).toBe(true);
      expect(labels).toContain("about.platform: ios");
      expect(labels).toContain("about.environment: dev");
      expect(labels).toContain("about.baseUrl: https://algapsa.com");
    });

    it("reports invalid config in About and disables account actions with no session", async () => {
      mocks.configOk = false;
      mocks.session = null;
      const renderer = await renderScreen();
      const labels = renderer.root
        .findAll((n) => n.props?.accessibilityRole === "text")
        .map((n) => n.props.accessibilityLabel as string);
      expect(labels).toContain("about.environment: about.invalid");
      expect(labels).toContain("about.baseUrl: about.missing");
      expect(texts(renderer)).not.toContain("Natalie Tech");
      expect(byLabelPrefix(renderer, "account.signOut").props.disabled).toBe(true);
      expect(byLabelPrefix(renderer, "Muted users").props.disabled).toBe(true);
    });

    it("navigates to Muted users and Account deletion", async () => {
      const renderer = await renderScreen();
      await press(renderer, "Muted users");
      await press(renderer, "Delete Account");
      expect(mocks.navigate).toHaveBeenNthCalledWith(1, "MutedUsers");
      expect(mocks.navigate).toHaveBeenNthCalledWith(2, "AccountDeletion");
    });

    it("signs out only after confirming", async () => {
      const renderer = await renderScreen();
      await press(renderer, "account.signOut");
      expect(mocks.alert).toHaveBeenCalledWith("account.signOutConfirmTitle", "account.signOutConfirmMessage", expect.any(Array));
      expect(mocks.logout).not.toHaveBeenCalled();
      await pressAlertButton("account.signOut");
      expect(mocks.logout).toHaveBeenCalledTimes(1);
    });

    it("ignores a second sign-out confirmation while the first is running", async () => {
      let finish!: () => void;
      mocks.logout.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
      const renderer = await renderScreen();
      await press(renderer, "account.signOut");
      const confirm = lastAlertButtons().find((b) => b.text === "account.signOut")!;
      await act(async () => {
        confirm.onPress!();
        confirm.onPress!();
      });
      expect(mocks.logout).toHaveBeenCalledTimes(1);
      await act(async () => finish());
    });

    it("tells the user when sign-out fails", async () => {
      mocks.logout.mockRejectedValue(new Error("network"));
      const renderer = await renderScreen();
      await press(renderer, "account.signOut");
      await pressAlertButton("account.signOut");
      expect(mocks.alert).toHaveBeenLastCalledWith("account.signOutFailed", "account.signOutFailedMessage");
    });
  });

  describe("appearance", () => {
    it("cycles the appearance preference from system to light and shows the tenant theme", async () => {
      const renderer = await renderScreen();
      await press(renderer, "Appearance:");
      expect(mocks.setPreference).toHaveBeenCalledWith("light");
      expect(texts(renderer)).toContain("Ocean");
    });
  });

  describe("biometric lock", () => {
    it("enables the lock after a successful biometric check", async () => {
      const renderer = await renderScreen();
      await press(renderer, "security.biometricLock");
      expect(mocks.authenticateForUnlock).toHaveBeenCalled();
      expect(mocks.setBiometricGateEnabled).toHaveBeenCalledWith(true);
      expect(byLabelPrefix(renderer, "security.biometricLock").props.accessibilityLabel).toBe("security.biometricLock: common:on");
    });

    it("disables the lock without re-authenticating when it is on", async () => {
      mocks.getBiometricGateEnabled.mockResolvedValue(true);
      const renderer = await renderScreen();
      await press(renderer, "security.biometricLock");
      expect(mocks.authenticateForUnlock).not.toHaveBeenCalled();
      expect(mocks.setBiometricGateEnabled).toHaveBeenCalledWith(false);
      expect(byLabelPrefix(renderer, "security.biometricLock").props.accessibilityLabel).toBe("security.biometricLock: common:off");
    });

    it("explains when biometrics are not set up on the device", async () => {
      mocks.canUseBiometrics.mockResolvedValue(false);
      const renderer = await renderScreen();
      await press(renderer, "security.biometricLock");
      expect(texts(renderer)).toContain("security.biometricNotSetUp");
      expect(mocks.setBiometricGateEnabled).not.toHaveBeenCalled();
    });

    it("shows the failure reason when authentication fails", async () => {
      mocks.authenticateForUnlock.mockResolvedValue({ ok: false, reason: "Face not recognized" });
      const renderer = await renderScreen();
      await press(renderer, "security.biometricLock");
      expect(texts(renderer)).toContain("Face not recognized");
      expect(mocks.setBiometricGateEnabled).not.toHaveBeenCalled();
    });
  });

  it("toggles hide-sensitive notifications and persists the new value", async () => {
    const renderer = await renderScreen();
    await press(renderer, "security.hideSensitiveNotifications");
    expect(mocks.setHideSensitive).toHaveBeenCalledWith(true);
    expect(byLabelPrefix(renderer, "security.hideSensitiveNotifications").props.accessibilityLabel).toBe(
      "security.hideSensitiveNotifications: common:on",
    );
  });

  describe("Sign in with Apple", () => {
    it("is hidden on Android and when Apple sign-in is unavailable", async () => {
      mocks.os = "android";
      mocks.isAppleSignInAvailable.mockResolvedValue(true);
      let renderer = await renderScreen();
      expect(texts(renderer)).not.toContain("Sign in with Apple");
      expect(mocks.isAppleSignInAvailable).not.toHaveBeenCalled();

      mocks.os = "ios";
      mocks.isAppleSignInAvailable.mockResolvedValue(false);
      renderer = await renderScreen();
      expect(texts(renderer)).not.toContain("Sign in with Apple");
      expect(mocks.getAppleLinkStatus).not.toHaveBeenCalled();
    });

    it("links an Apple ID and confirms it", async () => {
      mocks.isAppleSignInAvailable.mockResolvedValue(true);
      mocks.signInWithApple.mockResolvedValue({ identityToken: "id-tok", authorizationCode: null });
      mocks.linkAppleId.mockResolvedValue({ ok: true, data: {} });
      const renderer = await renderScreen();
      expect(texts(renderer)).toContain("Not connected — tap to connect");

      await press(renderer, "Sign in with Apple");
      expect(mocks.linkAppleId).toHaveBeenCalledWith(expect.anything(), { identityToken: "id-tok", authorizationCode: undefined });
      expect(texts(renderer)).toContain("Connected — tap to disconnect");
      expect(mocks.alert).toHaveBeenCalledWith("Apple ID connected", expect.any(String), expect.any(Array));
    });

    it("explains a 409 as an Apple ID linked to another account", async () => {
      mocks.isAppleSignInAvailable.mockResolvedValue(true);
      mocks.signInWithApple.mockResolvedValue({ identityToken: "id-tok", authorizationCode: "code" });
      mocks.linkAppleId.mockResolvedValue({ ok: false, status: 409, error: { message: "conflict" } });
      const renderer = await renderScreen();
      await press(renderer, "Sign in with Apple");
      expect(texts(renderer)).toContain("This Apple ID is already linked to a different AlgaPSA account.");
    });

    it("shows a generic error for other link failures and thrown errors", async () => {
      mocks.isAppleSignInAvailable.mockResolvedValue(true);
      mocks.signInWithApple.mockResolvedValue({ identityToken: "id-tok" });
      mocks.linkAppleId.mockResolvedValue({ ok: false, status: 500, error: { message: "boom" } });
      const renderer = await renderScreen();
      await press(renderer, "Sign in with Apple");
      expect(texts(renderer)).toContain("Unable to link your Apple ID. Please try again.");

      mocks.signInWithApple.mockRejectedValue(new Error("native crash"));
      await press(renderer, "Sign in with Apple");
      expect(texts(renderer)).toContain("Unable to link your Apple ID. Please try again.");
      expect(mocks.logger.error).toHaveBeenCalledWith("Apple link threw", expect.anything());
    });

    it("stays quiet when the user cancels and hides the row when Apple sign-in becomes unavailable", async () => {
      mocks.isAppleSignInAvailable.mockResolvedValue(true);
      mocks.signInWithApple.mockRejectedValue(new AppleSignInCancelledError());
      const renderer = await renderScreen();
      await press(renderer, "Sign in with Apple");
      expect(texts(renderer)).not.toContain("Unable to link your Apple ID. Please try again.");
      expect(mocks.linkAppleId).not.toHaveBeenCalled();

      mocks.signInWithApple.mockRejectedValue(new AppleSignInUnavailableError());
      await press(renderer, "Sign in with Apple");
      expect(texts(renderer)).not.toContain("Sign in with Apple");
    });

    it("disconnects a linked Apple ID after confirmation and reports failures", async () => {
      mocks.isAppleSignInAvailable.mockResolvedValue(true);
      mocks.getAppleLinkStatus.mockResolvedValue({ ok: true, data: { linked: true } });
      mocks.unlinkAppleId.mockResolvedValueOnce({ ok: false, status: 500, error: { message: "x" } });
      const renderer = await renderScreen();
      expect(texts(renderer)).toContain("Connected — tap to disconnect");

      await press(renderer, "Sign in with Apple");
      expect(mocks.alert).toHaveBeenCalledWith("Disconnect Apple ID?", expect.any(String), expect.any(Array));
      await pressAlertButton("Disconnect");
      expect(texts(renderer)).toContain("Unable to disconnect your Apple ID. Please try again.");

      mocks.unlinkAppleId.mockResolvedValueOnce({ ok: true, data: {} });
      await press(renderer, "Sign in with Apple");
      await pressAlertButton("Disconnect");
      expect(texts(renderer)).toContain("Not connected — tap to connect");
    });

    it("logs and keeps the loading state when the link status fetch throws", async () => {
      mocks.isAppleSignInAvailable.mockResolvedValue(true);
      mocks.getAppleLinkStatus.mockRejectedValue(new Error("offline"));
      const renderer = await renderScreen();
      expect(mocks.logger.warn).toHaveBeenCalledWith("Apple link status fetch failed", expect.anything());
      expect(byLabelPrefix(renderer, "Sign in with Apple").props.disabled).toBe(true);
    });
  });

  describe("push notifications", () => {
    it("starts as on when this device is registered for the current tenant and user", async () => {
      mocks.isRegisteredFor.mockReturnValue(true);
      const renderer = await renderScreen();
      expect(mocks.isRegisteredFor).toHaveBeenCalledWith(null, {
        baseUrl: "https://algapsa.com",
        tenantId: "tenant-1",
        userId: "user-1",
      });
      expect(byLabelPrefix(renderer, "Push Notifications").props.accessibilityLabel).toBe("Push Notifications: common:on");
    });

    it("registers the token and stores the registration when enabling", async () => {
      mocks.requestPushPermission.mockResolvedValue(true);
      mocks.getExpoPushToken.mockResolvedValue("ExponentPushToken[abc]");
      mocks.registerPushToken.mockResolvedValue({ ok: true, data: {} });
      const renderer = await renderScreen();
      await press(renderer, "Push Notifications");

      expect(mocks.registerPushToken).toHaveBeenCalledWith(expect.anything(), {
        apiKey: "api-key",
        expoPushToken: "ExponentPushToken[abc]",
        deviceId: "device-1",
        platform: "ios",
        appVersion: "1.6.5",
      });
      expect(mocks.writePushRegistration).toHaveBeenCalledWith({
        token: "ExponentPushToken[abc]",
        baseUrl: "https://algapsa.com",
        tenantId: "tenant-1",
        userId: "user-1",
      });
      expect(byLabelPrefix(renderer, "Push Notifications").props.accessibilityLabel).toBe("Push Notifications: common:on");
    });

    it("offers to open device settings when permission is denied", async () => {
      mocks.requestPushPermission.mockResolvedValue(false);
      const renderer = await renderScreen();
      await press(renderer, "Push Notifications");
      expect(mocks.registerPushToken).not.toHaveBeenCalled();
      expect(mocks.alert).toHaveBeenCalledWith("Notifications Disabled", expect.any(String), expect.any(Array));
      await pressAlertButton("Open Settings");
      expect(mocks.openSettings).toHaveBeenCalled();
    });

    it("surfaces the server error when registration fails", async () => {
      mocks.requestPushPermission.mockResolvedValue(true);
      mocks.getExpoPushToken.mockResolvedValue("tok");
      mocks.registerPushToken.mockResolvedValue({ ok: false, error: { message: "Server said no" } });
      const renderer = await renderScreen();
      await press(renderer, "Push Notifications");
      expect(mocks.alert).toHaveBeenCalledWith("Couldn't enable push notifications", "Server said no", expect.any(Array));
      expect(mocks.writePushRegistration).not.toHaveBeenCalled();
      expect(byLabelPrefix(renderer, "Push Notifications").props.accessibilityLabel).toBe("Push Notifications: common:off");
    });

    it("unregisters and clears the registration when disabling", async () => {
      mocks.isRegisteredFor.mockReturnValue(true);
      mocks.unregisterPushToken.mockResolvedValue({ ok: true, data: {} });
      const renderer = await renderScreen();
      await press(renderer, "Push Notifications");
      expect(mocks.unregisterPushToken).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key", deviceId: "device-1" });
      expect(mocks.clearPushRegistration).toHaveBeenCalled();
      expect(byLabelPrefix(renderer, "Push Notifications").props.accessibilityLabel).toBe("Push Notifications: common:off");
    });

    it("does nothing without a session", async () => {
      mocks.session = null;
      const renderer = await renderScreen();
      await press(renderer, "Push Notifications");
      expect(mocks.requestPushPermission).not.toHaveBeenCalled();
    });

    it("saves the threshold locally and pushes it to the server when push is on", async () => {
      mocks.isRegisteredFor.mockReturnValue(true);
      mocks.updatePushPriorityThreshold.mockResolvedValue({ ok: true, data: {} });
      const renderer = await renderScreen();
      await press(renderer, "Push me for");
      const select = renderer.root.find((n) => (n.type as unknown) === "Select");
      expect(select.props.visible).toBe(true);
      expect(select.props.options.map((o: { value: string }) => o.value)).toEqual(["low", "normal", "high"]);

      await act(async () => select.props.onSelect("high"));
      await flush();
      expect(mocks.setPushPriorityThreshold).toHaveBeenCalledWith("high");
      expect(mocks.updatePushPriorityThreshold).toHaveBeenCalledWith(expect.anything(), {
        apiKey: "api-key",
        deviceId: "device-1",
        priorityThreshold: "high",
      });

      await act(async () => select.props.onClose());
      expect(renderer.root.find((n) => (n.type as unknown) === "Select").props.visible).toBe(false);
    });

    it("warns when the server threshold update fails", async () => {
      mocks.isRegisteredFor.mockReturnValue(true);
      mocks.updatePushPriorityThreshold.mockResolvedValue({ ok: false, error: { message: "x" } });
      const renderer = await renderScreen();
      const select = renderer.root.find((n) => (n.type as unknown) === "Select");
      await act(async () => select.props.onSelect("normal"));
      await flush();
      expect(texts(renderer)).toContain("Couldn't update the server. The setting applies once push is re-enabled.");
    });

    it("only stores the threshold locally when push is off", async () => {
      const renderer = await renderScreen();
      const select = renderer.root.find((n) => (n.type as unknown) === "Select");
      await act(async () => select.props.onSelect("normal"));
      await flush();
      expect(mocks.setPushPriorityThreshold).toHaveBeenCalledWith("normal");
      expect(mocks.updatePushPriorityThreshold).not.toHaveBeenCalled();
    });

    it("toggles reminder lead times, sorted descending, and resyncs reminders on close", async () => {
      const renderer = await renderScreen();
      expect(texts(renderer)).toContain("15 minutes before");
      await press(renderer, "Calendar reminders");
      const multi = () => renderer.root.find((n) => (n.type as unknown) === "MultiSelect");
      expect(multi().props.visible).toBe(true);

      await act(async () => multi().props.onToggle(60));
      expect(mocks.setReminderLeadMinutes).toHaveBeenLastCalledWith([60, 15]);
      expect(texts(renderer)).toContain("1 hour before, 15 minutes before");

      await act(async () => multi().props.onToggle(15));
      expect(mocks.setReminderLeadMinutes).toHaveBeenLastCalledWith([60]);

      await act(async () => multi().props.onClose());
      expect(mocks.resyncScheduleReminders).toHaveBeenCalledWith({ accessToken: "api-key", tenantId: "tenant-1", userId: "user-1" });
      expect(multi().props.visible).toBe(false);
    });

    it("sends a test notification and shows the result", async () => {
      mocks.sendTestPushNotification.mockResolvedValue({ ok: true, data: { ok: true, deviceCount: 2, results: [] } });
      const renderer = await renderScreen();
      await press(renderer, "Send test notification");
      expect(mocks.sendTestPushNotification).toHaveBeenCalledWith(expect.anything(), { apiKey: "api-key" });
      expect(texts(renderer)).toContain("Sent to 2 device(s). Check your notifications.");
    });

    it("explains when the server does not support test notifications", async () => {
      mocks.sendTestPushNotification.mockResolvedValue({ ok: false, error: { kind: "http", message: "nf", status: 404 } });
      const renderer = await renderScreen();
      await press(renderer, "Send test notification");
      expect(texts(renderer)).toContain(
        "This server doesn't support test notifications yet. Update the server to use this.",
      );
    });
  });

  describe("data and legal", () => {
    it("clears the tickets cache after confirmation", async () => {
      const renderer = await renderScreen();
      await press(renderer, "data.clearCache");
      expect(mocks.clearTicketsCache).not.toHaveBeenCalled();
      await pressAlertButton("common:clear");
      expect(mocks.clearTicketsCache).toHaveBeenCalled();
      expect(mocks.alert).toHaveBeenLastCalledWith("data.cleared", "data.clearedMessage");
    });

    it("opens hosted legal pages and skips them when the base URL is missing", async () => {
      let renderer = await renderScreen();
      await press(renderer, "legal.privacyPolicy");
      await press(renderer, "legal.termsOfService");
      expect(mocks.openURL).toHaveBeenNthCalledWith(1, "https://algapsa.com/static/privacy_policy");
      expect(mocks.openURL).toHaveBeenNthCalledWith(2, "https://algapsa.com/static/master_terms");

      mocks.configOk = false;
      mocks.openURL.mockClear();
      renderer = await renderScreen();
      await press(renderer, "legal.privacyPolicy");
      expect(mocks.openURL).not.toHaveBeenCalled();
    });
  });
});

describe("describeReminderLeads", () => {
  it("returns Off for no leads", () => {
    expect(describeReminderLeads([], mocks.translate as never)).toBe("Off");
  });
});

describe("describeTestPush", () => {
  const t = mocks.translate as never;

  it("reports a request failure with its message", () => {
    expect(describeTestPush(null, { kind: "network", message: "timeout" }, t)).toBe("Request failed: timeout");
    expect(describeTestPush(null, null, t)).toBe("Request failed: unknown");
  });

  it("reports no registered devices", () => {
    expect(describeTestPush({ ok: false, deviceCount: 0, reason: "no_active_tokens", results: [] }, null, t)).toContain(
      "No device is registered",
    );
  });

  it("lists failed platforms for partial and total failures", () => {
    const results = [
      { platform: "ios", status: "ok" as const },
      { platform: "android", status: "error" as const, error: "DeviceNotRegistered" },
      { platform: "web", status: "error" as const, error: null },
    ];
    expect(describeTestPush({ ok: true, deviceCount: 3, results }, null, t)).toBe(
      "Sent to some devices; failed for android: DeviceNotRegistered, web: error",
    );
    expect(describeTestPush({ ok: false, deviceCount: 3, reason: "send_failed", results }, null, t)).toBe(
      "Server could not deliver: android: DeviceNotRegistered, web: error",
    );
  });
});
