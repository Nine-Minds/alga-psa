import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";
import type { TimeEntry, WorkItemType } from "./timeEntries";

export type ActiveTimeSession = {
  session_id: string;
  work_item_id: string | null;
  work_item_type: WorkItemType;
  start_time: string;
  notes: string | null;
  service_id: string | null;
  user_id: string;
  elapsed_minutes: number;
  work_item_title?: string | null;
  service_name?: string | null;
};

export function startTimeTracking(
  client: ApiClient,
  params: {
    apiKey: string;
    work_item_type: WorkItemType;
    work_item_id?: string;
    service_id: string;
    notes?: string;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<ActiveTimeSession>>> {
  return client.request<SuccessResponse<ActiveTimeSession>>({
    method: "POST",
    path: "/api/v1/time-entries/start-tracking",
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      work_item_type: params.work_item_type,
      work_item_id: params.work_item_id,
      service_id: params.service_id,
      notes: params.notes,
    },
  });
}

export function getActiveTimeSession(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<ActiveTimeSession | null>>> {
  return client.request<SuccessResponse<ActiveTimeSession | null>>({
    method: "GET",
    path: "/api/v1/time-entries/active-session",
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function stopTimeTracking(
  client: ApiClient,
  params: {
    apiKey: string;
    sessionId: string;
    end_time?: string;
    notes?: string;
    service_id?: string;
    is_billable?: boolean;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TimeEntry>>> {
  return client.request<SuccessResponse<TimeEntry>>({
    method: "POST",
    path: `/api/v1/time-entries/stop-tracking/${params.sessionId}`,
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      end_time: params.end_time,
      notes: params.notes,
      service_id: params.service_id,
      is_billable: params.is_billable,
    },
  });
}
