import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  dontNotifyCustomerDefault: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defOrOpts?: unknown) => (typeof defOrOpts === "object" && defOrOpts && "name" in defOrOpts ? `${key}:${String((defOrOpts as { name: unknown }).name)}` : key),
  }),
}));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return { ...actual, Alert: { alert: (...args: unknown[]) => mocks.alert(...args) } };
});
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../capabilities/CapabilitiesContext", () => ({
  useDontNotifyCustomerDefault: () => mocks.dontNotifyCustomerDefault,
}));

import { StatusPickerModal } from "./StatusPickerModal";

const STATUSES = [
  { status_id: "s-open", name: "Open", is_closed: false },
  { status_id: "s-wip", name: "In Progress", is_closed: false },
  { status_id: "s-closed", name: "Closed", is_closed: true },
] as never[];

function render(overrides: Partial<React.ComponentProps<typeof StatusPickerModal>> = {}) {
  const props = {
    visible: true,
    loading: false,
    error: null,
    updating: false,
    updateError: null,
    statuses: STATUSES,
    currentStatusId: "s-open",
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<StatusPickerModal {...props} />);
  });
  return { renderer, props };
}

const byLabel = (r: ReactTestRenderer, label: string) =>
  r.root.find((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === "function");
const apply = (r: ReactTestRenderer) => r.root.find((n) => n.props?.testID === "ticket-status-update-apply-button" && typeof n.props?.onPress === "function");
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((n) => [].concat(n.props.children).join(""));

describe("StatusPickerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dontNotifyCustomerDefault = false;
  });

  it("marks the current status and lists open/closed labels", () => {
    const { renderer } = render();
    const all = texts(renderer);
    expect(all).toContain("Open ✓");
    expect(all).toContain("statusPicker.closedLabel");
    expect(apply(renderer).props.disabled).toBe(true);
  });

  it("applies a different open status without confirmation", () => {
    const { renderer, props } = render();
    act(() => byLabel(renderer, "statusPicker.setStatus:In Progress").props.onPress());
    expect(apply(renderer).props.disabled).toBe(false);
    act(() => apply(renderer).props.onPress());
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(props.onApply).toHaveBeenCalledWith("s-wip", undefined);
  });

  it("asks for confirmation before moving to a closed status", () => {
    const { renderer, props } = render();
    act(() => byLabel(renderer, "statusPicker.setStatus:Closed").props.onPress());
    act(() => apply(renderer).props.onPress());
    expect(props.onApply).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    const buttons = mocks.alert.mock.calls[0][2] as Array<{ style?: string; onPress?: () => void }>;
    buttons.find((b) => b.style === "destructive")!.onPress!();
    expect(props.onApply).toHaveBeenCalledWith("s-closed", undefined);
  });

  it("passes customer suppression when the switch is on", () => {
    const { renderer, props } = render();
    act(() => byLabel(renderer, "statusPicker.setStatus:In Progress").props.onPress());
    act(() => {
      renderer.root.find((n) => n.props?.testID === "ticket-suppress-contact-notifications" && n.props?.onValueChange).props.onValueChange(true);
    });
    act(() => apply(renderer).props.onPress());
    expect(props.onApply).toHaveBeenCalledWith("s-wip", { suppressContactNotifications: true, suppressInternalNotifications: false });
  });

  it("starts with the tenant's customer-suppression default for status changes", () => {
    mocks.dontNotifyCustomerDefault = true;
    const { renderer, props } = render();

    expect(renderer.root.find((node) => node.props?.testID === "ticket-suppress-contact-notifications").props.value).toBe(true);
    expect(renderer.root.find((node) => node.props?.testID === "ticket-suppress-internal-notifications").props.value).toBe(false);

    act(() => byLabel(renderer, "statusPicker.setStatus:In Progress").props.onPress());
    act(() => apply(renderer).props.onPress());
    expect(props.onApply).toHaveBeenCalledWith("s-wip", {
      suppressContactNotifications: true,
      suppressInternalNotifications: false,
    });
  });

  it("shows loading, saving and error states and disables rows while busy", () => {
    const loading = render({ loading: true, error: "load failed" });
    expect(texts(loading.renderer)).toEqual(expect.arrayContaining(["common:loading", "load failed"]));
    expect(byLabel(loading.renderer, "statusPicker.setStatus:Open").props.disabled).toBe(true);

    const saving = render({ updating: true, updateError: "save failed" });
    expect(texts(saving.renderer)).toEqual(expect.arrayContaining(["common:saving", "save failed"]));
  });

  it("closes from the close button and the cancel footer", () => {
    const { renderer, props } = render();
    act(() => byLabel(renderer, "common:close").props.onPress());
    act(() => renderer.root.find((n) => n.props?.testID === "ticket-status-update-cancel-button" && n.props?.onPress).props.onPress());
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
