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

vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => React.createElement("MockDatePicker", props),
}));
vi.mock("../../../ui/formatters/dateTime", () => ({
  formatDateTimeWithRelative: (iso: string | null) => `fmt(${iso})`,
}));

import { DueDateModal } from "./DueDateModal";

function render(overrides: Partial<React.ComponentProps<typeof DueDateModal>> = {}) {
  const props = {
    visible: true, currentDueDateIso: "2026-09-20T00:00:00.000Z", updating: false, error: null,
    onSave: vi.fn(), onClose: vi.fn(), ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<DueDateModal {...props} />); });
  return { renderer, props };
}
const save = (r: ReactTestRenderer) => byTestId(r, "ticket-due-date-update-apply-button");
const picker = (r: ReactTestRenderer) => r.root.findByType("MockDatePicker" as never);

describe("DueDateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T14:07:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("seeds the picker from the current due date and shows it", () => {
    const { renderer } = render();
    expect((picker(renderer).props.value as Date).toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(texts(renderer)).toContain("dueDateModal.current:fmt(2026-09-20T00:00:00.000Z)");
  });

  it("ignores an invalid current date", () => {
    const { renderer } = render({ currentDueDateIso: "not-a-date" });
    expect(picker(renderer).props.value).toBeUndefined();
  });

  it.each([
    ["dueDateModal.today", 0],
    ["dueDateModal.tomorrow", 1],
    ["dueDateModal.plus7Days", 7],
  ])("quick chip %s saves local midnight +%i days", (label, days) => {
    const { renderer, props } = render({ currentDueDateIso: null });
    act(() => byLabel(renderer, label).props.onPress());
    act(() => save(renderer).props.onPress());
    const expected = new Date("2026-09-10T00:00:00");
    expected.setDate(expected.getDate() + days);
    expect(props.onSave).toHaveBeenCalledWith(expected.toISOString(), undefined);
  });

  it("normalizes a picked date to midnight", () => {
    const { renderer, props } = render();
    act(() => picker(renderer).props.onChange(new Date("2026-10-01T15:30:00")));
    act(() => save(renderer).props.onPress());
    expect(props.onSave).toHaveBeenCalledWith(new Date("2026-10-01T00:00:00").toISOString(), undefined);
  });

  it("clears the due date and saves null", () => {
    const { renderer, props } = render();
    expect(byLabel(renderer, "common:clear").props.disabled).toBe(false);
    act(() => byLabel(renderer, "common:clear").props.onPress());
    expect(byLabel(renderer, "common:clear").props.disabled).toBe(true);
    act(() => save(renderer).props.onPress());
    expect(props.onSave).toHaveBeenCalledWith(null, undefined);
  });

  it("shows saving and error state and disables the chips", () => {
    const { renderer } = render({ updating: true, error: "bad date" });
    expect(texts(renderer)).toEqual(expect.arrayContaining(["common:saving", "bad date"]));
    expect(byLabel(renderer, "dueDateModal.today").props.disabled).toBe(true);
    expect(picker(renderer).props.disabled).toBe(true);
  });
});
