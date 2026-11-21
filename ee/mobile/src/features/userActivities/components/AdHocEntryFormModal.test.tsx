import React from "react";
import { Alert, Pressable, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  translate: (key: string, defOrOpts?: string | Record<string, unknown>) => {
    if (typeof defOrOpts === "string") return defOrOpts;
    return (defOrOpts?.defaultValue as string | undefined) ?? key;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => React.createElement("DatePickerField", props),
}));
vi.mock("../../../ui/components/TimePickerField", () => ({
  TimePickerField: (props: Record<string, unknown>) => React.createElement("TimePickerField", props),
}));

import { AdHocEntryFormModal, defaultAdHocFormValue, type AdHocFormValue } from "./AdHocEntryFormModal";

type Props = React.ComponentProps<typeof AdHocEntryFormModal>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    visible: true,
    mode: "create",
    initial: defaultAdHocFormValue(),
    saving: false,
    busy: false,
    error: null,
    isDone: false,
    onSubmit: vi.fn(),
    onToggleDone: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function render(props: Props): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<AdHocEntryFormModal {...props} />);
  });
  return r;
}

function button(r: ReactTestRenderer, label: string) {
  return r.root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === label)[0];
}

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAllByType(Text).map((n) => String(n.props.children));
}

describe("AdHocEntryFormModal", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });
  afterEach(() => alertSpy.mockRestore());

  it("defaults to an empty, timeless value", () => {
    expect(defaultAdHocFormValue()).toEqual({
      title: "",
      notes: "",
      date: undefined,
      includeTime: false,
      startTime: "09:00",
      endTime: "10:00",
    });
  });

  it("create mode: save is disabled until a title is typed, then submits the edited value", () => {
    const props = baseProps();
    const r = render(props);
    expect(texts(r)).toContain("New to-do");
    expect(button(r, "Mark done")).toBeUndefined();
    expect(button(r, "Delete")).toBeUndefined();
    expect(button(r, "Save").props.disabled).toBe(true);

    const [titleInput, notesInput] = r.root.findAllByType(TextInput);
    act(() => titleInput.props.onChangeText("  "));
    expect(button(r, "Save").props.disabled).toBe(true);
    act(() => titleInput.props.onChangeText("Buy cables"));
    act(() => notesInput.props.onChangeText("cat6"));
    expect(button(r, "Save").props.disabled).toBe(false);
    act(() => button(r, "Save").props.onPress());
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Buy cables", notes: "cat6" }));

    act(() => button(r, "common:cancel").props.onPress());
    expect(props.onClose).toHaveBeenCalled();
  });

  it("time toggle appears only with a date, validates end > start, and clearing the date drops times", () => {
    const props = baseProps({ initial: { ...defaultAdHocFormValue(), title: "Call" } });
    const r = render(props);
    expect(button(r, "Set a time")).toBeUndefined();

    const date = new Date(2026, 10, 18);
    act(() => r.root.findByType("DatePickerField" as never).props.onChange(date));
    act(() => button(r, "Set a time").props.onPress());
    const pickers = r.root.findAllByType("TimePickerField" as never);
    expect(pickers).toHaveLength(2);
    act(() => pickers[1].props.onChange("08:00"));
    expect(texts(r)).toContain("End time must be after start time.");
    expect(button(r, "Save").props.disabled).toBe(true);

    act(() => r.root.findAllByType("TimePickerField" as never)[0].props.onChange("07:30"));
    expect(button(r, "Save").props.disabled).toBe(false);
    act(() => button(r, "Save").props.onPress());
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ date, includeTime: true, startTime: "07:30", endTime: "08:00" }),
    );

    act(() => r.root.findByType("DatePickerField" as never).props.onChange(undefined));
    expect(r.root.findAllByType("TimePickerField" as never)).toHaveLength(0);
    act(() => button(r, "Save").props.onPress());
    expect(props.onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ date: undefined, includeTime: false }));
  });

  it("edit mode: toggles done state and confirms delete before calling onDelete", () => {
    const initial: AdHocFormValue = { ...defaultAdHocFormValue(), title: "Existing" };
    const props = baseProps({ mode: "edit", initial, isDone: true, error: "Server said no" });
    const r = render(props);
    expect(texts(r)).toContain("Edit to-do");
    expect(texts(r)).toContain("Server said no");

    act(() => button(r, "Mark not done").props.onPress());
    expect(props.onToggleDone).toHaveBeenCalledWith(false);

    act(() => button(r, "Delete").props.onPress());
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(props.onDelete).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] as Array<{ style?: string; onPress?: () => void }>;
    buttons.find((b) => b.style === "destructive")!.onPress!();
    expect(props.onDelete).toHaveBeenCalled();
  });

  it("disables everything and shows a spinner while busy", () => {
    const props = baseProps({ mode: "edit", busy: true, isDone: false, initial: { ...defaultAdHocFormValue(), title: "X" } });
    const r = render(props);
    expect(r.root.findAll((n) => (n.type as unknown) === "ActivityIndicator")).not.toHaveLength(0);
    expect(button(r, "Save").props.disabled).toBe(true);
    expect(button(r, "Mark done").props.disabled).toBe(true);
    expect(texts(r)).toContain("Deleting…");
    expect(r.root.findAllByType(TextInput)[0].props.editable).toBe(false);
  });

  it("resets to the new initial value when reopened", () => {
    const props = baseProps({ initial: { ...defaultAdHocFormValue(), title: "First" } });
    const r = render(props);
    act(() => r.root.findAllByType(TextInput)[0].props.onChangeText("typed"));
    act(() => r.update(<AdHocEntryFormModal {...props} initial={{ ...defaultAdHocFormValue(), title: "Second" }} />));
    expect(r.root.findAllByType(TextInput)[0].props.value).toBe("Second");
  });
});
