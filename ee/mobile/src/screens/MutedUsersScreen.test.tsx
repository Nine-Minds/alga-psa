import React from "react";
import { ActivityIndicator, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  unmute: vi.fn(),
  alert: vi.fn(),
  warn: vi.fn(),
  session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } } as Record<string, unknown> | null,
  mutedUserIds: new Set<string>(),
  translate: (key: string, defOrOpts?: string | Record<string, unknown>, optsArg?: Record<string, unknown>) => {
    const opts = typeof defOrOpts === "object" ? defOrOpts : optsArg;
    let out =
      typeof defOrOpts === "string" ? defOrOpts : typeof opts?.defaultValue === "string" ? opts.defaultValue : key;
    if (opts) {
      for (const [name, value] of Object.entries(opts)) out = out.replaceAll(`{{${name}}}`, String(value));
    }
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return { ...actual, Alert: { alert: (...args: unknown[]) => mocks.alert(...args) } };
});
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ session: mocks.session }) }));
vi.mock("../features/moderation/useModeration", () => ({
  useModeration: () => ({ mutedUserIds: mocks.mutedUserIds, unmute: mocks.unmute }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/users")>()),
  listUsers: (...args: unknown[]) => mocks.listUsers(...args),
}));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() } }));

import { MutedUsersScreen } from "./MutedUsersScreen";

const USERS = [
  { user_id: "u-1", first_name: "Ann", last_name: "Lee", email: "ann@example.com" },
  { user_id: "u-2", first_name: "Bob", last_name: "Ray", email: "bob@example.com" },
];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(MutedUsersScreen));
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

describe("MutedUsersScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };
    mocks.mutedUserIds = new Set(["u-1"]);
    mocks.listUsers.mockResolvedValue({ ok: true, data: { data: USERS } });
    mocks.unmute.mockResolvedValue(undefined);
  });

  it("shows the empty state and skips the lookup when nobody is muted", async () => {
    mocks.mutedUserIds = new Set();
    const renderer = await renderScreen();
    expect(texts(renderer)).toContain("You haven't muted anyone.");
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it("lists only the muted users with name and email", async () => {
    const renderer = await renderScreen();
    expect(mocks.listUsers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiKey: "api-key", limit: 200 }));
    const all = texts(renderer);
    expect(all).toContain("ann@example.com");
    expect(all).not.toContain("bob@example.com");
  });

  it("shows a spinner while names load", async () => {
    mocks.listUsers.mockReturnValue(new Promise(() => undefined));
    const renderer = await renderScreen();
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it("explains the name lookup failure when the API errors", async () => {
    mocks.listUsers.mockResolvedValue({ ok: false, error: { kind: "http", status: 500 } });
    const renderer = await renderScreen();
    expect(texts(renderer).some((s) => s.startsWith("Couldn't look up names"))).toBe(true);
  });

  it("logs and shows the lookup failure when the request throws", async () => {
    mocks.listUsers.mockRejectedValue(new Error("boom"));
    const renderer = await renderScreen();
    expect(mocks.warn).toHaveBeenCalledWith("Failed to load muted users", expect.anything());
    expect(texts(renderer).some((s) => s.startsWith("Couldn't look up names"))).toBe(true);
  });

  it("does not look anything up without a session", async () => {
    mocks.session = null;
    const renderer = await renderScreen();
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(texts(renderer).some((s) => s.startsWith("Couldn't look up names"))).toBe(true);
  });

  it("confirms, then unmutes the tapped user", async () => {
    let finishUnmute!: () => void;
    mocks.unmute.mockReturnValue(new Promise<void>((resolve) => (finishUnmute = resolve)));
    const renderer = await renderScreen();

    const row = renderer.root.find((n) => typeof n.props?.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Unmute ") && n.props.onPress);
    await act(async () => row.props.onPress());

    expect(mocks.alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = mocks.alert.mock.calls[0];
    expect(title).toContain("Unmute");
    expect(buttons[0].style).toBe("cancel");

    await act(async () => buttons[1].onPress());
    expect(mocks.unmute).toHaveBeenCalledWith("u-1");
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);

    await act(async () => {
      finishUnmute();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  });
});
