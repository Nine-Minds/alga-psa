import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  data: {} as Record<string, any>,
  hooks: {} as Record<string, Record<string, any>>,
  operationalOnly: false,
  contactsCreate: false,
  offline: false,
  timerLastStopped: null as null | { workItemId: string; at: number },
  showToast: vi.fn(),
  placeCall: vi.fn(),
  resync: vi.fn(),
  openURL: vi.fn(),
  listUsers: vi.fn(),
  listContacts: vi.fn(),
  createApiClient: vi.fn(() => ({ request: vi.fn() })),
  t: (key: string, opts?: unknown) =>
    opts && typeof opts === "object" && "name" in (opts as Record<string, unknown>)
      ? `${key}:${String((opts as Record<string, unknown>).name)}`
      : key,
}));

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof import("react")).createElement(name, props, props.children as React.ReactNode),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: h.t }) }));
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return { ...actual, Linking: { openURL: (...args: unknown[]) => h.openURL(...args) } };
});
vi.mock("../capabilities/CapabilitiesContext", () => ({
  useCapabilities: () => ({
    features: { operationalOnly: h.operationalOnly, contactsCreate: h.contactsCreate },
    loaded: true,
    refresh: () => Promise.resolve(),
  }),
  useOperationalOnly: () => h.operationalOnly,
  useDontNotifyCustomerDefault: () => false,
}));
vi.mock("../network/useNetworkStatus", () => ({ useNetworkStatus: () => ({}) }));
vi.mock("../network/isOffline", () => ({ isOffline: () => h.offline }));
vi.mock("../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock("../ui/formatters/dateTime", () => ({ formatDateTimeWithRelative: (iso: string | null) => `fmt(${iso})` }));
vi.mock("../features/timer/TimerContext", () => ({
  useTimer: () => ({ lastStopped: h.timerLastStopped }),
  useTimerElapsedMs: () => null,
}));
vi.mock("../api", () => ({ createApiClient: (...args: unknown[]) => (h.createApiClient as any)(...args) }));
vi.mock("../api/users", () => ({
  listUsers: (...args: unknown[]) => h.listUsers(...args),
  getUserDisplayName: (u: Record<string, string>) => u.first_name ?? u.username,
}));
vi.mock("../api/contacts", () => ({ listContacts: (...args: unknown[]) => h.listContacts(...args) }));
vi.mock("../features/interactions/hooks/usePlaceCall", () => ({ usePlaceCall: () => h.placeCall }));
vi.mock("../notifications/reminderSync", () => ({ resyncScheduleReminders: (...args: unknown[]) => h.resync(...args) }));

// Hooks: each returns the per-test object from h.hooks.
vi.mock("../features/ticketDetail/hooks/useTicketData", () => ({ useTicketData: () => h.data }));
vi.mock("../features/ticketDetail/hooks/useCommentDraft", () => ({ useCommentDraft: () => h.hooks.comment }));
vi.mock("../features/ticketDetail/hooks/useDescriptionEditor", () => ({ useDescriptionEditor: () => h.hooks.desc }));
vi.mock("../features/ticketDetail/hooks/useTicketStatus", () => ({ useTicketStatus: (args: unknown) => { h.hooks.statusArgs = args as never; return h.hooks.status; } }));
vi.mock("../features/ticketDetail/hooks/useTicketPriority", () => ({ useTicketPriority: () => h.hooks.priority }));
vi.mock("../features/ticketDetail/hooks/useTicketCategory", () => ({ useTicketCategory: () => h.hooks.category }));
vi.mock("../features/ticketDetail/hooks/useTicketDueDate", () => ({ useTicketDueDate: () => h.hooks.due }));
vi.mock("../features/ticketDetail/hooks/useTicketWatch", () => ({ useTicketWatch: () => h.hooks.watch }));
vi.mock("../features/ticketDetail/hooks/useTimeEntry", () => ({ useTimeEntry: (_d: unknown, opts: unknown) => { h.hooks.timeOpts = opts as never; return h.hooks.time; } }));
vi.mock("../features/ticketDetail/hooks/useTicketAssignment", () => ({ useTicketAssignment: () => h.hooks.assign }));
vi.mock("../features/ticketDetail/hooks/useTicketTitle", () => ({ useTicketTitle: () => h.hooks.title }));
vi.mock("../features/ticketDetail/hooks/useTicketContact", () => ({ useTicketContact: () => h.hooks.contact }));
vi.mock("../features/ticketDetail/hooks/useTicketTags", () => ({ useTicketTags: () => h.hooks.tags }));
vi.mock("../features/ticketDetail/hooks/useTicketChecklist", () => ({ useTicketChecklist: () => h.hooks.checklist }));
vi.mock("../features/ticketDetail/hooks/useTicketQa", () => ({ useTicketQa: () => h.hooks.qa }));
vi.mock("../features/ticketDetail/hooks/useTicketBundle", () => ({ useTicketBundle: () => h.hooks.bundle }));

// Child components are stubs that expose their props.
vi.mock("../ui/states", () => ({ ErrorState: stub("MockErrorState"), LoadingState: stub("MockLoadingState") }));
vi.mock("../ui/components/RecordUnavailableState", () => ({ RecordUnavailableState: stub("MockUnavailable") }));
vi.mock("../ui/components/Avatar", () => ({ Avatar: stub("MockAvatar") }));
vi.mock("../ui/components/DisplayTagBadges", () => ({ DisplayTagBadges: stub("MockDisplayTagBadges") }));
vi.mock("../features/ticketDetail/components/ActionChip", () => ({ ActionChip: stub("MockActionChip") }));
vi.mock("../features/ticketDetail/components/KeyValue", () => ({ KeyValue: stub("MockKeyValue") }));
vi.mock("../features/ticketDetail/components/TicketMetaBar", () => ({ TicketMetaBar: stub("MockMetaBar") }));
vi.mock("../features/ticketDetail/components/BundleBanner", () => ({ BundleBanner: stub("MockBundleBanner") }));
vi.mock("../features/ticketDetail/components/MoreActionsSheet", () => ({ MoreActionsSheet: stub("MockMoreActions") }));
vi.mock("../features/ticketDetail/components/CallsEmailsSection", () => ({ CallsEmailsSection: stub("MockCallsEmails") }));
vi.mock("../features/interactions/components/CallPromptHost", () => ({ CallPromptHost: stub("MockCallPromptHost") }));
vi.mock("../features/ticketDetail/components/DueDateModal", () => ({ DueDateModal: stub("MockDueDateModal") }));
vi.mock("../features/ticketDetail/components/TimeEntryModal", () => ({ TimeEntryModal: stub("MockTimeEntryModal") }));
vi.mock("../features/ticketDetail/components/PriorityPickerModal", () => ({ PriorityPickerModal: stub("MockPriorityPicker") }));
vi.mock("../features/ticketDetail/components/CategoryPickerModal", () => ({ CategoryPickerModal: stub("MockCategoryPicker") }));
vi.mock("../features/ticketDetail/components/StatusPickerModal", () => ({ StatusPickerModal: stub("MockStatusPicker") }));
vi.mock("../features/ticketDetail/components/AgentPickerModal", () => ({ AgentPickerModal: stub("MockAgentPicker") }));
vi.mock("../features/ticketDetail/components/ContactPickerModal", () => ({ ContactPickerModal: stub("MockContactPicker") }));
vi.mock("../features/contacts/components/ContactFormModal", () => ({ ContactFormModal: stub("MockContactForm") }));
vi.mock("../features/ticketDetail/components/TagsSection", () => ({ TagsSection: stub("MockTagsSection") }));
vi.mock("../features/clients/components/ClientNotesSection", () => ({ ClientNotesSection: stub("MockClientNotes") }));
vi.mock("../features/ticketDetail/components/TagPickerModal", () => ({ TagPickerModal: stub("MockTagPicker") }));
vi.mock("../features/ticketDetail/components/ChecklistSection", () => ({ ChecklistSection: stub("MockChecklist") }));
vi.mock("../features/timer/components/TicketTimerChip", () => ({ TicketTimerChip: stub("MockTimerChip") }));
vi.mock("../features/ticketDetail/components/CommentComposer", () => ({ CommentComposer: stub("MockComposer") }));
vi.mock("../features/ticketDetail/components/CommentsSection", () => ({ CommentsSection: stub("MockComments") }));
vi.mock("../features/ticketDetail/components/DescriptionSection", () => ({ DescriptionSection: stub("MockDescription") }));
vi.mock("../features/ticketDetail/components/DocumentsSection", () => ({ DocumentsSection: stub("MockDocuments") }));
vi.mock("../features/ticketDetail/components/MaterialsSection", () => ({ MaterialsSection: stub("MockMaterials") }));
vi.mock("../features/ticketDetail/components/AssetsSection", () => ({ AssetsSection: stub("MockAssets") }));
vi.mock("../features/ticketDetail/components/TimeEntriesSection", () => ({ TimeEntriesSection: stub("MockTimeEntries") }));
vi.mock("../features/ticketDetail/components/TicketDetailsSection", () => ({ TicketDetailsSection: stub("MockDetailsSection") }));

import { TicketDetailBody, TicketDetailScreen } from "./TicketDetailScreen";

const CONFIG = { ok: true, env: "dev", baseUrl: "https://psa.example.com" } as const;
const SESSION = { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } };

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: "ticket-1",
    ticket_number: "T-1001",
    title: "Printer offline",
    status_id: "st-open",
    status_name: "Open",
    status_is_closed: false,
    priority_id: "pr-high",
    priority_name: "High",
    client_id: "client-1",
    client_name: "Acme",
    contact_name_id: "contact-1",
    contact_name: "Casey Jones",
    contact_email: "casey@acme.io",
    contact_phone: null,
    client_email: "office@acme.io",
    client_phone: null,
    location_name: "HQ",
    location_address: "1 Main St",
    assigned_to: "user-2",
    assigned_to_name: "Bob",
    attributes: { watcher_user_ids: ["user-1"] },
    entered_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-02T00:00:00.000Z",
    closed_at: null,
    ...overrides,
  };
}

