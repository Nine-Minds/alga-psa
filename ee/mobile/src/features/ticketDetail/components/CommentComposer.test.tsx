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
vi.mock("../../ticketRichText/TicketRichTextEditor", () => ({
  TicketRichTextEditor: (props: Record<string, unknown>) => React.createElement("MockEditor", props),
}));
vi.mock("./ScheduleCommentModal", () => ({
  ScheduleCommentModal: (props: Record<string, unknown>) => React.createElement("MockScheduleModal", props),
}));
vi.mock("./CommentEmailRecipients", () => ({
  CommentEmailRecipients: (props: Record<string, unknown>) => React.createElement("MockRecipients", props),
}));
vi.mock("../../../ui/formatters/dateTime", () => ({
  formatDateTimeWithRelative: (iso: string | null) => `fmt(${iso})`,
}));

import { CommentComposer } from "./CommentComposer";

const DOC = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };
const CLOSED = [
  { status_id: "s-closed", name: "Closed", is_closed: true },
  { status_id: "s-resolved", name: "Resolved", is_closed: true },
] as never[];

function render(overrides: Partial<React.ComponentProps<typeof CommentComposer>> = {}) {
  const props = {
    draftContent: "",
    draftPlainText: "Hello",
    isInternal: false,
    onChangeIsInternal: vi.fn(),
    onSend: vi.fn(),
    sending: false,
    offline: false,
    error: null,
    editorRef: { current: null },
    onDraftChange: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof CommentComposer>;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<CommentComposer {...props} />); });
  const rerender = (next: Partial<React.ComponentProps<typeof CommentComposer>>) =>
    act(() => renderer.update(<CommentComposer {...props} {...next} />));
  return { renderer, props, rerender };
}
const send = (r: ReactTestRenderer) => byLabel(r, "comments.sendComment");

describe("CommentComposer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serializes editor changes into draft content + plain text", () => {
    const { renderer, props } = render();
    act(() => renderer.root.findByType("MockEditor" as never).props.onContentChange({ json: DOC }));
    expect(props.onDraftChange).toHaveBeenCalledWith(expect.stringContaining("Hello"), "Hello");
  });

  it("sends a public comment without suppression", () => {
    const { renderer, props } = render();
    expect(texts(renderer)).toContain("5/5000");
    act(() => send(renderer).props.onPress());
    expect(props.onSend).toHaveBeenCalledWith(undefined);
  });

  it.each([
    ["empty", { draftPlainText: "   " }],
    ["offline", { offline: true }],
    ["sending", { sending: true }],
    ["too long", { draftPlainText: "x".repeat(5001) }],
  ])("disables send when %s", (_name, overrides) => {
    const { renderer } = render(overrides);
    expect(send(renderer).props.disabled).toBe(true);
  });

  it("shows sending label, error and offline notice", () => {
    const { renderer } = render({ sending: true, error: "failed", offline: true });
    expect(texts(renderer)).toEqual(expect.arrayContaining(["comments.sending", "failed", "comments.offlineDraftSaved"]));
  });

  it("toggles internal/client and resolution", () => {
    const onChangeIsResolution = vi.fn();
    const { renderer, props } = render({ onChangeIsResolution, isResolution: false });
    act(() => byLabel(renderer, "comments.internal").props.onPress());
    expect(props.onChangeIsInternal).toHaveBeenCalledWith(true);
    act(() => byLabel(renderer, "comments.clientChecked").props.onPress());
    expect(props.onChangeIsInternal).toHaveBeenCalledWith(false);
    act(() => byLabel(renderer, "comments.resolution").props.onPress());
    expect(onChangeIsResolution).toHaveBeenCalledWith(true);
  });

  it("picks a close status for a resolution and sends the close suppression", () => {
    const onChangeCloseStatusId = vi.fn();
    const { renderer, props, rerender } = render({ isResolution: true, onChangeIsResolution: vi.fn(), closedStatuses: CLOSED, onChangeCloseStatusId, closeStatusId: null });
    expect(texts(renderer)).toContain("comments.doNotChangeStatus ✓");
    act(() => byLabel(renderer, "Resolved").props.onPress());
    expect(onChangeCloseStatusId).toHaveBeenCalledWith("s-resolved");

    rerender({ closeStatusId: "s-resolved" });
    expect(texts(renderer)).toContain("Resolved ✓");
    act(() => byLabel(renderer, "comments.doNotChangeStatus").props.onPress());
    expect(onChangeCloseStatusId).toHaveBeenCalledWith(null);

    act(() => byTestId(renderer, "ticket-suppress-contact-notifications").props.onValueChange(true));
    act(() => send(renderer).props.onPress());
    expect(props.onSend).toHaveBeenCalledWith({ suppressContactNotifications: true, suppressInternalNotifications: false });
  });

  it("schedules a comment through the schedule modal", () => {
    const onChangeScheduleAt = vi.fn();
    const when = new Date("2026-12-01T09:00:00Z");
    const { renderer, rerender } = render({ onChangeScheduleAt });
    act(() => byLabel(renderer, "comments.sendLater").props.onPress());
    expect(renderer.root.findByType("MockScheduleModal" as never).props.visible).toBe(true);
    act(() => renderer.root.findByType("MockScheduleModal" as never).props.onConfirm(when));
    expect(onChangeScheduleAt).toHaveBeenCalledWith(when);
    expect(renderer.root.findByType("MockScheduleModal" as never).props.visible).toBe(false);

    rerender({ scheduleAt: when });
    expect(texts(renderer)).toEqual(expect.arrayContaining([`comments.scheduledFor:fmt(${when.toISOString()})`, "comments.scheduleConfirm"]));
    act(() => renderer.root.findByType("MockScheduleModal" as never).props.onClear());
    expect(onChangeScheduleAt).toHaveBeenLastCalledWith(null);
  });

  it("drops a pending schedule when switched to internal", () => {
    const onChangeScheduleAt = vi.fn();
    const { renderer } = render({ onChangeScheduleAt, isInternal: true, scheduleAt: new Date("2026-12-01T09:00:00Z") });
    expect(onChangeScheduleAt).toHaveBeenCalledWith(null);
    expect(texts(renderer)).toContain("comments.scheduleInternalBlocked");
  });

  it("renders Cc/Bcc recipients only for ticket comments with handlers", () => {
    const { renderer } = render({ onChangeCc: vi.fn(), onChangeBcc: vi.fn(), cc: ["a@x.io"] });
    expect(renderer.root.findByType("MockRecipients" as never).props.cc).toEqual(["a@x.io"]);
    const task = render({ variant: "task", onChangeCc: vi.fn(), onChangeBcc: vi.fn(), onChangeScheduleAt: vi.fn() });
    expect(task.renderer.root.findAllByType("MockRecipients" as never)).toHaveLength(0);
    expect(task.renderer.root.findAllByType("MockScheduleModal" as never)).toHaveLength(0);
    expect(task.renderer.root.findAll((n) => n.props?.accessibilityLabel === "comments.internal")).toHaveLength(0);
  });

  it("hides the editor when collapsed and toggles", () => {
    const onToggleCollapse = vi.fn();
    const { renderer } = render({ collapsed: true, onToggleCollapse });
    expect(renderer.root.findAllByType("MockEditor" as never)).toHaveLength(0);
    act(() => byLabel(renderer, "comments.expandComposer").props.onPress());
    expect(onToggleCollapse).toHaveBeenCalled();
  });
});
