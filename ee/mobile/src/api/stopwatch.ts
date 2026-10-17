import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";
import type { TimeEntry, WorkItemType } from "./timeEntries";

export type StopwatchSessionStatus = "running" | "paused" | "logged" | "discarded";

export type StopwatchSegment = {
  segment_id: string;
  started_at: string;
  /** null = open segment */
  ended_at: string | null;
};

/** Mirrors StopwatchSessionView in packages/scheduling/src/lib/stopwatch/stopwatchTypes.ts. */
export type StopwatchSession = {
  session_id: string;
  user_id: string;
  work_item_type: WorkItemType;
  work_item_id: string | null;
  service_id: string | null;
  notes: string;
  status: StopwatchSessionStatus;
  time_entry_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  segments: StopwatchSegment[];
  /** Active milliseconds as of server_now. */
  active_ms: number;
  /** Server clock (ISO) when this view was built. */
  server_now: string;
  ticket_number: string | null;
  work_item_title: string | null;
  project_name: string | null;
  client_name: string | null;
  service_name: string | null;
};

export type StopwatchLogResult = {
  session: StopwatchSession;
  time_entry: TimeEntry;
};

type Auth = {
  apiKey: string;
  auditHeaders?: Record<string, string | undefined>;
};

function headersOf(params: Auth): Record<string, string | undefined> {
  return { "x-api-key": params.apiKey, ...params.auditHeaders };
}

export function getActiveStopwatch(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<StopwatchSession | null>>> {
  return client.request<SuccessResponse<StopwatchSession | null>>({
    method: "GET",
    path: "/api/v1/stopwatch/active",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

/** A 409 response carries the user's open session at body.error.details.open_session. */
export function startStopwatch(
  client: ApiClient,
  params: Auth & {
    work_item_type: WorkItemType;
    work_item_id: string;
    service_id?: string;
    notes?: string;
  },
): Promise<ApiResult<SuccessResponse<StopwatchSession>>> {
  return client.request<SuccessResponse<StopwatchSession>>({
    method: "POST",
    path: "/api/v1/stopwatch",
    headers: headersOf(params),
    body: {
      work_item_type: params.work_item_type,
      work_item_id: params.work_item_id,
      service_id: params.service_id,
      notes: params.notes,
    },
  });
}

export function pauseStopwatch(
  client: ApiClient,
  params: Auth & { sessionId: string },
): Promise<ApiResult<SuccessResponse<StopwatchSession>>> {
  return client.request<SuccessResponse<StopwatchSession>>({
    method: "POST",
    path: `/api/v1/stopwatch/${params.sessionId}/pause`,
    headers: headersOf(params),
  });
}

export function resumeStopwatch(
  client: ApiClient,
  params: Auth & { sessionId: string },
): Promise<ApiResult<SuccessResponse<StopwatchSession>>> {
  return client.request<SuccessResponse<StopwatchSession>>({
    method: "POST",
    path: `/api/v1/stopwatch/${params.sessionId}/resume`,
    headers: headersOf(params),
  });
}

export function updateStopwatch(
  client: ApiClient,
  params: Auth & { sessionId: string; notes?: string; service_id?: string },
): Promise<ApiResult<SuccessResponse<StopwatchSession>>> {
  return client.request<SuccessResponse<StopwatchSession>>({
    method: "PATCH",
    path: `/api/v1/stopwatch/${params.sessionId}`,
    headers: headersOf(params),
    body: { notes: params.notes, service_id: params.service_id },
  });
}

export function logStopwatch(
  client: ApiClient,
  params: Auth & {
    sessionId: string;
    start_time?: string;
    end_time?: string;
    billable_duration?: number;
    is_billable?: boolean;
    notes?: string;
    service_id?: string;
  },
): Promise<ApiResult<SuccessResponse<StopwatchLogResult>>> {
  return client.request<SuccessResponse<StopwatchLogResult>>({
    method: "POST",
    path: `/api/v1/stopwatch/${params.sessionId}/log`,
    headers: headersOf(params),
    body: {
      start_time: params.start_time,
      end_time: params.end_time,
      billable_duration: params.billable_duration,
      is_billable: params.is_billable,
      notes: params.notes,
      service_id: params.service_id,
    },
  });
}

export function discardStopwatch(
  client: ApiClient,
  params: Auth & { sessionId: string },
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "DELETE",
    path: `/api/v1/stopwatch/${params.sessionId}`,
    headers: headersOf(params),
  });
}

/** Extracts details.open_session from a 409 start response body, if present. */
export function getOpenSessionFromConflict(body: unknown): StopwatchSession | null {
  const details = (body as { error?: { details?: { open_session?: unknown } } } | null)?.error?.details;
  const open = details?.open_session;
  return open && typeof open === "object" ? (open as StopwatchSession) : null;
}
