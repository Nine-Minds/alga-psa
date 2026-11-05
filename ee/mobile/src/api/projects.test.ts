import { describe, expect, it, vi } from "vitest";
import {
  createProjectTask,
  getProject,
  groupTasksByPhase,
  listProjectPhases,
  listProjectTasks,
  listProjects,
  listProjectStatuses,
  ORPHAN_PHASE_ID,
  projectProgress,
  statusTone,
  type ProjectPhase,
  type ProjectTaskSummary,
} from "./projects";
import type { ApiClient } from "./client";
import type { TaskStatusMapping } from "./projectTasks";

function mockClient(response: unknown = { ok: true, data: { data: [] } }): ApiClient {
  return { request: vi.fn().mockResolvedValue(response) } as unknown as ApiClient;
}

function phase(phase_id: string, wbs_code: string, order_number = 0): ProjectPhase {
  return { phase_id, phase_name: `Phase ${wbs_code}`, wbs_code, order_number };
}

function task(
  task_id: string,
  phase_id: string,
  mapping: string,
  extra: Partial<ProjectTaskSummary> = {},
): ProjectTaskSummary {
  return { task_id, phase_id, task_name: task_id, project_status_mapping_id: mapping, ...extra };
}

const mappings: TaskStatusMapping[] = [
  { project_status_mapping_id: "m-open", project_id: "p1", is_closed: false, display_order: 1 },
  { project_status_mapping_id: "m-done", project_id: "p1", is_closed: true, display_order: 2 },
];

describe("projects api", () => {
  it("T007 sends only the provided filters and parses pagination.total", async () => {
    const client = mockClient({
      ok: true,
      data: { data: [{ project_id: "p1" }], pagination: { page: 1, limit: 25, total: 7 } },
    });

    const result = await listProjects(client, {
      apiKey: "key-1",
      page: 2,
      limit: 25,
      project_name: "office",
      assigned_to: "user-1",
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/projects",
      signal: undefined,
      query: {
        page: 2,
        limit: 25,
        project_name: "office",
        status: undefined,
        client_id: undefined,
        assigned_to: "user-1",
        sort: "updated_at",
        order: "desc",
      },
      headers: { "x-api-key": "key-1" },
    });
    expect(result.ok && result.data.pagination.total).toBe(7);
  });

  it("drops an empty search string instead of filtering on it", async () => {
    const client = mockClient();

    await listProjects(client, { apiKey: "key-1", project_name: "" });

    const call = (client.request as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.query.project_name).toBeUndefined();
  });

  it("reads a project, its phases and its tasks from the v1 routes", async () => {
    const client = mockClient();

    await getProject(client, { apiKey: "key-1", projectId: "p1" });
    await listProjectPhases(client, { apiKey: "key-1", projectId: "p1" });
    await listProjectTasks(client, { apiKey: "key-1", projectId: "p1" });

    const paths = (client.request as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0].path,
    );
    expect(paths).toEqual([
      "/api/v1/projects/p1",
      "/api/v1/projects/p1/phases",
      "/api/v1/projects/p1/tasks",
    ]);
  });

  it("T008 posts a task to the phase route and refuses one with no status mapping", async () => {
    const client = mockClient({ ok: true, data: { data: { task_id: "t1" } } });

    await createProjectTask(client, {
      apiKey: "key-1",
      projectId: "p1",
      phaseId: "ph1",
      data: { task_name: "Label patch panel", project_status_mapping_id: "m-open" },
    });

    expect(client.request).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/v1/projects/p1/phases/ph1/tasks",
      signal: undefined,
      headers: { "x-api-key": "key-1" },
      body: { task_name: "Label patch panel", project_status_mapping_id: "m-open" },
    });

    const refused = await createProjectTask(client, {
      apiKey: "key-1",
      projectId: "p1",
      phaseId: "ph1",
      data: { task_name: "No status", project_status_mapping_id: "" },
    });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.kind).toBe("validation");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("T009 orders phases by wbs code, counts closed mappings as done and buckets orphans last", () => {
    const sections = groupTasksByPhase(
      [phase("b", "2"), phase("a", "1"), phase("c", "10")],
      [
        task("t1", "a", "m-done"),
        task("t2", "a", "m-open"),
        task("t3", "b", "m-done"),
        task("t4", "gone", "m-open"),
      ],
      mappings,
    );

    expect(sections.map((s) => s.phase.phase_id)).toEqual(["a", "b", "c", ORPHAN_PHASE_ID]);
    expect(sections[0]).toMatchObject({ doneCount: 1, totalCount: 2 });
    expect(sections[1]).toMatchObject({ doneCount: 1, totalCount: 1 });
    expect(sections[2]).toMatchObject({ doneCount: 0, totalCount: 0 });
    expect(sections[3].tasks.map((t) => t.task_id)).toEqual(["t4"]);
  });

  it("treats an is_closed flag on the task itself as done", () => {
    const sections = groupTasksByPhase(
      [phase("a", "1")],
      [task("t1", "a", "m-open", { is_closed: true })],
      mappings,
    );
    expect(sections[0].doneCount).toBe(1);
  });

  it("T010 returns every phase with 0 of 0 when the project has no tasks", () => {
    const sections = groupTasksByPhase([phase("a", "1"), phase("b", "2")], [], mappings);

    expect(sections).toHaveLength(2);
    expect(sections.every((s) => s.doneCount === 0 && s.totalCount === 0)).toBe(true);
  });

  it("T011 returns ratio 0 for an empty project and 0.5 for 2 of 4", () => {
    expect(projectProgress([])).toEqual({ done: 0, total: 0, ratio: 0 });

    const sections = groupTasksByPhase(
      [phase("a", "1")],
      [
        task("t1", "a", "m-done"),
        task("t2", "a", "m-done"),
        task("t3", "a", "m-open"),
        task("t4", "a", "m-open"),
      ],
      mappings,
    );
    expect(projectProgress(sections)).toEqual({ done: 2, total: 4, ratio: 0.5 });
  });

  it("reads tenant project statuses from the statuses route", async () => {
    const client = mockClient({ ok: true, data: { data: [], pagination: { page: 1, limit: 100, total: 0 } } });

    await listProjectStatuses(client, { apiKey: "key-1" });

    expect(client.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v1/statuses",
      signal: undefined,
      query: { type: "project", limit: 100 },
      headers: { "x-api-key": "key-1" },
    });
  });

  it("T012 maps all six project statuses and falls back to neutral", () => {
    expect(statusTone("planning")).toBe("neutral");
    expect(statusTone("on_hold")).toBe("neutral");
    expect(statusTone("active")).toBe("info");
    expect(statusTone("in_progress")).toBe("info");
    expect(statusTone("completed")).toBe("success");
    expect(statusTone("cancelled")).toBe("danger");
    expect(statusTone("something-else")).toBe("neutral");
    expect(statusTone(null)).toBe("neutral");
    // Tenant status rows are seeded with display names, not slugs.
    expect(statusTone("In Progress")).toBe("info");
    expect(statusTone("On Hold")).toBe("neutral");
    expect(statusTone("Planned")).toBe("neutral");
  });
});
