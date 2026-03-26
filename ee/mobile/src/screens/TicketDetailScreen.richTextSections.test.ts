import React, { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Linking } from "react-native";
import type { TicketRichTextEditorRef } from "../features/ticketRichText/TicketRichTextEditor";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    refreshSession: () => undefined,
  }),
}));

vi.mock("../config/appConfig", () => ({
  getAppConfig: () => ({
    ok: true,
    baseUrl: "https://example.com",
  }),
}));

vi.mock("../api", () => ({
  createApiClient: () => null,
}));

vi.mock("../api/tickets", () => ({
  addTicketComment: vi.fn(),
  getTicketById: vi.fn(),
  getTicketComments: vi.fn(),
  getTicketPriorities: vi.fn(),
  getTicketStatuses: vi.fn(),
  updateTicketAssignment: vi.fn(),
  updateTicketAttributes: vi.fn(),
  updateTicketPriority: vi.fn(),
  updateTicketStatus: vi.fn(),
}));

vi.mock("../hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({
    refreshing: false,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../cache/ticketsCache", () => ({
  getCachedTicketDetail: () => null,
  invalidateTicketsListCache: () => undefined,
  setCachedTicketDetail: () => undefined,
}));

vi.mock("../cache/referenceDataCache", () => ({
  getCachedTicketStatuses: () => null,
  setCachedTicketStatuses: () => undefined,
}));

vi.mock("../storage/secureStorage", () => ({
  getSecureJson: async () => null,
  secureStorage: {
    deleteItem: async () => undefined,
  },
  setSecureJson: async () => undefined,
}));

vi.mock("../device/clientMetadata", () => ({
  getClientMetadataHeaders: async () => ({}),
}));

vi.mock("../api/timeEntries", () => ({
  createTimeEntry: vi.fn(),
}));

vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () => ({}),
}));

vi.mock("../network/isOffline", () => ({
  isOffline: () => false,
}));

vi.mock("../ui/toast/ToastProvider", () => ({
  useToast: () => ({
    showToast: () => undefined,
  }),
}));

vi.mock("../ui/formatters/dateTime", () => ({
  formatDateTimeWithRelative: () => "just now",
}));

vi.mock("../clipboard/clipboard", () => ({
  copyToClipboard: async () => ({
    copiedText: "copied",
  }),
}));

vi.mock("../urls/hostedUrls", () => ({
  buildTicketWebUrl: () => "https://example.com/ticket/1",
}));

vi.mock("../ui/components/Badge", () => ({
  Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props),
}));

vi.mock("../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) =>
    React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));

vi.mock("../features/ticketDetail/components/DocumentsSection", () => ({
  DocumentsSection: (props: Record<string, unknown>) => React.createElement("MockDocumentsSection", props),
}));

vi.mock("../features/ticketDetail/components/MaterialsSection", () => ({
  MaterialsSection: (props: Record<string, unknown>) => React.createElement("MockMaterialsSection", props),
}));

vi.mock("../features/ticketRichText/TicketRichTextEditor", () => ({
  TicketRichTextEditor: (props: Record<string, unknown>) =>
    React.createElement("MockRichTextEditor", props),
}));

import {
  CommentComposer,
  CommentsSection,
  DescriptionSection,
} from "./TicketDetailScreen";

function render(node: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(node);
  });

  if (!renderer) {
    throw new Error("Renderer was not created");
  }

  return renderer;
}

function findMockRichTextEditor(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => (node.type as string) === "MockRichTextEditor");
}

const richDescription = "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Rich description\",\"styles\":{\"bold\":true}}]}]";
const richComment = "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Rich reply\",\"styles\":{\"italic\":true}}]}]";
const richImageComment = "[{\"type\":\"image\",\"props\":{\"url\":\"/api/documents/view/file-123\",\"name\":\"clipboard-image.png\",\"caption\":\"Screenshot\"}}]";
const malformedDescription = "{\"type\":";

