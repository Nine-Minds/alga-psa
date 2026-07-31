import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

/**
 * Workflow-task (EE) API client — SINGLE RECONCILIATION POINT.
 *
 * RECONCILE (Wave 3): the v1 workflow-task endpoints are being finalized in a
 * sibling task. Every workflow-task HTTP call and its response typing lives in
 * THIS file so reconciliation touches exactly one module. Assumptions built to
 * the PLANNED contract from the implementation plan:
 *
 *   GET    /api/v1/workflows/tasks            → PaginatedResponse<WorkflowTaskSummary>
 *   GET    /api/v1/workflows/tasks/{id}       → SuccessResponse<WorkflowTaskDetail>
 *   POST   /api/v1/workflows/tasks/{id}/claim → SuccessResponse<{ success: true }>
 *   POST   /api/v1/workflows/tasks/{id}/unclaim → SuccessResponse<{ success: true }>
 *   POST   /api/v1/workflows/tasks/{id}/complete (body { formData, comments? })
 *                                             → SuccessResponse<{ success: true }>
 *
 * RECONCILED (Wave 3): claim / unclaim / complete return only an acknowledgement
 * (`{ data: { success: true } }`), NOT the updated task — the detail screen re-fetches via
 * `getWorkflowTaskDetails` after a successful mutation. Field names mirror the EE
 * `TaskDetails` shape (shared/workflow/persistence/taskInboxInterfaces.ts):
 * camelCase taskId/executionId/formSchema{jsonSchema,uiSchema,defaultValues}, etc.
 */

export type WorkflowTaskStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "canceled"
  | "expired";

export type WorkflowTaskFormSchema = {
  jsonSchema?: Record<string, unknown>;
  uiSchema?: Record<string, unknown>;
  defaultValues?: Record<string, unknown>;
};

export type WorkflowTaskSummary = {
  taskId: string;
  executionId?: string;
  title: string;
  description?: string | null;
  status: WorkflowTaskStatus;
  priority?: string | null;
  dueDate?: string | null;
  assignedRoles?: string[];
  assignedUsers?: string[];
  contextData?: Record<string, unknown>;
  createdAt?: string;
  claimedBy?: string | null;
  claimedAt?: string | null;
};

export type WorkflowTaskDetail = WorkflowTaskSummary & {
  formId?: string;
  formSchema?: WorkflowTaskFormSchema;
};

/**
 * The acknowledgement body returned by claim / unclaim / complete. The backend wraps this in
 * `{ data: { success: true } }`; it does NOT echo the task, so callers re-fetch the detail.
 */
export type WorkflowTaskActionResult = {
  success: boolean;
};

export type ListWorkflowTasksParams = {
  apiKey: string;
  page?: number;
  pageSize?: number;
  /** Workflow-task lifecycle status filter (e.g. "pending" | "claimed"). */
  status?: string;
  signal?: AbortSignal;
};

export function listWorkflowTasks(
  client: ApiClient,
  params: ListWorkflowTasksParams,
): Promise<ApiResult<PaginatedResponse<WorkflowTaskSummary>>> {
  return client.request<PaginatedResponse<WorkflowTaskSummary>>({
    method: "GET",
    path: "/api/v1/workflows/tasks",
    signal: params.signal,
    query: {
      page: params.page,
      pageSize: params.pageSize,
      status: params.status,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getWorkflowTaskDetails(
  client: ApiClient,
  params: { apiKey: string; taskId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<WorkflowTaskDetail>>> {
  return client.request<SuccessResponse<WorkflowTaskDetail>>({
    method: "GET",
    path: `/api/v1/workflows/tasks/${params.taskId}`,
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function claimWorkflowTask(
  client: ApiClient,
  params: { apiKey: string; taskId: string },
): Promise<ApiResult<SuccessResponse<WorkflowTaskActionResult>>> {
  return client.request<SuccessResponse<WorkflowTaskActionResult>>({
    method: "POST",
    path: `/api/v1/workflows/tasks/${params.taskId}/claim`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function unclaimWorkflowTask(
  client: ApiClient,
  params: { apiKey: string; taskId: string },
): Promise<ApiResult<SuccessResponse<WorkflowTaskActionResult>>> {
  return client.request<SuccessResponse<WorkflowTaskActionResult>>({
    method: "POST",
    path: `/api/v1/workflows/tasks/${params.taskId}/unclaim`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function completeWorkflowTask(
  client: ApiClient,
  params: {
    apiKey: string;
    taskId: string;
    formData: Record<string, unknown>;
    comments?: string;
  },
): Promise<ApiResult<SuccessResponse<WorkflowTaskActionResult>>> {
  return client.request<SuccessResponse<WorkflowTaskActionResult>>({
    method: "POST",
    path: `/api/v1/workflows/tasks/${params.taskId}/complete`,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: {
      formData: params.formData,
      ...(params.comments ? { comments: params.comments } : {}),
    },
  });
}
