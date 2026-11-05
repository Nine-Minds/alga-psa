import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  listProjectPhases: vi.fn(),
  listProjectTasks: vi.fn(),
  listProjectStatuses: vi.fn(),
  listTaskStatusMappings: vi.fn(),
  listUsers: vi.fn(),
  getClient: vi.fn(),
  createProjectTask: vi.fn(),
  listPriorities: vi.fn(),
  navigate: vi.fn(),
  // Stable object, like the real auth context: a fresh one per render would
  // rebuild the api client and re-run the load effect forever.
  authValue: {
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: () => Promise.resolve(null),
  },
  addListener: vi.fn(() => () => {}),
  showToast: vi.fn(),
  translate: (key: string, defOrOpts?: string | Record<string, unknown>, optsArg?: Record<string, unknown>) => {
    const def = typeof defOrOpts === "string" ? defOrOpts : undefined;
    const opts = typeof defOrOpts === "object" ? defOrOpts : optsArg;
    let out = def ?? key;
    if (opts) {
      for (const [name, value] of Object.entries(opts)) out = out.replaceAll(`{{${name}}}`, String(value));
    }
    return out;
  },
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.authValue }));
vi.mock("../capabilities/CapabilitiesContext", () => ({
  useCapabilities: () => ({ features: { projects: true }, loaded: true }),
}));
vi.mock("../config/appConfig", () => ({ getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }) }));
vi.mock("../api", () => ({ createApiClient: () => ({ request: vi.fn() }) }));
vi.mock("../api/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/projects")>()),
  getProject: (...args: unknown[]) => mocks.getProject(...args),
  listProjectPhases: (...args: unknown[]) => mocks.listProjectPhases(...args),
  listProjectTasks: (...args: unknown[]) => mocks.listProjectTasks(...args),
  listProjectStatuses: (...args: unknown[]) => mocks.listProjectStatuses(...args),
  createProjectTask: (...args: unknown[]) => mocks.createProjectTask(...args),
}));
vi.mock("../api/projectTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/projectTasks")>()),
  listTaskStatusMappings: (...args: unknown[]) => mocks.listTaskStatusMappings(...args),
}));
vi.mock("../api/users", () => ({
  listUsers: (...args: unknown[]) => mocks.listUsers(...args),
  getUserDisplayName: (user: { first_name?: string; last_name?: string }) =>
    `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim(),
}));
vi.mock("../api/clients", () => ({ getClient: (...args: unknown[]) => mocks.getClient(...args) }));
vi.mock("../api/priorities", () => ({ listPriorities: (...args: unknown[]) => mocks.listPriorities(...args) }));
vi.mock("../ui/toast/ToastProvider", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("../logging/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { ProjectDetailScreen } from "./ProjectDetailScreen";

const PHASES = [
  { phase_id: "ph-2", phase_name: "Cabling", wbs_code: "2", order_number: 2 },
  { phase_id: "ph-1", phase_name: "Survey", wbs_code: "1", order_number: 1 },
];

const MAPPINGS = [
  { project_status_mapping_id: "m-open", project_id: "p-1", status_name: "In Progress", is_closed: false, display_order: 1 },
  { project_status_mapping_id: "m-done", project_id: "p-1", status_name: "Done", is_closed: true, display_order: 2 },
];

const TASKS = [
  { task_id: "t-1", phase_id: "ph-1", task_name: "Walk the floor", project_status_mapping_id: "m-done" },
  { task_id: "t-2", phase_id: "ph-1", task_name: "Draw the plan", project_status_mapping_id: "m-done" },
  { task_id: "t-3", phase_id: "ph-1", task_name: "Sign off", project_status_mapping_id: "m-open" },
  { task_id: "t-4", phase_id: "ph-1", task_name: "Order parts", project_status_mapping_id: "m-open" },
  {
    task_id: "t-5",
    phase_id: "ph-1",
    task_name: "Late one",
    project_status_mapping_id: "m-open",
    due_date: "2020-01-01",
    assigned_to: "user-9",
  },
];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(ProjectDetailScreen, {
        navigation: { navigate: mocks.navigate, addListener: mocks.addListener },
        route: { params: { projectId: "p-1", projectName: "Office move" } },
      } as never),
    );
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

describe("ProjectDetailScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockResolvedValue({
      ok: true,
      data: {
        data: {
          project_id: "p-1",
          project_name: "Office move",
          client_id: "cl-1",
          status: "st-open",
          assigned_to: "user-7",
          start_date: "2026-10-01",
          end_date: "2026-11-02",
        },
      },
    });
    mocks.listProjectPhases.mockResolvedValue({ ok: true, data: { data: PHASES } });
    mocks.listProjectTasks.mockResolvedValue({ ok: true, data: { data: TASKS } });
    mocks.listTaskStatusMappings.mockResolvedValue({ ok: true, data: { data: MAPPINGS } });
    mocks.listProjectStatuses.mockResolvedValue({
      ok: true,
      data: { data: [{ status_id: "st-open", name: "In Progress", is_closed: false }], pagination: { total: 1 } },
    });
    mocks.listUsers.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { user_id: "user-7", first_name: "Ada", last_name: "Byron", username: "ada" },
          { user_id: "user-9", first_name: "Tin", last_name: "Man", username: "tin" },
        ],
        pagination: { total: 2 },
      },
    });
    mocks.getClient.mockResolvedValue({ ok: true, data: { data: { client_id: "cl-1", client_name: "ECTS" } } });
    mocks.listPriorities.mockResolvedValue({ ok: true, data: { data: [], pagination: { total: 0 } } });
  });

  it("T020 renders the name, client, status and manager", async () => {
    const renderer = await renderScreen();
    const all = texts(renderer);
    expect(all).toContain("Office move");
    expect(all).toContain("ECTS");
    expect(all).toContain("In Progress");
    expect(all).toContain("Ada Byron");
  });

  it("T021 opens ClientDetail from the client row", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "project-client").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("ClientDetail", { clientId: "cl-1", clientName: "ECTS" });
  });

  it("T022 shows the per-phase done count with closed mappings counted", async () => {
    const renderer = await renderScreen();
    expect(texts(renderer)).toContain("2 of 5 done");
  });

  it("T025 hides closed tasks until Show completed is pressed", async () => {
    const renderer = await renderScreen();
    expect(texts(renderer)).not.toContain("Walk the floor");
    expect(texts(renderer)).toContain("Show 2 completed");

    await act(async () =>
      renderer.root.find((n) => n.props?.testID === "project-phase-ph-1-show-completed").props.onPress(),
    );

    expect(texts(renderer)).toContain("Walk the floor");
  });

  it("T023 marks a past due date on an open task as danger", async () => {
    const renderer = await renderScreen();
    const due = renderer.root.find((n) => n.props?.testID === "project-task-due-t-5");
    expect(due.props.style.fontWeight).toBe("700");
  });

  it("T024 opens the task detail on tap", async () => {
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "project-task-row-t-3").props.onPress());

    expect(mocks.navigate).toHaveBeenCalledWith("ProjectTaskDetail", { taskId: "t-3" });
  });

  it("T026 shows the no-phases state for a project without phases", async () => {
    mocks.listProjectPhases.mockResolvedValue({ ok: true, data: { data: [] } });
    mocks.listProjectTasks.mockResolvedValue({ ok: true, data: { data: [] } });
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain("No phases yet. Add phases on the web.");
  });

  it("T027 reloads the project when the screen regains focus", async () => {
    await renderScreen();
    expect(mocks.addListener).toHaveBeenCalledWith("focus", expect.any(Function));

    const calls = mocks.getProject.mock.calls.length;
    const focusCall = mocks.addListener.mock.calls.find((call) => (call as unknown[])[0] === "focus") as unknown[];
    const handler = focusCall[1] as () => void;
    await act(async () => handler());
    await flush();

    expect(mocks.getProject.mock.calls.length).toBeGreaterThan(calls);
  });

  it("T029 creates a task with the first status mapping and adds it to the phase", async () => {
    mocks.createProjectTask.mockResolvedValue({
      ok: true,
      data: { data: { task_id: "t-new", phase_id: "ph-1", task_name: "Label patch panel", project_status_mapping_id: "m-open" } },
    });
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "project-phase-ph-1-add-task").props.onPress());
    await flush();

    // T028 Save is disabled until the name has content.
    expect(renderer.root.find((n) => n.props?.testID === "create-task-save").props.disabled).toBe(true);
    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-name").props.onChangeText("Label patch panel"));
    expect(renderer.root.find((n) => n.props?.testID === "create-task-save").props.disabled).toBe(false);

    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-save").props.onPress());
    await flush();

    expect(mocks.createProjectTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "p-1",
        phaseId: "ph-1",
        data: expect.objectContaining({ task_name: "Label patch panel", project_status_mapping_id: "m-open" }),
      }),
    );
    expect(texts(renderer)).toContain("Label patch panel");
    expect(mocks.showToast).toHaveBeenCalledWith({ message: "Task created", tone: "success" });
  });

  it("T120 sends the estimate in minutes, the unit the column stores", async () => {
    mocks.createProjectTask.mockResolvedValue({
      ok: true,
      data: { data: { task_id: "t-new", phase_id: "ph-1", task_name: "Label patch panel" } },
    });
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "project-phase-ph-1-add-task").props.onPress());
    await flush();
    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-name").props.onChangeText("Label patch panel"));
    await act(async () =>
      renderer.root.find((n) => n.props?.testID === "create-task-estimated-hours").props.onChangeText("2.5"),
    );
    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-save").props.onPress());
    await flush();

    expect(mocks.createProjectTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ estimated_hours: 150 }) }),
    );
  });

  it("T030 keeps the modal open with an error when the create fails", async () => {
    mocks.createProjectTask.mockResolvedValue({ ok: false, error: { kind: "server", message: "boom", status: 500 } });
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "project-phase-ph-1-add-task").props.onPress());
    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-name").props.onChangeText("Nope"));
    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-save").props.onPress());
    await flush();

    expect(renderer.root.find((n) => n.props?.testID === "create-task-error")).toBeTruthy();
    expect(renderer.root.find((n) => n.props?.testID === "create-task-name").props.value).toBe("Nope");
  });

  it("T028 hides the add-task affordance after a 403 from the create route", async () => {
    mocks.createProjectTask.mockResolvedValue({ ok: false, error: { kind: "permission", message: "no", status: 403 } });
    const renderer = await renderScreen();

    await act(async () => renderer.root.find((n) => n.props?.testID === "project-phase-ph-1-add-task").props.onPress());
    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-name").props.onChangeText("Nope"));
    await act(async () => renderer.root.find((n) => n.props?.testID === "create-task-save").props.onPress());
    await flush();

    expect(renderer.root.findAll((n) => n.props?.testID === "project-phase-ph-1-add-task")).toHaveLength(0);
  });
});
