'use server';

import {
  ActivityType,
  Activity
} from "@alga-psa/types";
import { createTenantKnex, tenantDb } from "@alga-psa/db";
import { withAuth } from "@alga-psa/auth";
import { revalidatePath } from "next/cache";
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { publishTicketUpdate } from '@alga-psa/event-bus/ticket-live-updates';

function formatLiveUpdateDisplayName(user: any): string {
  return `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username || 'Workflow';
}

/**
 * Server action to update the status of an activity
 *
 * @param activityId The ID of the activity to update
 * @param activityType The type of the activity
 * @param newStatus The new status to set
 * @returns Promise resolving to a boolean indicating success
 */
export const updateActivityStatus = withAuth(async (
  user,
  { tenant },
  activityId: string,
  activityType: ActivityType,
  newStatus: string
): Promise<boolean> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Update the status based on the activity type
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      switch (activityType) {
        case ActivityType.SCHEDULE:
          await tenantScopedTable("schedule_entries")
            .where("entry_id", activityId)
            .update({ status: newStatus, updated_at: new Date() });
          break;
          
        case ActivityType.PROJECT_TASK:
          // For project tasks, we need to get the status mapping ID
          const statusMapping = await tenantScopedTable("project_status_mappings")
            .join("statuses", function() {
              this.on("project_status_mappings.status_id", "statuses.status_id")
                  .andOn("project_status_mappings.tenant", "statuses.tenant");
            })
            .where("statuses.name", newStatus)
            .select("project_status_mappings.project_status_mapping_id")
            .first();
            
          if (!statusMapping) {
            throw new Error(`Status '${newStatus}' not found for project tasks`);
          }
          
          await tenantScopedTable("project_tasks")
            .where("task_id", activityId)
            .update({ 
              project_status_mapping_id: statusMapping.project_status_mapping_id,
              updated_at: new Date()
            });
          break;
          
        case ActivityType.TICKET:
          // For tickets, we need to get the status ID
          const status = await tenantScopedTable("statuses")
            .where("name", newStatus)
            .select("status_id")
            .first();
            
          if (!status) {
            throw new Error(`Status '${newStatus}' not found for tickets`);
          }
          
          await tenantScopedTable("tickets")
            .where("ticket_id", activityId)
            .update({
              status_id: status.status_id,
              updated_at: new Date()
            });
          break;
          
        case ActivityType.TIME_ENTRY:
          await tenantScopedTable("time_entries")
            .where("entry_id", activityId)
            .update({ 
              approval_status: newStatus,
              updated_at: new Date()
            });
          break;
          
        case ActivityType.WORKFLOW_TASK:
          await tenantScopedTable("workflow_tasks")
            .where("task_id", activityId)
            .update({ 
              status: newStatus,
              updated_at: new Date()
            });
          break;
          
        default:
          throw new Error(`Unsupported activity type: ${activityType}`);
      }
    });

    if (activityType === ActivityType.TICKET) {
      await publishTicketUpdate({
        tenantId: tenant,
        ticketId: activityId,
        updatedFields: ['status_id'],
        updatedBy: {
          userId: user?.user_id ?? 'workflow',
          displayName: formatLiveUpdateDisplayName(user),
        },
        updatedAt: new Date().toISOString(),
      });
    }

    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error updating activity status (${activityId}, ${activityType}, ${newStatus}):`, error);
    throw new Error("Failed to update activity status. Please try again later.");
  }
});

/**
 * Server action to update the status of an activity by status ID.
 * Used by the inline status picker which already has the status ID available.
 *
 * For tickets: statusId is tickets.status_id (from statuses table)
 * For project tasks: statusId is project_status_mappings.project_status_mapping_id
 * For schedule/workflow tasks: statusId is treated as a free-form status string
 *
 * @param activityId The ID of the activity to update
 * @param activityType The type of the activity
 * @param statusId The status/mapping ID to set
 */
