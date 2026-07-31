/**
 * Pure filter state + API-param mapping for the User Activities screen.
 *
 * Kept free of React/RN so the due-date bucketing and param translation can be unit
 * tested in isolation (mirrors the ticket list's `ticketsClientFilter` / `ticketsTagsFilter`).
 */

import type {
  ActivityStatusFilter,
  MobileActivityGroupBy,
  MobileActivitySortBy,
  MobileActivitySortDirection,
  MobileActivityType,
} from "../../api/activities";
import type { PriorityItemType } from "../../api/priorities";

/** Quick due-date buckets. Translated into a dueDateStart/dueDateEnd window for the API. */
export type ActivityDueFilter = "any" | "overdue" | "today" | "week";

/** Sort selection. `default` omits sortBy so the server applies its default sort. */
export type ActivitySortField = "default" | "priority" | "dueDate" | "title" | "status" | "type";

/**
 * Grouping selection. `none` uses the flat paginated list; the dimensions use the grouped
 * endpoint; `custom` renders the user's saved (desktop) groups, bucketed client-side.
 */
export type ActivityGroupField = "none" | "custom" | MobileActivityGroupBy;

export type ActivitiesFilterState = {
  status: ActivityStatusFilter;
  types: MobileActivityType[];
  /** Exact tenant priority IDs. Only meaningful when scoped to a single prioritized type. */
  priorityIds: string[];
  due: ActivityDueFilter;
  sortField: ActivitySortField;
  sortOrder: MobileActivitySortDirection;
  groupBy: ActivityGroupField;
};

export const DEFAULT_ACTIVITY_FILTERS: ActivitiesFilterState = {
  status: "open",
  types: [],
  priorityIds: [],
  due: "any",
  sortField: "default",
  sortOrder: "asc",
  groupBy: "none",
};

/**
 * The activity types this screen shows — the actionable work items. This doubles as the
 * default `type` set sent to the API, so types NOT listed here (notifications, documents)
 * are never fetched: notifications aren't actionable here and have no detail view, and the
 * server otherwise returns every type when `type` is omitted.
 */
export const ACTIVITY_TYPE_FILTERS: MobileActivityType[] = [
  "ticket",
  "projectTask",
  "schedule",
  "workflowTask",
  "timeEntry",
];

export const ACTIVITY_SORT_FIELDS: ActivitySortField[] = [
  "default",
  "priority",
  "dueDate",
  "title",
  "status",
  "type",
];

export const ACTIVITY_GROUP_FIELDS: ActivityGroupField[] = [
  "none",
  "custom",
  "type",
  "priority",
  "status",
  "dueDate",
];

/** Activity types that carry a real, per-tenant priority set (and their priorities item_type). */
const PRIORITY_ITEM_TYPE_BY_ACTIVITY: Partial<Record<MobileActivityType, PriorityItemType>> = {
  ticket: "ticket",
  projectTask: "project_task",
};

/**
 * The priority `item_type` to filter/group by — but only when the list is scoped to exactly
 * one prioritized type (Tickets or Project tasks). Otherwise null: priorities are per-type
 * (ticket vs project_task are different sets) and most activity types have none, so a
 * cross-type priority filter is meaningless. Mirrors the web's single-type gating.
 */
export function scopedPriorityItemType(filters: ActivitiesFilterState): PriorityItemType | null {
  if (filters.types.length !== 1) return null;
  return PRIORITY_ITEM_TYPE_BY_ACTIVITY[filters.types[0]] ?? null;
}

/** Group dimensions available for the current scope — drops `priority` unless single-type scoped. */
export function groupFieldsFor(filters: ActivitiesFilterState): ActivityGroupField[] {
  const scoped = scopedPriorityItemType(filters) !== null;
  return ACTIVITY_GROUP_FIELDS.filter((g) => g !== "priority" || scoped);
}

export type ActivitiesApiParams = {
  status: ActivityStatusFilter;
  type?: MobileActivityType[];
  priorityIds?: string[];
  dueDateStart?: string;
  dueDateEnd?: string;
  sortBy?: MobileActivitySortBy;
  sortDirection?: MobileActivitySortDirection;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayMs(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Translate a due bucket into an ISO dueDateStart/dueDateEnd window relative to `now`.
 * The server's due filter is an inclusive range over items that have a due date, so the
 * "no due date" case is intentionally not expressible here — it surfaces via grouping.
 */
export function dueRange(
  due: ActivityDueFilter,
  now: Date = new Date(),
): { dueDateStart?: string; dueDateEnd?: string } {
  if (due === "any") return {};
  const today = startOfDayMs(now);
  if (due === "overdue") {
    // Everything due strictly before today.
    return { dueDateEnd: new Date(today - 1).toISOString() };
  }
  if (due === "today") {
    return {
      dueDateStart: new Date(today).toISOString(),
      dueDateEnd: new Date(today + DAY_MS - 1).toISOString(),
    };
  }
  // "week": today through the next 7 days.
  return {
    dueDateStart: new Date(today).toISOString(),
    dueDateEnd: new Date(today + 7 * DAY_MS - 1).toISOString(),
  };
}

/** Build the subset of list/grouped API params that the filter state controls. */
export function activitiesApiParams(
  filters: ActivitiesFilterState,
  now: Date = new Date(),
): ActivitiesApiParams {
  const params: ActivitiesApiParams = { status: filters.status };
  // Always send an explicit type set: the user's selection, or all supported work types so
  // the server never falls back to "all types" (which would include notifications/documents).
  params.type = filters.types.length > 0 ? filters.types : [...ACTIVITY_TYPE_FILTERS];
  // Exact priorities only apply when scoped to a single prioritized type.
  if (filters.priorityIds.length > 0 && scopedPriorityItemType(filters)) {
    params.priorityIds = filters.priorityIds;
  }
  const { dueDateStart, dueDateEnd } = dueRange(filters.due, now);
  if (dueDateStart) params.dueDateStart = dueDateStart;
  if (dueDateEnd) params.dueDateEnd = dueDateEnd;
  if (filters.sortField !== "default") {
    params.sortBy = filters.sortField;
    params.sortDirection = filters.sortOrder;
  }
  return params;
}

/**
 * Count the result-narrowing filters that differ from the default (status, types,
 * priorities, due). Sort and grouping are view options, not counted here — they drive the
 * Filters badge that signals "your list is narrowed".
 */
export function countActiveFilters(filters: ActivitiesFilterState): number {
  let n = 0;
  if (filters.status !== DEFAULT_ACTIVITY_FILTERS.status) n += 1;
  if (filters.types.length > 0) n += 1;
  if (filters.priorityIds.length > 0) n += 1;
  if (filters.due !== "any") n += 1;
  return n;
}

/** True when any filter, sort, or grouping differs from the defaults. */
export function hasNonDefaultView(filters: ActivitiesFilterState, search: string): boolean {
  return (
    countActiveFilters(filters) > 0 ||
    filters.sortField !== DEFAULT_ACTIVITY_FILTERS.sortField ||
    filters.sortOrder !== DEFAULT_ACTIVITY_FILTERS.sortOrder ||
    filters.groupBy !== DEFAULT_ACTIVITY_FILTERS.groupBy ||
    search.trim() !== ""
  );
}
