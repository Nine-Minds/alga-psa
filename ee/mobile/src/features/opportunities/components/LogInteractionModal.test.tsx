import React from "react";
import { Switch, TextInput } from "react-native";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { listInteractionTypesMock, createInteractionMock, getUserPermissionsMock, listUsersMock, translate } = vi.hoisted(() => ({
  listInteractionTypesMock: vi.fn(),
  createInteractionMock: vi.fn(),
  getUserPermissionsMock: vi.fn(),
  listUsersMock: vi.fn(),
  // Stable identity across renders (matches production react-i18next).
  translate: (_key: string, def?: string) => def ?? _key,
}));

vi.mock("../../../api/users", () => ({
  getUserPermissions: (...args: unknown[]) => getUserPermissionsMock(...args),
  listUsers: (...args: unknown[]) => listUsersMock(...args),
  getUserDisplayName: (user: { username: string }) => user.username,
}));

vi.mock("../../../ui/components/DatePickerField", () => ({ DatePickerField: () => null }));
vi.mock("../../../ui/components/TimePickerField", () => ({ TimePickerField: () => null }));
vi.mock("../../../ui/components/EntityPickerModal", () => ({ EntityPickerModal: () => null }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("../../../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../../../ui/themes");
  return { useTheme: () => lightTheme };
});

vi.mock("../../../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../../api/interactions", () => ({
  listInteractionTypes: (...args: unknown[]) => listInteractionTypesMock(...args),
  createInteraction: (...args: unknown[]) => createInteractionMock(...args),
}));

vi.mock("../../../ui/components/Select", async () => {
  const React = await import("react");
  return {
    Select: (props: { options: Array<{ label: string; value: string }>; onSelect: (v: string) => void }) =>
      React.createElement(
        "SelectStub",
        {},
        (props.options ?? []).map((option) =>
          React.createElement(
            "Pressable",
            {
              key: String(option.value),
              testID: `select-option-${option.value}`,
              onPress: () => props.onSelect(option.value),
            },
            option.label,
          ),
        ),
      ),
  };
});

import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { LogInteractionModal } from "./LogInteractionModal";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { TimePickerField } from "../../../ui/components/TimePickerField";
import { EntityPickerModal } from "../../../ui/components/EntityPickerModal";
import { SecondaryButton } from "./SecondaryButton";

type Props = Parameters<typeof LogInteractionModal>[0];

function makeProps(over: Partial<Props> = {}): Props {
  return {
    visible: true,
    client: { request: vi.fn() } as never,
    apiKey: "api-key",
    userId: "user-self",
    opportunityId: "opp-1",
    clientId: "client-1",
    contactNameId: "contact-1",
    onClose: vi.fn(),
    onLogged: vi.fn(),
    ...over,
  };
}

async function render(props: Props): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(LogInteractionModal, props));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function inputByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const input = renderer.root.findAllByType(TextInput).find((n) => n.props.accessibilityLabel === label);
  if (!input) throw new Error(`TextInput "${label}" not found`);
  return input;
}

function pressOption(renderer: ReactTestRenderer, value: string) {
  const option = renderer.root.find((n) => n.props.testID === `select-option-${value}`);
  act(() => option.props.onPress());
}

function submitButton(renderer: ReactTestRenderer): ReactTestInstance {
  const button = renderer.root.findAllByType(PrimaryButton).find((b) => b.props.children === "Log it");
  if (!button) throw new Error("submit button not found");
  return button;
}