export const updateActivityStatusById = withAuth(async (
  user,
  { tenant },
  activityId: string,
  activityType: ActivityType,
  statusId: string
): Promise<boolean> => {
  try {
    const { knex: db } = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      switch (activityType) {
        case ActivityType.TICKET:
          return await tenantScopedTable("tickets")
            .where("ticket_id", activityId)
            .update({
              status_id: statusId,
              updated_at: new Date(),
            });

        case ActivityType.PROJECT_TASK:
          return await tenantScopedTable("project_tasks")
            .where("task_id", activityId)
            .update({
              project_status_mapping_id: statusId,
              updated_at: new Date(),
            });

        case ActivityType.SCHEDULE:
          return await tenantScopedTable("schedule_entries")
            .where("entry_id", activityId)
            .update({ status: statusId, updated_at: new Date() });

        case ActivityType.WORKFLOW_TASK:
          return await tenantScopedTable("workflow_tasks")
            .where("task_id", activityId)
            .update({ status: statusId, updated_at: new Date() });

        default:
          throw new Error(`Status update by ID not supported for activity type: ${activityType}`);
      }
    });

    if (activityType === ActivityType.TICKET) {
      await publishTicketUpdate({
        tenantId: tenant,
        ticketId: activityId,
        updatedFields: ['status_id'],
        updatedBy: {
          userId: user?.user_id ?? 'workflow',
          displayName: formatLiveUpdateDisplayName(user),
        },
        updatedAt: new Date().toISOString(),
      });
    }

    revalidatePath('/activities');
    return true;
  } catch (error) {
    console.error(`Error updating activity status by ID (${activityId}, ${activityType}, ${statusId}):`, error);
    throw new Error("Failed to update activity status. Please try again later.");
  }
});

/**
 * Server action to fetch the statuses available for a given activity.
 * Returns a list of { id, name, isClosed } suitable for the inline status picker.
 *
 * For tickets: fetches ticket statuses scoped to the ticket's board
 * For project tasks: fetches project_status_mappings for the task's project (phase-scoped if custom)
 */
export interface ActivityStatusOption {
  id: string;
  name: string;
  isClosed: boolean;
  orderNumber?: number;
}

export const getActivityStatusOptions = withAuth(async (
  _user,
  { tenant },
  activityId: string,
  activityType: ActivityType
): Promise<ActivityStatusOption[]> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

    if (activityType === ActivityType.TICKET) {
      const ticket = await tenantScopedTable("tickets")
        .where("ticket_id", activityId)
        .select("board_id")
        .first();

      if (!ticket) return [];

      const statuses = await tenantScopedTable("statuses")
        .where("status_type", "ticket")
        .modify((qb) => {
          if (ticket.board_id) qb.andWhere("board_id", ticket.board_id);
        })
        .select("status_id", "name", "is_closed", "order_number")
        .orderBy("order_number");

      return statuses.map((s: any) => ({
        id: s.status_id,
        name: s.name,
        isClosed: !!s.is_closed,
        orderNumber: s.order_number ?? undefined,
      }));
    }

    if (activityType === ActivityType.PROJECT_TASK) {
      // Need the task's project and phase to scope mappings correctly
      const task = await tenantScopedTable("project_tasks")
        .leftJoin("project_phases", function () {
          this.on("project_tasks.phase_id", "project_phases.phase_id").andOn(
            "project_tasks.tenant",
            "project_phases.tenant"
          );
        })
        .where("project_tasks.task_id", activityId)
        .select(
          "project_phases.project_id as project_id",
          "project_tasks.phase_id as phase_id"
        )
        .first();

      if (!task) return [];

      // First, check for phase-specific mappings
      const phaseMappings = await tenantDb(trx, tenant).table("project_status_mappings as psm")
        .leftJoin("statuses as s", function () {
          this.on("psm.status_id", "=", "s.status_id").andOn("psm.tenant", "=", "s.tenant");
        })
        .leftJoin("standard_statuses as ss", function () {
          this.on("psm.standard_status_id", "=", "ss.standard_status_id");
        })
        .where("psm.project_id", task.project_id)
        .where("psm.phase_id", task.phase_id)
        .select(
          "psm.project_status_mapping_id as id",
          trx.raw(
            "COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id::text) as name"
          ),
          trx.raw("COALESCE(s.is_closed, ss.is_closed, false) as is_closed"),
          "psm.display_order as order_number"
        )
        .orderBy("psm.display_order");

      if (phaseMappings.length > 0) {
        return phaseMappings.map((m: any) => ({
          id: m.id,
          name: m.name,
          isClosed: !!m.is_closed,
          orderNumber: m.order_number ?? undefined,
        }));
      }

      // Fall back to project-default mappings (phase_id IS NULL)
      const projectMappings = await tenantDb(trx, tenant).table("project_status_mappings as psm")
        .leftJoin("statuses as s", function () {
          this.on("psm.status_id", "=", "s.status_id").andOn("psm.tenant", "=", "s.tenant");
        })
        .leftJoin("standard_statuses as ss", function () {
          this.on("psm.standard_status_id", "=", "ss.standard_status_id");
        })
        .where("psm.project_id", task.project_id)
        .whereNull("psm.phase_id")
        .select(
          "psm.project_status_mapping_id as id",
          trx.raw(
            "COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id::text) as name"
          ),
          trx.raw("COALESCE(s.is_closed, ss.is_closed, false) as is_closed"),
          "psm.display_order as order_number"
        )
        .orderBy("psm.display_order");

      return projectMappings.map((m: any) => ({
        id: m.id,
        name: m.name,
        isClosed: !!m.is_closed,
        orderNumber: m.order_number ?? undefined,
      }));
    }

    // Other activity types don't support inline status editing yet
    return [];
  });
});

