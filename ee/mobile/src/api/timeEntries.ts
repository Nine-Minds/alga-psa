import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

export type WorkItemType = "ticket" | "project_task" | "non_billable_category" | "ad_hoc" | "interaction";

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
  othersTotalMinutes: number;
  totalMinutes: number;
  ownEntryCount: number;
  othersEntryCount: number;
  canViewOthers: boolean;
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

