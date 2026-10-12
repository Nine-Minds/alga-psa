import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  getProjectTask: vi.fn(),
  listTaskStatusMappings: vi.fn(),
  updateProjectTask: vi.fn(),
  getTaskChecklist: vi.fn(),
  updateTaskChecklistItem: vi.fn(),
  listComments: vi.fn(),
  listTimeEntries: vi.fn(),
  getServices: vi.fn(),
  createTimeEntry: vi.fn(),
  showToast: vi.fn(),
  features: { projects: true },
  timer: { status: "idle", session: null, lastStopped: null as { at: number; workItemId: string | null } | null, defaultService: null, client: null, apiKey: null, starting: false, refresh: vi.fn(), start: vi.fn(), openStopModal: vi.fn() },
  authValue: { session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } }, refreshSession: () => Promise.resolve(null) },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts && "estimated" in opts ? `${opts.estimated} estimated · ${opts.actual} logged` : key) }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.authValue }));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/projectTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/projectTasks")>()),
  getProjectTask: (...args: unknown[]) => mocks.getProjectTask(...args),
  listTaskStatusMappings: (...args: unknown[]) => mocks.listTaskStatusMappings(...args),
  updateProjectTask: (...args: unknown[]) => mocks.updateProjectTask(...args),
  getTaskChecklist: (...args: unknown[]) => mocks.getTaskChecklist(...args),
  updateTaskChecklistItem: (...args: unknown[]) => mocks.updateTaskChecklistItem(...args),
}));
vi.mock("../features/comments/commentTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/comments/commentTarget")>()),
  createCommentApi: () => ({ supportsVisibility: false, list: (...args: unknown[]) => mocks.listComments(...args), add: vi.fn(), update: vi.fn(), toggleReaction: vi.fn() }),
}));
vi.mock("../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => ({ features: mocks.features, defaultCountry: "US", loaded: true }) }));
vi.mock("../network/useNetworkStatus", () => ({ useNetworkStatus: () => ({ isConnected: true, isInternetReachable: true }) }));
vi.mock("../api/users", () => ({ listUsers: vi.fn(), getUserDisplayName: () => "" }));
vi.mock("../features/ticketDetail/components/CommentsSection", () => ({ CommentsSection: (props: Record<string, unknown>) => React.createElement("MockCommentsSection", props) }));
vi.mock("../features/ticketDetail/components/CommentComposer", () => ({ CommentComposer: (props: Record<string, unknown>) => React.createElement("MockCommentComposer", props) }));
vi.mock("../features/ticketDetail/hooks/useCommentDraft", () => ({
  useCommentDraft: () => ({ commentsVisibleCount: 20, setCommentsVisibleCount: vi.fn(), commentDraft: "", commentDraftPlainText: "", commentSending: false, commentSendError: null, commentEditorRef: { current: null }, sendComment: vi.fn(), submitReply: vi.fn(), setCommentDraft: vi.fn(), setCommentDraftPlainText: vi.fn() }),
}));
vi.mock("../ui/components/EntityPickerModal", () => ({ EntityPickerModal: (props: Record<string, unknown>) => React.createElement("MockEntityPicker", props) }));
vi.mock("../api/timeEntries", () => ({
  listTimeEntries: (...args: unknown[]) => mocks.listTimeEntries(...args),
  getServices: (...args: unknown[]) => mocks.getServices(...args),
  createTimeEntry: (...args: unknown[]) => mocks.createTimeEntry(...args),
}));
vi.mock("../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../features/timer/TimerContext", () => ({ useTimer: () => mocks.timer }));
vi.mock("../features/timer/components/TicketTimerChip", () => ({ WorkItemTimerChip: (props: Record<string, unknown>) => React.createElement("MockTimerChip", props) }));
vi.mock("../features/ticketDetail/components/TimeEntryModal", () => ({ TimeEntryModal: (props: Record<string, unknown>) => React.createElement("MockTimeEntryModal", props) }));
vi.mock("../device/clientMetadata", () => ({ getClientMetadataHeaders: async () => ({}) }));
vi.mock("../logging/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { ProjectTaskDetailScreen, timeEntryMinutes } from "./ProjectTaskDetailScreen";

const task = {
  task_id: "task-1",
  task_name: "Rack the switch",
  description: "Row 3, slot 2",
  phase_id: "phase-1",
  phase_name: "Deploy",
  project_name: "HQ refresh",
  status_name: "In Progress",
  is_closed: false,
  assigned_user_name: "Sam Lee",
  estimated_hours: 120,
  actual_hours: 0,
  due_date: "2026-10-10",
  service_id: "svc-1",
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(params: Record<string, unknown> = { taskId: "task-1" }): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(ProjectTaskDetailScreen, { route: { params } as never, navigation: { navigate: vi.fn(), setOptions: vi.fn() } as never }));
  });
  await flush();
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => {
    const value = node.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

describe("ProjectTaskDetailScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.features.projects = true;
    mocks.getProjectTask.mockResolvedValue({ ok: true, data: { data: { ...task, project_id: "proj-1", project_status_mapping_id: "map-1" } } });
    mocks.getTaskChecklist.mockResolvedValue({ ok: true, data: { data: [
      { checklist_item_id: "i1", task_id: "task-1", item_name: "Mount rails", completed: true, order_number: 1 },
      { checklist_item_id: "i2", task_id: "task-1", item_name: "Patch uplinks", completed: false, order_number: 2 },
    ] } });
    mocks.updateTaskChecklistItem.mockResolvedValue({ ok: true, data: { data: { checklist_item_id: "i2", completed: true } } });
    mocks.listComments.mockResolvedValue({ ok: true, data: { data: [] } });
    mocks.listTaskStatusMappings.mockResolvedValue({ ok: true, data: { data: [
      { project_status_mapping_id: "map-1", project_id: "proj-1", status_name: "In Progress", display_order: 2, is_visible: true },
      { project_status_mapping_id: "map-2", project_id: "proj-1", custom_name: "Done", display_order: 3, is_visible: true, is_closed: true },
      { project_status_mapping_id: "map-x", project_id: "proj-1", status_name: "Hidden", display_order: 9, is_visible: false },
    ] } });
    mocks.updateProjectTask.mockResolvedValue({ ok: true, data: { data: task } });
    mocks.listTimeEntries.mockResolvedValue({ ok: true, data: { data: [
      { entry_id: "e1", billable_duration: 45, start_time: "2026-10-02T09:00:00Z", service_name: "Onsite", user_name: "Sam Lee", notes: "Cabling" },
      { entry_id: "e2", duration_hours: 0.5, start_time: "2026-10-01T09:00:00Z" },
    ], pagination: { total: 2 } } });
    mocks.getServices.mockResolvedValue({ ok: true, data: { data: [{ service_id: "svc-1", service_name: "Onsite" }] } });
  });

  it("loads the task by id and shows project, estimate and logged time", async () => {
    const renderer = await renderScreen();
    expect(mocks.getProjectTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: "task-1" }));
    expect(mocks.listTimeEntries).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ work_item_id: "task-1", work_item_type: "project_task" }));
    const all = texts(renderer);
    expect(all).toContain("Rack the switch");
    expect(all).toContain("HQ refresh • Deploy");
    expect(all).toContain("2h estimated · 1h 15m logged");
    expect(all).toContain("Cabling");
  });

  it("shows the start date only when the task has one", async () => {
    expect(texts(await renderScreen())).not.toContain("projectTask.startDateLabel");

    mocks.getProjectTask.mockResolvedValue({ ok: true, data: { data: { ...task, start_date: "2026-10-05" } } });
    const all = texts(await renderScreen());
    expect(all).toContain("projectTask.startDateLabel");
    expect(all.indexOf("projectTask.startDateLabel")).toBeLessThan(all.indexOf("projectTask.dueDateLabel"));
  });

  it("times the task with its own service and opens the log-time form against the task", async () => {
    const renderer = await renderScreen();
    const chip = renderer.root.find((n) => n.type === ("MockTimerChip" as never));
    expect(chip.props).toMatchObject({ workItemId: "task-1", workItemType: "project_task", preferredService: { service_id: "svc-1", service_name: "Onsite" } });

    act(() => renderer.root.find((n) => n.props?.testID === "project-task-log-time").props.onPress());
    const modal = renderer.root.find((n) => n.type === ("MockTimeEntryModal" as never));
    expect(modal.props.visible).toBe(true);
    expect(modal.props.serviceId).toBe("svc-1");
    expect(modal.props.serviceSource).toBe("task");
  });

  it("prefills, times and marks a service the task inherits from its phase", async () => {
    mocks.getProjectTask.mockResolvedValue({ ok: true, data: { data: {
      ...task,
      project_id: "proj-1",
      project_status_mapping_id: "map-1",
      service_id: null,
      effective_service_id: "svc-2",
      service_source: "phase",
      service_name: "Remote Support",
    } } });
    const renderer = await renderScreen();

    // The detail row says the service is not the task's own.
    expect(texts(renderer)).toContain("projectTask.serviceFrom.phase");

    const chip = renderer.root.find((n) => n.type === ("MockTimerChip" as never));
    expect(chip.props.preferredService).toEqual({ service_id: "svc-2", service_name: "Remote Support" });

    act(() => renderer.root.find((n) => n.props?.testID === "project-task-log-time").props.onPress());
    const modal = renderer.root.find((n) => n.type === ("MockTimeEntryModal" as never));
    expect(modal.props.serviceId).toBe("svc-2");
    expect(modal.props.serviceSource).toBe("phase");
  });

  it("leaves the service blank when no level of the hierarchy sets one", async () => {
    mocks.getProjectTask.mockResolvedValue({ ok: true, data: { data: {
      ...task,
      project_id: "proj-1",
      project_status_mapping_id: "map-1",
      service_id: null,
      effective_service_id: null,
      service_source: null,
      service_name: null,
    } } });
    const renderer = await renderScreen();

    const chip = renderer.root.find((n) => n.type === ("MockTimerChip" as never));
    expect(chip.props.preferredService).toBeNull();

    act(() => renderer.root.find((n) => n.props?.testID === "project-task-log-time").props.onPress());
    const modal = renderer.root.find((n) => n.type === ("MockTimeEntryModal" as never));
    expect(modal.props.serviceId).toBeNull();
    expect(modal.props.serviceSource).toBeNull();
  });

  it("paints from the activity row while the task loads and reloads after the timer stops here", async () => {
    mocks.getProjectTask.mockReturnValue(new Promise(() => {}));
    const renderer = await renderScreen({ taskId: "task-1", activity: { type: "projectTask", id: "task-1", title: "From activity", status: "in_progress", priority: "high", projectName: "HQ refresh" } });
    expect(texts(renderer)).toContain("From activity");
  });

  it("reduces time entry minutes from whichever duration field is present", () => {
    expect(timeEntryMinutes({ billable_duration: 30 })).toBe(30);
    expect(timeEntryMinutes({ duration_hours: 1.5 })).toBe(90);
    expect(timeEntryMinutes({ start_time: "2026-10-02T09:00:00Z", end_time: "2026-10-02T09:20:00Z" })).toBe(20);
    expect(timeEntryMinutes({})).toBe(0);
  });

  it("changes status from the project's visible mappings", async () => {
    const renderer = await renderScreen();
    await act(async () => renderer.root.find((n) => n.props?.testID === "project-task-status").props.onPress());
    await flush();
    expect(mocks.listTaskStatusMappings).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projectId: "proj-1" }));
    const picker = renderer.root.find((n) => n.type === ("MockEntityPicker" as never));
    expect(picker.props.visible).toBe(true);
    expect(picker.props.items.map((item: { label: string }) => item.label)).toEqual(["In Progress", "Done"]);

    await act(async () => picker.props.onSelect("map-2", "Done"));
    await flush();
    expect(mocks.updateProjectTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: "task-1", data: { project_status_mapping_id: "map-2" } }));
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "projectTask.statusUpdated", tone: "success" });
  });

  it("ticks checklist items and shows progress", async () => {
    const renderer = await renderScreen();
    expect(texts(renderer).some((text) => text.includes("projectTask.checklistProgress"))).toBe(true);
    await act(async () => renderer.root.find((n) => n.props?.testID === "project-task-checklist-i2").props.onPress());
    await flush();
    expect(mocks.updateTaskChecklistItem).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: "task-1", itemId: "i2", data: { completed: true } }));
  });

  it("renders task comments through the shared components with the task target", async () => {
    const renderer = await renderScreen();
    expect(mocks.listComments).toHaveBeenCalled();
    const section = renderer.root.find((n) => n.type === ("MockCommentsSection" as never));
    expect(section.props.target).toEqual({ kind: "project_task", taskId: "task-1" });
    expect(renderer.root.find((n) => n.type === ("MockCommentComposer" as never)).props.variant).toBe("task");
  });

  it("hides status, checklist and comments without the projects capability", async () => {
    mocks.features.projects = false;
    const renderer = await renderScreen();
    expect(mocks.getTaskChecklist).not.toHaveBeenCalled();
    expect(mocks.listComments).not.toHaveBeenCalled();
    expect(renderer.root.findAll((n) => n.type === ("MockCommentsSection" as never))).toHaveLength(0);
    expect(renderer.root.find((n) => n.props?.testID === "project-task-status").props.onPress).toBeUndefined();
  });
});
