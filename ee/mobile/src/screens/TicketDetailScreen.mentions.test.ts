import React, { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { TicketRichTextEditorRef } from "../features/ticketRichText/TicketRichTextEditor";
import type { MentionSuggestionItem } from "../features/ticketRichText/MentionSuggestionList";

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
  DescriptionSection,
} from "./TicketDetailScreen";

function render(node: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(node);
  });
  if (!renderer) throw new Error("Renderer was not created");
  return renderer;
}

function findMockRichTextEditor(renderer: ReactTestRenderer) {
  return renderer.root.find((node) => (node.type as string) === "MockRichTextEditor");
}

const richContent = "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Hello\",\"styles\":{}}]}]";

describe("TicketDetailScreen mention prop threading", () => {
  it("passes onMentionSearch to DescriptionSection editor in edit mode", () => {
    const mentionSearch = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([]);

    const renderer = render(
      React.createElement(DescriptionSection, {
        ticket: {
          ticket_id: "ticket-1",
          ticket_number: "T-1",
          title: "Example",
          attributes: { description: richContent },
        },
        isEditing: true,
        draftContent: richContent,
        draftPlainText: "Hello",
        saving: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onStartEditing: () => undefined,
        onCancelEditing: () => undefined,
        onSave: () => undefined,
        onDraftChange: () => undefined,
        onMentionSearch: mentionSearch,
        mentionBaseUrl: "https://example.com",
        mentionAuthToken: "token-1",
      }),
    );

    const editor = findMockRichTextEditor(renderer);
    expect(editor.props.onMentionSearch).toBe(mentionSearch);
    expect(editor.props.mentionBaseUrl).toBe("https://example.com");
    expect(editor.props.mentionAuthToken).toBe("token-1");
  });

  it("does not pass mention props to DescriptionSection editor in read mode", () => {
    const mentionSearch = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([]);

    const renderer = render(
      React.createElement(DescriptionSection, {
        ticket: {
          ticket_id: "ticket-1",
          ticket_number: "T-1",
          title: "Example",
          attributes: { description: richContent },
        },
        isEditing: false,
        draftContent: richContent,
        draftPlainText: "Hello",
        saving: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onStartEditing: () => undefined,
        onCancelEditing: () => undefined,
        onSave: () => undefined,
        onDraftChange: () => undefined,
        onMentionSearch: mentionSearch,
      }),
    );

    const editor = findMockRichTextEditor(renderer);
    // Read-mode editor should not receive mention search
    expect(editor.props.onMentionSearch).toBeUndefined();
  });

  it("passes onMentionSearch to CommentComposer editor", () => {
    const mentionSearch = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([]);

    const renderer = render(
      React.createElement(CommentComposer, {
        draftContent: richContent,
        draftPlainText: "Hello",
        isInternal: false,
        onChangeIsInternal: () => undefined,
        onSend: () => undefined,
        sending: false,
        offline: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onDraftChange: () => undefined,
        onMentionSearch: mentionSearch,
        mentionBaseUrl: "https://example.com",
        mentionAuthToken: "token-1",
      }),
    );

    const editor = findMockRichTextEditor(renderer);
    expect(editor.props.onMentionSearch).toBe(mentionSearch);
    expect(editor.props.mentionBaseUrl).toBe("https://example.com");
    expect(editor.props.mentionAuthToken).toBe("token-1");
  });

  it("passes mention props when composer is expanded (not collapsed)", () => {
    const mentionSearch = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([]);

    const renderer = render(
      React.createElement(CommentComposer, {
        draftContent: richContent,
        draftPlainText: "Hello",
        isInternal: false,
        onChangeIsInternal: () => undefined,
        onSend: () => undefined,
        sending: false,
        offline: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onDraftChange: () => undefined,
        onMentionSearch: mentionSearch,
        collapsed: false,
        onToggleCollapse: () => undefined,
      }),
    );

    const editors = renderer.root.findAll((node) => (node.type as string) === "MockRichTextEditor");
    expect(editors).toHaveLength(1);
    expect(editors[0].props.onMentionSearch).toBe(mentionSearch);
  });

  it("does not render editor or mention props when composer is collapsed", () => {
    const mentionSearch = vi.fn<(query: string, signal: AbortSignal) => Promise<MentionSuggestionItem[]>>().mockResolvedValue([]);

    const renderer = render(
      React.createElement(CommentComposer, {
        draftContent: richContent,
        draftPlainText: "Hello",
        isInternal: false,
        onChangeIsInternal: () => undefined,
        onSend: () => undefined,
        sending: false,
        offline: false,
        error: null,
        editorRef: createRef<TicketRichTextEditorRef>(),
        onDraftChange: () => undefined,
        onMentionSearch: mentionSearch,
        collapsed: true,
        onToggleCollapse: () => undefined,
      }),
    );

    const editors = renderer.root.findAll((node) => (node.type as string) === "MockRichTextEditor");
    expect(editors).toHaveLength(0);
  });
});
