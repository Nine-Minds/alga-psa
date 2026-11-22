import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const i18n = vi.hoisted(() => {
  // Stable identity, like production react-i18next.
  const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
  return { t };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: i18n.t }) }));

const mockListTickets = vi.fn();
vi.mock("../../../api/tickets", () => ({ listTickets: (...args: unknown[]) => mockListTickets(...args) }));

vi.mock("../../../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => React.createElement("DatePickerField", props),
}));
vi.mock("../../../ui/components/TimePickerField", () => ({
  TimePickerField: (props: Record<string, unknown>) => React.createElement("TimePickerField", props),
}));
vi.mock("../../../ui/components/EntityPickerModal", () => ({
  EntityPickerModal: (props: Record<string, unknown>) => React.createElement("EntityPickerModal", props),
}));

import { ScheduleEntryFormModal, type ScheduleFormValue } from "./ScheduleEntryFormModal";

const client = { request: vi.fn() } as never;

function initial(overrides: Partial<ScheduleFormValue> = {}): ScheduleFormValue {
  return {
    kind: "meeting",
    title: "Sync",
    date: new Date(2026, 10, 18),
    startTime: "09:00",
    endTime: "10:00",
    notes: "",
    ticketId: null,
    ticketLabel: null,
    ...overrides,
  };
}

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");
const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => String(n.type) === "Pressable" && n.props.accessibilityLabel === label);
const buttonWithText = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (n) => String(n.type) === "Pressable" && n.findAll((c) => String(c.type) === "Text" && c.props.children === label).length > 0,
  );
const inputs = (tree: ReactTestRenderer) => tree.root.findAll((n) => String(n.type) === "TextInput");
const timeFields = (tree: ReactTestRenderer) => tree.root.findAll((n) => String(n.type) === "TimePickerField");
const picker = (tree: ReactTestRenderer) => tree.root.find((n) => String(n.type) === "EntityPickerModal");

function render(props: Partial<React.ComponentProps<typeof ScheduleEntryFormModal>> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <ScheduleEntryFormModal
        visible
        mode="create"
        initial={initial()}
        client={client}
        apiKey="key-1"
        saving={false}
        error={null}
        onSubmit={onSubmit}
        onClose={onClose}
        {...props}
      />,
    );
  });
  return { tree, onSubmit, onClose };
}

