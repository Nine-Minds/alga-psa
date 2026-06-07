// @ts-nocheck
// EE implementation of the user-activities workflow-task source.
//
// `@alga-psa/user-activities/server/workflow-tasks` resolves here in the EE app build
// (and to packages/user-activities/src/server/workflow-tasks.ts in CE). This is the
// real query against `workflow_tasks`; gating is by build placement, not imports, so the
// base CE package never depends on EE/workflow code.
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import {
  Activity,
  ActivityFilters,
  ActivityType,
  workflowTaskToActivity,
} from '@alga-psa/types';

// Helper function to convert ISO string to plain date
function toPlainDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toISOString().split('T')[0];
}

/**
 * Interface for workflow task data from database
 */
interface WorkflowTaskData {
  task_id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  due_date?: string;
  assigned_users?: string[];
  assigned_roles?: string[];
  execution_id: string;
  form_id?: string;
  context_data?: Record<string, any>;
  tenant: string;
  created_at: string;
  updated_at: string;
  workflow_name?: string;
  workflow_version?: string;
  current_state?: string;
  execution_status?: string;
}

/**
 * Fetch workflow task activities for a user
 */
export async function fetchWorkflowTaskActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    if (filters.clientId) {
      return [];
    }

    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Execute queries in transaction
    const { workflowTasks } = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get user roles for role-based task assignment
      const userRoles = await trx("user_roles")
        .where("user_roles.tenant", tenant)
        .where("user_roles.user_id", userId)
        .select("role_id");

      const roleIds = userRoles.map(role => role.role_id);

      // Go back to using the knex query builder instead of raw SQL to avoid binding issues
      const workflowTasksQuery = trx("workflow_tasks as wt")
      .select(
        "wt.*"
      )
      .where("wt.tenant", tenant)
      .modify(function(queryBuilder) {
        // Filter for tasks assigned to the user or their roles
        queryBuilder.where(function() {
          // Tasks assigned to the user
          this.whereRaw("wt.assigned_users::jsonb @> ?::jsonb", [JSON.stringify([userId])]);

          // Tasks assigned to user's roles
          if (roleIds.length > 0) {
            roleIds.forEach(roleId => {
              this.orWhereRaw("wt.assigned_roles::jsonb @> ?::jsonb", [JSON.stringify([roleId])]);
            });
          }
        });

        // Apply status filter if provided
        if (filters.status && filters.status.length > 0) {
          queryBuilder.whereIn("wt.status", filters.status);
        }

        // Apply priority filter if provided (case-insensitive comparison)
        if (filters.priority && filters.priority.length > 0) {
          queryBuilder.where(function() {
            this.whereRaw(
              "LOWER(wt.priority) IN (" + filters.priority!.map(() => "?").join(", ") + ")",
              filters.priority!.map(p => p.toLowerCase())
            );
          });
        }

        // Apply due date filter if provided
        if (filters.dueDateStart) {
          queryBuilder.where("wt.due_date", ">=", toPlainDate(filters.dueDateStart));
        }

        if (filters.dueDateEnd) {
          queryBuilder.where("wt.due_date", "<=", toPlainDate(filters.dueDateEnd));
        }

        // Apply closed filter if provided
        if (filters.isClosed !== undefined) {
          if (filters.isClosed) {
            queryBuilder.whereIn("wt.status", ["completed", "cancelled"]);
          } else {
            queryBuilder.whereNotIn("wt.status", ["completed", "cancelled"]);
          }
        }

        // Apply execution ID filter if provided
        if (filters.executionId) {
          queryBuilder.where("wt.execution_id", filters.executionId);
        }

        // Apply search filter if provided
        if (filters.search) {
          const searchTerm = `%${filters.search}%`;
          queryBuilder.where(function() {
            this.where("wt.title", 'ilike', searchTerm)
              .orWhere("wt.description", 'ilike', searchTerm);
          });
        }

        // Apply hidden filter if provided
        if (filters.includeHidden !== undefined) {
          if (filters.includeHidden) {
            // Include all tasks (hidden and not hidden)
            // No additional filter needed
          } else {
            // Only include non-hidden tasks
            queryBuilder.where(function() {
              this.where("wt.is_hidden", false)
                .orWhereNull("wt.is_hidden");
            });
          }
        } else {
          // Default behavior: exclude hidden tasks
          queryBuilder.where(function() {
            this.where("wt.is_hidden", false)
              .orWhereNull("wt.is_hidden");
          });
        }
      });

      // Execute the query
      const workflowTasks = await workflowTasksQuery;

      return { userRoles, workflowTasks };
    });

    // Convert to activities
    const activities = workflowTasks.map((task: WorkflowTaskData) => workflowTaskToActivity(task));

    return activities;
  } catch (error) {
    console.error("Error fetching workflow task activities:", error);
    return [];
  }
}