function resetHooks() {
  const fn = () => vi.fn();
  h.data = {
    ticket: makeTicket(),
    initialLoading: false,
    error: null,
    unavailable: false,
    comments: [],
    commentsError: null,
    refreshing: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    fetchTicket: fn(),
    fetchComments: vi.fn().mockResolvedValue(undefined),
    setComments: fn(),
    setTicket: fn(),
  };
  h.hooks = {
    comment: {
      draftLoaded: true, submitCommentPayload: fn(), setCommentDraft: fn(), setCommentDraftPlainText: fn(),
      commentDraft: "", commentDraftPlainText: "", commentIsInternal: false, setCommentIsInternal: fn(),
      commentIsResolution: false, setCommentIsResolution: fn(), commentCloseStatusId: null, setCommentCloseStatusId: fn(),
      commentScheduleAt: null, setCommentScheduleAt: fn(), commentCc: [], commentBcc: [], setCommentCc: fn(), setCommentBcc: fn(),
      sendComment: vi.fn().mockResolvedValue(undefined), commentSending: false, commentSendError: null,
      commentEditorRef: { current: null }, commentsVisibleCount: 20, setCommentsVisibleCount: fn(), submitReply: fn(),
    },
    desc: {
      persistDescriptionContent: fn(), startDescriptionEditing: fn(), setDescriptionDraft: fn(), setDescriptionPlainText: fn(),
      descriptionEditing: false, descriptionDraft: "", descriptionPlainText: "", descriptionSaving: false, descriptionError: null,
      descriptionEditorRef: { current: null }, cancelDescriptionEditing: fn(), saveDescription: vi.fn().mockResolvedValue(true),
    },
    status: {
      pendingStatusId: null, statusOptions: [], openStatusPicker: vi.fn().mockResolvedValue(undefined), statusPickerOpen: false,
      statusOptionsLoading: false, statusOptionsError: null, statusUpdating: false, statusUpdateError: null,
      submitStatus: vi.fn().mockResolvedValue(undefined), setStatusPickerOpen: fn(),
    },
    priority: {
      openPriorityPicker: vi.fn().mockResolvedValue(undefined), priorityPickerOpen: false, priorityOptionsLoading: false,
      priorityOptionsError: null, priorityOptions: [], priorityUpdating: false, priorityUpdateError: null,
      submitPriority: vi.fn().mockResolvedValue(undefined), setPriorityPickerOpen: fn(),
    },
    category: {
      openCategoryPicker: vi.fn().mockResolvedValue(undefined), categoryPickerOpen: false, categoryOptionsLoading: false,
      categoryOptionsError: null, categoryOptions: [], categoryUpdating: false, categoryUpdateError: null,
      submitCategory: vi.fn().mockResolvedValue(undefined), setCategoryPickerOpen: fn(),
    },
    due: { setDueDateDraft: fn(), dueDateOpen: false, dueDateUpdating: false, dueDateError: null, submitDueDateIso: vi.fn().mockResolvedValue(undefined), setDueDateOpen: fn() },
    watch: { watchUpdating: false, toggleWatch: vi.fn().mockResolvedValue(undefined), watchError: null },
    time: {
      openTimeEntryModal: fn(), timeEntryOpen: false, timeEntryDate: "", setTimeEntryDate: fn(), timeEntryStartTime: "",
      setTimeEntryStartTime: fn(), timeEntryEndTime: "", setTimeEntryEndTime: fn(), timeEntryNotes: "", setTimeEntryNotes: fn(),
      timeEntryServiceId: null, setTimeEntryServiceId: fn(), timeEntryUpdating: false, timeEntryError: null,
      setTimeEntryOpen: fn(), submitTimeEntry: vi.fn().mockResolvedValue(undefined),
    },
    assign: {
      assignmentUpdating: false, openAgentPicker: fn(), assignmentError: null, agentPickerOpen: false,
      assignToUser: vi.fn().mockResolvedValue(true), unassign: vi.fn().mockResolvedValue(true), closeAgentPicker: fn(),
    },
    title: {
      titleEditing: false, titleDraft: "", setTitleDraft: fn(), titleSaving: false, titleError: null,
      startTitleEditing: fn(), cancelTitleEditing: fn(), saveTitle: vi.fn().mockResolvedValue(true),
    },
    contact: {
      contactUpdating: false, contactError: null, contactPickerOpen: false, openContactPicker: fn(), closeContactPicker: fn(),
      selectContact: vi.fn().mockResolvedValue(undefined), removeContact: vi.fn().mockResolvedValue(undefined),
    },
    tags: {
      tags: [{ tag_id: "tg-1", tag_text: "vip" }], tagsLoading: false, tagsHidden: false, tagsError: null, tagUpdating: false,
      tagActionError: null, tagPickerOpen: false, fetchTags: vi.fn().mockResolvedValue(undefined), openTagPicker: fn(),
      closeTagPicker: fn(), applyTags: vi.fn().mockResolvedValue(undefined),
    },
    checklist: {
      items: [], loading: false, hidden: false, error: null, actionError: null, adding: false, updatingIds: [],
      addItem: fn(), toggleItem: vi.fn().mockResolvedValue(undefined), fetchChecklist: vi.fn().mockResolvedValue(undefined),
    },
    qa: { qaStatus: null, handleRichTextLinkPress: fn(), qaAutoPressLink: false },
    bundle: { bundle: null, bundleRole: "standalone", fetchBundle: vi.fn().mockResolvedValue(undefined) },
  };
}

