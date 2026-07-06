'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import {
  WorkflowTaskModel,
  WorkflowTaskStatus,
  type TaskDetails,
  type TaskQueryParams,
  type TaskQueryResult,
  type TaskSubmissionParams,
} from '@alga-psa/workflows/persistence';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from "next/cache";
import {
  submitTaskFormForApi,
  getUserTasksForApi,
  getTaskDetailsForApi,
  claimTaskForApi,
  unclaimTaskForApi,
} from './taskInboxCore';
import { workflowTenantTable } from '../../lib/workflowTenantDb';

//TODO: we need to fix withTransaction to work with passed knex instances

/**
 * Submit a task form.
 *
 * The business logic + form validation live in `submitTaskFormForApi`; this wrapper only
 * resolves the session user/tenant. The v1 REST API calls the core directly with an
 * API-key-resolved identity so both paths stay identical.
 */
export const submitTaskForm = withAuth(async (user, { tenant }, params: TaskSubmissionParams): Promise<{ success: boolean }> => {
  return submitTaskFormForApi(user, tenant, params);
});

/**
 * Get tasks for the current user.
 */
export const getUserTasks = withAuth(async (user, { tenant }, params?: TaskQueryParams): Promise<TaskQueryResult> => {
  return getUserTasksForApi(user, tenant, params);
});

/**
 * Get task details (including the resolved form schema).
 */
export const getTaskDetails = withAuth(async (user, { tenant }, taskId: string): Promise<TaskDetails> => {
  return getTaskDetailsForApi(user, tenant, taskId);
});

/**
 * Claim a task.
 */
export const claimTask = withAuth(async (user, { tenant }, taskId: string): Promise<{ success: boolean }> => {
  return claimTaskForApi(user, tenant, taskId);
});

/**
 * Unclaim a task.
 */
export const unclaimTask = withAuth(async (user, { tenant }, taskId: string): Promise<{ success: boolean }> => {
  return unclaimTaskForApi(user, tenant, taskId);
});

/**
 * Dismiss a task
 * This completes the task with resolution data indicating it was dismissed
 */
export const dismissTask = withAuth(async (user, { tenant }, taskId: string): Promise<{ success: boolean }> => {
  try {
    const { knex } = await createTenantKnex();

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
    
    // Check if task can be dismissed (should be in pending or claimed state)
    if (![WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED].includes(task.status)) {
      throw new Error(`Task is in ${task.status} state and cannot be dismissed`);
    }
    
    // Use transaction to complete task with dismiss resolution data
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Create dismiss resolution data
      const dismissResolutionData = {
        dismissed: true,
        dismissedBy: userId,
        dismissedAt: new Date().toISOString(),
        reason: 'dismissed_by_user'
      };
      
      // Complete task with dismiss resolution data
      await WorkflowTaskModel.completeTask(
        trx,
        tenant,
        taskId,
        dismissResolutionData,
        userId
      );
      
      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(
        trx,
        tenant,
        {
          task_id: taskId,
          tenant,
          action: 'dismiss',
          from_status: task.status,
          to_status: WorkflowTaskStatus.COMPLETED,
          user_id: userId,
          details: { dismissed: true }
        }
      );
      
      const taskCompletionEventId = uuidv4();
      void taskCompletionEventId;
      
      return { success: true };
    });
  } catch (error) {
    console.error(`Error dismissing task ${taskId}:`, error);
    throw error;
  } finally {
    // Revalidate cache to refresh UI
    revalidatePath('/msp/user-activities');
  }
});

/**
 * Hide a task from the user's view
 */
export const hideTask = withAuth(async (user, { tenant }, taskId: string): Promise<{ success: boolean }> => {
  try {
    const { knex } = await createTenantKnex();

    const userId = user?.user_id;

    if (!userId) {
      throw new Error('User not authenticated');
    }
    
    // Use transaction to update task and add history
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update task to mark as hidden
      await workflowTenantTable(trx, tenant, 'workflow_tasks')
        .where('task_id', taskId)
        .update({
          is_hidden: true,
          hidden_at: new Date(),
          hidden_by: userId,
          updated_at: new Date()
        });
      
      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(
        trx,
        tenant,
        {
          task_id: taskId,
          tenant,
          action: 'hide',
          user_id: userId,
          details: { hidden_by: userId }
        }
      );
      
      return { success: true };
    });
  } catch (error) {
    console.error(`Error hiding task ${taskId}:`, error);
    throw error;
  } finally {
    // Revalidate cache to refresh UI
    revalidatePath('/msp/user-activities');
  }
});

/**
 * Unhide a task to make it visible again
 */
export const unhideTask = withAuth(async (user, { tenant }, taskId: string): Promise<{ success: boolean }> => {
  try {
    const { knex } = await createTenantKnex();

    const userId = user?.user_id;

    if (!userId) {
      throw new Error('User not authenticated');
    }
    
    // Use transaction to update task and add history
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update task to mark as not hidden
      await workflowTenantTable(trx, tenant, 'workflow_tasks')
        .where('task_id', taskId)
        .update({
          is_hidden: false,
          hidden_at: null,
          hidden_by: null,
          updated_at: new Date()
        });
      
      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(
        trx,
        tenant,
        {
          task_id: taskId,
          tenant,
          action: 'unhide',
          user_id: userId,
          details: { unhidden_by: userId }
        }
      );
      
      return { success: true };
    });
  } catch (error) {
    console.error(`Error unhiding task ${taskId}:`, error);
    throw error;
  } finally {
    // Revalidate cache to refresh UI
    revalidatePath('/msp/user-activities');
  }
});
