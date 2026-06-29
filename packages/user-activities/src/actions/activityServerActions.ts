'use server';

import {
  Activity,
  ActivityFilters,
  ActivityResponse,
  ActivityType,
  ScheduleActivity,
  ProjectTaskActivity,
  TicketActivity,
  TimeEntryActivity,
  WorkflowTaskActivity,
  NotificationActivity,
  IUser
} from "@alga-psa/types";
import { createTenantKnex } from "@alga-psa/db";
import {
  fetchUserActivities,
  fetchScheduleActivities as fetchScheduleActivitiesInternal,
  fetchProjectActivities as fetchProjectActivitiesInternal,
  fetchTicketActivities as fetchTicketActivitiesInternal,
  fetchTimeEntryActivities as fetchTimeEntryActivitiesInternal,
  fetchWorkflowTaskActivities as fetchWorkflowTaskActivitiesInternal,
  fetchNotificationActivities as fetchNotificationActivitiesInternal
} from "./activityAggregationActions";
import { withAuth, hasPermission } from "@alga-psa/auth";
import { revalidatePath } from "next/cache";
import {
  createAdHocActivityForApi,
  getAdHocActivityForApi,
  updateAdHocActivityForApi,
  setAdHocActivityDoneForApi,
  deleteAdHocActivityForApi,
} from "./adHocActivityCore";
import type {
  CreateAdHocActivityInput,
  UpdateAdHocActivityInput,
} from "./adHocActivityCore";

/**
 * Server action to fetch all activities for the current user with optional filters
 * This is the main entry point for the activities dashboard
 *
 * @param filters Optional filters to apply to the activities
 * @param page Optional page number for pagination (1-based)
 * @param pageSize Optional number of items per page
 * @returns Promise resolving to ActivityResponse containing activities and pagination info
 */
export const fetchActivities = withAuth(async (
  _user,
  _ctx,
  filters: ActivityFilters = {},
  page: number = 1,
  pageSize: number = 10
): Promise<ActivityResponse> => {
  try {
    // Pass pagination parameters to the aggregation function
    return await fetchUserActivities(filters, page, pageSize);
  } catch (error) {
    console.error(`Error fetching activities (page ${page}, size ${pageSize}):`, error);
    throw new Error("Failed to fetch activities. Please try again later.");
  }
});

/**
 * Server action to fetch schedule activities for the current user
 *
 * @param filters Optional filters to apply to the schedule activities
 * @returns Promise resolving to an array of ScheduleActivity objects
 */
export const fetchScheduleActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {}
): Promise<ScheduleActivity[]> => {
  try {
    // This function already handles tenant isolation internally
    return await fetchScheduleActivitiesInternal(user.user_id, tenant, filters) as ScheduleActivity[];
  } catch (error) {
    console.error("Error fetching schedule activities:", error);
    throw new Error("Failed to fetch schedule activities. Please try again later.");
  }
});

/**
 * Server action to fetch project activities for the current user
 *
 * @param filters Optional filters to apply to the project activities
 * @returns Promise resolving to an array of ProjectTaskActivity objects
 */
export const fetchProjectActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {}
): Promise<ProjectTaskActivity[]> => {
  try {
    // This function already handles tenant isolation internally
    return await fetchProjectActivitiesInternal(user.user_id, tenant, filters) as ProjectTaskActivity[];
  } catch (error) {
    console.error("Error fetching project activities:", error);
    throw new Error("Failed to fetch project activities. Please try again later.");
  }
});

/**
 * Server action to fetch ticket activities for the current user
 *
 * @param filters Optional filters to apply to the ticket activities
 * @returns Promise resolving to an array of TicketActivity objects
 */
export const fetchTicketActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {}
): Promise<TicketActivity[]> => {
  try {
    // This function already handles tenant isolation internally
    return await fetchTicketActivitiesInternal(user.user_id, tenant, filters) as TicketActivity[];
  } catch (error) {
    console.error("Error fetching ticket activities:", error);
    throw new Error("Failed to fetch ticket activities. Please try again later.");
  }
});

/**
 * Server action to fetch time entry activities for the current user
 *
 * @param filters Optional filters to apply to the time entry activities
 * @returns Promise resolving to an array of TimeEntryActivity objects
 */
export const fetchTimeEntryActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {}
): Promise<TimeEntryActivity[]> => {
  try {
    // This function already handles tenant isolation internally
    return await fetchTimeEntryActivitiesInternal(user.user_id, tenant, filters) as TimeEntryActivity[];
  } catch (error) {
    console.error("Error fetching time entry activities:", error);
    throw new Error("Failed to fetch time entry activities. Please try again later.");
  }
});

/**
 * Server action to fetch workflow task activities for the current user
 *
 * @param filters Optional filters to apply to the workflow task activities
 * @returns Promise resolving to an array of WorkflowTaskActivity objects
 */