const navigation = { setOptions: vi.fn(), goBack: vi.fn(), push: vi.fn() };

function render(props: Record<string, unknown> = {}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      React.createElement(TicketDetailBody, {
        ticketId: "ticket-1",
        config: CONFIG,
        session: SESSION,
        refreshSession: vi.fn(),
        navigation,
        ...props,
      } as never),
    );
  });
  return renderer;
}

const one = (r: ReactTestRenderer, type: string) => r.root.findByType(type as never);
const chip = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n) => String(n.type) === "MockActionChip" && n.props.label === label)[0] as ReactTestInstance;
const byLabel = (r: ReactTestRenderer, label: string) =>
  r.root.find((n) => typeof n.type === "string" && n.props?.accessibilityLabel === label && typeof n.props?.onPress === "function");
const allText = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.type === ("Text" as never)).map((n) => ([] as unknown[]).concat(n.props.children).join(""));

describe("TicketDetailScreen flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHooks();
    h.operationalOnly = false;
    h.contactsCreate = false;
    h.offline = false;
    h.timerLastStopped = null;
  });

  describe("guards", () => {
    it("shows a configuration error", () => {
      const r = render({ config: { ok: false, error: "missing base url" } });
      expect(one(r, "MockErrorState").props).toMatchObject({ title: "common:configurationError", description: "missing base url" });
    });

    it("shows signed-out without a session and builds no client", () => {
      const r = render({ session: null });
      expect(one(r, "MockErrorState").props.title).toBe("common:signedOut");
      expect(h.createApiClient).not.toHaveBeenCalled();
    });

    it("shows loading before the ticket arrives", () => {
      h.data.ticket = null;
      h.data.initialLoading = true;
      expect(one(render(), "MockLoadingState").props.message).toBe("detail.loadingTicket");
    });

    it("shows the unavailable state and goes back from it", () => {
      h.data.ticket = null;
      h.data.unavailable = true;
      const r = render();
      act(() => (one(r, "MockUnavailable").props.onBack as () => void)());
      expect(navigation.goBack).toHaveBeenCalled();
    });

    it("shows the load error, or not-found when there is nothing", () => {
      h.data.ticket = null;
      h.data.error = { title: "Network", description: "try again" };
      expect(one(render(), "MockErrorState").props).toMatchObject({ title: "Network", description: "try again" });
      h.data.error = null;
      expect(one(render(), "MockErrorState").props.title).toBe("detail.ticketNotFound");
    });
  });

  it("renders the header, sets the nav title and builds the client against the configured host", () => {
    const r = render();
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: "T-1001" });
    expect(h.createApiClient).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://psa.example.com" }));
    expect(allText(r)).toEqual(expect.arrayContaining(["T-1001 • Acme • Casey Jones", "Printer offline"]));
    expect(one(r, "MockMetaBar").props).toMatchObject({ statusLabel: "Open", priorityName: "High", assignedToName: "Bob" });
    expect(one(r, "MockMoreActions").props).toMatchObject({ isWatching: true, ticketNumber: "T-1001", watchDisabled: false });
  });

  it("keeps a stale ticket visible with a warning banner on refresh error", () => {
    h.data.error = { title: "Offline", description: "showing cached" };
    const r = render();
    expect(allText(r)).toEqual(expect.arrayContaining(["Offline", "showing cached", "Printer offline"]));
  });

  it("labels the status with the pending choice while it saves", () => {
    h.hooks.status.pendingStatusId = "st-wip";
    h.hooks.status.statusOptions = [{ status_id: "st-wip", name: "In Progress", is_closed: false }];
    expect(one(render(), "MockMetaBar").props.statusLabel).toBe("In Progress");
  });

  it("renders the QA status panel", () => {
    h.hooks.qa.qaStatus = { scenario: "links", state: "failed", step: "open", detail: "no link" };
    expect(allText(render())).toEqual(expect.arrayContaining(["QA links", "FAILED - open", "no link"]));
  });

  describe("title editing", () => {
    it("starts editing from the title", () => {
      const r = render();
      act(() => byLabel(r, "detail.editTitle").props.onPress());
      expect(h.hooks.title.startTitleEditing).toHaveBeenCalled();
    });

    it("saves with the chosen suppression and cancels", async () => {
      Object.assign(h.hooks.title, { titleEditing: true, titleDraft: "Printer on fire", titleError: "too short?" });
      const r = render();
      expect(allText(r)).toContain("too short?");
      const apply = () => r.root.find((n) => typeof n.type === "string" && n.props?.testID === "ticket-title-update-apply-button");
      expect(apply().props.disabled).toBe(false);
      act(() => r.root.find((n) => typeof n.type === "string" && n.props?.testID === "ticket-suppress-contact-notifications").props.onValueChange(true));
      await act(async () => { apply().props.onPress(); });
      expect(h.hooks.title.saveTitle).toHaveBeenCalledWith({ suppressContactNotifications: true, suppressInternalNotifications: false });

      act(() => r.root.find((n) => typeof n.type === "string" && n.props?.testID === "ticket-title-update-cancel-button").props.onPress());
      expect(h.hooks.title.cancelTitleEditing).toHaveBeenCalled();
    });

    it("disables saving an unchanged title", () => {
      Object.assign(h.hooks.title, { titleEditing: true, titleDraft: "Printer offline" });
      const r = render();
      expect(r.root.find((n) => typeof n.type === "string" && n.props?.testID === "ticket-title-update-apply-button").props.disabled).toBe(true);
    });
  });

  describe("meta bar", () => {
    it("opens the status, priority, assignee and due-date editors", () => {
      const r = render();
      const bar = one(r, "MockMetaBar").props;
      act(() => bar.onStatusPress());
      act(() => bar.onPriorityPress());
      act(() => bar.onAssigneePress());
      act(() => bar.onDuePress());
      expect(h.hooks.status.openStatusPicker).toHaveBeenCalled();
      expect(h.hooks.priority.openPriorityPicker).toHaveBeenCalled();
      expect(h.hooks.assign.openAgentPicker).toHaveBeenCalled();
      expect(h.hooks.due.setDueDateDraft).toHaveBeenCalledWith("");
      expect(h.hooks.due.setDueDateOpen).toHaveBeenCalledWith(true);
    });

    it("locks workflow fields on a bundled child and explains why", () => {
      h.data.ticket = makeTicket({ master_ticket_id: "ticket-0", bundle_master_ticket_number: "T-1000" });
      h.hooks.bundle.bundleRole = "child";
      const r = render();
      const bar = one(r, "MockMetaBar").props;
      expect(bar).toMatchObject({ statusDisabled: true, priorityDisabled: true, assigneeDisabled: true });
      act(() => bar.onStatusPress());
      expect(h.hooks.status.openStatusPicker).not.toHaveBeenCalled();
      expect(h.showToast).toHaveBeenCalledWith({ message: "detail.bundle.locked", tone: "info" });

      const banner = one(r, "MockBundleBanner").props;
      expect(banner).toMatchObject({ role: "child", masterTicketNumber: "T-1000" });
      act(() => banner.onOpenTicket("ticket-0"));
      expect(navigation.push).toHaveBeenCalledWith("TicketDetail", { ticketId: "ticket-0" });
      expect(one(r, "MockComposer").props.closedStatuses).toEqual([]);
    });
  });

  describe("picker modals", () => {
    it("routes status, priority, category and due-date saves to their hooks", () => {
      const r = render();
      const suppress = { suppressContactNotifications: true, suppressInternalNotifications: false };
      act(() => one(r, "MockStatusPicker").props.onApply("st-closed", suppress));
      act(() => one(r, "MockPriorityPicker").props.onApply("pr-low", undefined));
      act(() => one(r, "MockCategoryPicker").props.onApply("cat-1", undefined));
      act(() => one(r, "MockDueDateModal").props.onSave("2026-12-01T00:00:00.000Z", undefined));
      expect(h.hooks.status.submitStatus).toHaveBeenCalledWith("st-closed", suppress);
      expect(h.hooks.priority.submitPriority).toHaveBeenCalledWith("pr-low", undefined);
      expect(h.hooks.category.submitCategory).toHaveBeenCalledWith("cat-1", undefined);
      expect(h.hooks.due.submitDueDateIso).toHaveBeenCalledWith("2026-12-01T00:00:00.000Z", undefined);

      act(() => one(r, "MockStatusPicker").props.onClose());
      act(() => one(r, "MockPriorityPicker").props.onClose());
      act(() => one(r, "MockCategoryPicker").props.onClose());
      act(() => one(r, "MockDueDateModal").props.onClose());
      expect(h.hooks.status.setStatusPickerOpen).toHaveBeenCalledWith(false);
      expect(h.hooks.priority.setPriorityPickerOpen).toHaveBeenCalledWith(false);
      expect(h.hooks.category.setCategoryPickerOpen).toHaveBeenCalledWith(false);
      expect(h.hooks.due.setDueDateOpen).toHaveBeenCalledWith(false);
    });

    it("assigns an agent, and closes the picker only after a successful unassign", async () => {
      const r = render();
      expect(one(r, "MockAgentPicker").props).toMatchObject({ currentAssignedToId: "user-2", apiKey: "api-key", baseUrl: "https://psa.example.com" });
      act(() => one(r, "MockAgentPicker").props.onApply("user-3", undefined));
      expect(h.hooks.assign.assignToUser).toHaveBeenCalledWith("user-3", undefined);

      await act(async () => { one(r, "MockAgentPicker").props.onApply(null, undefined); });
      expect(h.hooks.assign.unassign).toHaveBeenCalled();
      expect(h.hooks.assign.closeAgentPicker).toHaveBeenCalledTimes(1);

      h.hooks.assign.unassign.mockResolvedValueOnce(false);
      await act(async () => { one(r, "MockAgentPicker").props.onApply(null, undefined); });
      expect(h.hooks.assign.closeAgentPicker).toHaveBeenCalledTimes(1);
    });

    it("selects or removes a contact", () => {
      const r = render();
      act(() => one(r, "MockContactPicker").props.onApply("contact-2", undefined));
      act(() => one(r, "MockContactPicker").props.onApply(null, undefined));
      expect(h.hooks.contact.selectContact).toHaveBeenCalledWith("contact-2", undefined);
      expect(h.hooks.contact.removeContact).toHaveBeenCalledWith(undefined);
      expect(one(r, "MockContactPicker").props.onCreateContact).toBeUndefined();
    });

    it("creates a new contact and returns to the picker with it preselected", () => {
      h.contactsCreate = true;
      const r = render();
      act(() => one(r, "MockContactPicker").props.onCreateContact());
      expect(h.hooks.contact.closeContactPicker).toHaveBeenCalled();
      expect(one(r, "MockContactForm").props).toMatchObject({ visible: true, presetClient: { id: "client-1", name: "Acme" } });

      act(() => one(r, "MockContactForm").props.onSaved({ contact_name_id: "contact-9", full_name: "New Person", email: "n@acme.io" }));
      expect(h.hooks.contact.openContactPicker).toHaveBeenCalled();
      expect(one(r, "MockContactPicker").props.preselect).toEqual({ id: "contact-9", name: "New Person", email: "n@acme.io" });

      act(() => one(r, "MockContactPicker").props.onClose());
      expect(one(r, "MockContactPicker").props.preselect).toBeNull();
      act(() => one(r, "MockContactForm").props.onClose());
      expect(one(r, "MockContactForm").props.visible).toBe(false);
    });

    it("applies tags and wires the time-entry modal", () => {
      const r = render();
      expect(one(r, "MockTagPicker").props.appliedTagTexts).toEqual(["vip"]);
      act(() => one(r, "MockTagPicker").props.onApply(["vip", "urgent"]));
      expect(h.hooks.tags.applyTags).toHaveBeenCalledWith(["vip", "urgent"]);

      act(() => one(r, "MockTimeEntryModal").props.onSubmit());
      act(() => one(r, "MockTimeEntryModal").props.onClose());
      expect(h.hooks.time.submitTimeEntry).toHaveBeenCalled();
      expect(h.hooks.time.setTimeEntryOpen).toHaveBeenCalledWith(false);
    });
  });

  describe("actions", () => {
    it("opens more actions and toggles watch from it", () => {
      const r = render();
      act(() => chip(r, "detail.more").props.onPress());
      expect(one(r, "MockMoreActions").props.visible).toBe(true);
      act(() => one(r, "MockMoreActions").props.onToggleWatch());
      expect(h.hooks.watch.toggleWatch).toHaveBeenCalled();
      act(() => one(r, "MockMoreActions").props.onClose());
      expect(one(r, "MockMoreActions").props.visible).toBe(false);
    });

    it("opens the time entry modal and bumps time entries after a create", () => {
      const r = render();
      act(() => chip(r, "detail.addTime").props.onPress());
      expect(h.hooks.time.openTimeEntryModal).toHaveBeenCalled();
      expect(one(r, "MockTimeEntries").props.refreshKey).toBe(0);
      act(() => (h.hooks.timeOpts as unknown as { onCreated: () => void }).onCreated());
      expect(one(r, "MockTimeEntries").props.refreshKey).toBe(1);
    });

    it("refreshes time entries when the timer stops on this ticket", () => {
      h.timerLastStopped = { workItemId: "ticket-1", at: 123 };
      expect(one(render(), "MockTimeEntries").props.refreshKey).toBe(1);
    });

    it("shows watch and assignment errors", () => {
      h.hooks.watch.watchError = "watch failed";
      h.hooks.assign.assignmentError = "assign failed";
      expect(allText(render())).toEqual(expect.arrayContaining(["watch failed", "assign failed"]));
    });

    it("pull-to-refresh reloads ticket, tags, checklist and bundle", () => {
      const r = render();
      const control = r.root.findAll((n) => n.props?.refreshControl)[0].props.refreshControl;
      act(() => control.props.onRefresh());
      expect(h.data.refresh).toHaveBeenCalled();
      expect(h.hooks.tags.fetchTags).toHaveBeenCalled();
      expect(h.hooks.checklist.fetchChecklist).toHaveBeenCalled();
      expect(h.hooks.bundle.fetchBundle).toHaveBeenCalled();
    });

    it("opens email and map links for the contact, client and location", () => {
      const r = render();
      act(() => byLabel(r, "detail.emailContact:Casey Jones").props.onPress());
      expect(h.openURL).toHaveBeenCalledWith("mailto:casey@acme.io");
      act(() => r.root.find((n) => typeof n.type === "string" && n.props?.onPress && allTextOf(n).includes("office@acme.io")).props.onPress());
      expect(h.openURL).toHaveBeenCalledWith("mailto:office@acme.io");
      act(() => byLabel(r, "detail.openInMaps").props.onPress());
      expect(String(h.openURL.mock.calls.at(-1)![0])).toContain("1%20Main%20St");
    });

    it("dials directly without logging when the seat is operational-only", () => {
      h.operationalOnly = true;
      h.openURL.mockResolvedValue(undefined);
      h.data.ticket = makeTicket({ contact_phone: "+15550100" });
      const r = render();
      act(() => r.root.find((n) => typeof n.type === "string" && n.props?.testID === "ticket-detail-call-contact").props.onPress());
      expect(h.placeCall).not.toHaveBeenCalled();
      expect(h.openURL).toHaveBeenCalledWith("tel:+15550100");
      // Operational-only seats get no tags, calls, materials, client notes or time shortcuts.
      for (const type of ["MockTagsSection", "MockCallsEmails", "MockMaterials", "MockClientNotes", "MockTimerChip"]) {
        expect(r.root.findAllByType(type as never)).toHaveLength(0);
      }
      expect(one(r, "MockTimeEntries").props.onAddPress).toBeUndefined();
      expect(one(r, "MockMetaBar").props.assigneeDisabled).toBe(true);
    });
  });

  describe("comment composer", () => {
    it("sends, collapses and forwards draft changes", () => {
      const r = render();
      const composer = () => one(r, "MockComposer").props;
      expect(composer().collapsed).toBe(true);
      act(() => composer().onToggleCollapse());
      expect(composer().collapsed).toBe(false);
      act(() => composer().onDraftChange("{json}", "plain"));
      expect(h.hooks.comment.setCommentDraft).toHaveBeenCalledWith("{json}");
      expect(h.hooks.comment.setCommentDraftPlainText).toHaveBeenCalledWith("plain");
      act(() => composer().onSend(undefined));
      expect(h.hooks.comment.sendComment).toHaveBeenCalledWith(undefined);
    });

    it("passes the offline flag through", () => {
      h.offline = true;
      expect(one(render(), "MockComposer").props.offline).toBe(true);
    });

    it("loads statuses quietly when a resolution is turned on, and clears the close status when off", () => {
      const r = render();
      act(() => one(r, "MockComposer").props.onChangeIsResolution(true));
      expect(h.hooks.comment.setCommentIsResolution).toHaveBeenCalledWith(true);
      expect(h.hooks.status.openStatusPicker).toHaveBeenCalled();
      expect(h.hooks.status.setStatusPickerOpen).toHaveBeenCalledWith(false);

      act(() => one(r, "MockComposer").props.onChangeIsResolution(false));
      expect(h.hooks.comment.setCommentCloseStatusId).toHaveBeenCalledWith(null);
    });

    it("offers only closed statuses for a resolution", () => {
      h.hooks.status.statusOptions = [
        { status_id: "a", name: "Open", is_closed: false },
        { status_id: "b", name: "Closed", is_closed: true },
      ];
      expect(one(render(), "MockComposer").props.closedStatuses).toEqual([{ status_id: "b", name: "Closed", is_closed: true }]);
    });

    it("loads more comments in pages of 20 and refetches after an edit", () => {
      const r = render();
      act(() => one(r, "MockComments").props.onLoadMore());
      const updater = h.hooks.comment.setCommentsVisibleCount.mock.calls[0][0] as (n: number) => number;
      expect(updater(20)).toBe(40);
      act(() => one(r, "MockComments").props.onCommentUpdated());
      expect(h.data.fetchComments).toHaveBeenCalled();
    });

    it("searches Cc/Bcc recipients among the ticket client's contacts with an email", async () => {
      h.listContacts.mockResolvedValue({
        ok: true,
        data: { data: [{ email: "a@acme.io", full_name: "Ann" }, { email: null, full_name: "No Mail" }] },
      });
      const r = render();
      const signal = new AbortController().signal;
      const results = await one(r, "MockComposer").props.onSearchRecipients("an", signal);
      expect(h.listContacts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ client_id: "client-1", search: "an", apiKey: "api-key" }));
      expect(results).toEqual([{ email: "a@acme.io", name: "Ann" }]);

      h.listContacts.mockResolvedValueOnce({ ok: false });
      expect(await one(r, "MockComposer").props.onSearchRecipients("x", signal)).toEqual([]);
    });

    it("returns no recipients for a ticket without a client", async () => {
      h.data.ticket = makeTicket({ client_id: null });
      const r = render();
      expect(await one(r, "MockComposer").props.onSearchRecipients("x", new AbortController().signal)).toEqual([]);
      expect(h.listContacts).not.toHaveBeenCalled();
    });
  });

  describe("mention search", () => {
    const signal = new AbortController().signal;

    it("lists @everyone plus all users on an empty query, then filters the cache", async () => {
      h.listUsers.mockResolvedValue({
        ok: true,
        data: { data: [{ user_id: "u1", username: "ann", first_name: "Ann" }, { user_id: "u2", username: "bob", first_name: "Bob" }] },
      });
      const r = render();
      const search = one(r, "MockDescription").props.onMentionSearch;
      const all = await search("", signal);
      expect(all.map((m: { user_id: string }) => m.user_id)).toEqual(["@everyone", "u1", "u2"]);
      expect(h.listUsers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 50 }));

      const filtered = await search("bo", signal);
      expect(filtered.map((m: { user_id: string }) => m.user_id)).toEqual(["u2"]);
      expect(h.listUsers).toHaveBeenCalledTimes(1);
    });

    it("falls back to a server search when the cache has no match", async () => {
      h.listUsers.mockResolvedValue({ ok: true, data: { data: [{ user_id: "u9", username: "zed", first_name: "Zed" }] } });
      const r = render();
      const result = await one(r, "MockComposer").props.onMentionSearch("ze", signal);
      expect(h.listUsers).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ search: "ze", limit: 10 }));
      expect(result).toEqual([{ user_id: "u9", username: "zed", display_name: "Zed", avatar_url: undefined }]);
    });

    it("offers only @everyone to an operational-only seat", async () => {
      h.operationalOnly = true;
      const r = render();
      const result = await one(r, "MockComposer").props.onMentionSearch("", signal);
      expect(result.map((m: { user_id: string }) => m.user_id)).toEqual(["@everyone"]);
      expect(h.listUsers).not.toHaveBeenCalled();
    });
  });

  describe("description", () => {
    it("forwards editing callbacks to the description editor", async () => {
      const r = render();
      const desc = one(r, "MockDescription").props;
      act(() => desc.onDraftChange("{c}", "p"));
      expect(h.hooks.desc.setDescriptionDraft).toHaveBeenCalledWith("{c}");
      expect(h.hooks.desc.setDescriptionPlainText).toHaveBeenCalledWith("p");
      await desc.onSave(undefined);
      expect(h.hooks.desc.saveDescription).toHaveBeenCalledWith(undefined);
      expect(desc.imageAuth).toEqual({ baseUrl: "https://psa.example.com", apiKey: "api-key" });
    });
  });

  describe("layout", () => {
    it("starts sections collapsed in one column and opens them in two columns", () => {
      const r = render();
      expect(one(r, "MockComments").props.initiallyCollapsed).toBe(true);
      const scroll = r.root.findAll((n) => typeof n.type === "string" && n.props?.refreshControl)[0];
      act(() => scroll.props.onLayout({ nativeEvent: { layout: { width: 1024 } } }));
      expect(one(r, "MockComments").props.initiallyCollapsed).toBe(false);
    });

    it("reloads the checklist when a status change is blocked by it", () => {
      const r = render({ initialWidth: 1024 });
      expect(r.root.findAllByType("MockChecklist" as never)).toHaveLength(1);
      act(() => (h.hooks.statusArgs as unknown as { onChecklistBlocked: () => void }).onChecklistBlocked());
      expect(h.hooks.checklist.fetchChecklist).toHaveBeenCalled();
    });
  });

  it("logs a call from the prompt and re-arms reminders", () => {
    const r = render();
    act(() => one(r, "MockCallPromptHost").props.onLogged());
    expect(one(r, "MockCallsEmails").props.reloadKey).toBe(1);
    expect(h.resync).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "api-key", tenantId: "tenant-1", userId: "user-1" }));
    act(() => one(r, "MockCallsEmails").props.onLogged());
    expect(h.resync).toHaveBeenCalledTimes(2);
  });

  it("TicketDetailScreen reads the route and auth context", async () => {
    vi.resetModules();
    vi.doMock("../auth/AuthContext", () => ({ useAuth: () => ({ session: SESSION, refreshSession: vi.fn() }) }));
    vi.doMock("../config/appConfig", () => ({ getAppConfig: () => CONFIG }));
    const mod = await import("./TicketDetailScreen");
    let r!: ReactTestRenderer;
    act(() => {
      r = create(React.createElement(mod.TicketDetailScreen, { route: { params: { ticketId: "ticket-1" } }, navigation } as never));
    });
    expect(r.root.findAll((n) => n.props?.accessibilityLabel === "detail.editTitle").length).toBeGreaterThan(0);
    void TicketDetailScreen;
  });
});

function allTextOf(node: ReactTestInstance): string {
  return node
    .findAll((n) => n.type === ("Text" as never))
    .map((n) => ([] as unknown[]).concat(n.props.children).join(""))
    .join(" ");
}
