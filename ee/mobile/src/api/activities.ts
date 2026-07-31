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

/** Sort columns the v1 list endpoint accepts (mirrors the server `ActivitySortBy`). */
export type MobileActivitySortBy = "type" | "title" | "status" | "priority" | "dueDate";
export type MobileActivitySortDirection = "asc" | "desc";

/** Dimension the unified list can be grouped by server-side. */
export type MobileActivityGroupBy = "type" | "priority" | "status" | "dueDate";

export type ListActivitiesParams = {
  apiKey: string;
  page?: number;
  pageSize?: number;
  /** Subset of activity types to include; omit/empty for all. */
  type?: MobileActivityType[];
  status?: ActivityStatusFilter;
  search?: string;
  /** Normalized priority buckets (lossy; prefer priorityIds). Omit/empty for all. */
  priority?: MobileActivityPriority[];
  /** Exact tenant priority IDs (ticket/project-task scoped). Omit/empty for all. */
  priorityIds?: string[];
  /** ISO-8601 with offset/Z. Schedule/time-entry/notification window. */
  dateStart?: string;
  dateEnd?: string;
  /** ISO-8601 with offset/Z. Due-date window (independent of the schedule window). */
  dueDateStart?: string;
  dueDateEnd?: string;
  sortBy?: MobileActivitySortBy;
  sortDirection?: MobileActivitySortDirection;
  signal?: AbortSignal;
};

function activitiesQuery(params: ListActivitiesParams): Record<string, unknown> {
  return {
    type: params.type && params.type.length > 0 ? params.type.join(",") : undefined,
    status: params.status,
    search: params.search,
    priority: params.priority && params.priority.length > 0 ? params.priority.join(",") : undefined,
    priorityIds: params.priorityIds && params.priorityIds.length > 0 ? params.priorityIds.join(",") : undefined,
    dateStart: params.dateStart,
    dateEnd: params.dateEnd,
    dueDateStart: params.dueDateStart,
    dueDateEnd: params.dueDateEnd,
    sortBy: params.sortBy,
    sortDirection: params.sortDirection,
  };
}

export function listActivities(
  client: ApiClient,
  params: ListActivitiesParams,
): Promise<ApiResult<PaginatedResponse<Activity>>> {
  return client.request<PaginatedResponse<Activity>>({
    method: "GET",
    path: "/api/v1/activities",
    signal: params.signal,
    query: {
      ...activitiesQuery(params),
      page: params.page,
      pageSize: params.pageSize,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

/** One server-computed group bucket: a stable `key`, English `label`, count, and members. */
export type ActivityGroup = {
  key: string;
  label: string;
  count: number;
  activities: Activity[];
};

export type GroupedActivitiesData = {
  groupBy: MobileActivityGroupBy;
  groups: ActivityGroup[];
  totalCount: number;
  /** True when the result set exceeded the server grouping cap and was truncated. */
  truncated: boolean;
};

export type ListActivitiesGroupedParams = ListActivitiesParams & {
  groupBy: MobileActivityGroupBy;
};

/**
 * Grouped variant of {@link listActivities}: the server buckets the full filtered set by
 * `groupBy` and returns ordered, counted groups (no pagination). Read via `.data.data`.
 */
export function listActivitiesGrouped(
  client: ApiClient,
  params: ListActivitiesGroupedParams,
): Promise<ApiResult<SuccessResponse<GroupedActivitiesData>>> {
  return client.request<SuccessResponse<GroupedActivitiesData>>({
    method: "GET",
    path: "/api/v1/activities",
    signal: params.signal,
    query: {
      ...activitiesQuery(params),
      groupBy: params.groupBy,
    },
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}

/** One item inside a user's saved custom group: an activity reference + its order. */
export type CustomActivityGroupItem = {
  itemId: string;
  activityId: string;
  activityType: string;
  sortOrder: number;
};

/** A user's saved custom activity group (created/ordered on the web), read-only on mobile. */
export type CustomActivityGroup = {
  groupId: string;
  groupName: string;
  sortOrder: number;
  isCollapsed: boolean;
  items: CustomActivityGroupItem[];
};

export type ListActivityGroupsParams = {
  apiKey: string;
  /** Another user's groups (requires user_schedule:update/read_all); omit for self. */
  targetUserId?: string;
  signal?: AbortSignal;
};

/**
 * Fetch the caller's saved custom activity groups (ordered, with ordered items). Read-only:
 * the mobile "My groups" view buckets the unified activity list into these locally; editing
 * stays on the web. Read via `.data.data`.
 */
export function listActivityGroups(
  client: ApiClient,
  params: ListActivityGroupsParams,
): Promise<ApiResult<SuccessResponse<CustomActivityGroup[]>>> {
  return client.request<SuccessResponse<CustomActivityGroup[]>>({
    method: "GET",
    path: "/api/v1/activities/groups",
    signal: params.signal,
    query: { targetUserId: params.targetUserId },
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

// ---------------------------------------------------------------------------
// Custom-group organization (drag-to-organize the "My groups" view).
//
// Groups themselves are still created/renamed/deleted on the web; these mutate
// only membership and ordering of the caller's own groups.
// ---------------------------------------------------------------------------

/** Move an activity into `groupId` at `sortOrder`, removing it from any other group first. */
export function moveActivityToGroup(
  client: ApiClient,
  params: { apiKey: string; activityId: string; activityType: string; groupId: string; sortOrder: number },
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "POST",
    path: "/api/v1/activities/groups/items",
    headers: {
      "x-api-key": params.apiKey,
    },
    body: {
      activityId: params.activityId,
      activityType: params.activityType,
      groupId: params.groupId,
      sortOrder: params.sortOrder,
    },
  });
}

/** Remove an activity from all of the caller's groups (makes it "ungrouped"). */
export function removeActivityFromGroups(
  client: ApiClient,
  params: { apiKey: string; activityId: string; activityType: string },
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "DELETE",
    path: "/api/v1/activities/groups/items",
    headers: {
      "x-api-key": params.apiKey,
    },
    body: {
      activityId: params.activityId,
      activityType: params.activityType,
    },
  });
}

/** Persist the full ordered membership of a group after a drag-to-reorder. */
export function reorderActivitiesInGroup(
  client: ApiClient,
  params: {
    apiKey: string;
    groupId: string;
    items: Array<{ activityId: string; activityType: string; sortOrder: number }>;
  },
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "PATCH",
    path: `/api/v1/activities/groups/${params.groupId}/items`,
    headers: {
      "x-api-key": params.apiKey,
    },
    body: { items: params.items },
  });
}