describe("TicketDetailScreen rich text sections", () => {
  it("renders rich description content through the rich-text wrapper in read mode", () => {
    const renderer = render(
      React.createElement(DescriptionSection, {
        ticket: {
          ticket_id: "ticket-1",
          ticket_number: "T-1",
          title: "Example",
          attributes: {
            description: richDescription,
          },
        },
        isEditing: false,
        draftContent: richDescription,
        draftPlainText: "Rich description",
        saving: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onStartEditing: () => undefined,
        onCancelEditing: () => undefined,
        onSave: () => undefined,
        onDraftChange: () => undefined,
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    expect(richEditor.props.content).toBe(richDescription);
    expect(richEditor.props.editable).toBe(false);
  });

  it("mounts the rich editor wrapper with existing description content in edit mode", () => {
    const renderer = render(
      React.createElement(DescriptionSection, {
        ticket: {
          ticket_id: "ticket-1",
          ticket_number: "T-1",
          title: "Example",
          attributes: {
            description: richDescription,
          },
        },
        isEditing: true,
        draftContent: richDescription,
        draftPlainText: "Rich description",
        saving: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onStartEditing: () => undefined,
        onCancelEditing: () => undefined,
        onSave: () => undefined,
        onDraftChange: () => undefined,
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    expect(richEditor.props.content).toBe(richDescription);
    expect(richEditor.props.editable).toBe(true);
    expect(richEditor.props.showToolbar).toBe(true);
  });

  it("falls back to safe plain-text display when the saved description payload is malformed", () => {
    const renderer = render(
      React.createElement(DescriptionSection, {
        ticket: {
          ticket_id: "ticket-1",
          ticket_number: "T-1",
          title: "Example",
          attributes: {
            description: malformedDescription,
          },
        },
        isEditing: false,
        draftContent: malformedDescription,
        draftPlainText: malformedDescription,
        saving: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onStartEditing: () => undefined,
        onCancelEditing: () => undefined,
        onSave: () => undefined,
        onDraftChange: () => undefined,
      }),
    );

    expect(
      renderer.root.findAll((node) => (node.type as string) === "MockRichTextEditor"),
    ).toHaveLength(0);
    expect(renderer.root.findByProps({ children: malformedDescription })).toBeTruthy();
  });

  it("renders saved ticket comments through the rich-text wrapper", () => {
    const renderer = render(
      React.createElement(CommentsSection, {
        comments: [
          {
            comment_id: "comment-1",
            comment_text: richComment,
            is_internal: true,
            created_by_name: "Alice",
            created_at: "2026-03-11T00:00:00.000Z",
          },
        ],
        visibleCount: 20,
        onLoadMore: () => undefined,
        onJumpToLatest: () => undefined,
        onJumpToTop: () => undefined,
        error: null,
        onLinkPress: (url: string) => {
          void Linking.openURL(url);
        },
        ticketId: "test-ticket-1",
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    expect(richEditor.props.content).toBe(richComment);
    expect(richEditor.props.editable).toBe(false);
  });

  it("preserves tappable links for rich comment items through the screen wrapper", () => {
    const onLinkPress = vi.fn();
    const renderer = render(
      React.createElement(CommentsSection, {
        comments: [
          {
            comment_id: "comment-1",
            comment_text: richComment,
            is_internal: false,
            created_by_name: "Alice",
            created_at: "2026-03-11T00:00:00.000Z",
          },
        ],
        visibleCount: 20,
        onLoadMore: () => undefined,
        onJumpToLatest: () => undefined,
        onJumpToTop: () => undefined,
        error: null,
        onLinkPress,
        ticketId: "test-ticket-1",
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    act(() => {
      (richEditor.props.onLinkPress as ((url: string) => void) | undefined)?.("https://example.com/comment-link");
    });

    expect(onLinkPress).toHaveBeenCalledWith("https://example.com/comment-link");
  });

  it("routes saved image-backed comment content through the rich-text wrapper", () => {
    const renderer = render(
      React.createElement(CommentsSection, {
        comments: [
          {
            comment_id: "comment-1",
            comment_text: richImageComment,
            is_internal: false,
            created_by_name: "Alice",
            created_at: "2026-03-11T00:00:00.000Z",
          },
        ],
        visibleCount: 20,
        onLoadMore: () => undefined,
        onJumpToLatest: () => undefined,
        onJumpToTop: () => undefined,
        error: null,
        ticketId: "test-ticket-1",
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    expect(richEditor.props.content).toBe(richImageComment);
    expect(richEditor.props.editable).toBe(false);
  });

  it("keeps legacy plain-text comments viewable through the read-only wrapper path", () => {
    const renderer = render(
      React.createElement(CommentsSection, {
        comments: [
          {
            comment_id: "comment-1",
            comment_text: "Legacy plain text reply",
            is_internal: false,
            created_by_name: "Alice",
            created_at: "2026-03-11T00:00:00.000Z",
          },
        ],
        visibleCount: 20,
        onLoadMore: () => undefined,
        onJumpToLatest: () => undefined,
        onJumpToTop: () => undefined,
        error: null,
        ticketId: "test-ticket-1",
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    expect(richEditor.props.content).toBe("Legacy plain text reply");
    expect(richEditor.props.editable).toBe(false);
  });

  it("mounts the rich comment composer while preserving visibility controls", () => {
    const renderer = render(
      React.createElement(CommentComposer, {
        draftContent: richComment,
        draftPlainText: "Rich reply",
        isInternal: true,
        onChangeIsInternal: () => undefined,
        onSend: () => undefined,
        sending: false,
        offline: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onDraftChange: () => undefined,
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    expect(richEditor.props.content).toBe(richComment);
    expect(richEditor.props.showToolbar).toBe(true);
    expect(
      renderer.root.find((node) => (node.type as string) === "Pressable" && node.props.accessibilityLabel === "Internal ✓"),
    ).toBeTruthy();
    expect(
      renderer.root.find((node) => (node.type as string) === "Pressable" && node.props.accessibilityLabel === "Public"),
    ).toBeTruthy();
  });

  it("keeps existing saved comments non-editable in v1", () => {
    const renderer = render(
      React.createElement(CommentsSection, {
        comments: [
          {
            comment_id: "comment-1",
            comment_text: richComment,
            is_internal: false,
            created_by_name: "Alice",
            created_at: "2026-03-11T00:00:00.000Z",
          },
        ],
        visibleCount: 20,
        onLoadMore: () => undefined,
        onJumpToLatest: () => undefined,
        onJumpToTop: () => undefined,
        error: null,
        ticketId: "test-ticket-1",
      }),
    );

    const richEditor = findMockRichTextEditor(renderer);
    expect(richEditor.props.editable).toBe(false);
    expect(richEditor.props.showToolbar).toBeUndefined();
  });
});
