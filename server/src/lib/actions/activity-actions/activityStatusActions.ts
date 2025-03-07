'use server';

import { 
  ActivityType,
  Activity
} from "../../../interfaces/activity.interfaces";
import { createTenantKnex } from "../../db";
import { getCurrentUser } from "../user-actions/userActions";
import { revalidatePath } from "next/cache";

/**
 * Server action to update the status of an activity
 * 
 * @param activityId The ID of the activity to update
 * @param activityType The type of the activity
 * @param newStatus The new status to set
 * @returns Promise resolving to a boolean indicating success
 */
export async function updateActivityStatus(
  activityId: string,
  activityType: ActivityType,
  newStatus: string
): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Update the status based on the activity type
    switch (activityType) {
      case ActivityType.SCHEDULE:
        await db("schedule_entries")
          .where("entry_id", activityId)
          .where("tenant", tenant)
          .update({ status: newStatus, updated_at: new Date() });
        break;
        
      case ActivityType.PROJECT_TASK:
        // For project tasks, we need to get the status mapping ID
        const statusMapping = await db("project_status_mappings")
          .join("statuses", function() {
            this.on("project_status_mappings.status_id", "statuses.status_id")
                .andOn("project_status_mappings.tenant", "statuses.tenant");
          })
          .where("statuses.name", newStatus)
          .where("project_status_mappings.tenant", tenant)
          .select("project_status_mappings.project_status_mapping_id")
          .first();
          
        if (!statusMapping) {
          throw new Error(`Status '${newStatus}' not found for project tasks`);
        }
        
        await db("project_tasks")
          .where("task_id", activityId)
          .where("tenant", tenant)
          .update({ 
            project_status_mapping_id: statusMapping.project_status_mapping_id,
            updated_at: new Date()
          });
        break;
        
      case ActivityType.TICKET:
        // For tickets, we need to get the status ID
        const status = await db("statuses")
          .where("name", newStatus)
          .where("tenant", tenant)
          .select("status_id")
          .first();
          
        if (!status) {
          throw new Error(`Status '${newStatus}' not found for tickets`);
        }
        
        await db("tickets")
          .where("ticket_id", activityId)
          .where("tenant", tenant)
          .update({ 
            status: status.status_id,
            updated_at: new Date()
          });
        break;
        
      case ActivityType.TIME_ENTRY:
        await db("time_entries")
          .where("entry_id", activityId)
          .where("tenant", tenant)
          .update({ 
            approval_status: newStatus,
            updated_at: new Date()
          });
        break;
        
      case ActivityType.WORKFLOW_TASK:
        await db("workflow_tasks")
          .where("task_id", activityId)
          .where("tenant", tenant)
          .update({ 
            status: newStatus,
            updated_at: new Date()
          });
        break;
        
      default:
        throw new Error(`Unsupported activity type: ${activityType}`);
    }

    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error updating activity status (${activityId}, ${activityType}, ${newStatus}):`, error);
    throw new Error("Failed to update activity status. Please try again later.");
  }
}

/**
 * Server action to update the priority of an activity
 * 
 * @param activityId The ID of the activity to update
 * @param activityType The type of the activity
 * @param newPriority The new priority to set
 * @returns Promise resolving to a boolean indicating success
 */
export async function updateActivityPriority(
  activityId: string,
  activityType: ActivityType,
  newPriority: string
): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Update the priority based on the activity type
    switch (activityType) {
      case ActivityType.TICKET:
        // For tickets, we need to get the priority ID
        const priority = await db("priorities")
          .where("priority_name", newPriority)
          .where("tenant", tenant)
          .select("priority_id")
          .first();
          
        if (!priority) {
          throw new Error(`Priority '${newPriority}' not found for tickets`);
        }
        
        await db("tickets")
          .where("ticket_id", activityId)
          .where("tenant", tenant)
          .update({ 
            priority_id: priority.priority_id,
            updated_at: new Date()
          });
        break;
        
      case ActivityType.WORKFLOW_TASK:
        await db("workflow_tasks")
          .where("task_id", activityId)
          .where("tenant", tenant)
          .update({ 
            priority: newPriority,
            updated_at: new Date()
          });
        break;
        
      // Add cases for other activity types as needed
      
      default:
        throw new Error(`Priority update not supported for activity type: ${activityType}`);
    }

    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error updating activity priority (${activityId}, ${activityType}, ${newPriority}):`, error);
    throw new Error("Failed to update activity priority. Please try again later.");
  }
}

/**
 * Server action to reassign an activity to a different user
 * 
 * @param activityId The ID of the activity to reassign
 * @param activityType The type of the activity
 * @param newAssigneeId The ID of the user to assign the activity to
 * @returns Promise resolving to a boolean indicating success
 */
export async function reassignActivity(
  activityId: string,
  activityType: ActivityType,
  newAssigneeId: string
): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Update the assignee based on the activity type
    switch (activityType) {
      case ActivityType.SCHEDULE:
        // For schedule entries, we need to update the assigned_user_ids array
        const scheduleEntry = await db("schedule_entries")
          .where("entry_id", activityId)
          .where("tenant", tenant)
          .first();
          
        if (!scheduleEntry) {
          throw new Error(`Schedule entry not found: ${activityId}`);
        }
        
        // Replace the assigned users with the new assignee
        await db("schedule_entries")
          .where("entry_id", activityId)
          .where("tenant", tenant)
          .update({ 
            assigned_user_ids: [newAssigneeId],
            updated_at: new Date()
          });
        break;
        
      case ActivityType.PROJECT_TASK:
        await db("project_tasks")
          .where("task_id", activityId)
          .where("tenant", tenant)
          .update({ 
            assigned_to: newAssigneeId,
            updated_at: new Date()
          });
        break;
        
      case ActivityType.TICKET:
        await db("tickets")
          .where("ticket_id", activityId)
          .where("tenant", tenant)
          .update({ 
            assigned_to: newAssigneeId,
            updated_at: new Date()
          });
        break;
        
      case ActivityType.WORKFLOW_TASK:
        // For workflow tasks, we need to update the assigned_users array
        const workflowTask = await db("workflow_tasks")
          .where("task_id", activityId)
          .where("tenant", tenant)
          .first();
          
        if (!workflowTask) {
          throw new Error(`Workflow task not found: ${activityId}`);
        }
        
        // Replace the assigned users with the new assignee
        await db("workflow_tasks")
          .where("task_id", activityId)
          .where("tenant", tenant)
          .update({ 
            assigned_users: [newAssigneeId],
            updated_at: new Date()
          });
        break;
        
      default:
        throw new Error(`Reassignment not supported for activity type: ${activityType}`);
    }

    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error reassigning activity (${activityId}, ${activityType}, ${newAssigneeId}):`, error);
    throw new Error("Failed to reassign activity. Please try again later.");
  }
}