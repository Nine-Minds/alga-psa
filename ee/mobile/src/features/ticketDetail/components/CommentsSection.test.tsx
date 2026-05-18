import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import type { TicketComment } from "../../../api/tickets";

// --- Hoisted mock state --------------------------------------------------

const { mutedIds, toggleCommentReactionMock, updateTicketCommentMock } = vi.hoisted(() => ({
  mutedIds: new Set<string>(),
  toggleCommentReactionMock: vi.fn(),
  updateTicketCommentMock: vi.fn(),
}));

let sessionUserId: string | null = "me-user";

// --- Module mocks (mirror existing CommentsSection screen tests) ---------

vi.mock("../../../auth/AuthContext", () => ({
  useAuth: () => ({
    session: {
      accessToken: "token-1",
      tenantId: "tenant-1",
      user: sessionUserId ? { id: sessionUserId, name: "Me" } : undefined,
    },
    refreshSession: () => undefined,
  }),
}));

vi.mock("../../moderation/useModeration", () => ({
  useModeration: () => ({
    mutedUserIds: mutedIds,
    isMuted: (userId: string | null | undefined) => Boolean(userId) && mutedIds.has(userId as string),
    mute: vi.fn(),
    unmute: vi.fn(),
    report: vi.fn(),
  }),
}));

vi.mock("../../../config/appConfig", () => ({
  getAppConfig: () => ({ ok: true, baseUrl: "https://example.com" }),
}));

vi.mock("../../../api", () => ({
  createApiClient: () => ({ request: vi.fn() }),
}));

vi.mock("../../../api/tickets", () => ({
  toggleCommentReaction: (...args: unknown[]) => toggleCommentReactionMock(...args),
  updateTicketComment: (...args: unknown[]) => updateTicketCommentMock(...args),
}));

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: async () => ({}),
}));

vi.mock("../../../ui/formatters/dateTime", () => ({
  formatDateTimeWithRelative: () => "just now",
}));

vi.mock("../../../ui/components/Badge", () => ({
  Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props),
}));

vi.mock("../../../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement("MockAvatar", props),
}));

vi.mock("../../ticketRichText/TicketRichTextEditor", () => ({
  TicketRichTextEditor: (props: Record<string, unknown>) =>
    React.createElement("MockRichTextEditor", props),
}));

vi.mock("./ExpandableComment", () => ({
  ExpandableComment: (props: Record<string, unknown>) => {
    // Render the footer like the real component so see-more wiring is exercised.
    const footer = (props.renderFooter as
      | ((o: { needsExpansion: boolean; expanded: boolean; toggle: () => void }) => React.ReactNode)
      | undefined)?.({ needsExpansion: false, expanded: false, toggle: () => undefined });
    return React.createElement("MockExpandableComment", { content: props.content }, footer);
  },
}));

import { CommentsSection } from "./CommentsSection";

// --- Helpers -------------------------------------------------------------

function render(
  props: Partial<React.ComponentProps<typeof CommentsSection>> & { comments: TicketComment[] },
): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  const element = React.createElement(CommentsSection, {
    visibleCount: 50,
    onLoadMore: () => undefined,
    error: null,
    ticketId: "ticket-1",
    ...props,
  } as React.ComponentProps<typeof CommentsSection>);
  act(() => {
    renderer = create(element);
  });
  if (renderer === undefined) {
    throw new Error("Renderer was not created");
  }
  return renderer;
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const s = node.props.style;
  return (Array.isArray(s) ? Object.assign({}, ...s) : s ?? {}) as Record<string, unknown>;
}

// Every rendered comment node (normal, system event, optimistic, or a
// [deleted]/[hidden] placeholder) is wrapped in a `View` whose style is the
// component's `nodeWrapperStyle` — uniquely identified by carrying BOTH a
// numeric `marginLeft` and an `opacity`. The per-thread bar is a Pressable
// (excluded), and inner layout rows have no marginLeft.
function commentWrappers(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((n) => {
    if ((n.type as string) !== "View") return false;
    const s = styleOf(n);
    return typeof s.marginLeft === "number" && s.opacity !== undefined;
  });
}

function pressables(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((n) => (n.type as string) === "Pressable");
}

function findPressableByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance[] {
  return pressables(renderer).filter((p) => p.props.accessibilityLabel === label);
}

function instanceText(node: ReactTestInstance): string {
  return node
    .findAll((n) => (n.type as string) === "Text")
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.map((x) => String(x ?? "")).join("") : String(c ?? "");
    })
    .join(" ");
}

// Per-thread bars are Collapse/Expand Pressables that also render the reply
// count ("1 reply" / "N replies"); the global collapse-all Pressable only
// renders the Collapse/Expand word.
function threadBars(renderer: ReactTestRenderer): ReactTestInstance[] {
  return pressables(renderer).filter(
    (p) =>
      (p.props.accessibilityLabel === "Collapse" || p.props.accessibilityLabel === "Expand") &&
      /\brepl(y|ies)\b/.test(instanceText(p)),
  );
}

function globalCollapse(renderer: ReactTestRenderer): ReactTestInstance {
  const all = pressables(renderer).filter(
    (p) => p.props.accessibilityLabel === "Collapse" || p.props.accessibilityLabel === "Expand",
  );
  const bars = new Set(threadBars(renderer));
  const candidate = all.find((p) => !bars.has(p));
  if (!candidate) throw new Error("global collapse pressable not found");
  return candidate;
}

function textContents(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => (n.type as string) === "Text")
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.map((x) => String(x ?? "")).join("") : String(c ?? "");
    });
}

function hasText(renderer: ReactTestRenderer, needle: string): boolean {
  return textContents(renderer).some((t) => t.includes(needle));
}

// --- Fixtures ------------------------------------------------------------

const T = (n: number) => `2026-05-18T0${n}:00:00.000Z`;

function root(id: string, threadId: string, createdHour: number, over: Partial<TicketComment> = {}): TicketComment {
  return {
    comment_id: id,
    comment_text: `Root ${id}`,
    is_internal: false,
    created_by: "author-a",
    created_by_name: "Author A",
    created_at: T(createdHour),
    thread_id: threadId,
    parent_comment_id: null,
    ...over,
  };
}

function reply(
  id: string,
  threadId: string,
  parentId: string,
  createdHour: number,
  over: Partial<TicketComment> = {},
): TicketComment {
  return {
    comment_id: id,
    comment_text: `Reply ${id}`,
    is_internal: false,
    created_by: "author-b",
    created_by_name: "Author B",
    created_at: T(createdHour),
    thread_id: threadId,
    parent_comment_id: parentId,
    ...over,
  };
}

