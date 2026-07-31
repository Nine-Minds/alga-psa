/**
 * Task-inbox core logic.
 *
 * Plain functions that take an explicit `(user, tenant, …)` identity. They hold the full
 * business logic + form validation for the workflow task inbox and are shared by two
 * callers:
 *   - the web app, via the `withAuth`-wrapped exports in `taskInboxActions.ts`
 *     (which resolve the user from the NextAuth session), and
 *   - the v1 REST API, which resolves the user from an API key and calls these `*ForApi`
 *     functions directly under `runWithTenant` (through the EE user-activities seam).
 *
 * IMPORTANT: this module deliberately has NO `'use server'` directive. These functions are
 * unauthenticated by design (the caller supplies the already-resolved identity), so they
 * must never be registered as client-callable server actions.
 */

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { getFormRegistry } from '@shared/task-inbox';
import {
  WorkflowTaskModel,
  WorkflowTaskStatus,
  type TaskDetails,
  type TaskQueryParams,
  type TaskQueryResult,
  type TaskSubmissionParams,
} from '@alga-psa/workflows/persistence';
import { Knex } from 'knex';
import { workflowTenantTable } from '../../lib/workflowTenantDb';

const SYSTEM_WORKFLOW_CATALOG_TENANT = '__workflow_system_catalog__';

// system_workflow_task_definitions is a global table; the facade only needs a
// non-empty tenant to route it unscoped.
const systemCatalogTenant = (tenant: string | null | undefined): string => {
  const value = String(tenant ?? '').trim();
  return value || SYSTEM_WORKFLOW_CATALOG_TENANT;
};

const systemWorkflowTaskDefinitions = (
  conn: Knex | Knex.Transaction,
  tenant: string | null | undefined
) => tenantDb(conn, systemCatalogTenant(tenant)).table('system_workflow_task_definitions');

/**
 * Submit a task form. Validates `formData` against the task's form schema via the form
 * registry, then completes the task. Throws `Form validation failed: …` on schema
 * violations so callers can surface a 400.
 */
export async function submitTaskFormForApi(
  user: IUserWithRoles,
  tenant: string,
  params: TaskSubmissionParams,
): Promise<{ success: boolean }> {
  const { taskId, formData, comments } = params;

  try {
    const { knex } = await createTenantKnex(tenant);

    const userId = user?.user_id;

    // Use a transaction to ensure all operations succeed or fail together
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get task details
      const task = await WorkflowTaskModel.getTaskById(trx, tenant, taskId);

      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      // Get task definition to find the form schema
      let taskDefinition: any;

      if (task.task_definition_type === 'system') {
        if (!task.system_task_definition_task_type) {
          throw new Error(`System task ${taskId} is missing system_task_definition_task_type.`);
        }
        taskDefinition = await systemWorkflowTaskDefinitions(trx, tenant)
          .where({
            task_type: task.system_task_definition_task_type,
          })
          .first();
      } else {
        // 'tenant'
        if (!task.tenant_task_definition_id) {
          throw new Error(`Tenant task ${taskId} is missing tenant_task_definition_id.`);
        }
        taskDefinition = await workflowTenantTable(trx, tenant, 'workflow_task_definitions')
          .where({
            task_definition_id: task.tenant_task_definition_id,
          })
          .first();
      }

      if (!taskDefinition) {
        const idUsed =
          task.task_definition_type === 'system'
            ? task.system_task_definition_task_type
            : task.tenant_task_definition_id;
        throw new Error(`Task definition ${idUsed} (type: ${task.task_definition_type}) not found`);
      }

      // The form_id to use for FormRegistry lookup comes from the resolved taskDefinition
      const formIdForRegistry = taskDefinition.form_id;

      // Get form registry
      const formRegistry = getFormRegistry();

      // Validate form data against schema
      const validationResult = await formRegistry.validateFormData(
        trx,
        tenant,
        formIdForRegistry,
        formData,
      );

      if (!validationResult.valid) {
        throw new Error(`Form validation failed: ${JSON.stringify(validationResult.errors)}`);
      }

      // Add comments to form data if provided
      const finalFormData = comments ? { ...formData, __comments: comments } : formData;

      // 1. Update task status to completed
      await WorkflowTaskModel.completeTask(trx, tenant, taskId, finalFormData, userId);

      // 2. Add task history entry
      await WorkflowTaskModel.addTaskHistory(trx, tenant, {
        task_id: taskId,
        tenant,
        action: 'complete',
        from_status: task.status,
        to_status: WorkflowTaskStatus.COMPLETED,
        user_id: userId,
        details: { formData: finalFormData },
      });

      const taskCompletionEventId = uuidv4();
      void taskCompletionEventId;

      return { success: true };
    });
  } catch (error) {
    console.error('Error submitting task form:', error);
    throw error;
  }
}

