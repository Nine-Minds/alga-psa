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

import { DescriptionSection } from "./DescriptionSection";

const DOC = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Printer jams" }] }] };

function render(overrides: Partial<React.ComponentProps<typeof DescriptionSection>> = {}) {
  const props = {
    ticket: { ticket_id: "t-1", attributes: { description: "Printer jams on tray 2" } } as never,
    isEditing: false,
    draftContent: "",
    draftPlainText: "",
    saving: false,
    error: null,
    editorRef: { current: null },
    onStartEditing: vi.fn(),
    onCancelEditing: vi.fn(),
    onSave: vi.fn(),
    onDraftChange: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof DescriptionSection>;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<DescriptionSection {...props} />); });
  const rerender = (next: Partial<React.ComponentProps<typeof DescriptionSection>>) =>
    act(() => renderer.update(<DescriptionSection {...props} {...next} />));
  return { renderer, props, rerender };
}
const editors = (r: ReactTestRenderer) => r.root.findAllByType("MockEditor" as never);

describe("DescriptionSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the description read-only and starts editing on tap", () => {
    const { renderer, props } = render();
    expect(editors(renderer)[0].props).toMatchObject({ content: "Printer jams on tray 2", editable: false, height: 96 });
    act(() => byLabel(renderer, "description.edit").props.onPress());
    expect(props.onStartEditing).toHaveBeenCalled();
  });

  it("offers see more once the content is taller than the collapsed height", () => {
    const { renderer } = render();
    act(() => editors(renderer)[0].props.onContentHeight({ height: 240.2 }));
    expect(editors(renderer)[0].props.height).toBe(96);
    act(() => byLabel(renderer, "comments.seeMore").props.onPress());
    expect(editors(renderer)[0].props.height).toBe(241);
    expect(texts(renderer)).toContain("comments.seeLess");
  });

  it("uses the short content height without a see-more toggle", () => {
    const { renderer } = render();
    act(() => editors(renderer)[0].props.onContentHeight({ height: 40 }));
    expect(editors(renderer)[0].props.height).toBe(40);
    expect(renderer.root.findAll((n) => n.props?.accessibilityLabel === "comments.seeMore")).toHaveLength(0);
  });

  it("shows tap-to-add for an empty description and the draft when present", () => {
    const empty = render({ ticket: { ticket_id: "t", attributes: {} } as never });
    expect(texts(empty.renderer)).toContain("description.tapToAdd");
    act(() => byLabel(empty.renderer, "description.add").props.onPress());
    expect(empty.props.onStartEditing).toHaveBeenCalled();
    const drafted = render({ ticket: { ticket_id: "t", attributes: {} } as never, draftPlainText: "pending text" });
    expect(texts(drafted.renderer)).toContain("pending text");
  });

  it("falls back to plain text for malformed rich content", () => {
    const { renderer } = render({ ticket: { ticket_id: "t", attributes: { description: "[{not json" } } as never });
    expect(editors(renderer)).toHaveLength(0);
    expect(renderer.root.findAll((n) => n.props?.accessibilityLabel === "description.add").length).toBeGreaterThan(0);
  });

  it("collapses and expands the section", () => {
    const { renderer } = render();
    act(() => byLabel(renderer, "collapse description.label").props.onPress());
    expect(editors(renderer)).toHaveLength(0);
    act(() => byLabel(renderer, "expand description.label").props.onPress());
    expect(editors(renderer)).toHaveLength(1);
  });

  it("starts collapsed when asked but opens when editing begins", () => {
    const { renderer, rerender } = render({ initiallyCollapsed: true });
    expect(editors(renderer)).toHaveLength(0);
    rerender({ isEditing: true });
    expect(editors(renderer)[0].props.editable).toBe(true);
  });

  it("edits: forwards draft changes, saves with suppression, and cancels", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { renderer, props } = render({ isEditing: true, onSave, error: "too long" });
    expect(texts(renderer)).toContain("too long");
    act(() => editors(renderer)[0].props.onContentChange({ json: DOC }));
    expect(props.onDraftChange).toHaveBeenCalledWith(expect.stringContaining("Printer jams"), "Printer jams");

    act(() => byTestId(renderer, "ticket-suppress-contact-notifications").props.onValueChange(true));
    await act(async () => { byTestId(renderer, "ticket-description-update-apply-button").props.onPress(); });
    expect(onSave).toHaveBeenCalledWith({ suppressContactNotifications: true, suppressInternalNotifications: false });
    // Successful save resets the suppression toggle.
    expect(byTestId(renderer, "ticket-suppress-contact-notifications").props.value).toBe(false);

    act(() => byTestId(renderer, "ticket-description-update-cancel-button").props.onPress());
    expect(props.onCancelEditing).toHaveBeenCalled();
  });

  it("keeps the suppression choice when the save fails", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const { renderer } = render({ isEditing: true, onSave });
    act(() => byTestId(renderer, "ticket-suppress-contact-notifications").props.onValueChange(true));
    await act(async () => { byTestId(renderer, "ticket-description-update-apply-button").props.onPress(); });
    expect(byTestId(renderer, "ticket-suppress-contact-notifications").props.value).toBe(true);
  });
});
