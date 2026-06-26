import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { PaginatedResponse, SuccessResponse } from "./tickets";

/**
 * User Activities API client.
 *
 * Mirrors the v1 `Activity` discriminated union (canonical:
 * `packages/types/src/interfaces/activity.interfaces.ts`) for the fields the
 * mobile app reads. Envelope unwrapping follows the other api modules: the list
 * endpoint returns `{ data, pagination }` (PaginatedResponse) and the ad-hoc
 * endpoints return `{ data }` (SuccessResponse); callers read `.data.data`.
 */

export type MobileActivityType =
  | "schedule"
  | "projectTask"
  | "ticket"
  | "timeEntry"
  | "workflowTask"
  | "notification"
  | "document";

export type MobileActivityPriority = "low" | "medium" | "high";

export type ActivityAction = {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type ActivityBaseFields = {
  id: string;
  title: string;
  description?: string;
  status: string;
  statusColor?: string;
  priority: MobileActivityPriority;
  priorityName?: string;
  priorityColor?: string;
  dueDate?: string;
  startDate?: string;
  endDate?: string;
  assignedTo?: string[];
  assignedToNames?: string[];
  sourceId: string;
  sourceType: MobileActivityType;
  actions: ActivityAction[];
  isClosed?: boolean;
  tenant: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleActivity = ActivityBaseFields & {
  type: "schedule";
  workItemId?: string;
  /** Ad-hoc personal to-dos use `ad_hoc`; others are meeting/break/ticket/etc. */
  workItemType?: string;
  isRecurring?: boolean;
};

export type ProjectTaskActivity = ActivityBaseFields & {
  type: "projectTask";
  projectId?: string;
  phaseId?: string;
  projectName?: string;
  phaseName?: string;
  statusMappingId?: string;
  estimatedHours?: number;
  actualHours?: number;
  wbsCode?: string;
};

export type TicketActivity = ActivityBaseFields & {
  type: "ticket";
  ticketNumber?: string;
  boardId?: string;
  statusId?: string;
  clientId?: string;
  clientName?: string;
  contactId?: string;
  contactName?: string;
};

export type TimeEntryActivity = ActivityBaseFields & {
  type: "timeEntry";
  workItemId?: string;
  workItemType?: string;
  billableDuration?: number;
  timeSheetId?: string;
  approvalStatus?: string;
};

export type WorkflowTaskActivity = ActivityBaseFields & {
  type: "workflowTask";
  executionId?: string;
  formId?: string;
  contextData?: Record<string, unknown>;
  assignedRoles?: string[];
};

export type NotificationActivity = ActivityBaseFields & {
  type: "notification";
  notificationId?: string;
  message?: string;
  isRead?: boolean;
  link?: string;
  category?: string;
};

export type DocumentActivity = ActivityBaseFields & {
  type: "document";
  documentId?: string;
  documentName?: string;
};

export type Activity =
  | ScheduleActivity
  | ProjectTaskActivity
  | TicketActivity
  | TimeEntryActivity
  | WorkflowTaskActivity
  | NotificationActivity
  | DocumentActivity;

/**
 * True when an activity is a personal ad-hoc to-do (owned CRUD on mobile).
 * Returns a plain boolean (not a type predicate) so the false branch does not
 * narrow non-ad-hoc schedule activities out of the union.
 */
export function isAdHocActivity(activity: Activity): boolean {
  return activity.type === "schedule" && activity.workItemType === "ad_hoc";
}

export type ActivityStatusFilter = "open" | "closed" | "all";

export type ListActivitiesParams = {
  apiKey: string;
  page?: number;
  pageSize?: number;
  /** Subset of activity types to include; omit/empty for all. */
  type?: MobileActivityType[];
  status?: ActivityStatusFilter;
  search?: string;
  /** ISO-8601 with offset/Z. */
  dateStart?: string;
  dateEnd?: string;
  signal?: AbortSignal;
};

export function listActivities(
  client: ApiClient,
  params: ListActivitiesParams,
): Promise<ApiResult<PaginatedResponse<Activity>>> {
  return client.request<PaginatedResponse<Activity>>({
    method: "GET",
    path: "/api/v1/activities",
    signal: params.signal,
    query: {
      page: params.page,
      pageSize: params.pageSize,
      type: params.type && params.type.length > 0 ? params.type.join(",") : undefined,
      status: params.status,
      search: params.search,
      dateStart: params.dateStart,
      dateEnd: params.dateEnd,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

export type CreateAdHocEntryInput = {
  title: string;
  // Create rejects an explicit null (backend `notes: z.string().optional()`); omit to leave empty.
  notes?: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
};

export type UpdateAdHocEntryInput = {
  title?: string;
  // Update accepts null to clear notes (backend `notes: z.string().nullable().optional()`).
  notes?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
};

export function createAdHocEntry(
  client: ApiClient,
  params: { apiKey: string; entry: CreateAdHocEntryInput },
): Promise<ApiResult<SuccessResponse<Activity>>> {
  return client.request<SuccessResponse<Activity>>({
    method: "POST",
    path: "/api/v1/activities/ad-hoc",
    headers: {
      "x-api-key": params.apiKey,
    },
    body: params.entry,
  });
}

export function updateAdHocEntry(
  client: ApiClient,
  params: { apiKey: string; id: string; entry: UpdateAdHocEntryInput },
): Promise<ApiResult<SuccessResponse<Activity>>> {
  return client.request<SuccessResponse<Activity>>({
    method: "PATCH",
    path: `/api/v1/activities/ad-hoc/${params.id}`,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: params.entry,
  });
}

export function setAdHocDone(
  client: ApiClient,
  params: { apiKey: string; id: string; done: boolean },
): Promise<ApiResult<SuccessResponse<Activity>>> {
  return client.request<SuccessResponse<Activity>>({
    method: "POST",
    path: `/api/v1/activities/ad-hoc/${params.id}/done`,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: { done: params.done },
  });
}

export function deleteAdHocEntry(
  client: ApiClient,
  params: { apiKey: string; id: string },
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "DELETE",
    path: `/api/v1/activities/ad-hoc/${params.id}`,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}
