import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

export type WorkItemType = "ticket" | "project_task" | "non_billable_category" | "ad_hoc" | "interaction";

export type TimePeriod = {
  period_id: string;
  start_date: string;
  end_date: string;
  is_current?: boolean | null;
};

export type TimeEntryListItem = {
  entry_id: string;
  work_item_id?: string | null;
  work_item_type?: WorkItemType | null;
  start_time?: string | null;
  end_time?: string | null;
  work_date?: string | null;
  billable_duration?: number | null;
  notes?: string | null;
  user_id?: string | null;
  approval_status?: string | null;
  service_id?: string | null;
  service_name?: string | null;
  user_name?: string | null;
  duration_hours?: number | null;
  is_billable?: boolean | null;
};

export type TimeEntry = {
  entry_id: string;
  work_item_id: string | null;
  work_item_type: WorkItemType;
  start_time: string;
  end_time: string;
  billable_duration: number;
  notes: string | null;
  user_id: string;
  approval_status: string;
};

export type TicketTimeEntrySummaryItem = {
  entry_id: string;
  user_id: string;
  user_name: string | null;
  start_time: string;
  end_time: string;
  work_date: string | null;
  billable_duration: number;
  notes: string | null;
  approval_status: string;
  service_id: string | null;
  service_name: string | null;
  is_own: boolean;
};

export type TicketTimeEntriesSummary = {
  entries: TicketTimeEntrySummaryItem[];
  ownTotalMinutes: number;
  ownEntryCount: number;
  othersTotalMinutes: number;
  othersEntryCount: number;
  othersVisibleMinutes: number;
  othersVisibleCount: number;
  othersHiddenMinutes: number;
  othersHiddenCount: number;
  totalMinutes: number;
};

export type ServiceOption = {
  service_id: string;
  service_name: string;
};

export function getServices(
  client: ApiClient,
  params: { apiKey: string },
): Promise<ApiResult<SuccessResponse<ServiceOption[]>>> {
  return client.request<SuccessResponse<ServiceOption[]>>({
    method: "GET",
    path: "/api/v1/services?is_active=true&limit=100",
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function listTimePeriods(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<TimePeriod[]>>> {
  return client.request<SuccessResponse<TimePeriod[]>>({
    method: "GET",
    path: "/api/v1/time-periods",
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export type ListTimeEntriesParams = {
  apiKey: string;
  page: number;
  limit: number;
  user_id?: string;
  date_from?: string;
  date_to?: string;
  sort?: string;
  order?: "asc" | "desc";
  signal?: AbortSignal;
};

export function listTimeEntries(
  client: ApiClient,
  params: ListTimeEntriesParams,
): Promise<ApiResult<PaginatedResponse<TimeEntryListItem>>> {
  return client.request<PaginatedResponse<TimeEntryListItem>>({
    method: "GET",
    path: "/api/v1/time-entries",
    signal: params.signal,
    query: {
      page: params.page,
      limit: params.limit,
      sort: params.sort ?? "start_time",
      order: params.order ?? "desc",
      user_id: params.user_id,
      date_from: params.date_from,
      date_to: params.date_to,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function getTicketTimeEntries(
  client: ApiClient,
  params: { apiKey: string; ticketId: string },
): Promise<ApiResult<SuccessResponse<TicketTimeEntriesSummary>>> {
  return client.request<SuccessResponse<TicketTimeEntriesSummary>>({
    method: "GET",
    path: `/api/v1/tickets/${params.ticketId}/time-entries`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export function createTimeEntry(
  client: ApiClient,
  params: {
    apiKey: string;
    work_item_type: WorkItemType;
    work_item_id?: string;
    service_id: string;
    start_time: string;
    end_time: string;
    notes?: string;
    is_billable?: boolean;
    auditHeaders?: Record<string, string | undefined>;
  },
): Promise<ApiResult<SuccessResponse<TimeEntry>>> {
  return client.request<SuccessResponse<TimeEntry>>({
    method: "POST",
    path: "/api/v1/time-entries",
    headers: {
      "x-api-key": params.apiKey,
      ...params.auditHeaders,
    },
    body: {
      work_item_type: params.work_item_type,
      work_item_id: params.work_item_id,
      service_id: params.service_id,
      start_time: params.start_time,
      end_time: params.end_time,
      notes: params.notes,
      is_billable: params.is_billable,
    },
  });
}