/**
 * Get tasks for the given user (their direct assignments + their role assignments),
 * paginated and sorted by due date then creation date.
 */
export async function getUserTasksForApi(
  user: IUserWithRoles,
  tenant: string,
  params?: TaskQueryParams,
): Promise<TaskQueryResult> {
  try {
    const { knex } = await createTenantKnex(tenant);

    const userId = user?.user_id;

    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Default query parameters
    const { status = [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED], page = 1, pageSize = 20 } =
      params || {};

    const statusList = Array.isArray(status) ? status : [status];
    const userRoles = user.roles || [];
    const roleIds = userRoles.map((role) => role.role_id).filter(Boolean);

    // A user's inbox is every active (non-hidden) task they can act on:
    //   - assigned directly to them (assigned_users contains their id),
    //   - assigned to one of their roles (assigned_roles intersects their role ids),
    //   - the open claimable pool — PENDING tasks with no user/role assignment. Workflow
    //     `human.task` nodes create tasks unassigned, and claimTaskForApi lets any user
    //     claim any PENDING task, so these belong in everyone's inbox as claimable.
    //   - tasks they have already claimed, so a pool task stays in their inbox after they
    //     claim it (it is no longer PENDING and was never in assigned_users).
    // jsonb `@>` is bound as a JSON string + ::jsonb cast — a raw JS-array bind is sent to
    // Postgres as an array and rejected with "invalid input syntax for type json".
    const allTasks = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await workflowTenantTable<Record<string, any>>(trx, tenant, 'workflow_tasks')
        .where('is_hidden', false)
        .whereIn('status', statusList)
        .where(function () {
          this.whereRaw('assigned_users @> ?::jsonb', [JSON.stringify([userId])]);
          for (const roleId of roleIds) {
            this.orWhereRaw('assigned_roles @> ?::jsonb', [JSON.stringify([roleId])]);
          }
          this.orWhere(function () {
            this.where('status', WorkflowTaskStatus.PENDING)
              .where(function () {
                this.whereNull('assigned_users').orWhereRaw("assigned_users = '[]'::jsonb");
              })
              .where(function () {
                this.whereNull('assigned_roles').orWhereRaw("assigned_roles = '[]'::jsonb");
              });
          });
          this.orWhere('claimed_by', userId);
        })
        .orderBy('due_date', 'asc');
    });

    // Sort by due date (ascending) and created date (descending)
    allTasks.sort((a, b) => {
      // First sort by due date (null values last)
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      if (a.due_date && b.due_date) {
        const dateComparison = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        if (dateComparison !== 0) return dateComparison;
      }

      // Then sort by created date (newest first)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Apply pagination
    const offset = (page - 1) * pageSize;
    const paginatedTasks = allTasks.slice(offset, offset + pageSize);

    // Convert to TaskDetails format
    const taskDetails: TaskDetails[] = paginatedTasks.map((task) => ({
      taskId: task.task_id,
      executionId: task.execution_id,
      title: task.title,
      description: task.description,
      status: task.status as WorkflowTaskStatus,
      priority: task.priority,
      dueDate: task.due_date,
      assignedRoles: task.assigned_roles as string[],
      assignedUsers: task.assigned_users as string[],
      contextData: task.context_data,
      formId: '', // Will be populated from task definition
      createdAt: task.created_at,
      createdBy: task.created_by,
      claimedAt: task.claimed_at,
      claimedBy: task.claimed_by,
      completedAt: task.completed_at,
      completedBy: task.completed_by,
      responseData: task.response_data,
    }));

    return {
      tasks: taskDetails,
      total: allTasks.length,
      page,
      pageSize,
      totalPages: Math.ceil(allTasks.length / pageSize),
    };
  } catch (error) {
    console.error('Error getting user tasks:', error);
    throw error;
  }
}

/**
 * Get full task details, including the resolved form schema (`jsonSchema` + `uiSchema` +
 * `defaultValues`) so the client can classify the form (simple vs complex) and render it.
 */
