import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ alert: vi.fn() }));

const i18n = vi.hoisted(() => {
  // Stable identity, like production react-i18next.
  const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
  return { t };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: i18n.t }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return { ...actual, Alert: { alert: (...args: unknown[]) => mocks.alert(...args) } };
});
vi.mock("./InteractionEntryContext", () => ({
  InteractionEntryContext: (props: Record<string, unknown>) => React.createElement("InteractionEntryContext", props),
}));

import type { ScheduleEntry } from "../../../api/schedule";
import { ScheduleEntryDetailModal, entryKindIcon } from "./ScheduleEntryDetailModal";

function entry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    entry_id: "e-1",
    title: "Standup",
    scheduled_start: "2026-11-18T09:00:00.000Z",
    scheduled_end: "2026-11-18T09:30:00.000Z",
    work_item_id: null,
    work_item_type: "meeting",
    notes: null,
    is_private: false,
    created_by: "u-1",
    assigned_users: [],
    ...overrides,
  };
}

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((n) => String(n.type) === "Text")
    .map((n) => [].concat(n.props.children ?? []).join(""))
    .join("\n");

function button(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (n) =>
      String(n.type) === "Pressable" &&
      n.props.accessibilityRole === "button" &&
      n.findAll((c) => String(c.type) === "Text" && c.props.children === label).length > 0,
  );
}
const hasButton = (tree: ReactTestRenderer, label: string) => {
  try {
    button(tree, label);
    return true;
  } catch {
    return false;
  }
};

function render(props: Partial<React.ComponentProps<typeof ScheduleEntryDetailModal>> = {}) {
  const handlers = {
    onOpenTicket: vi.fn(),
    onOpenProjectTask: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onManage: vi.fn(),
    onClose: vi.fn(),
  };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <ScheduleEntryDetailModal
        visible
        entry={entry()}
        currentUserId="u-1"
        busy={false}
        error={null}
        {...handlers}
        {...props}
      />,
    );
  });
  return { tree, ...handlers };
}

describe("ScheduleEntryDetailModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing without an entry", () => {
    const { tree } = render({ entry: null });
    expect(tree.toJSON()).toBeNull();
  });

  it("shows title, kind, notes and assignees with name fallbacks", () => {
    const { tree } = render({
      entry: entry({
        notes: "Bring laptop",
        is_private: true,
        assigned_users: [
          { user_id: "u-1", first_name: "Ann", last_name: "Lee" },
          { user_id: "u-2", email: "bob@example.com" },
          { user_id: "u-3" },
        ],
      }),
    });
    const all = text(tree);
    expect(all).toContain("Standup");
    expect(all).toContain("Meeting");
    expect(all).toContain("Private");
    expect(all).toContain("Bring laptop");
    expect(all).toContain("Ann Lee, bob@example.com, u-3");
  });

  it.each([
    ["break", "Break", "coffee"],
    ["other", "Other", "calendar"],
    ["interaction", "Interaction", "phone"],
    [null, "Ad-hoc", "calendar"],
    ["ad_hoc", "Ad-hoc", "calendar"],
    ["custom_type", "custom_type", "calendar"],
  ])("labels %s entries", (type, label, icon) => {
    const e = entry({ work_item_type: type as string | null });
    const { tree } = render({ entry: e });
    expect(text(tree)).toContain(label);
    expect(entryKindIcon(e)).toBe(icon);
  });

  it("editable own ad-hoc entry: edit and confirmed delete", () => {
    const { tree, onEdit, onDelete } = render();
    act(() => button(tree, "Edit").props.onPress());
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ entry_id: "e-1" }));

    act(() => button(tree, "Delete").props.onPress());
    expect(mocks.alert).toHaveBeenCalledWith("Delete entry?", "This schedule entry will be permanently removed.", expect.any(Array));
    const buttons = mocks.alert.mock.calls[0][2];
    expect(buttons[0].style).toBe("cancel");
    expect(onDelete).not.toHaveBeenCalled();
    buttons[1].onPress();
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ entry_id: "e-1" }));
  });

  it("shows deleting label and disables buttons while busy, plus the error", () => {
    const { tree } = render({ busy: true, error: "Unable to delete" });
    expect(text(tree)).toContain("Deleting…");
    expect(text(tree)).toContain("Unable to delete");
    expect(button(tree, "Edit").props.disabled).toBe(true);
  });

  it("other users' entries are read-only", () => {
    const { tree } = render({ currentUserId: "someone-else" });
    expect(text(tree)).toContain("This entry is read-only on mobile.");
    expect(hasButton(tree, "Edit")).toBe(false);
    expect(hasButton(tree, "Delete")).toBe(false);
  });

  it("recurring entries are read-only with the recurring note", () => {
    const { tree } = render({ entry: entry({ recurrence_pattern: { frequency: "weekly" } }) });
    expect(text(tree)).toContain("Recurring");
    expect(text(tree)).toContain("Recurring entries are read-only on mobile.");
    expect(hasButton(tree, "Edit")).toBe(false);
  });

  it("ticket entries open the ticket", () => {
    const { tree, onOpenTicket } = render({ entry: entry({ work_item_type: "ticket", work_item_id: "t-9" }) });
    expect(text(tree)).toContain("Ticket");
    expect(entryKindIcon(entry({ work_item_type: "ticket" }))).toBe("tag");
    act(() => button(tree, "Open ticket").props.onPress());
    expect(onOpenTicket).toHaveBeenCalledWith("t-9");
  });

  it("project task entries open the task when a handler is given", () => {
    const e = entry({ work_item_type: "project_task", work_item_id: "pt-1" });
    const { tree, onOpenProjectTask } = render({ entry: e });
    expect(text(tree)).toContain("Project task");
    expect(entryKindIcon(e)).toBe("clipboard");
    act(() => button(tree, "Open task").props.onPress());
    expect(onOpenProjectTask).toHaveBeenCalledWith("pt-1");
    expect(hasButton(render({ entry: e, onOpenProjectTask: undefined }).tree, "Open task")).toBe(false);
  });

  it("interaction entries render the interaction context with the api client", () => {
    const client = { request: vi.fn() } as never;
    const { tree } = render({ entry: entry({ work_item_type: "interaction", work_item_id: "int-1" }), client, apiKey: "k" });
    const ctx = tree.root.find((n) => String(n.type) === "InteractionEntryContext");
    expect(ctx.props).toMatchObject({ client, apiKey: "k", interactionId: "int-1" });
  });

  it("manage and close buttons call their handlers; backdrop closes", () => {
    const { tree, onManage, onClose } = render({ onEdit: undefined, onDelete: undefined });
    expect(hasButton(tree, "Edit")).toBe(false);
    act(() => button(tree, "Open in Schedule").props.onPress());
    expect(onManage).toHaveBeenCalled();
    act(() => button(tree, "common:close").props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    const backdrop = tree.root.findAll((n) => String(n.type) === "Pressable" && n.props.accessibilityRole === undefined)[0];
    act(() => backdrop.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
