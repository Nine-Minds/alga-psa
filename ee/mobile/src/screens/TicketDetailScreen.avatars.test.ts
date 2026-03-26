import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseTicketData = vi.fn();

function getInitials(name?: string | null) {
  const value = name?.trim() ?? "";
  if (!value) return "?";
  const parts = value.split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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

vi.mock("../ui/components/Badge", () => ({
  Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props),
}));

vi.mock("../ui/components/Avatar", () => ({
  Avatar: (props: Record<string, unknown>) =>
    React.createElement(
      "MockAvatar",
      props,
      props.imageUri ? null : React.createElement(Text, null, getInitials(props.name as string | null | undefined)),
    ),
}));

vi.mock("../features/ticketDetail/hooks/useTicketData", () => ({
  useTicketData: (...args: unknown[]) => mockUseTicketData(...args),
}));

vi.mock("../features/ticketDetail/hooks/useCommentDraft", () => ({
  useCommentDraft: () => ({
    draftLoaded: true,
    submitCommentPayload: vi.fn(),
    setCommentDraft: vi.fn(),
    setCommentDraftPlainText: vi.fn(),
    commentDraft: "",
    commentDraftPlainText: "",
    commentIsInternal: false,
    setCommentIsInternal: vi.fn(),
    sendComment: vi.fn(),
    commentSending: false,
    commentSendError: null,
    commentEditorRef: { current: null },
    commentsVisibleCount: 20,
    setCommentsVisibleCount: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useDescriptionEditor", () => ({
  useDescriptionEditor: () => ({
    persistDescriptionContent: vi.fn(),
    startDescriptionEditing: vi.fn(),
    setDescriptionDraft: vi.fn(),
    setDescriptionPlainText: vi.fn(),
    descriptionEditing: false,
    descriptionDraft: "",
    descriptionPlainText: "",
    descriptionSaving: false,
    descriptionError: null,
    descriptionEditorRef: { current: null },
    cancelDescriptionEditing: vi.fn(),
    saveDescription: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTicketStatus", () => ({
  useTicketStatus: () => ({
    pendingStatusId: null,
    statusOptions: [],
    openStatusPicker: vi.fn(),
    statusPickerOpen: false,
    statusOptionsLoading: false,
    statusOptionsError: null,
    statusUpdating: false,
    statusUpdateError: null,
    submitStatus: vi.fn(),
    setStatusPickerOpen: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTicketPriority", () => ({
  useTicketPriority: () => ({
    openPriorityPicker: vi.fn(),
    priorityPickerOpen: false,
    priorityOptionsLoading: false,
    priorityOptionsError: null,
    priorityOptions: [],
    priorityUpdating: false,
    priorityUpdateError: null,
    submitPriority: vi.fn(),
    setPriorityPickerOpen: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTicketDueDate", () => ({
  useTicketDueDate: () => ({
    setDueDateDraft: vi.fn(),
    dueDateOpen: false,
    dueDateUpdating: false,
    dueDateError: null,
    submitDueDateIso: vi.fn(),
    setDueDateInDays: vi.fn(),
    setDueDateOpen: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTicketWatch", () => ({
  useTicketWatch: () => ({
    watchUpdating: false,
    toggleWatch: vi.fn(),
    watchError: null,
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTimeEntry", () => ({
  useTimeEntry: () => ({
    openTimeEntryModal: vi.fn(),
    timeEntryOpen: false,
    timeEntryDate: "",
    setTimeEntryDate: vi.fn(),
    timeEntryStartTime: "",
    setTimeEntryStartTime: vi.fn(),
    timeEntryEndTime: "",
    setTimeEntryEndTime: vi.fn(),
    timeEntryNotes: "",
    setTimeEntryNotes: vi.fn(),
    timeEntryServiceId: null,
    setTimeEntryServiceId: vi.fn(),
    timeEntryUpdating: false,
    timeEntryError: null,
    setTimeEntryOpen: vi.fn(),
    submitTimeEntry: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTicketAssignment", () => ({
  useTicketAssignment: () => ({
    assignmentUpdating: false,
    assignmentAction: null,
    assignToMe: vi.fn(),
    openAgentPicker: vi.fn(),
    assignmentError: null,
    agentPickerOpen: false,
    assignToUser: vi.fn(),
    unassign: vi.fn(),
    closeAgentPicker: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTicketTitle", () => ({
  useTicketTitle: () => ({
    titleEditing: false,
    startTitleEditing: vi.fn(),
  }),
}));

vi.mock("../features/ticketDetail/hooks/useTicketQa", () => ({
  useTicketQa: () => ({
    qaStatus: null,
    handleRichTextLinkPress: vi.fn(),
    qaAutoPressLink: false,
  }),
}));

vi.mock("../features/ticketDetail/components/ActionChip", () => ({
  ActionChip: (props: Record<string, unknown>) => React.createElement("MockActionChip", props),
}));

vi.mock("../features/ticketDetail/components/TicketActions", () => ({
  TicketActions: (props: Record<string, unknown>) => React.createElement("MockTicketActions", props),
}));

vi.mock("../features/ticketDetail/components/DueDateModal", () => ({
  DueDateModal: (props: Record<string, unknown>) => React.createElement("MockDueDateModal", props),
}));

vi.mock("../features/ticketDetail/components/TimeEntryModal", () => ({
  TimeEntryModal: (props: Record<string, unknown>) => React.createElement("MockTimeEntryModal", props),
}));

vi.mock("../features/ticketDetail/components/PriorityPickerModal", () => ({
  PriorityPickerModal: (props: Record<string, unknown>) => React.createElement("MockPriorityPickerModal", props),
}));

vi.mock("../features/ticketDetail/components/StatusPickerModal", () => ({
  StatusPickerModal: (props: Record<string, unknown>) => React.createElement("MockStatusPickerModal", props),
}));

vi.mock("../features/ticketDetail/components/AgentPickerModal", () => ({
  AgentPickerModal: (props: Record<string, unknown>) => React.createElement("MockAgentPickerModal", props),
}));

vi.mock("../features/ticketDetail/components/CommentComposer", () => ({
  CommentComposer: (props: Record<string, unknown>) => React.createElement("MockCommentComposer", props),
}));

vi.mock("../features/ticketDetail/components/CommentsSection", () => ({
  CommentsSection: (props: Record<string, unknown>) => React.createElement("MockCommentsSection", props),
}));

vi.mock("../features/ticketDetail/components/DescriptionSection", () => ({
  DescriptionSection: (props: Record<string, unknown>) => React.createElement("MockDescriptionSection", props),
}));

vi.mock("../features/ticketDetail/components/DocumentsSection", () => ({
  DocumentsSection: (props: Record<string, unknown>) => React.createElement("MockDocumentsSection", props),
}));

import { TicketDetailBody } from "./TicketDetailScreen";

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

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: "ticket-1",
    ticket_number: "T-1",
    title: "Example ticket",
    status_id: "status-1",
    status_name: "Open",
    status_is_closed: false,
    priority_id: "priority-1",
    priority_name: "High",
    client_name: "Acme Industries",
    client_id: "client-1",
    contact_name: "Casey Jones",
    contact_name_id: "contact-1",
    contact_email: null,
    contact_phone: null,
    client_email: null,
    client_phone: null,
    attributes: {},
    entered_at: "2026-03-26T00:00:00.000Z",
    updated_at: "2026-03-26T00:00:00.000Z",
    closed_at: null,
    assigned_to: null,
    assigned_to_name: null,
    contact_avatar_url: "/api/documents/view/contact-file?t=1",
    client_logo_url: "/api/documents/view/client-file?t=2",
    ...overrides,
  };
}

function renderScreen(ticketOverrides: Record<string, unknown> = {}) {
  mockUseTicketData.mockReturnValue({
    ticket: makeTicket(ticketOverrides),
    initialLoading: false,
    error: null,
    comments: [],
    commentsError: null,
    refreshing: false,
    refresh: vi.fn(),
    fetchTicket: vi.fn(),
    fetchComments: vi.fn(),
    setComments: vi.fn(),
    setTicket: vi.fn(),
  });

  return render(
    React.createElement(TicketDetailBody, {
      ticketId: "ticket-1",
      config: { ok: true, baseUrl: "https://example.com" },
      session: {
        accessToken: "api-key-1",
        tenantId: "tenant-1",
        user: { id: "user-1" },
      } as any,
      refreshSession: vi.fn(),
    }),
  );
}

describe("TicketDetailScreen avatars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T006/T007: renders avatar components with contact and client image URLs", () => {
    const renderer = renderScreen();
    const avatars = renderer.root.findAll((node) => node.type === "MockAvatar");

    expect(avatars).toHaveLength(2);
    expect(avatars[0].props.name).toBe("Casey Jones");
    expect(avatars[0].props.imageUri).toBe("/api/documents/view/contact-file?t=1");
    expect(avatars[1].props.name).toBe("Acme Industries");
    expect(avatars[1].props.imageUri).toBe("/api/documents/view/client-file?t=2");
  });

  it("T008: falls back to initials when the contact and client image URLs are null", () => {
    const renderer = renderScreen({
      contact_avatar_url: null,
      client_logo_url: null,
    });

    const textNodes = renderer.root.findAllByType(Text).map((node) => {
      const value = node.props.children;
      return Array.isArray(value) ? value.join("") : value;
    });

    expect(textNodes).toContain("CJ");
    expect(textNodes).toContain("AI");
  });
});