/**
 * Server action to update the priority of an activity
 *
 * @param activityId The ID of the activity to update
 * @param activityType The type of the activity
 * @param newPriority The new priority to set
 * @returns Promise resolving to a boolean indicating success
 */
export const updateActivityPriority = withAuth(async (
  user,
  { tenant },
  activityId: string,
  activityType: ActivityType,
  newPriority: string
): Promise<boolean> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Update the priority based on the activity type
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      switch (activityType) {
        case ActivityType.TICKET:
          // For tickets, we need to get the priority ID
          const ticketPriority = await tenantScopedTable("priorities")
            .where("priority_name", newPriority)
            .where("item_type", "ticket")
            .select("priority_id")
            .first();

          if (!ticketPriority) {
            throw new Error(`Priority '${newPriority}' not found for tickets`);
          }

          await tenantScopedTable("tickets")
            .where("ticket_id", activityId)
            .update({
              priority_id: ticketPriority.priority_id,
              updated_at: new Date()
            });
          break;

        case ActivityType.PROJECT_TASK:
          // For project tasks, we need to get the priority ID
          const projectTaskPriority = await tenantScopedTable("priorities")
            .where("priority_name", newPriority)
            .where("item_type", "project_task")
            .select("priority_id")
            .first();

          if (!projectTaskPriority) {
            throw new Error(`Priority '${newPriority}' not found for project tasks`);
          }

          await tenantScopedTable("project_tasks")
            .where("task_id", activityId)
            .update({
              priority_id: projectTaskPriority.priority_id,
              updated_at: new Date()
            });
          break;

        case ActivityType.WORKFLOW_TASK:
          await tenantScopedTable("workflow_tasks")
            .where("task_id", activityId)
            .update({
              priority: newPriority,
              updated_at: new Date()
            });
          break;

        default:
          throw new Error(`Priority update not supported for activity type: ${activityType}`);
      }
    });

    if (activityType === ActivityType.TICKET) {
      await publishTicketUpdate({
        tenantId: tenant,
        ticketId: activityId,
        updatedFields: ['priority_id'],
        updatedBy: {
          userId: user?.user_id ?? 'workflow',
          displayName: formatLiveUpdateDisplayName(user),
        },
        updatedAt: new Date().toISOString(),
      });
    }

    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');

    return true;
  } catch (error) {
    console.error(`Error updating activity priority (${activityId}, ${activityType}, ${newPriority}):`, error);
    throw new Error("Failed to update activity priority. Please try again later.");
  }
});

/**
 * Server action to update the priority of an activity by priority ID.
 * Used by the inline priority picker which has the priority_id available directly.
 *
 * @param activityId The ID of the activity to update
 * @param activityType The type of the activity
 * @param priorityId The priority ID to set (from the priorities table)
 * @returns Promise resolving to a boolean indicating success
 */
