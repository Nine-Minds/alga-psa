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

import { PriorityPickerModal } from "./PriorityPickerModal";

const PRIORITIES = [
  { priority_id: "p-low", priority_name: "Low" },
  { priority_id: "p-high", priority_name: "High" },
] as never[];

function render(overrides: Partial<React.ComponentProps<typeof PriorityPickerModal>> = {}) {
  const props = {
    visible: true, loading: false, error: null, priorities: PRIORITIES, currentPriorityId: "p-low",
    updating: false, updateError: null, onApply: vi.fn(), onClose: vi.fn(), ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<PriorityPickerModal {...props} />); });
  return { renderer, props };
}
const apply = (r: ReactTestRenderer) => byTestId(r, "ticket-priority-update-apply-button");

describe("PriorityPickerModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables apply until a different priority is picked, then applies it", () => {
    const { renderer, props } = render();
    expect(texts(renderer)).toContain("Low ✓");
    expect(apply(renderer).props.disabled).toBe(true);
    act(() => byLabel(renderer, "priorityPicker.setPriority:High").props.onPress());
    expect(texts(renderer)).toContain("High ✓");
    act(() => apply(renderer).props.onPress());
    expect(props.onApply).toHaveBeenCalledWith("p-high", undefined);
  });

  it("does nothing on apply when nothing is selected", () => {
    const { renderer, props } = render({ currentPriorityId: null });
    act(() => apply(renderer).props.onPress());
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("re-seeds the selection when reopened", () => {
    const { renderer, props } = render();
    act(() => byLabel(renderer, "priorityPicker.setPriority:High").props.onPress());
    act(() => renderer.update(<PriorityPickerModal {...props} visible={false} />));
    act(() => renderer.update(<PriorityPickerModal {...props} visible />));
    expect(texts(renderer)).toContain("Low ✓");
  });

  it("shows loading/saving with errors and disables rows while busy", () => {
    const a = render({ loading: true, error: "boom" });
    expect(texts(a.renderer)).toEqual(expect.arrayContaining(["common:loading", "boom"]));
    expect(byLabel(a.renderer, "priorityPicker.setPriority:High").props.disabled).toBe(true);
    const b = render({ updating: true, updateError: "nope" });
    expect(texts(b.renderer)).toEqual(expect.arrayContaining(["common:saving", "nope"]));
  });

  it("cancels via the footer", () => {
    const { renderer, props } = render();
    act(() => byTestId(renderer, "ticket-priority-update-cancel-button").props.onPress());
    expect(props.onClose).toHaveBeenCalled();
  });
});
