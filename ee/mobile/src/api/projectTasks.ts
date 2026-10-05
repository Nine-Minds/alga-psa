import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

/** Hierarchy level a task's default time-entry service came from. */
export type ProjectTaskServiceSource = "task" | "phase" | "project";

/** A project task as GET /api/v1/projects/tasks/{taskId} returns it; hours fields hold minutes. */
export type ProjectTaskDetail = {
  task_id: string;
  task_name: string;
  description?: string | null;
  phase_id: string;
  phase_name?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  client_id?: string | null;
  project_status_mapping_id?: string | null;
  status_name?: string | null;
  is_closed?: boolean;
  assigned_to?: string | null;
  assigned_user_name?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  due_date?: string | null;
  service_id?: string | null;
  /** The task's own service, else its phase's default, else its project's. */
  effective_service_id?: string | null;
  /** Which level `effective_service_id` came from; null when no level sets one. */
  service_source?: ProjectTaskServiceSource | null;
  /** Name of the service `effective_service_id` points at. */
  service_name?: string | null;
  wbs_code?: string | null;
  updated_at?: string | null;
};

export function getProjectTask(
  client: ApiClient,
  params: { apiKey: string; taskId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ProjectTaskDetail>>> {
  return client.request<SuccessResponse<ProjectTaskDetail>>({
    method: "GET",
    path: `/api/v1/projects/tasks/${params.taskId}`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export type TaskStatusMapping = {
  project_status_mapping_id: string;
  project_id: string;
  status_name?: string | null;
  name?: string | null;
  custom_name?: string | null;
  is_closed?: boolean;
  is_visible?: boolean;
  display_order?: number;
};

export function statusMappingLabel(mapping: TaskStatusMapping): string {
  return mapping.custom_name?.trim() || mapping.status_name?.trim() || mapping.name?.trim() || "";
}

/** The statuses a task in this project can take; tasks move between project status mappings. */
export function listTaskStatusMappings(
  client: ApiClient,
  params: { apiKey: string; projectId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<TaskStatusMapping[]>>> {
  return client.request<SuccessResponse<TaskStatusMapping[]>>({
    method: "GET",
    path: `/api/v1/projects/${params.projectId}/task-status-mappings`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function updateProjectTask(
  client: ApiClient,
  params: {
    apiKey: string;
    taskId: string;
    data: { project_status_mapping_id?: string; task_name?: string; description?: string | null };
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<ProjectTaskDetail>>> {
  return client.request<SuccessResponse<ProjectTaskDetail>>({
    method: "PUT",
    path: `/api/v1/projects/tasks/${params.taskId}`,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: params.data,
  });
}

export type TaskChecklistItem = {
  checklist_item_id: string;
  task_id: string;
  item_name: string;
  description?: string | null;
  completed: boolean;
  order_number?: number;
  assigned_to?: string | null;
  due_date?: string | null;
};

export function getTaskChecklist(
  client: ApiClient,
  params: { apiKey: string; taskId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<TaskChecklistItem[]>>> {
  return client.request<SuccessResponse<TaskChecklistItem[]>>({
    method: "GET",
    path: `/api/v1/projects/tasks/${params.taskId}/checklist`,
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function updateTaskChecklistItem(
  client: ApiClient,
  params: { apiKey: string; taskId: string; itemId: string; data: { completed?: boolean; item_name?: string }; auditHeaders?: Record<string, string | undefined> },
): Promise<ApiResult<SuccessResponse<TaskChecklistItem>>> {
  return client.request<SuccessResponse<TaskChecklistItem>>({
    method: "PUT",
    path: `/api/v1/projects/tasks/${params.taskId}/checklist/${params.itemId}`,
    headers: { "x-api-key": params.apiKey, ...params.auditHeaders },
    body: params.data,
  });
}
