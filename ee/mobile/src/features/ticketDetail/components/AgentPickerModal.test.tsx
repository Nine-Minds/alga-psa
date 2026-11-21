import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn(),
  copy: vi.fn(),
  listUsers: vi.fn(),
  // Stable identity, like production react-i18next.
  t: (key: string, defOrOpts?: unknown, maybeOpts?: unknown) => {
    const opts = (typeof defOrOpts === "object" ? defOrOpts : maybeOpts) as Record<string, unknown> | undefined;
    const extra = opts ? Object.values(opts).map(String).join(",") : "";
    return extra ? `${key}:${extra}` : key;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return {
    ...actual,
    Alert: { alert: (...args: unknown[]) => mocks.alert(...args) },
    Linking: { openURL: (...args: unknown[]) => mocks.openURL(...args) },
  };
});
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});

const byLabel = (r: ReactTestRenderer, label: string) =>
  r.root.find((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === "function");
const byTestId = (r: ReactTestRenderer, id: string) =>
  r.root.find((n) => n.props?.testID === id && (typeof n.props?.onPress === "function" || typeof n.props?.onChangeText === "function" || typeof n.props?.onValueChange === "function"));
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((n) => ([] as unknown[]).concat(n.props.children).join(""));
void afterEach;
vi.mock("../../../api/users", () => ({
  listUsers: (...args: unknown[]) => mocks.listUsers(...args),
  getUserDisplayName: (u: { first_name?: string; last_name?: string; username: string }) =>
    u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.username,
}));
vi.mock("../../../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement("MockAvatar", props),
}));

import { AgentPickerModal } from "./AgentPickerModal";

const USERS = [
  { user_id: "u-1", first_name: "Ann", last_name: "Lee", username: "ann", email: "ann@x.io", avatarUrl: "/avatars/u-1.png" },
  { user_id: "u-2", username: "bob", email: "bob@x.io" },
];

const client = { request: vi.fn() } as never;

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function render(overrides: Partial<React.ComponentProps<typeof AgentPickerModal>> = {}) {
  const props = {
    visible: true, updating: false, updateError: null, currentAssignedToId: "u-2", currentAssignedToName: "bob",
    onApply: vi.fn(), onClose: vi.fn(), client, apiKey: "key", baseUrl: "https://psa.example.com", ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<AgentPickerModal {...props} />); });
  await flush();
  return { renderer, props };
}
const apply = (r: ReactTestRenderer) => byTestId(r, "ticket-agent-update-apply-button");
const confirmLast = (style?: string) => {
  const buttons = mocks.alert.mock.calls.at(-1)![2] as Array<{ text: string; style?: string; onPress?: () => void }>;
  buttons.find((b) => (style ? b.style === style : b.style !== "cancel"))!.onPress!();
};

describe("AgentPickerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.listUsers.mockResolvedValue({ ok: true, data: { data: USERS } });
  });
  afterEach(() => vi.useRealTimers());

  it("loads users on open and renders names, emails and avatar urls", async () => {
    const { renderer } = await render();
    expect(mocks.listUsers).toHaveBeenCalledWith(client, expect.objectContaining({ apiKey: "key", search: undefined, limit: 50 }));
    expect(texts(renderer)).toEqual(expect.arrayContaining(["Ann Lee", "ann@x.io", "bob", "agentPicker.currentlyAssigned:bob"]));
    const avatars = renderer.root.findAllByType("MockAvatar" as never);
    expect(avatars[0].props.imageUri).toBe("https://psa.example.com/avatars/u-1.png");
    expect(avatars[1].props.imageUri).toBeUndefined();
  });

  it("debounces search and queries with the trimmed text", async () => {
    const { renderer } = await render();
    act(() => renderer.root.find((n) => n.props?.placeholder === "agentPicker.searchPlaceholder" && n.props.onChangeText).props.onChangeText(" an"));
    act(() => renderer.root.find((n) => n.props?.placeholder === "agentPicker.searchPlaceholder" && n.props.onChangeText).props.onChangeText(" ann "));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(mocks.listUsers).toHaveBeenCalledTimes(2);
    expect(mocks.listUsers.mock.calls[1][1]).toMatchObject({ search: "ann" });
  });

  it("shows an error when the user list fails or throws", async () => {
    mocks.listUsers.mockResolvedValueOnce({ ok: false });
    const a = await render();
    expect(texts(a.renderer)).toContain("agentPicker.unableToLoad");
    mocks.listUsers.mockRejectedValueOnce(new Error("net"));
    const b = await render();
    expect(texts(b.renderer)).toContain("agentPicker.unableToLoad");
  });

  it("shows no results for an empty list", async () => {
    mocks.listUsers.mockResolvedValueOnce({ ok: true, data: { data: [] } });
    const { renderer } = await render();
    expect(texts(renderer)).toContain("agentPicker.noResults");
  });

  it("does not fetch without a client", async () => {
    await render({ client: null });
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it("confirms before replacing an existing assignee", async () => {
    const { renderer, props } = await render();
    expect(apply(renderer).props.disabled).toBe(true);
    act(() => byLabel(renderer, "agentPicker.assignTo:Ann Lee").props.onPress());
    expect(texts(renderer)).toContain("agentPicker.selected:Ann Lee");
    act(() => apply(renderer).props.onPress());
    expect(props.onApply).not.toHaveBeenCalled();
    confirmLast();
    expect(props.onApply).toHaveBeenCalledWith("u-1", undefined);
  });

  it("assigns directly when the ticket is unassigned", async () => {
    const { renderer, props } = await render({ currentAssignedToId: null, currentAssignedToName: null });
    expect(renderer.root.findAll((n) => n.props?.accessibilityLabel === "agentPicker.unassign")).toHaveLength(0);
    act(() => byLabel(renderer, "agentPicker.assignTo:bob").props.onPress());
    act(() => apply(renderer).props.onPress());
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(props.onApply).toHaveBeenCalledWith("u-2", undefined);
  });

  it("confirms unassigning and applies null", async () => {
    const { renderer, props } = await render();
    act(() => byLabel(renderer, "agentPicker.unassign").props.onPress());
    expect(texts(renderer)).toContain("agentPicker.unassignSelected");
    act(() => apply(renderer).props.onPress());
    confirmLast("destructive");
    expect(props.onApply).toHaveBeenCalledWith(null, undefined);
  });

  it("in selection-only mode reports picks without a footer", async () => {
    const onSelect = vi.fn();
    const onUnassign = vi.fn();
    const { renderer } = await render({ onApply: undefined, onSelect, onUnassign });
    expect(renderer.root.findAll((n) => n.props?.testID === "ticket-agent-update-apply-button")).toHaveLength(0);
    act(() => byLabel(renderer, "agentPicker.assignTo:Ann Lee").props.onPress());
    expect(onSelect).toHaveBeenCalledWith("u-1", "Ann Lee");
    act(() => byLabel(renderer, "agentPicker.unassign").props.onPress());
    expect(onUnassign).toHaveBeenCalled();
  });

  it("shows the update error and clears the list when hidden", async () => {
    const { renderer, props } = await render({ updateError: "forbidden" });
    expect(texts(renderer)).toContain("forbidden");
    await act(async () => { renderer.update(<AgentPickerModal {...props} visible={false} />); });
    expect(texts(renderer)).not.toContain("Ann Lee");
  });
});
