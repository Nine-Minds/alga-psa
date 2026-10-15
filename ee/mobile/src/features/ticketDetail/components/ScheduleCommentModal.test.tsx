import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const translate = (key: string, opts?: Record<string, unknown>) => (opts?.when ? `${key}:${String(opts.when)}` : key);
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => React.createElement("MockDatePicker", props),
}));
vi.mock("../../../ui/components/TimePickerField", () => ({
  TimePickerField: (props: Record<string, unknown>) => React.createElement("MockTimePicker", props),
}));
vi.mock("../../../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) => React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));
vi.mock("../../../ui/formatters/dateTime", () => ({
  formatDateTimeWithRelative: (iso: string) => `fmt(${iso})`,
}));

import { combineDateAndTime, defaultScheduleTime, ScheduleCommentModal } from "./ScheduleCommentModal";

function render(props: Partial<React.ComponentProps<typeof ScheduleCommentModal>> = {}) {
  const onConfirm = vi.fn();
  const onClear = vi.fn();
  const onClose = vi.fn();
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(React.createElement(ScheduleCommentModal, { visible: true, initialValue: null, onConfirm, onClear, onClose, ...props }));
  });
  if (!renderer) throw new Error("no renderer");
  return { renderer: renderer as ReactTestRenderer, onConfirm, onClear, onClose };
}

describe("ScheduleCommentModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T14:07:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the next quarter hour at least an hour out", () => {
    expect(defaultScheduleTime(new Date("2026-09-10T14:07:00")).toISOString()).toBe(new Date("2026-09-10T15:15:00").toISOString());
    expect(combineDateAndTime(new Date("2026-09-12T00:00:00"), "09:30")?.toISOString()).toBe(new Date("2026-09-12T09:30:00").toISOString());
    expect(combineDateAndTime(new Date("2026-09-12T00:00:00"), "9x")).toBeNull();
  });

  it("confirms with the combined date and time and previews the publish moment", () => {
    const { renderer, onConfirm } = render();

    act(() => {
      renderer.root.findByType("MockDatePicker" as never).props.onChange(new Date("2026-09-12T00:00:00"));
      renderer.root.findByType("MockTimePicker" as never).props.onChange("08:45");
    });
    const preview = renderer.root.findByProps({ testID: "schedule-comment-preview" });
    expect(preview.props.children).toBe(`comments.publishesAt:fmt(${new Date("2026-09-12T08:45:00").toISOString()})`);

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: "comments.scheduleConfirm" }).props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledWith(new Date("2026-09-12T08:45:00"));
  });

  it("refuses a time in the past", () => {
    const { renderer, onConfirm } = render();
    act(() => {
      renderer.root.findByType("MockDatePicker" as never).props.onChange(new Date("2026-09-10T00:00:00"));
      renderer.root.findByType("MockTimePicker" as never).props.onChange("08:00");
    });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: "comments.scheduleConfirm" }).props.onPress();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(Text).map((n) => n.props.children)).toContain("comments.scheduleInPast");
  });

  it("offers 'send now instead' only when a schedule already exists", () => {
    const { renderer: fresh } = render();
    expect(fresh.root.findAllByProps({ accessibilityLabel: "comments.scheduleClear" })).toHaveLength(0);

    const { renderer, onClear } = render({ initialValue: new Date("2026-09-11T09:00:00") });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: "comments.scheduleClear" }).props.onPress();
    });
    expect(onClear).toHaveBeenCalled();
  });
});