export const updateActivityPriorityById = withAuth(async (
  user,
  { tenant },
  activityId: string,
  activityType: ActivityType,
  priorityId: string
): Promise<boolean> => {
  try {
    const { knex: db } = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      switch (activityType) {
        case ActivityType.TICKET:
          await tenantScopedTable("tickets")
            .where("ticket_id", activityId)
            .update({
              priority_id: priorityId,
              updated_at: new Date()
            });
          break;

        case ActivityType.PROJECT_TASK:
          await tenantScopedTable("project_tasks")
            .where("task_id", activityId)
            .update({
              priority_id: priorityId,
              updated_at: new Date()
            });
          break;

        default:
          throw new Error(`Priority update by ID not supported for activity type: ${activityType}`);
      }
    });

    if (activityType === ActivityType.TICKET) {
      await publishTicketUpdate({
        tenantId: tenant,
        ticketId: activityId,
        updatedFields: ['priority_id'],
        updatedBy: {
          userId: user?.user_id ?? 'workflow',
          displayName: formatLiveUpdateDisplayName(user),
        },
        updatedAt: new Date().toISOString(),
      });
    }

    revalidatePath('/activities');
    return true;
  } catch (error) {
    console.error(`Error updating activity priority by ID (${activityId}, ${activityType}, ${priorityId}):`, error);
    throw new Error("Failed to update activity priority. Please try again later.");
  }
});

/**
 * Server action to reassign an activity to a different user
 *
 * @param activityId The ID of the activity to reassign
 * @param activityType The type of the activity
 * @param newAssigneeId The ID of the user to assign the activity to
 * @returns Promise resolving to a boolean indicating success
 */
export const reassignActivity = withAuth(async (
  user,
  { tenant },
  activityId: string,
  activityType: ActivityType,
  newAssigneeId: string
): Promise<boolean> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Update the assignee based on the activity type
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      switch (activityType) {
        case ActivityType.SCHEDULE:
          // For schedule entries, we need to update the assigned_user_ids array
          const scheduleEntry = await tenantScopedTable("schedule_entries")
            .where("entry_id", activityId)
            .first();
            
          if (!scheduleEntry) {
            throw new Error(`Schedule entry not found: ${activityId}`);
          }
          
          // Replace the assigned users with the new assignee
          await tenantScopedTable("schedule_entries")
            .where("entry_id", activityId)
            .update({ 
              assigned_user_ids: [newAssigneeId],
              updated_at: new Date()
            });
          break;
          
        case ActivityType.PROJECT_TASK:
          await tenantScopedTable("project_tasks")
            .where("task_id", activityId)
            .update({ 
              assigned_to: newAssigneeId,
              updated_at: new Date()
            });
          break;
          
        case ActivityType.TICKET:
          await tenantScopedTable("tickets")
            .where("ticket_id", activityId)
            .update({ 
              assigned_to: newAssigneeId,
              updated_at: new Date()
            });
          break;
          
        case ActivityType.WORKFLOW_TASK:
          // For workflow tasks, we need to update the assigned_users array
          const workflowTask = await tenantScopedTable("workflow_tasks")
            .where("task_id", activityId)
            .first();
            
          if (!workflowTask) {
            throw new Error(`Workflow task not found: ${activityId}`);
          }
          
          // Replace the assigned users with the new assignee
          await tenantScopedTable("workflow_tasks")
            .where("task_id", activityId)
            .update({ 
              assigned_users: [newAssigneeId],
              updated_at: new Date()
            });
          break;
          
        default:
          throw new Error(`Reassignment not supported for activity type: ${activityType}`);
      }
    });

    if (activityType === ActivityType.TICKET) {
      await publishTicketUpdate({
        tenantId: tenant,
        ticketId: activityId,
        updatedFields: ['assigned_to'],
        updatedBy: {
          userId: user?.user_id ?? 'workflow',
          displayName: formatLiveUpdateDisplayName(user),
        },
        updatedAt: new Date().toISOString(),
      });
    }

    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error reassigning activity (${activityId}, ${activityType}, ${newAssigneeId}):`, error);
    throw new Error("Failed to reassign activity. Please try again later.");
  }
});