export const fetchWorkflowTaskActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {}
): Promise<WorkflowTaskActivity[]> => {
  try {
    // This function already handles tenant isolation internally
    return await fetchWorkflowTaskActivitiesInternal(user.user_id, tenant, filters) as WorkflowTaskActivity[];
  } catch (error) {
    console.error("Error fetching workflow task activities:", error);
    throw new Error("Failed to fetch workflow task activities. Please try again later.");
  }
});

/**
 * Server action to fetch notification activities for the current user
 *
 * @param filters Optional filters to apply to the notification activities
 * @returns Promise resolving to an array of NotificationActivity objects
 */
export const fetchNotificationActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {}
): Promise<NotificationActivity[]> => {
  try {
    // This function already handles tenant isolation internally
    return await fetchNotificationActivitiesInternal(user.user_id, tenant, filters) as NotificationActivity[];
  } catch (error) {
    console.error("Error fetching notification activities:", error);
    throw new Error("Failed to fetch notification activities. Please try again later.");
  }
});

/**
 * Server action to fetch a specific activity by ID and type
 *
 * @param id The ID of the activity to fetch
 * @param type The type of the activity
 * @returns Promise resolving to the Activity object or null if not found
 */
export const fetchActivityById = withAuth(async (
  user,
  { tenant },
  id: string,
  type: ActivityType
): Promise<Activity | null> => {
  try {
    // Fetch activities of the specified type
    let activities: Activity[] = [];

    switch (type) {
      case ActivityType.SCHEDULE:
        activities = await fetchScheduleActivitiesInternal(user.user_id, tenant, {});
        break;
      case ActivityType.PROJECT_TASK:
        activities = await fetchProjectActivitiesInternal(user.user_id, tenant, {});
        break;
      case ActivityType.TICKET:
        activities = await fetchTicketActivitiesInternal(user.user_id, tenant, {});
        break;
      case ActivityType.TIME_ENTRY:
        activities = await fetchTimeEntryActivitiesInternal(user.user_id, tenant, {});
        break;
      case ActivityType.WORKFLOW_TASK:
        activities = await fetchWorkflowTaskActivitiesInternal(user.user_id, tenant, {});
        break;
      case ActivityType.NOTIFICATION:
        activities = await fetchNotificationActivitiesInternal(user.user_id, tenant, {});
        break;
      default:
        throw new Error(`Unsupported activity type: ${type}`);
    }

    // Find the activity with the specified ID
    const activity = activities.find(a => a.id === id);
    return activity || null;
  } catch (error) {
    console.error(`Error fetching activity by ID (${id}, ${type}):`, error);
    throw new Error("Failed to fetch activity. Please try again later.");
  }
});

/**
 * Server action to mark an activity as viewed
 * This can be used to update the user's activity history
 *
 * @param activityId The ID of the activity to mark as viewed
 * @param activityType The type of the activity
 */
export const markActivityViewed = withAuth(async (
  user,
  _ctx,
  activityId: string,
  activityType: ActivityType
): Promise<void> => {
  try {
    // Implementation would depend on how you want to track viewed activities
    // This is a placeholder for future implementation
    console.log(`Activity ${activityId} of type ${activityType} viewed by user ${user.user_id}`);

    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
  } catch (error) {
    console.error(`Error marking activity as viewed (${activityId}, ${activityType}):`, error);
    throw new Error("Failed to mark activity as viewed. Please try again later.");
  }
});

/**
 * Server action to fetch activities for the dashboard
 * This is a specialized version of fetchActivities that returns a limited number of activities
 * for each type, suitable for displaying in the dashboard
 *
 * @param limit The maximum number of activities to return for each type
 * @returns Promise resolving to an object containing activities grouped by type
 */
export const fetchDashboardActivities = withAuth(async (
  user,
  { tenant },
  limit: number = 5
): Promise<{
  scheduleActivities: ScheduleActivity[];
  projectActivities: ProjectTaskActivity[];
  ticketActivities: TicketActivity[];
  timeEntryActivities: TimeEntryActivity[];
  workflowTaskActivities: WorkflowTaskActivity[];
}> => {
  try {
    // Fetch activities for each type with a limit
    const filters: ActivityFilters = { isClosed: false };

    const [
      scheduleActivities,
      projectActivities,
      ticketActivities,
      timeEntryActivities,
      workflowTaskActivities
    ] = await Promise.all([
      fetchScheduleActivitiesInternal(user.user_id, tenant, filters),
      fetchProjectActivitiesInternal(user.user_id, tenant, filters),
      fetchTicketActivitiesInternal(user.user_id, tenant, filters),
      fetchTimeEntryActivitiesInternal(user.user_id, tenant, filters),
      fetchWorkflowTaskActivitiesInternal(user.user_id, tenant, filters)
    ]);

    // Sort and limit each type of activity
    const sortByPriorityAndDueDate = (a: Activity, b: Activity) => {
      // First sort by priority (high to low)
      const priorityOrder = {
        'high': 0,
        'medium': 1,
        'low': 2
      };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then sort by due date (closest first)
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      } else if (a.dueDate) {
        return -1; // a has due date, b doesn't
      } else if (b.dueDate) {
        return 1; // b has due date, a doesn't
      }

      // Finally sort by creation date (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    };

    return {
      scheduleActivities: scheduleActivities.sort(sortByPriorityAndDueDate).slice(0, limit) as ScheduleActivity[],
      projectActivities: projectActivities.sort(sortByPriorityAndDueDate).slice(0, limit) as ProjectTaskActivity[],
      ticketActivities: ticketActivities.sort(sortByPriorityAndDueDate).slice(0, limit) as TicketActivity[],
      timeEntryActivities: timeEntryActivities.sort(sortByPriorityAndDueDate).slice(0, limit) as TimeEntryActivity[],
      workflowTaskActivities: workflowTaskActivities.sort(sortByPriorityAndDueDate).slice(0, limit) as WorkflowTaskActivity[]
    };
  } catch (error) {
    console.error("Error fetching dashboard activities:", error);
    throw new Error("Failed to fetch dashboard activities. Please try again later.");
  }
});

