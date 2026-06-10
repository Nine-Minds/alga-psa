import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

export type ScheduleWorkItemType = "ticket" | "project_task" | "meeting" | "break" | "other";

export type ScheduleAssignedUser = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export type ScheduleWorkItem = {
  id: string;
  title: string;
  type: string;
};

export type ScheduleEntry = {
  entry_id: string;
  title: string;
  scheduled_start: string;
  scheduled_end: string;
  work_item_id: string | null;
  work_item_type: string | null;
  notes: string | null;
  is_private: boolean;
  status?: string | null;
  recurrence_pattern?: string | Record<string, unknown> | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  assigned_users?: ScheduleAssignedUser[];
  work_item?: ScheduleWorkItem | null;
  duration_hours?: number;
  is_current?: boolean;
};

export type CreateScheduleEntryInput = {
  title: string;
  scheduled_start: string;
  scheduled_end: string;
  work_item_id?: string;
  work_item_type?: ScheduleWorkItemType;
  assigned_user_ids?: string[];
  notes?: string;
  is_private?: boolean;
  recurrence_pattern?: string;
};

export type UpdateScheduleEntryInput = Partial<CreateScheduleEntryInput>;

export function listScheduleEntries(
  client: ApiClient,
  params: {
    apiKey: string;
    startDate: string;
    endDate: string;
    userId?: string;
    signal?: AbortSignal;
  },
): Promise<ApiResult<SuccessResponse<ScheduleEntry[]>>> {
  return client.request<SuccessResponse<ScheduleEntry[]>>({
    method: "GET",
    path: "/api/v1/schedules",
    signal: params.signal,
    query: {
      start_date: params.startDate,
      end_date: params.endDate,
      user_id: params.userId,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function createScheduleEntry(
  client: ApiClient,
  params: { apiKey: string; entry: CreateScheduleEntryInput },
): Promise<ApiResult<SuccessResponse<ScheduleEntry>>> {
  return client.request<SuccessResponse<ScheduleEntry>>({
    method: "POST",
    path: "/api/v1/schedules",
    headers: {
      "x-api-key": params.apiKey,
    },
    body: params.entry,
  });
}

export function updateScheduleEntry(
  client: ApiClient,
  params: { apiKey: string; entryId: string; entry: UpdateScheduleEntryInput },
): Promise<ApiResult<SuccessResponse<ScheduleEntry>>> {
  return client.request<SuccessResponse<ScheduleEntry>>({
    method: "PUT",
    path: `/api/v1/schedules/${params.entryId}`,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: params.entry,
  });
}

export function deleteScheduleEntry(
  client: ApiClient,
  params: { apiKey: string; entryId: string },
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "DELETE",
    path: `/api/v1/schedules/${params.entryId}`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}