describe("CommentsSection — threaded rendering", () => {
  beforeEach(() => {
    mutedIds.clear();
    sessionUserId = "me-user";
    toggleCommentReactionMock.mockReset();
    updateTicketCommentMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("T020: renders a root plus two replies, replies indented (marginLeft > 0) and root at 0", () => {
    const renderer = render({
      comments: [
        root("c1", "th1", 1),
        reply("c2", "th1", "c1", 2),
        reply("c3", "th1", "c1", 3),
      ],
    });

    const wrappers = commentWrappers(renderer);
    expect(wrappers).toHaveLength(3);

    const byLabel = (frag: string) =>
      wrappers.find((w) => String(w.props.accessibilityLabel).includes(frag))!;
    expect(styleOf(byLabel("Root c1")).marginLeft).toBe(0);
    expect(styleOf(byLabel("Reply c2")).marginLeft).toBeGreaterThan(0);
    expect(styleOf(byLabel("Reply c3")).marginLeft).toBeGreaterThan(0);
  });

  it("T021: sort toggle orders threads by activity; replies stay chronological; Pressable flips it", () => {
    // Thread A: old root (01:00) but a fresh reply (05:00) -> recent activity.
    // Thread B: standalone comment created later (03:00) but no replies.
    const renderer = render({
      comments: [
        root("a-root", "thA", 1),
        reply("a-reply", "thA", "a-root", 5),
        root("b-root", "thB", 3),
      ],
    });

    const orderLabels = () =>
      commentWrappers(renderer).map((w) => String(w.props.accessibilityLabel));

    // newest mode (default): thread A (last activity 05:00) before thread B (03:00)
    let labels = orderLabels();
    const aRoot = labels.findIndex((l) => l.includes("Root a-root"));
    const aReply = labels.findIndex((l) => l.includes("Reply a-reply"));
    const bRoot = labels.findIndex((l) => l.includes("Root b-root"));
    expect(aRoot).toBeLessThan(bRoot);
    // replies chronological within the thread: root before its reply
    expect(aRoot).toBeLessThan(aReply);

    // Toggle sort -> oldest first: thread B (03:00) should now precede thread A (05:00)
    const toggle = findPressableByLabel(renderer, "Sort oldest first");
    expect(toggle).toHaveLength(1);
    act(() => toggle[0].props.onPress());

    labels = orderLabels();
    expect(labels.findIndex((l) => l.includes("Root b-root"))).toBeLessThan(
      labels.findIndex((l) => l.includes("Root a-root")),
    );
    // The toggle Pressable's label flips back to "newest"
    expect(findPressableByLabel(renderer, "Sort newest first")).toHaveLength(1);
  });

  it("T022: visibleCount slices the render list and 'load more' calls onLoadMore", () => {
    const onLoadMore = vi.fn();
    const renderer = render({
      visibleCount: 2,
      onLoadMore,
      comments: [
        root("c1", "th1", 1),
        root("c2", "th2", 2),
        root("c3", "th3", 3),
        root("c4", "th4", 4),
      ],
    });

    // Only 2 of the 4 standalone threads render.
    expect(commentWrappers(renderer)).toHaveLength(2);

    const loadMore = findPressableByLabel(renderer, "Load more comments");
    expect(loadMore).toHaveLength(1);
    act(() => loadMore[0].props.onPress());
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("T023: a deep reply chain caps indent at visualDepth 4 (deepest nodes share marginLeft)", () => {
    const renderer = render({
      comments: [
        root("r", "th1", 1),
        reply("d1", "th1", "r", 2),
        reply("d2", "th1", "d1", 3),
        reply("d3", "th1", "d2", 4),
        reply("d4", "th1", "d3", 5),
        reply("d5", "th1", "d4", 6),
        reply("d6", "th1", "d5", 7),
      ],
    });

    const wrappers = commentWrappers(renderer);
    const ml = (frag: string) =>
      styleOf(wrappers.find((w) => String(w.props.accessibilityLabel).includes(frag))!).marginLeft as number;

    expect(ml("Root r")).toBe(0);
    expect(ml("Reply d1")).toBeGreaterThan(0);
    expect(ml("Reply d2")).toBeGreaterThan(ml("Reply d1"));
    expect(ml("Reply d3")).toBeGreaterThan(ml("Reply d2"));
    expect(ml("Reply d4")).toBeGreaterThan(ml("Reply d3"));
    // depth 5 and 6 are clamped to visual depth 4 == same indent as d4
    expect(ml("Reply d5")).toBe(ml("Reply d4"));
    expect(ml("Reply d6")).toBe(ml("Reply d4"));
  });

  it("T024: a thread with replies renders a thread bar showing the reply count", () => {
    const renderer = render({
      comments: [
        root("c1", "th1", 1),
        reply("c2", "th1", "c1", 2),
        reply("c3", "th1", "c1", 3),
      ],
    });
    expect(hasText(renderer, "2 replies")).toBe(true);
    // Exactly one per-thread bar, expanded (label "Collapse").
    const bars = threadBars(renderer);
    expect(bars).toHaveLength(1);
    expect(bars[0].props.accessibilityLabel).toBe("Collapse");
  });

  it("T025: a single-comment thread renders NO thread bar", () => {
    const renderer = render({ comments: [root("c1", "th1", 1)] });
    expect(hasText(renderer, "reply")).toBe(false);
    expect(hasText(renderer, "replies")).toBe(false);
  });

  it("T026: tapping the thread bar collapses then expands the thread", () => {
    const renderer = render({
      comments: [root("c1", "th1", 1), reply("c2", "th1", "c1", 2)],
    });
    expect(commentWrappers(renderer)).toHaveLength(2);

    let bar = threadBars(renderer)[0];
    expect(bar.props.accessibilityLabel).toBe("Collapse");
    act(() => bar.props.onPress());

    // Reply removed; only the root remains.
    expect(commentWrappers(renderer)).toHaveLength(1);
    // Bar now shows an expand affordance for that thread.
    bar = threadBars(renderer)[0];
    expect(bar.props.accessibilityLabel).toBe("Expand");

    act(() => bar.props.onPress());
    expect(commentWrappers(renderer)).toHaveLength(2);
    expect(threadBars(renderer)[0].props.accessibilityLabel).toBe("Collapse");
  });

  it("T027: collapsing thread A does not collapse thread B", () => {
    const renderer = render({
      comments: [
        root("a1", "thA", 1),
        reply("a2", "thA", "a1", 2),
        root("b1", "thB", 3),
        reply("b2", "thB", "b1", 4),
      ],
    });
    expect(commentWrappers(renderer)).toHaveLength(4);

    const labelsBefore = commentWrappers(renderer).map((w) => String(w.props.accessibilityLabel));
    expect(labelsBefore.some((l) => l.includes("Reply a2"))).toBe(true);
    expect(labelsBefore.some((l) => l.includes("Reply b2"))).toBe(true);

    // Two independent thread bars; collapse the first one only.
    const bars = threadBars(renderer);
    expect(bars).toHaveLength(2);
    act(() => bars[0].props.onPress());

    // Exactly one reply got hidden -> 3 wrappers remain; the other thread's
    // reply is still visible.
    const wrappersAfter = commentWrappers(renderer);
    expect(wrappersAfter).toHaveLength(3);
    const labelsAfter = wrappersAfter.map((w) => String(w.props.accessibilityLabel));
    const aHidden = !labelsAfter.some((l) => l.includes("Reply a2"));
    const bHidden = !labelsAfter.some((l) => l.includes("Reply b2"));
    // Precisely one of the two threads collapsed (XOR), not both.
    expect(aHidden).not.toBe(bHidden);
    // One per-thread bar now shows Expand, the other still Collapse.
    const labels = threadBars(renderer).map((b) => b.props.accessibilityLabel).sort();
    expect(labels).toEqual(["Collapse", "Expand"]);
  });

  it("T028: global collapse-all hides everything regardless of per-thread state", () => {
    const renderer = render({
      comments: [
        root("c1", "th1", 1),
        reply("c2", "th1", "c1", 2),
        root("c3", "th2", 3),
      ],
    });
    expect(commentWrappers(renderer).length).toBeGreaterThan(0);

    // Collapse a single thread first to prove global collapse overrides it.
    const bar = threadBars(renderer)[0];
    act(() => bar.props.onPress());

    act(() => globalCollapse(renderer).props.onPress());
    expect(commentWrappers(renderer)).toHaveLength(0);
  });

  it("T029: Reply affordance present on a normal comment, absent on event/optimistic/deleted", () => {
    const renderer = render({
      onSubmitReply: vi.fn().mockResolvedValue(true),
      comments: [
        root("normal", "th1", 1),
        { comment_id: "evt", comment_text: "status changed", kind: "event", created_at: T(2) },
        { comment_id: "opt", comment_text: "Sending one", optimistic: true, created_at: T(3), created_by: "me-user", created_by_name: "Me" },
        root("del", "th4", 4, { deleted_at: T(4) }),
      ],
    });

    // Exactly one Reply affordance (only the normal comment is eligible).
    expect(findPressableByLabel(renderer, "Reply")).toHaveLength(1);
  });

  it("T029b: no Reply affordance at all when onSubmitReply is not provided", () => {
    const renderer = render({ comments: [root("c1", "th1", 1)] });
    expect(findPressableByLabel(renderer, "Reply")).toHaveLength(0);
  });

  it("T030: tapping Reply renders an inline composer beneath the target", () => {
    const renderer = render({
      onSubmitReply: vi.fn().mockResolvedValue(true),
      comments: [root("c1", "th1", 1)],
    });
    expect(renderer.root.findAll((n) => (n.type as string) === "MockRichTextEditor")).toHaveLength(0);

    const replyBtn = findPressableByLabel(renderer, "Reply")[0];
    act(() => replyBtn.props.onPress());

    const editors = renderer.root.findAll((n) => (n.type as string) === "MockRichTextEditor");
    expect(editors).toHaveLength(1);
  });

  it("T031: submitting a reply calls onSubmitReply with the target comment id; closes on true", async () => {
    const onSubmitReply = vi.fn().mockResolvedValue(true);
    const renderer = render({ onSubmitReply, comments: [root("c1", "th1", 1)] });

    act(() => findPressableByLabel(renderer, "Reply")[0].props.onPress());
    const editor = renderer.root.find((n) => (n.type as string) === "MockRichTextEditor");
    act(() => {
      (editor.props.onContentChange as (p: { json: unknown }) => void)({
        json: [{ type: "paragraph", content: [{ type: "text", text: "my reply", styles: {} }] }],
      });
    });

    // The submit Pressable is the one inside the composer labelled "Reply"
    // that is NOT the action-row affordance: after composing, find Reply
    // pressables and press the last (submit) one.
    const replyButtons = findPressableByLabel(renderer, "Reply");
    await act(async () => {
      await replyButtons[replyButtons.length - 1].props.onPress();
    });

    expect(onSubmitReply).toHaveBeenCalledTimes(1);
    expect(onSubmitReply.mock.calls[0][0]).toMatchObject({ parentCommentId: "c1" });
    // Composer closed.
    expect(renderer.root.findAll((n) => (n.type as string) === "MockRichTextEditor")).toHaveLength(0);
  });

  it("T033: when onSubmitReply resolves false an error shows and the composer stays open", async () => {
    const onSubmitReply = vi.fn().mockResolvedValue(false);
    const renderer = render({ onSubmitReply, comments: [root("c1", "th1", 1)] });

    act(() => findPressableByLabel(renderer, "Reply")[0].props.onPress());
    const editor = renderer.root.find((n) => (n.type as string) === "MockRichTextEditor");
    act(() => {
      (editor.props.onContentChange as (p: { json: unknown }) => void)({
        json: [{ type: "paragraph", content: [{ type: "text", text: "fails", styles: {} }] }],
      });
    });
    const replyButtons = findPressableByLabel(renderer, "Reply");
    await act(async () => {
      await replyButtons[replyButtons.length - 1].props.onPress();
    });

    expect(onSubmitReply).toHaveBeenCalledTimes(1);
    // Composer still mounted.
    expect(renderer.root.findAll((n) => (n.type as string) === "MockRichTextEditor")).toHaveLength(1);
    // Generic error string is rendered.
    expect(hasText(renderer, "Unable to send comment")).toBe(true);
  });

  it("T034: a soft-deleted root with a child shows [deleted], keeps child indented, no controls", () => {
    const renderer = render({
      onSubmitReply: vi.fn().mockResolvedValue(true),
      comments: [
        root("del-root", "th1", 1, { deleted_at: T(1) }),
        reply("kid", "th1", "del-root", 2),
      ],
    });

    expect(hasText(renderer, "[deleted]")).toBe(true);

    const wrappers = commentWrappers(renderer);
    // Two wrappers: the [deleted] placeholder + the visible child.
    expect(wrappers).toHaveLength(2);
    const kid = wrappers.find((w) => String(w.props.accessibilityLabel ?? "").includes("Reply kid"))!;
    expect(kid).toBeTruthy();
    expect(styleOf(kid).marginLeft).toBeGreaterThan(0);

    // The deleted root exposes no Reply / edit / reaction controls.
    // It still renders a thread bar (replyCount > 0) which is allowed.
    // Only the surviving child may have a Reply affordance.
    expect(findPressableByLabel(renderer, "Reply")).toHaveLength(1);
    // No "Add reaction" button on the deleted node (child has one).
    expect(findPressableByLabel(renderer, "Add reaction")).toHaveLength(1);
  });

  it("T035: a muted thread root with a visible reply renders [hidden] and keeps the reply", () => {
    mutedIds.add("muted-author");
    const renderer = render({
      comments: [
        root("m-root", "th1", 1, { created_by: "muted-author", created_by_name: "Muted" }),
        reply("ok-reply", "th1", "m-root", 2),
      ],
    });

    expect(hasText(renderer, "[hidden]")).toBe(true);
    const wrappers = commentWrappers(renderer);
    expect(wrappers).toHaveLength(2);
    expect(
      wrappers.some((w) => String(w.props.accessibilityLabel ?? "").includes("Reply ok-reply")),
    ).toBe(true);
  });

  it("T036: a muted standalone/leaf comment is filtered out entirely", () => {
    mutedIds.add("muted-author");
    const renderer = render({
      comments: [
        root("visible", "thV", 1),
        root("muted-standalone", "thM", 2, { created_by: "muted-author", created_by_name: "Muted" }),
      ],
    });

    const wrappers = commentWrappers(renderer);
    expect(wrappers).toHaveLength(1);
    expect(String(wrappers[0].props.accessibilityLabel)).toContain("Root visible");
    expect(hasText(renderer, "[hidden]")).toBe(false);
  });

  it("T037: reactions add button + see-more render on a reply node", () => {
    const renderer = render({
      comments: [
        root("c1", "th1", 1),
        reply("c2", "th1", "c1", 2, {
          reactions: [{ emoji: "👍", count: 2, userIds: ["x", "y"], currentUserReacted: false }],
        }),
      ],
    });

    // Add-reaction button exists for both root and reply.
    expect(findPressableByLabel(renderer, "Add reaction").length).toBeGreaterThanOrEqual(2);
    // The reply's existing reaction pill is rendered with its count.
    expect(
      pressables(renderer).some((p) => String(p.props.accessibilityLabel).startsWith("👍 2")),
    ).toBe(true);
  });

  it("T038: optimistic 'sending' badge renders for an optimistic top-level comment in the list", () => {
    const renderer = render({
      comments: [
        root("c1", "th1", 1),
        {
          comment_id: "opt",
          comment_text: "Pending",
          optimistic: true,
          created_at: T(2),
          created_by: "me-user",
          created_by_name: "Me",
          thread_id: "th-opt",
        },
      ],
    });

    const badges = renderer.root.findAll((n) => (n.type as string) === "MockBadge");
    expect(badges.some((b) => b.props.label === "Sending…")).toBe(true);
  });

  it("T041: legacy comments (no thread_id/parent) render with no thread bar and no indentation", () => {
    const renderer = render({
      comments: [
        { comment_id: "legacy1", comment_text: "Legacy A", created_by_name: "A", created_at: T(1) },
        { comment_id: "legacy2", comment_text: "Legacy B", created_by_name: "B", created_at: T(2) },
      ],
    });

    const wrappers = commentWrappers(renderer);
    expect(wrappers).toHaveLength(2);
    for (const w of wrappers) expect(styleOf(w).marginLeft).toBe(0);
    expect(hasText(renderer, "reply")).toBe(false);
    expect(hasText(renderer, "replies")).toBe(false);
  });

  it("T019: a system event renders flat (no thread bar, no Reply)", () => {
    const renderer = render({
      onSubmitReply: vi.fn().mockResolvedValue(true),
      comments: [
        { comment_id: "evt", comment_text: "moved to In Progress", kind: "event", event_text: "Status changed", created_at: T(1) },
      ],
    });

    const wrappers = commentWrappers(renderer);
    expect(wrappers).toHaveLength(1);
    expect(styleOf(wrappers[0]).marginLeft).toBe(0);
    expect(findPressableByLabel(renderer, "Reply")).toHaveLength(0);
    expect(hasText(renderer, "replies")).toBe(false);
    // System-event badge present.
    const badges = renderer.root.findAll((n) => (n.type as string) === "MockBadge");
    expect(badges.some((b) => b.props.label === "Event")).toBe(true);
  });

  it("T042: regression — own-comment edit pencil, moderation menu trigger, count badge still render with grouping", () => {
    const renderer = render({
      comments: [
        root("mine", "th1", 1, { created_by: "me-user", created_by_name: "Me" }),
        reply("theirs", "th1", "mine", 2, { created_by: "other", created_by_name: "Other" }),
      ],
    });

    // Edit pencil only for the own comment.
    expect(findPressableByLabel(renderer, "Edit comment")).toHaveLength(1);
    // Moderation more-vertical trigger on each non-event/non-optimistic node.
    expect(
      findPressableByLabel(renderer, "More actions for this comment").length,
    ).toBeGreaterThanOrEqual(2);
    // Header comments count badge reflects total comment count (2).
    const badges = renderer.root.findAll((n) => (n.type as string) === "MockBadge");
    expect(badges.some((b) => b.props.label === "2" && b.props.tone === "neutral")).toBe(true);
  });
});
