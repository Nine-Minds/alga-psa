import React from "react";
import { Pressable, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { TicketChecklistItem } from "../../../api/ticketChecklist";

vi.mock("../../../ui/components/Card", () => ({
  Card: (props: Record<string, unknown>) => React.createElement("MockCard", props, props.children as React.ReactNode),
}));
vi.mock("../../../ui/components/SectionHeader", () => ({
  SectionHeader: (props: Record<string, unknown>) => React.createElement("MockSectionHeader", props, props.action as React.ReactNode),
}));

import { ChecklistSection } from "./ChecklistSection";

const item = (overrides: Partial<TicketChecklistItem> = {}): TicketChecklistItem => ({
  checklist_item_id: "item-1",
  ticket_id: "ticket-1",
  item_name: "Confirm backup",
  description: null,
  order_number: 1,
  assigned_to: null,
  is_required: true,
  completed: false,
  completed_by: null,
  completed_at: null,
  source: "manual",
  template_id: null,
  ...overrides,
});

function render(overrides: Partial<React.ComponentProps<typeof ChecklistSection>> = {}): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(ChecklistSection, {
      items: [item()],
      loading: false,
      hidden: false,
      error: null,
      actionError: null,
      adding: false,
      updatingIds: new Set<string>(),
      onAdd: vi.fn().mockResolvedValue(true),
      onToggle: vi.fn(),
      ...overrides,
    }));
  });
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

describe("ChecklistSection", () => {
  it("renders required progress and calls the one-tap completion action", () => {
    const onToggle = vi.fn();
    const renderer = render({ onToggle });
    const checkbox = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityRole === "checkbox");
    expect(checkbox?.props.accessibilityState.checked).toBe(false);
    act(() => checkbox?.props.onPress());
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ checklist_item_id: "item-1" }));
  });

  it("disables a checklist item while its update is in flight", () => {
    const renderer = render({ updatingIds: new Set(["item-1"]) });
    const checkbox = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityRole === "checkbox");
    expect(checkbox?.props.disabled).toBe(true);
  });

  it("adds a required item only after the Add button is pressed", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    const renderer = render({ items: [], onAdd });
    const addAffordance = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === "Add item");
    act(() => addAffordance?.props.onPress());
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText("Verify restore"));
    const required = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === "Required");
    act(() => required?.props.onPress());
    expect(onAdd).not.toHaveBeenCalled();

    const addButtons = renderer.root.findAllByType(Pressable).filter((node) => node.props.accessibilityLabel === "Add item");
    await act(async () => {
      addButtons.at(-1)?.props.onPress();
      await Promise.resolve();
    });
    expect(onAdd).toHaveBeenCalledWith("Verify restore", true);
  });

  it("renders nothing when checklist read is forbidden", () => {
    expect(render({ hidden: true }).toJSON()).toBeNull();
  });
});
