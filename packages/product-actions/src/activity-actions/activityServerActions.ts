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
  WorkflowTaskActivity
} from "@server/interfaces/activity.interfaces";
import { 
  fetchUserActivities,
  fetchScheduleActivities as fetchScheduleActivitiesInternal,
  fetchProjectActivities as fetchProjectActivitiesInternal,
  fetchTicketActivities as fetchTicketActivitiesInternal,
  fetchTimeEntryActivities as fetchTimeEntryActivitiesInternal,
  fetchWorkflowTaskActivities as fetchWorkflowTaskActivitiesInternal
} from "./activityAggregationActions";
import { getCurrentUser } from "@product/actions/user-actions/userActions";
import { revalidatePath } from "next/cache";

/**
 * Server action to fetch all activities for the current user with optional filters
 * This is the main entry point for the activities dashboard
 * 
 * @param filters Optional filters to apply to the activities
 * @param page Optional page number for pagination (1-based)
 * @param pageSize Optional number of items per page
 * @returns Promise resolving to ActivityResponse containing activities and pagination info
 */
export async function fetchActivities(
  filters: ActivityFilters = {},
  page: number = 1,
  pageSize: number = 10
): Promise<ActivityResponse> {
  try {
    // Pass pagination parameters to the aggregation function
    return await fetchUserActivities(filters, page, pageSize);
  } catch (error) {
    console.error(`Error fetching activities (page ${page}, size ${pageSize}):`, error);
    throw new Error("Failed to fetch activities. Please try again later.");
  }
}

/**
 * Server action to fetch schedule activities for the current user
 * 
 * @param filters Optional filters to apply to the schedule activities
 * @returns Promise resolving to an array of ScheduleActivity objects
 */
export async function fetchScheduleActivities(
  filters: ActivityFilters = {}
): Promise<ScheduleActivity[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // This function already handles tenant isolation internally
    return await fetchScheduleActivitiesInternal(user.user_id, filters) as ScheduleActivity[];
  } catch (error) {
    console.error("Error fetching schedule activities:", error);
    throw new Error("Failed to fetch schedule activities. Please try again later.");
  }
}

/**
 * Server action to fetch project activities for the current user
 * 
 * @param filters Optional filters to apply to the project activities
 * @returns Promise resolving to an array of ProjectTaskActivity objects
 */
export async function fetchProjectActivities(
  filters: ActivityFilters = {}
): Promise<ProjectTaskActivity[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // This function already handles tenant isolation internally
    return await fetchProjectActivitiesInternal(user.user_id, filters) as ProjectTaskActivity[];
  } catch (error) {
    console.error("Error fetching project activities:", error);
    throw new Error("Failed to fetch project activities. Please try again later.");
  }
}

/**
 * Server action to fetch ticket activities for the current user
 * 
 * @param filters Optional filters to apply to the ticket activities
 * @returns Promise resolving to an array of TicketActivity objects
 */
export async function fetchTicketActivities(
  filters: ActivityFilters = {}
): Promise<TicketActivity[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // This function already handles tenant isolation internally
    return await fetchTicketActivitiesInternal(user.user_id, filters) as TicketActivity[];
  } catch (error) {
    console.error("Error fetching ticket activities:", error);
    throw new Error("Failed to fetch ticket activities. Please try again later.");
  }
}

/**
 * Server action to fetch time entry activities for the current user
 * 
 * @param filters Optional filters to apply to the time entry activities
 * @returns Promise resolving to an array of TimeEntryActivity objects
 */
export async function fetchTimeEntryActivities(
  filters: ActivityFilters = {}
): Promise<TimeEntryActivity[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // This function already handles tenant isolation internally
    return await fetchTimeEntryActivitiesInternal(user.user_id, filters) as TimeEntryActivity[];
  } catch (error) {
    console.error("Error fetching time entry activities:", error);
    throw new Error("Failed to fetch time entry activities. Please try again later.");
  }
}

/**
 * Server action to fetch workflow task activities for the current user
 * 
 * @param filters Optional filters to apply to the workflow task activities
 * @returns Promise resolving to an array of WorkflowTaskActivity objects
 */
export async function fetchWorkflowTaskActivities(
  filters: ActivityFilters = {}
): Promise<WorkflowTaskActivity[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // This function already handles tenant isolation internally
    return await fetchWorkflowTaskActivitiesInternal(user.user_id, filters) as WorkflowTaskActivity[];
  } catch (error) {
    console.error("Error fetching workflow task activities:", error);
    throw new Error("Failed to fetch workflow task activities. Please try again later.");
  }
}

/**
 * Server action to fetch a specific activity by ID and type
 * 
 * @param id The ID of the activity to fetch
 * @param type The type of the activity
 * @returns Promise resolving to the Activity object or null if not found
 */
export async function fetchActivityById(
  id: string,
  type: ActivityType
): Promise<Activity | null> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Fetch activities of the specified type
    let activities: Activity[] = [];
    
    switch (type) {
      case ActivityType.SCHEDULE:
        activities = await fetchScheduleActivitiesInternal(user.user_id, {});
        break;
      case ActivityType.PROJECT_TASK:
        activities = await fetchProjectActivitiesInternal(user.user_id, {});
        break;
      case ActivityType.TICKET:
        activities = await fetchTicketActivitiesInternal(user.user_id, {});
        break;
      case ActivityType.TIME_ENTRY:
        activities = await fetchTimeEntryActivitiesInternal(user.user_id, {});
        break;
      case ActivityType.WORKFLOW_TASK:
        activities = await fetchWorkflowTaskActivitiesInternal(user.user_id, {});
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
}

/**
 * Server action to mark an activity as viewed
 * This can be used to update the user's activity history
 * 
 * @param activityId The ID of the activity to mark as viewed
 * @param activityType The type of the activity
 */
export async function markActivityViewed(
  activityId: string,
  activityType: ActivityType
): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Implementation would depend on how you want to track viewed activities
    // This is a placeholder for future implementation
    console.log(`Activity ${activityId} of type ${activityType} viewed by user ${user.user_id}`);
    
    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
  } catch (error) {
    console.error(`Error marking activity as viewed (${activityId}, ${activityType}):`, error);
    throw new Error("Failed to mark activity as viewed. Please try again later.");
  }
}

/**
 * Server action to fetch activities for the dashboard
 * This is a specialized version of fetchActivities that returns a limited number of activities
 * for each type, suitable for displaying in the dashboard
 * 
 * @param limit The maximum number of activities to return for each type
 * @returns Promise resolving to an object containing activities grouped by type
 */
export async function fetchDashboardActivities(
  limit: number = 5
): Promise<{
  scheduleActivities: ScheduleActivity[];
  projectActivities: ProjectTaskActivity[];
  ticketActivities: TicketActivity[];
  timeEntryActivities: TimeEntryActivity[];
  workflowTaskActivities: WorkflowTaskActivity[];
}> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Fetch activities for each type with a limit
    const filters: ActivityFilters = { isClosed: false };
    
    const [
      scheduleActivities,
      projectActivities,
      ticketActivities,
      timeEntryActivities,
      workflowTaskActivities
    ] = await Promise.all([
      fetchScheduleActivitiesInternal(user.user_id, filters),
      fetchProjectActivitiesInternal(user.user_id, filters),
      fetchTicketActivitiesInternal(user.user_id, filters),
      fetchTimeEntryActivitiesInternal(user.user_id, filters),
      fetchWorkflowTaskActivitiesInternal(user.user_id, filters)
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
}