/**
 * Create an ad-hoc item (a schedule entry with work_item_type='ad_hoc', assigned to the
 * current user). Times are optional — an ad-hoc item is a lightweight personal to-do.
 *
 * Business logic + permission gate live in `createAdHocActivityForApi`; this wrapper only
 * resolves the session user/tenant. The v1 REST API calls the core directly with an
 * API-key-resolved identity so both paths stay identical.
 */
export const createAdHocActivity = withAuth(async (
  user,
  { tenant },
  input: CreateAdHocActivityInput
): Promise<ScheduleActivity> => {
  const created = await createAdHocActivityForApi(user, tenant, input);
  revalidatePath("/msp/user-activities");
  return created;
});

/**
 * Mark an ad-hoc item Done (status='closed') or not done (status='scheduled').
 * The caller must be an assignee of the entry, or hold user_schedule:update to act
 * on another user's entries.
 */
export const setAdHocActivityDone = withAuth(async (
  user,
  { tenant },
  entryId: string,
  done: boolean
): Promise<void> => {
  await setAdHocActivityDoneForApi(user, tenant, entryId, done);
  revalidatePath("/msp/user-activities");
});

/**
 * Fetch a single ad-hoc item by id, independent of any schedule date window.
 * Used by the detail drawer, which can't locate dateless ad-hoc items through the
 * normal date-ranged schedule fetch.
 */
export const getAdHocActivity = withAuth(async (
  user,
  { tenant },
  entryId: string
) => {
  return getAdHocActivityForApi(user, tenant, entryId);
});

/**
 * Update an ad-hoc item's title, notes and optional start/end times. Times remain
 * optional for ad-hoc items, but when both are supplied the end must be after the
 * start.
 */
export const updateAdHocActivity = withAuth(async (
  user,
  { tenant },
  entryId: string,
  input: UpdateAdHocActivityInput
): Promise<void> => {
  await updateAdHocActivityForApi(user, tenant, entryId, input);
  revalidatePath("/msp/user-activities");
});

/**
 * Permanently delete an ad-hoc item (and its assignees). Used when an ad-hoc item is
 * converted into a ticket or project task.
 */
export const deleteAdHocActivity = withAuth(async (
  user,
  { tenant },
  entryId: string
): Promise<void> => {
  await deleteAdHocActivityForApi(user, tenant, entryId);
  revalidatePath("/msp/user-activities");
});

export interface ActivityViewableUsersResult {
  /** Whether the caller may view other users' activities at all. */
  canViewOthers: boolean;
  /** Internal users (excluding the caller) whose activities may be viewed. */
  users: IUser[];
}

/**
 * List the internal users whose activities the caller may view, and whether the caller has
 * that capability at all. Gated by the same permission the schedule calendar uses to view
 * other users' calendars (user_schedule:update or user_schedule:read_all). When the caller
 * lacks it, returns canViewOthers=false and an empty list so the UI can hide the selector.
 *
 * Returns IUser-shaped rows (safe columns only) so the UI can render them with UserPicker,
 * including avatars.
 */
export const getActivityViewableUsers = withAuth(async (
  user,
  { tenant }
): Promise<ActivityViewableUsersResult> => {
  const { knex } = await createTenantKnex(tenant);

  const [canUpdate, canReadAll] = await Promise.all([
    hasPermission(user, "user_schedule", "update", knex),
    hasPermission(user, "user_schedule", "read_all", knex),
  ]);
  if (!canUpdate && !canReadAll) {
    return { canViewOthers: false, users: [] };
  }

  // Select only non-sensitive columns (never hashed_password / two_factor_secret).
  const rows = await knex("users")
    .where({ tenant, user_type: "internal", is_inactive: false })
    .whereNot({ user_id: user.user_id })
    .orderBy([{ column: "first_name" }, { column: "last_name" }])
    .select(
      "user_id",
      "first_name",
      "last_name",
      "email",
      "username",
      "user_type",
      "is_inactive",
      "tenant"
    );

  return { canViewOthers: true, users: rows as IUser[] };
});
