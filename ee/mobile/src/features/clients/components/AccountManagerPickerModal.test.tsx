import React from "react";
import { ActivityIndicator, Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  // Stable identity, like production react-i18next.
  t: (key: string, opts?: { defaultValue?: string; [k: string]: unknown }) => {
    let out = opts?.defaultValue ?? key;
    if (opts) for (const [k, v] of Object.entries(opts)) out = out.replaceAll(`{{${k}}}`, String(v));
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement("MockAvatar", props),
}));
vi.mock("../../../api/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/users")>()),
  listUsers: (...args: unknown[]) => mocks.listUsers(...args),
}));

import { AccountManagerPickerModal } from "./AccountManagerPickerModal";

const client = { request: vi.fn() } as never;
const USERS = [
  { user_id: "u-1", first_name: "Ada", last_name: "Lovelace", username: "ada", email: "ada@x.test", avatarUrl: "/avatars/ada.png" },
  { user_id: "u-2", first_name: null, last_name: null, username: "bob", email: "bob@x.test" },
];

type Props = React.ComponentProps<typeof AccountManagerPickerModal>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    visible: true,
    updating: false,
    updateError: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    client,
    apiKey: "key",
    baseUrl: "https://algapsa.test",
    ...overrides,
  };
}

async function render(props: Props): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(AccountManagerPickerModal, props));
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.join("") : String(c);
  });
}

function userRows(renderer: ReactTestRenderer) {
  return renderer.root
    .findAllByType(Pressable)
    .filter((p) => typeof p.props.accessibilityLabel === "string" && p.props.accessibilityLabel.startsWith("Assign to"));
}

describe("AccountManagerPickerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listUsers.mockResolvedValue({ ok: true, data: { data: USERS } });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads users when visible and renders display names, emails and absolute avatar URLs", async () => {
    const renderer = await render(baseProps());
    expect(mocks.listUsers).toHaveBeenCalledWith(client, expect.objectContaining({ apiKey: "key", search: undefined, limit: 50 }));
    const all = texts(renderer);
    expect(all).toContain("Ada Lovelace");
    expect(all).toContain("ada@x.test");
    expect(all).toContain("bob");
    const avatars = renderer.root.findAll((n) => (n.type as unknown) === "MockAvatar");
    expect(avatars[0].props.imageUri).toBe("https://algapsa.test/avatars/ada.png");
    expect(avatars[1].props.imageUri).toBeUndefined();
  });

  it("omits avatar URIs when there is no base URL", async () => {
    const renderer = await render(baseProps({ baseUrl: null }));
    const avatars = renderer.root.findAll((n) => (n.type as unknown) === "MockAvatar");
    expect(avatars[0].props.imageUri).toBeUndefined();
  });

  it("calls onSelect with the user id and display name", async () => {
    const props = baseProps();
    const renderer = await render(props);
    await act(async () => {
      userRows(renderer)[0].props.onPress();
    });
    expect(props.onSelect).toHaveBeenCalledWith("u-1", "Ada Lovelace");
  });

  it("disables rows and shows spinners while updating, and shows the update error", async () => {
    const renderer = await render(baseProps({ updating: true, updateError: "Could not assign" }));
    const rows = userRows(renderer);
    expect(rows.every((r) => r.props.disabled === true)).toBe(true);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(2);
    expect(texts(renderer)).toContain("Could not assign");
  });

  it("shows a loading state while the first page is in flight", async () => {
    mocks.listUsers.mockReturnValue(new Promise(() => undefined));
    const renderer = await render(baseProps());
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(texts(renderer)).toContain("common:loading");
  });

  it("shows an error when the API fails", async () => {
    mocks.listUsers.mockResolvedValue({ ok: false, error: { kind: "http", status: 500 } });
    const renderer = await render(baseProps());
    expect(texts(renderer)).toContain("Unable to load users");
    expect(userRows(renderer)).toHaveLength(0);
  });

  it("shows an error when the request throws", async () => {
    mocks.listUsers.mockRejectedValue(new Error("network"));
    const renderer = await render(baseProps());
    expect(texts(renderer)).toContain("Unable to load users");
  });

  it("shows an empty message when no users match", async () => {
    mocks.listUsers.mockResolvedValue({ ok: true, data: { data: [] } });
    const renderer = await render(baseProps());
    expect(texts(renderer)).toContain("No matching users");
  });

  it("does not fetch without a client or api key", async () => {
    await render(baseProps({ client: null }));
    await render(baseProps({ apiKey: "" }));
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it("does not fetch while hidden, and clears users when hidden again", async () => {
    const hidden = await render(baseProps({ visible: false }));
    expect(mocks.listUsers).not.toHaveBeenCalled();
    hidden.unmount();

    const props = baseProps();
    const renderer = await render(props);
    expect(userRows(renderer)).toHaveLength(2);
    await act(async () => {
      renderer.update(React.createElement(AccountManagerPickerModal, { ...props, visible: false }));
    });
    expect(userRows(renderer)).toHaveLength(0);
  });

  it("debounces search and sends the trimmed query, aborting the previous request", async () => {
    vi.useFakeTimers();
    const renderer = await render(baseProps());
    const firstSignal = mocks.listUsers.mock.calls[0][1].signal as AbortSignal;
    const input = renderer.root.findByType(TextInput);

    await act(async () => {
      input.props.onChangeText("ad");
    });
    await act(async () => {
      input.props.onChangeText(" ada ");
    });
    expect(renderer.root.findByType(TextInput).props.value).toBe(" ada ");
    await act(async () => {
      vi.advanceTimersByTime(349);
    });
    expect(mocks.listUsers).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(mocks.listUsers).toHaveBeenCalledTimes(2);
    expect(mocks.listUsers.mock.calls[1][1]).toEqual(expect.objectContaining({ search: "ada" }));
    expect(firstSignal.aborted).toBe(true);
  });

  it("closes from the backdrop and the close button", async () => {
    const props = baseProps();
    const renderer = await render(props);
    const backdrop = renderer.root.findAllByType(Pressable)[0];
    await act(async () => {
      backdrop.props.onPress();
    });
    const closeButton = renderer.root.findAllByType(Pressable).find((p) => p.props.accessibilityLabel === "common:close")!;
    await act(async () => {
      closeButton.props.onPress();
    });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
