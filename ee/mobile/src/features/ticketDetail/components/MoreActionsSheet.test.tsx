import React from "react";
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
void afterEach;

vi.mock("../../../clipboard/clipboard", () => ({ copyToClipboard: (...args: unknown[]) => mocks.copy(...args) }));

import { MoreActionsSheet } from "./MoreActionsSheet";

function render(overrides: Partial<React.ComponentProps<typeof MoreActionsSheet>> = {}) {
  const props = {
    visible: true, onClose: vi.fn(), baseUrl: "https://psa.example.com", ticketId: "t-1", ticketNumber: "T-0042",
    isWatching: false, watchUpdating: false, onToggleWatch: vi.fn(), ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MoreActionsSheet {...props} />); });
  return { renderer, props };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("MoreActionsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copy.mockImplementation(async (_kind: string, value: string) => ({ copiedText: value }));
  });

  it("toggles watch and closes the sheet", () => {
    const { renderer, props } = render();
    act(() => byLabel(renderer, "detail.watch").props.onPress());
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onToggleWatch).toHaveBeenCalled();
  });

  it("shows unwatch and disables the row while updating", () => {
    const { renderer } = render({ isWatching: true, watchUpdating: true });
    expect(byLabel(renderer, "detail.unwatch").props.disabled).toBe(true);
    const disabled = render({ watchDisabled: true });
    expect(byLabel(disabled.renderer, "detail.watch").props.disabled).toBe(true);
  });

  it("copies the ticket number and id and confirms", async () => {
    const { renderer } = render();
    act(() => byLabel(renderer, "detail.copyNumber").props.onPress());
    await flush();
    expect(mocks.copy).toHaveBeenCalledWith("ticket_number", "T-0042");
    expect(mocks.alert).toHaveBeenLastCalledWith("common:copied", "T-0042");

    act(() => byLabel(renderer, "detail.copyId").props.onPress());
    await flush();
    expect(mocks.copy).toHaveBeenCalledWith("ticket_id", "t-1");
    expect(mocks.alert).toHaveBeenLastCalledWith("common:copied", "t-1");
  });

  it("opens the ticket in the web app after confirmation", () => {
    const { renderer } = render();
    act(() => byLabel(renderer, "detail.openInWeb").props.onPress());
    const [, url, buttons] = mocks.alert.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
    expect(url).toContain("https://psa.example.com");
    expect(url).toContain("t-1");
    buttons.find((b) => b.text === "common:open")!.onPress!();
    expect(mocks.openURL).toHaveBeenCalledWith(url);
  });

  it("hides open-in-web without a base URL", () => {
    const { renderer } = render({ baseUrl: null });
    expect(renderer.root.findAll((n) => n.props?.accessibilityLabel === "detail.openInWeb")).toHaveLength(0);
  });

  it("closes from the backdrop", () => {
    const { renderer, props } = render();
    act(() => byLabel(renderer, "common:close").props.onPress());
    expect(props.onClose).toHaveBeenCalled();
  });
});
