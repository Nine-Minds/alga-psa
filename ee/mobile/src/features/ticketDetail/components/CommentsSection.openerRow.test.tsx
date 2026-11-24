import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { TicketComment } from "../../../api/tickets";

// T010: compact opener row (alga-2026-0003227). Mocks mirror CommentsSection.test.tsx.
// --- Hoisted mock state --------------------------------------------------

const { mutedIds, toggleCommentReactionMock, updateTicketCommentMock, cancelScheduledTicketCommentMock, alertMock } = vi.hoisted(() => ({
  cancelScheduledTicketCommentMock: vi.fn(),
  alertMock: vi.fn(),
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
  cancelScheduledTicketComment: (...args: unknown[]) => cancelScheduledTicketCommentMock(...args),
  isScheduledComment: (c: { publish_state?: string | null }) => c.publish_state === "scheduled",
}));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return { ...actual, Alert: { alert: (...args: unknown[]) => alertMock(...args) } };
});

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

function render(comments: TicketComment[]): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  const element = React.createElement(CommentsSection, {
    visibleCount: 50,
    onLoadMore: () => undefined,
    error: null,
    ticketId: "ticket-1",
    comments,
  } as React.ComponentProps<typeof CommentsSection>);
  act(() => {
    renderer = create(element);
  });
  if (renderer === undefined) throw new Error("Renderer was not created");
  return renderer;
}

function textOf(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((n) => (n.type as string) === "Text")
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.map((x) => String(x ?? "")).join("") : String(c ?? "");
    })
    .join(" | ");
}

function pressableByLabelContaining(renderer: ReactTestRenderer, needle: string) {
  return renderer.root.findAll(
    (n) => (n.type as string) === "Pressable" && String(n.props.accessibilityLabel ?? "").includes(needle),
  );
}

const base: TicketComment = {
  comment_id: "c1",
  comment_text: "Opening body",
  is_internal: false,
  created_by: "author-a",
  created_by_name: "Jane Doe",
  created_at: "2026-05-18T01:00:00.000Z",
  thread_id: "c1",
  parent_comment_id: null,
};

describe("CommentsSection — opener row", () => {
  beforeEach(() => {
    mutedIds.clear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the opener as a compact row and expands on tap, then collapses", () => {
    const renderer = render([
      { ...base, metadata: { opensTicket: true, attachmentCount: 2, email: { fromName: "Jane Doe" } } },
    ]);

    expect(textOf(renderer)).toContain("Opened by email from Jane Doe");
    expect(textOf(renderer)).toContain("2 attachments");
    expect(renderer.root.findAll((n) => (n.type as string) === "MockExpandableComment")).toHaveLength(0);

    const [show] = pressableByLabelContaining(renderer, "Show original email");
    expect(show.props.accessibilityRole).toBe("button");
    expect(show.props.accessibilityState).toEqual({ expanded: false });
    act(() => show.props.onPress());

    expect(renderer.root.findAll((n) => (n.type as string) === "MockExpandableComment")).toHaveLength(1);
    const [hide] = pressableByLabelContaining(renderer, "Hide original email");
    expect(hide.props.accessibilityState).toEqual({ expanded: true });
    act(() => hide.props.onPress());
    expect(renderer.root.findAll((n) => (n.type as string) === "MockExpandableComment")).toHaveLength(0);
  });

  it("accepts metadata stored as a jsonb string", () => {
    const renderer = render([{ ...base, metadata: JSON.stringify({ opensTicket: true }) }]);
    expect(textOf(renderer)).toContain("Opened by email from Jane Doe");
  });

  it("falls back to the inbound sender when the author is unresolved", () => {
    const renderer = render([
      { ...base, created_by_name: null, metadata: { opensTicket: true, email: { fromAddress: "pat@elsewhere.example" } } },
    ]);
    expect(textOf(renderer)).toContain("Opened by email from pat@elsewhere.example");
  });

  it("renders non-opener comments unchanged", () => {
    const renderer = render([{ ...base, metadata: { responseSource: "inbound_email" } }]);
    expect(textOf(renderer)).not.toContain("Opened by email");
    expect(renderer.root.findAll((n) => (n.type as string) === "MockExpandableComment")).toHaveLength(1);
    expect(pressableByLabelContaining(renderer, "original email")).toHaveLength(0);
  });

  it("keeps the replies bar and replies under a collapsed opener", () => {
    const renderer = render([
      { ...base, metadata: { opensTicket: true } },
      { ...base, comment_id: "c2", comment_text: "Reply", parent_comment_id: "c1", created_at: "2026-05-18T02:00:00.000Z", created_by_name: "Author B" },
    ]);
    expect(textOf(renderer)).toContain("1 reply");
    // Root collapsed (no expandable) + the reply's own expandable.
    expect(renderer.root.findAll((n) => (n.type as string) === "MockExpandableComment")).toHaveLength(1);
  });
});