export async function getTaskDetailsForApi(
  _user: IUserWithRoles,
  tenant: string,
  taskId: string,
): Promise<TaskDetails> {
  try {
    const { knex } = await createTenantKnex(tenant);

    // Get task
    const task = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await WorkflowTaskModel.getTaskById(trx, tenant, taskId);
    });

    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }

    // Get task definition
    let taskDefinition: any;

    if (task.task_definition_type === 'system') {
      if (!task.system_task_definition_task_type) {
        throw new Error(`System task ${taskId} is missing system_task_definition_task_type.`);
      }
      taskDefinition = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await systemWorkflowTaskDefinitions(trx, tenant)
          .where({
            task_type: task.system_task_definition_task_type,
          })
          .first();
      });
    } else {
      // 'tenant'
      if (!task.tenant_task_definition_id) {
        throw new Error(`Tenant task ${taskId} is missing tenant_task_definition_id.`);
      }
      taskDefinition = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await workflowTenantTable(trx, tenant, 'workflow_task_definitions')
          .where({
            task_definition_id: task.tenant_task_definition_id,
          })
          .first();
      });
    }

    if (!taskDefinition) {
      const idUsed =
        task.task_definition_type === 'system'
          ? task.system_task_definition_task_type
          : task.tenant_task_definition_id;
      throw new Error(`Task definition ${idUsed} (type: ${task.task_definition_type}) not found`);
    }

    // Get form schema using the form_id from the fetched task definition
    const formRegistry = getFormRegistry();
    const form = await formRegistry.getForm(knex, tenant, taskDefinition.form_id);

    // Return task details
    return {
      taskId: task.task_id,
      executionId: task.execution_id,
      title: task.title,
      description: task.description,
      status: task.status as WorkflowTaskStatus,
      priority: task.priority,
      dueDate: task.due_date,
      assignedRoles: task.assigned_roles as string[],
      assignedUsers: task.assigned_users as string[],
      contextData: task.context_data,
      formId: taskDefinition.form_id,
      formSchema: form
        ? {
            jsonSchema: form.schema.json_schema,
            uiSchema: form.schema.ui_schema,
            defaultValues: form.schema.default_values,
          }
        : undefined,
      createdAt: task.created_at,
      createdBy: task.created_by,
      claimedAt: task.claimed_at,
      claimedBy: task.claimed_by,
      completedAt: task.completed_at,
      completedBy: task.completed_by,
      responseData: task.response_data,
    };
  } catch (error) {
    console.error(`Error getting task details for ${taskId}:`, error);
    throw error;
  }
}

/**
 * Claim a pending task for the given user.
 */
export async function claimTaskForApi(
  user: IUserWithRoles,
  tenant: string,
  taskId: string,
): Promise<{ success: boolean }> {
  try {
    const { knex } = await createTenantKnex(tenant);

    const userId = user?.user_id;

    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Get task
    const task = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await WorkflowTaskModel.getTaskById(trx, tenant, taskId);
    });

    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }

    // Check if task is already claimed
    if (task.status === WorkflowTaskStatus.CLAIMED) {
      if (task.claimed_by === userId) {
        return { success: true }; // Already claimed by this user
      } else {
        throw new Error('Task is already claimed by another user');
      }
    }

    // Check if task is in a claimable state
    if (task.status !== WorkflowTaskStatus.PENDING) {
      throw new Error(`Task is in ${task.status} state and cannot be claimed`);
    }

    // Use transaction to update task and add history
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update task status
      await WorkflowTaskModel.updateTaskStatus(trx, tenant, taskId, WorkflowTaskStatus.CLAIMED, userId);

      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(trx, tenant, {
        task_id: taskId,
        tenant,
        action: 'claim',
        from_status: task.status,
        to_status: WorkflowTaskStatus.CLAIMED,
        user_id: userId,
      });

      return { success: true };
    });
  } catch (error) {
    console.error(`Error claiming task ${taskId}:`, error);
    throw error;
  }
}

/**
 * Release a task the given user has claimed, returning it to the pending pool.
 */
export async function unclaimTaskForApi(
  user: IUserWithRoles,
  tenant: string,
  taskId: string,
): Promise<{ success: boolean }> {
  try {
    const { knex } = await createTenantKnex(tenant);

    const userId = user?.user_id;

    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Get task
    const task = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await WorkflowTaskModel.getTaskById(trx, tenant, taskId);
    });

    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }

    // Check if task is claimed by this user
    if (task.status !== WorkflowTaskStatus.CLAIMED) {
      throw new Error('Task is not in claimed state');
    }

    if (task.claimed_by !== userId) {
      throw new Error('Task is claimed by another user');
    }

    // Use transaction to update task and add history
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update task status
      await WorkflowTaskModel.updateTaskStatus(trx, tenant, taskId, WorkflowTaskStatus.PENDING, userId);

      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(trx, tenant, {
        task_id: taskId,
        tenant,
        action: 'unclaim',
        from_status: task.status,
        to_status: WorkflowTaskStatus.PENDING,
        user_id: userId,
      });

      return { success: true };
    });
  } catch (error) {
    console.error(`Error unclaiming task ${taskId}:`, error);
    throw error;
  }
}