describe("ScheduleEntryFormModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTickets.mockResolvedValue({
      ok: true,
      data: { data: [{ ticket_id: "t-1", ticket_number: "T-001", title: "Printer down", client_name: "ECTS" }, { ticket_id: "t-2", ticket_number: "T-002", title: "VPN", client_name: null }] },
    });
  });

  it("create mode: edits fields and submits the edited value", () => {
    const { tree, onSubmit } = render();
    expect(text(tree)).toContain("New schedule entry");
    act(() => pressable(tree, "Break").props.onPress());
    act(() => inputs(tree)[0].props.onChangeText("Lunch"));
    act(() => inputs(tree)[1].props.onChangeText("away"));
    const d = new Date(2026, 10, 20);
    act(() => tree.root.find((n) => String(n.type) === "DatePickerField").props.onChange(d));
    act(() => tree.root.find((n) => String(n.type) === "DatePickerField").props.onChange(null));
    act(() => timeFields(tree)[0].props.onChange("12:00"));
    act(() => timeFields(tree)[1].props.onChange("12:30"));
    act(() => buttonWithText(tree, "Save").props.onPress());
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "break",
      title: "Lunch",
      date: d,
      startTime: "12:00",
      endTime: "12:30",
      notes: "away",
      ticketId: null,
      ticketLabel: null,
    });
  });

  it("disables save for a blank title or end before start, and explains invalid times", () => {
    const { tree } = render();
    act(() => inputs(tree)[0].props.onChangeText("   "));
    expect(buttonWithText(tree, "Save").props.disabled).toBe(true);
    act(() => inputs(tree)[0].props.onChangeText("x"));
    expect(buttonWithText(tree, "Save").props.disabled).toBe(false);
    act(() => timeFields(tree)[1].props.onChange("08:00"));
    expect(buttonWithText(tree, "Save").props.disabled).toBe(true);
    expect(text(tree)).toContain("End time must be after start time.");
  });

  it("edit mode locks the kind chips and shows the edit title", () => {
    const { tree } = render({ mode: "edit" });
    expect(text(tree)).toContain("Edit schedule entry");
    expect(pressable(tree, "Ticket").props.disabled).toBe(true);
  });

  it("saving state disables actions and shows the error", () => {
    const { tree } = render({ saving: true, error: "Unable to save." });
    expect(text(tree)).toContain("common:saving");
    expect(text(tree)).toContain("Unable to save.");
    expect(buttonWithText(tree, "Save").props.disabled).toBe(true);
    expect(buttonWithText(tree, "common:cancel").props.disabled).toBe(true);
  });

  it("cancel closes", () => {
    const { tree, onClose } = render();
    act(() => buttonWithText(tree, "common:cancel").props.onPress());
    expect(onClose).toHaveBeenCalled();
  });

  it("ticket kind requires a ticket picked from the searchable picker", async () => {
    const { tree, onSubmit } = render({ initial: initial({ title: "" }) });
    act(() => pressable(tree, "Ticket").props.onPress());
    expect(buttonWithText(tree, "Save").props.disabled).toBe(true);
    expect(picker(tree).props.visible).toBe(false);
    await act(async () => pressable(tree, "Select ticket").props.onPress());
    expect(picker(tree).props.visible).toBe(true);
    expect(mockListTickets).toHaveBeenCalledWith(client, { apiKey: "key-1", page: 1, limit: 20, search: undefined });
    expect(picker(tree).props.items).toEqual([
      { id: "t-1", label: "T-001 • Printer down", subtitle: "ECTS" },
      { id: "t-2", label: "T-002 • VPN", subtitle: null },
    ]);

    await act(async () => picker(tree).props.onSearch("vpn"));
    expect(mockListTickets).toHaveBeenLastCalledWith(client, expect.objectContaining({ search: "vpn" }));

    act(() => picker(tree).props.onSelect("t-2", "T-002 • VPN"));
    expect(picker(tree).props.visible).toBe(false);
    expect(text(tree)).toContain("T-002 • VPN");
    expect(inputs(tree)[0].props.value).toBe("T-002 • VPN");
    act(() => buttonWithText(tree, "Save").props.onPress());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "ticket", ticketId: "t-2", title: "T-002 • VPN" }));
  });

  it("keeps an existing title when picking a ticket and closes the picker", async () => {
    const { tree } = render({ initial: initial({ kind: "ticket" }) });
    await act(async () => pressable(tree, "Select ticket").props.onPress());
    act(() => picker(tree).props.onSelect("t-1", "T-001 • Printer down"));
    expect(inputs(tree)[0].props.value).toBe("Sync");
    await act(async () => pressable(tree, "T-001 • Printer down").props.onPress());
    act(() => picker(tree).props.onClose());
    expect(picker(tree).props.visible).toBe(false);
  });

  it("shows a ticket load error", async () => {
    mockListTickets.mockResolvedValue({ ok: false, error: { kind: "server" } });
    const { tree } = render({ initial: initial({ kind: "ticket" }) });
    await act(async () => pressable(tree, "Select ticket").props.onPress());
    expect(picker(tree).props.error).toBe("Unable to load tickets.");
    expect(picker(tree).props.loading).toBe(false);
  });

  it("does not search tickets without a client", async () => {
    const { tree } = render({ client: null, initial: initial({ kind: "ticket" }) });
    await act(async () => pressable(tree, "Select ticket").props.onPress());
    expect(mockListTickets).not.toHaveBeenCalled();
  });

  it("resets to the new initial value when reopened", () => {
    const { tree, onSubmit } = render();
    act(() => inputs(tree)[0].props.onChangeText("draft"));
    const next = initial({ title: "Fresh" });
    act(() =>
      tree.update(
        <ScheduleEntryFormModal visible mode="create" initial={next} client={client} apiKey="key-1" saving={false} error={null} onSubmit={onSubmit} onClose={vi.fn()} />,
      ),
    );
    expect(inputs(tree)[0].props.value).toBe("Fresh");
  });
});