describe("LogInteractionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInteractionTypesMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        data: [
          { type_id: "type-call", type_name: "Call" },
          { type_id: "type-email", type_name: "Email" },
        ],
      },
    });
    createInteractionMock.mockResolvedValue({ ok: true, status: 200, data: { data: {} } });
    getUserPermissionsMock.mockResolvedValue({ ok: true, data: { data: { effective_permissions: [] } } });
    listUsersMock.mockResolvedValue({ ok: true, data: { data: [{ user_id: "user-other", username: "Dorothy" }] } });
  });

  it("keeps submit disabled until a type is chosen", async () => {
    const renderer = await render(makeProps());
    expect(submitButton(renderer).props.disabled).toBe(true);

    pressOption(renderer, "type-call");
    expect(submitButton(renderer).props.disabled).toBe(false);
  });

  it("posts the chosen type, deal context, and field values", async () => {
    const props = makeProps();
    const renderer = await render(props);

    pressOption(renderer, "type-call");
    act(() => inputByLabel(renderer, "Title").props.onChangeText("Intro call"));
    act(() => inputByLabel(renderer, "Notes").props.onChangeText("Talked pricing"));
    act(() => inputByLabel(renderer, "Duration (minutes)").props.onChangeText("30"));

    await act(async () => {
      submitButton(renderer).props.onPress();
    });

    expect(createInteractionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          type_id: "type-call",
          opportunity_id: "opp-1",
          client_id: "client-1",
          contact_name_id: "contact-1",
          title: "Intro call",
          notes: "Talked pricing",
          duration: 30,
        }),
      }),
    );
    expect(props.onLogged).toHaveBeenCalled();
  });

  it("preselects the Call type and duration when opened from a call prompt", async () => {
    const renderer = await render(makeProps({ preferTypeName: "Call", initialDuration: 4 }));

    // Call type preselected -> submit already enabled without user interaction.
    expect(submitButton(renderer).props.disabled).toBe(false);
    expect(inputByLabel(renderer, "Duration (minutes)").props.value).toBe("4");
  });

  it("books self with the selected local date and time, without loading other users", async () => {
    const renderer = await render(makeProps({ preferTypeName: "Call" }));
    expect(renderer.root.findByType(Switch).props.value).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("A schedule entry will be added");
    act(() => renderer.root.findByType(Switch).props.onValueChange(true));
    act(() => renderer.root.findByType(DatePickerField).props.onChange(new Date(2026, 9, 12)));
    act(() => renderer.root.findByType(TimePickerField).props.onChange("14:15"));
    await act(async () => submitButton(renderer).props.onPress());
    expect(createInteractionMock.mock.calls[0][1].data).toMatchObject({
      create_schedule_entry: true,
      start_time: new Date(2026, 9, 12, 14, 15).toISOString(),
      schedule_assigned_user_ids: ["user-self"],
    });
    expect(getUserPermissionsMock).toHaveBeenCalledOnce();
    expect(listUsersMock).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(SecondaryButton).some((button) => button.props.testID === "log-interaction-schedule-assignees")).toBe(false);
  });

  it("loads internal users lazily, searches, and books multiple selected calendars with permission", async () => {
    getUserPermissionsMock.mockResolvedValue({ ok: true, data: { data: { effective_permissions: ["user_schedule:update"] } } });
    const renderer = await render(makeProps({ preferTypeName: "Call" }));
    act(() => renderer.root.findByType(Switch).props.onValueChange(true));
    expect(listUsersMock).not.toHaveBeenCalled();
    const openPicker = renderer.root.findAllByType(SecondaryButton).find((button) => button.props.testID === "log-interaction-schedule-assignees")!;
    await act(async () => openPicker.props.onPress());
    expect(listUsersMock).toHaveBeenCalledOnce();
    await act(async () => renderer.root.findByType(EntityPickerModal).props.onSearch("Dorothy"));
    expect(listUsersMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ search: "Dorothy" }));
    act(() => renderer.root.findByType(EntityPickerModal).props.onSelect("user-other", "Dorothy"));
    expect(JSON.stringify(renderer.toJSON())).toContain("selected users' AlgaPSA calendars");
    await act(async () => submitButton(renderer).props.onPress());
    expect(createInteractionMock.mock.calls[0][1].data.schedule_assigned_user_ids).toEqual(["user-self", "user-other"]);
    expect(getUserPermissionsMock).toHaveBeenCalledOnce();
  });

  it("omits booking options when the toggle is off and resets selection on reopen", async () => {
    getUserPermissionsMock.mockResolvedValue({ ok: true, data: { data: { effective_permissions: ["user_schedule:update"] } } });
    const props = makeProps({ preferTypeName: "Call" });
    const renderer = await render(props);
    act(() => renderer.root.findByType(Switch).props.onValueChange(true));
    act(() => renderer.root.findByType(EntityPickerModal).props.onSelect("user-other", "Dorothy"));
    act(() => renderer.root.findByType(Switch).props.onValueChange(false));
    await act(async () => submitButton(renderer).props.onPress());
    expect(createInteractionMock.mock.calls[0][1].data).not.toHaveProperty("create_schedule_entry");
    expect(createInteractionMock.mock.calls[0][1].data).not.toHaveProperty("schedule_assigned_user_ids");
    await act(async () => renderer.update(React.createElement(LogInteractionModal, { ...props, visible: false })));
    await act(async () => renderer.update(React.createElement(LogInteractionModal, props)));
    expect(renderer.root.findByType(Switch).props.value).toBe(false);
    act(() => renderer.root.findByType(Switch).props.onValueChange(true));
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Dorothy");
    expect(getUserPermissionsMock).toHaveBeenCalledTimes(2);
  });

  it("disables scheduling with invalid times or duration and keeps failures open", async () => {
    const props = makeProps({ preferTypeName: "Call" });
    const renderer = await render(props);
    act(() => renderer.root.findByType(Switch).props.onValueChange(true));
    act(() => renderer.root.findByType(TimePickerField).props.onChange("25:00"));
    expect(submitButton(renderer).props.disabled).toBe(true);
    act(() => renderer.root.findByType(TimePickerField).props.onChange("10:00"));
    act(() => inputByLabel(renderer, "Duration (minutes)").props.onChangeText("0"));
    expect(submitButton(renderer).props.disabled).toBe(true);
    act(() => inputByLabel(renderer, "Duration (minutes)").props.onChangeText("30"));
    createInteractionMock.mockResolvedValue({ ok: false, error: { kind: "http", status: 403, message: "Permission denied" } });
    await act(async () => submitButton(renderer).props.onPress());
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onLogged).not.toHaveBeenCalled();
    expect(submitButton(renderer).props.disabled).toBe(false);
  });

  it("keeps self scheduling available when permissions cannot be loaded", async () => {
    getUserPermissionsMock.mockResolvedValue({ ok: false, error: { kind: "http", status: 403 } });
    const renderer = await render(makeProps({ preferTypeName: "Call" }));
    act(() => renderer.root.findByType(Switch).props.onValueChange(true));
    expect(renderer.root.findByType(EntityPickerModal).props.visible).toBe(false);
    await act(async () => submitButton(renderer).props.onPress());
    expect(createInteractionMock.mock.calls[0][1].data.schedule_assigned_user_ids).toEqual(["user-self"]);
  });
});
