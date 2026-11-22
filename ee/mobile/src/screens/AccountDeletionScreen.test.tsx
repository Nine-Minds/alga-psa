import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
  logout: vi.fn(),
  reset: vi.fn(),
  alert: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  configOk: true,
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as Record<string, unknown> | null,
  translate: (key: string, def?: unknown) => (typeof def === "string" ? def : key),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return { ...actual, Alert: { alert: (...args: unknown[]) => mocks.alert(...args) } };
});
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ reset: mocks.reset }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ session: mocks.session, logout: mocks.logout }) }));
vi.mock("../config/appConfig", () => ({
  getAppConfig: () => (mocks.configOk ? { ok: true, env: "dev", baseUrl: "https://algapsa.com" } : { ok: false }),
}));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/iap", () => ({ deleteAccount: (...args: unknown[]) => mocks.deleteAccount(...args) }));
vi.mock("../logging/logger", () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn, info: vi.fn(), debug: vi.fn() },
}));

import { AccountDeletionScreen } from "./AccountDeletionScreen";

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AccountDeletionScreen));
  });
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

function deleteButton(renderer: ReactTestRenderer) {
  return renderer.root.find((n) => n.props?.accessibilityLabel === "Delete account" && n.props?.accessibilityRole === "button");
}

/** Press the button and accept the destructive confirmation. */
async function pressAndConfirm(renderer: ReactTestRenderer) {
  await act(async () => deleteButton(renderer).props.onPress());
  const buttons = mocks.alert.mock.calls[0][2];
  expect(buttons[1].style).toBe("destructive");
  await act(async () => {
    buttons[1].onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AccountDeletionScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configOk = true;
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.logout.mockResolvedValue(undefined);
  });

  it("asks for confirmation and does nothing on cancel", async () => {
    const renderer = await renderScreen();
    await act(async () => deleteButton(renderer).props.onPress());
    const buttons = mocks.alert.mock.calls[0][2];
    expect(buttons[0].style).toBe("cancel");
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it("disables the button without a session", async () => {
    mocks.session = null;
    const renderer = await renderScreen();
    expect(deleteButton(renderer).props.disabled).toBe(true);
  });

  it("shows the not-signed-in error when config is unavailable", async () => {
    mocks.configOk = false;
    const renderer = await renderScreen();
    await pressAndConfirm(renderer);
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain("You must be signed in to delete your account.");
  });

  it("shows the failure message when the API rejects the deletion", async () => {
    mocks.deleteAccount.mockResolvedValue({ ok: false, error: { kind: "http", status: 500 } });
    const renderer = await renderScreen();
    await pressAndConfirm(renderer);
    expect(texts(renderer)).toContain("Unable to delete your account. Please try again.");
    expect(deleteButton(renderer).props.disabled).toBe(false);
  });

  it("logs and shows the failure message when the request throws", async () => {
    mocks.deleteAccount.mockRejectedValue(new Error("network"));
    const renderer = await renderScreen();
    await pressAndConfirm(renderer);
    expect(mocks.loggerError).toHaveBeenCalledWith("deleteAccount threw", expect.anything());
    expect(texts(renderer)).toContain("Unable to delete your account. Please try again.");
  });

  it("on success shows server cancel instructions, then logs out and resets to SignIn", async () => {
    mocks.deleteAccount.mockResolvedValue({ ok: true, data: { subscriptionCancellationInstructions: "Cancel in Play" } });
    const renderer = await renderScreen();
    await pressAndConfirm(renderer);

    const [title, message, buttons, options] = mocks.alert.mock.calls[1];
    expect(title).toBe("Account deleted");
    expect(message).toBe("Cancel in Play");
    expect(options).toEqual({ cancelable: false });

    await act(async () => {
      buttons[0].onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.logout).toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "SignIn" }] });
  });

  it("falls back to the Apple instructions and still resets when logout fails", async () => {
    mocks.deleteAccount.mockResolvedValue({ ok: true, data: {} });
    mocks.logout.mockRejectedValue(new Error("nope"));
    const renderer = await renderScreen();
    await pressAndConfirm(renderer);

    const [, message, buttons] = mocks.alert.mock.calls[1];
    expect(message).toContain("Apple ID > Subscriptions");
    await act(async () => {
      buttons[0].onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith("Logout after deletion failed", expect.anything());
    expect(mocks.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "SignIn" }] });
  });
});
