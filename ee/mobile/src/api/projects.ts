import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";
import type { TaskStatusMapping } from "./projectTasks";

/** The project lifecycle names the tenant status rows are seeded with. */
export const PROJECT_STATUSES = [
  "planning",
  "active",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type BadgeTone = "neutral" | "info" | "success" | "danger";

const STATUS_TONES: Record<ProjectStatus, BadgeTone> = {
  planning: "neutral",
  on_hold: "neutral",
  active: "info",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};

/** Accepts a slug or a tenant status name ("On Hold", "In Progress", "Planned"). */
export function statusTone(status: string | null | undefined): BadgeTone {
  if (!status) return "neutral";
  const slug = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (slug === "planned") return "neutral";
  if (slug === "done") return "success";
  return STATUS_TONES[slug as ProjectStatus] ?? "neutral";
}

/** A tenant project status row; `projects.status` holds its status_id. */
export type ProjectStatusOption = {
  status_id: string;
  name: string;
  is_closed: boolean;
  order_number?: number;
};

export function listProjectStatuses(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<PaginatedResponse<ProjectStatusOption>>> {
  return client.request<PaginatedResponse<ProjectStatusOption>>({
    method: "GET",
    path: "/api/v1/statuses",
    signal: params.signal,
    query: { type: "project", limit: 100 },
    headers: { "x-api-key": params.apiKey },
  });
}

export type ProjectListItem = {
  project_id: string;
  client_id: string;
  project_number?: string | null;
  project_name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
  status_name?: string | null;
  is_closed?: boolean;
  is_inactive?: boolean;
  assigned_to?: string | null;
  client_name?: string | null;
  wbs_code?: string | null;
};

export type ProjectPhase = {
  phase_id: string;
  project_id?: string;
  phase_name: string;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  order_number?: number;
  wbs_code?: string | null;
};

export type ProjectStatistics = {
  total_phases?: number;
  total_tasks?: number;
  completed_tasks?: number;
  total_estimated_hours?: number;
  total_actual_hours?: number;
  progress_percentage?: number;
};

export type ProjectDetail = ProjectListItem & {
  client?: { client_id: string; client_name: string } | null;
  assigned_user?: { user_id: string; first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  phases?: ProjectPhase[];
  statistics?: ProjectStatistics;
};

export type ProjectTaskSummary = {
  task_id: string;
  phase_id: string;
  task_name: string;
  description?: string | null;
  assigned_to?: string | null;
  assigned_user_name?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  priority_id?: string | null;
  priority_name?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  project_status_mapping_id?: string | null;
  status_name?: string | null;
  is_closed?: boolean;
  wbs_code?: string | null;
};

export type ListProjectsParams = {
  apiKey: string;
  page?: number;
  limit?: number;
  project_name?: string;
  /** A status_id; the column is a FK to statuses, not a name. */
  status?: string;
  client_id?: string;
  assigned_to?: string;
  signal?: AbortSignal;
};

export function listProjects(
  client: ApiClient,
  params: ListProjectsParams,
): Promise<ApiResult<PaginatedResponse<ProjectListItem>>> {
  return client.request<PaginatedResponse<ProjectListItem>>({
    method: "GET",
    path: "/api/v1/projects",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      project_name: params.project_name || undefined,
      status: params.status,
      client_id: params.client_id,
      assigned_to: params.assigned_to,
      sort: "updated_at",
      order: "desc",
    },
    headers: { "x-api-key": params.apiKey },
  });
}

export function getProject(
  client: ApiClient,
  params: { apiKey: string; projectId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ProjectDetail>>> {
  return client.request<SuccessResponse<ProjectDetail>>({
    method: "GET",
    path: `/api/v1/projects/${params.projectId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

/** Phases come back unpaginated, already in order_key then order_number order. */
export function listProjectPhases(
  client: ApiClient,
  params: { apiKey: string; projectId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ProjectPhase[]>>> {
  return client.request<SuccessResponse<ProjectPhase[]>>({
    method: "GET",
    path: `/api/v1/projects/${params.projectId}/phases`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

/** Every task of the project, unpaginated; rows are raw project_tasks columns. */
export function listProjectTasks(
  client: ApiClient,
  params: { apiKey: string; projectId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ProjectTaskSummary[]>>> {
  return client.request<SuccessResponse<ProjectTaskSummary[]>>({
    method: "GET",
    path: `/api/v1/projects/${params.projectId}/tasks`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type CreateProjectTaskInput = {
  task_name: string;
  /** The v1 route rejects a task with no status mapping, so the caller must resolve one first. */
  project_status_mapping_id: string;
  description?: string;
  assigned_to?: string;
  due_date?: string;
  priority_id?: string;
  estimated_hours?: number;
};

export function createProjectTask(
  client: ApiClient,
  params: {
    apiKey: string;
    projectId: string;
    phaseId: string;
    data: CreateProjectTaskInput;
    auditHeaders?: Record<string, string | undefined>;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ProjectTaskSummary>>> {
  if (!params.data.project_status_mapping_id) {
    return Promise.resolve({
      ok: false,
      error: {
        kind: "validation",
        message: "project_status_mapping_id is required",
        status: 400,
      },
    });
  }
  return client.request<SuccessResponse<ProjectTaskSummary>>({
    method: "POST",
    path: `/api/v1/projects/${params.projectId}/phases/${params.phaseId}/tasks`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: params.data,
  });
}

export type PhaseWithTasks = {
  phase: ProjectPhase;
  tasks: ProjectTaskSummary[];
  doneCount: number;
  totalCount: number;
};

/** Phase ids the server never sent; their tasks still have to show somewhere. */
export const ORPHAN_PHASE_ID = "__other__";

function wbsOrder(a: ProjectPhase, b: ProjectPhase): number {
  const aCode = a.wbs_code ?? "";
  const bCode = b.wbs_code ?? "";
  if (aCode && bCode && aCode !== bCode) {
    return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: "base" });
  }
  return (a.order_number ?? 0) - (b.order_number ?? 0);
}

function isTaskDone(task: ProjectTaskSummary, closedMappings: Set<string>): boolean {
  if (task.is_closed === true) return true;
  return task.project_status_mapping_id ? closedMappings.has(task.project_status_mapping_id) : false;
}

/**
 * Phases in WBS order with their tasks and done counts. Tasks whose phase the
 * detail payload did not include land in a trailing "Other" bucket rather than
 * disappearing from the screen.
 */
export function groupTasksByPhase(
  phases: ProjectPhase[],
  tasks: ProjectTaskSummary[],
  statusMappings: TaskStatusMapping[] = [],
): PhaseWithTasks[] {
  const closedMappings = new Set(
    statusMappings.filter((m) => m.is_closed).map((m) => m.project_status_mapping_id),
  );
  const ordered = [...phases].sort(wbsOrder);
  const byPhase = new Map<string, ProjectTaskSummary[]>();
  for (const phase of ordered) byPhase.set(phase.phase_id, []);

  const orphans: ProjectTaskSummary[] = [];
  for (const task of tasks) {
    const bucket = byPhase.get(task.phase_id);
    if (bucket) bucket.push(task);
    else orphans.push(task);
  }

  const sections: PhaseWithTasks[] = ordered.map((phase) => {
    const phaseTasks = byPhase.get(phase.phase_id) ?? [];
    return {
      phase,
      tasks: phaseTasks,
      doneCount: phaseTasks.filter((task) => isTaskDone(task, closedMappings)).length,
      totalCount: phaseTasks.length,
    };
  });

  if (orphans.length > 0) {
    sections.push({
      phase: { phase_id: ORPHAN_PHASE_ID, phase_name: "", wbs_code: null },
      tasks: orphans,
      doneCount: orphans.filter((task) => isTaskDone(task, closedMappings)).length,
      totalCount: orphans.length,
    });
  }

  return sections;
}

export function projectProgress(sections: PhaseWithTasks[]): {
  done: number;
  total: number;
  ratio: number;
} {
  const done = sections.reduce((sum, section) => sum + section.doneCount, 0);
  const total = sections.reduce((sum, section) => sum + section.totalCount, 0);
  return { done, total, ratio: total === 0 ? 0 : done / total };
}
