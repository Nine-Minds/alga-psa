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

export function createTimeEntry(
  client: ApiClient,
  params: {
    apiKey: string;
    work_item_type: WorkItemType;
    work_item_id?: string;
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
      start_time: params.start_time,
      end_time: params.end_time,
      notes: params.notes,
      is_billable: params.is_billable,
    },
  });
}

