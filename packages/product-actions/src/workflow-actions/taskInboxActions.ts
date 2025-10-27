'use server';

import { createTenantKnex } from '@server/lib/db';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { v4 as uuidv4 } from 'uuid';
import { getFormRegistry } from '@shared/workflow/core/formRegistry';
import { getActionRegistry } from '@shared/workflow/core/actionRegistry';
import WorkflowTaskModel, { WorkflowTaskStatus } from '@shared/workflow/persistence/workflowTaskModel';
import WorkflowEventModel from '@shared/workflow/persistence/workflowEventModel';
import { TaskSubmissionParams, TaskDetails, TaskQueryParams, TaskQueryResult, TaskEventNames } from '@shared/workflow/persistence/taskInboxInterfaces';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';
import { revalidatePath } from "next/cache";

//TODO: we need to fix withTransaction to work with passed knex instances

/**
 * Submit a task form
 * This function handles the conversion of form submissions to workflow events
 */
export async function submitTaskForm(params: TaskSubmissionParams): Promise<{ success: boolean }> {
  const { taskId, formData, comments } = params;
  
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get current user
    const currentUser = await getCurrentUser();
    const userId = currentUser?.user_id;
    
    // Use a transaction to ensure all operations succeed or fail together
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get task details
      const task = await WorkflowTaskModel.getTaskById(trx, tenant, taskId);
      
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      // Get task definition to find the form schema
      let taskDefinition: any; // Define with a broader type or a specific combined type if available

      if (task.task_definition_type === 'system') {
        if (!task.system_task_definition_task_type) {
          throw new Error(`System task ${taskId} is missing system_task_definition_task_type.`);
        }
        taskDefinition = await trx('system_workflow_task_definitions')
          .where({
            task_type: task.system_task_definition_task_type,
          })
          .first();
      } else { // 'tenant'
        if (!task.tenant_task_definition_id) {
          throw new Error(`Tenant task ${taskId} is missing tenant_task_definition_id.`);
        }
        taskDefinition = await trx('workflow_task_definitions')
          .where({
            task_definition_id: task.tenant_task_definition_id,
            tenant
          })
          .first();
      }
      
      if (!taskDefinition) {
        const idUsed = task.task_definition_type === 'system' ? task.system_task_definition_task_type : task.tenant_task_definition_id;
        throw new Error(`Task definition ${idUsed} (type: ${task.task_definition_type}) not found`);
      }
      
      // The form_id to use for FormRegistry lookup comes from the resolved taskDefinition
      const formIdForRegistry = taskDefinition.form_id;
      // If system_workflow_task_definitions.form_id refers to system_workflow_form_definitions.name
      // and workflow_task_definitions.form_id refers to workflow_form_definitions.definition_id (UUID)
      // then formRegistry.getForm needs to handle this.
      // For now, we assume taskDefinition.form_id is the correct identifier for formRegistry.

      // Get form registry
      const formRegistry = getFormRegistry();
      
      // Validate form data against schema
      const validationResult = await formRegistry.validateFormData(
        trx,
        tenant,
        formIdForRegistry, // Use the resolved formId
        formData
      );
      
      if (!validationResult.valid) {
        throw new Error(`Form validation failed: ${JSON.stringify(validationResult.errors)}`);
      }
      
      // Add comments to form data if provided
      const finalFormData = comments
        ? { ...formData, __comments: comments }
        : formData;
      
      // 1. Update task status to completed
      await WorkflowTaskModel.completeTask(
        trx,
        tenant,
        taskId,
        finalFormData,
        userId
      );
      
      // 2. Add task history entry
      await WorkflowTaskModel.addTaskHistory(
        trx,
        tenant,
        {
          task_id: taskId,
          tenant,
          action: 'complete',
          from_status: task.status,
          to_status: WorkflowTaskStatus.COMPLETED,
          user_id: userId,
          details: { formData: finalFormData }
        }
      );
      
      // 3. Generate a clean eventId for this task completion.
      // This eventId will be used as the idempotency_key for enqueueEvent,
      // making enqueueEvent the sole persister of this event.
      const taskCompletionEventId = uuidv4();
      
      // The direct insert into workflow_events is removed from here.
      // WorkflowRuntime.enqueueEvent will handle the event persistence.

      // 4. Publish event to workflow engine
      // Get action registry and workflow runtime
      const actionRegistry = getActionRegistry();
      const workflowRuntime = getWorkflowRuntime(actionRegistry);
      
      try {
        // First, try to load the execution state to ensure it's in memory
        // Note: Depending on implementation, loadExecutionState might not be strictly necessary
        // before enqueueEvent if enqueueEvent can robustly handle non-cached states.
        // However, it's often good practice to ensure the state is loaded or can be loaded.
        await workflowRuntime.loadExecutionState(trx, task.execution_id, tenant);
        
        // Then enqueue event for asynchronous processing, passing the generated
        // eventId as the idempotency_key.
        await workflowRuntime.enqueueEvent(trx, {
          execution_id: task.execution_id,
          event_name: TaskEventNames.taskCompleted(taskId),
          payload: finalFormData,
          user_id: userId,
          tenant,
          idempotency_key: taskCompletionEventId // Pass the generated clean UUID
        });
      } catch (error) {
        console.error('Error enqueueing workflow event:', error);
        
        // If we can't enqueue the event, we'll still mark the task as completed
        // but log the error for debugging
        console.log('Task marked as completed but workflow event not enqueued');
      }
      
      return { success: true };
    });
  } catch (error) {
    console.error('Error submitting task form:', error);
    throw error;
  }
}

/**
 * Get tasks for the current user
 */
export async function getUserTasks(params?: TaskQueryParams): Promise<TaskQueryResult> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get current user
    const currentUser = await getCurrentUser();
    const userId = currentUser?.user_id;
    
    if (!userId) {
      throw new Error('User not authenticated');
    }
    
    // Default query parameters
    const {
      status = [WorkflowTaskStatus.PENDING, WorkflowTaskStatus.CLAIMED],
      page = 1,
      pageSize = 20
    } = params || {};
    
    // Get tasks assigned to the user
    const tasks = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await WorkflowTaskModel.getTasksAssignedToUser(
        trx,
        tenant,
        userId,
        status
      );
    });
    
    // Get tasks assigned to user's roles
    const userRoles = currentUser.roles || [];
    const roleIds = userRoles.map(role => role.role_id);
    const roleTasks = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await WorkflowTaskModel.getTasksAssignedToRoles(
        trx,
        tenant,
        roleIds,
        status
      );
    });
    
    // Combine and deduplicate tasks
    const allTasks = [...tasks];
    for (const roleTask of roleTasks) {
      if (!allTasks.some(t => t.task_id === roleTask.task_id)) {
        allTasks.push(roleTask);
      }
    }
    
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
    const taskDetails: TaskDetails[] = paginatedTasks.map(task => ({
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
      responseData: task.response_data
    }));
    
    return {
      tasks: taskDetails,
      total: allTasks.length,
      page,
      pageSize,
      totalPages: Math.ceil(allTasks.length / pageSize)
    };
  } catch (error) {
    console.error('Error getting user tasks:', error);
    throw error;
  }
}

/**
 * Get task details
 */
export async function getTaskDetails(taskId: string): Promise<TaskDetails> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get task
    const task = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await WorkflowTaskModel.getTaskById(trx, tenant, taskId);
    });
    
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    
    // Get task definition
    let taskDefinition: any; // Define with a broader type

    if (task.task_definition_type === 'system') {
      if (!task.system_task_definition_task_type) {
        throw new Error(`System task ${taskId} is missing system_task_definition_task_type.`);
      }
      taskDefinition = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('system_workflow_task_definitions')
          .where({
            task_type: task.system_task_definition_task_type,
          })
          .first();
      });
    } else { // 'tenant'
      if (!task.tenant_task_definition_id) {
        throw new Error(`Tenant task ${taskId} is missing tenant_task_definition_id.`);
      }
      taskDefinition = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('workflow_task_definitions')
          .where({
            task_definition_id: task.tenant_task_definition_id,
            tenant
          })
          .first();
      });
    }
    
    if (!taskDefinition) {
      const idUsed = task.task_definition_type === 'system' ? task.system_task_definition_task_type : task.tenant_task_definition_id;
      throw new Error(`Task definition ${idUsed} (type: ${task.task_definition_type}) not found`);
    }
    
    // Get form schema using the form_id from the fetched task definition
    const formRegistry = getFormRegistry();
    // Assuming taskDefinition.form_id correctly points to either a system form name or a tenant form UUID
    // and formRegistry.getForm can resolve this.
    const form = await formRegistry.getForm(knex, tenant, taskDefinition.form_id);
    
    console.log('[taskInboxAction] Form:', form);

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
      formSchema: form ? {
        jsonSchema: form.schema.json_schema,
        uiSchema: form.schema.ui_schema,
        defaultValues: form.schema.default_values
      } : undefined,
      createdAt: task.created_at,
      createdBy: task.created_by,
      claimedAt: task.claimed_at,
      claimedBy: task.claimed_by,
      completedAt: task.completed_at,
      completedBy: task.completed_by,
      responseData: task.response_data
    };
  } catch (error) {
    console.error(`Error getting task details for ${taskId}:`, error);
    throw error;
  }
}

/**
 * Claim a task
 */
export async function claimTask(taskId: string): Promise<{ success: boolean }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get current user
    const currentUser = await getCurrentUser();
    const userId = currentUser?.user_id;
    
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
      await WorkflowTaskModel.updateTaskStatus(
        trx,
        tenant,
        taskId,
        WorkflowTaskStatus.CLAIMED,
        userId
      );
      
      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(
        trx,
        tenant,
        {
          task_id: taskId,
          tenant,
          action: 'claim',
          from_status: task.status,
          to_status: WorkflowTaskStatus.CLAIMED,
          user_id: userId
        }
      );
      
      return { success: true };
    });
  } catch (error) {
    console.error(`Error claiming task ${taskId}:`, error);
    throw error;
  }
}

/**
 * Unclaim a task
 */
export async function unclaimTask(taskId: string): Promise<{ success: boolean }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get current user
    const currentUser = await getCurrentUser();
    const userId = currentUser?.user_id;
    
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
      await WorkflowTaskModel.updateTaskStatus(
        trx,
        tenant,
        taskId,
        WorkflowTaskStatus.PENDING,
        userId
      );
      
      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(
        trx,
        tenant,
        {
          task_id: taskId,
          tenant,
          action: 'unclaim',
          from_status: task.status,
          to_status: WorkflowTaskStatus.PENDING,
          user_id: userId
        }
      );
      
      return { success: true };
    });
  } catch (error) {
    console.error(`Error unclaiming task ${taskId}:`, error);
    throw error;
  }
}

/**
 * Dismiss a task
 * This completes the task with resolution data indicating it was dismissed
 */
export async function dismissTask(taskId: string): Promise<{ success: boolean }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get current user
    const currentUser = await getCurrentUser();
    const userId = currentUser?.user_id;
    
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
      
      // Generate event ID for task completion
      const taskCompletionEventId = uuidv4();
      
      // Publish task completion event to workflow engine
      const actionRegistry = getActionRegistry();
      const workflowRuntime = getWorkflowRuntime(actionRegistry);
      
      try {
        // Load execution state
        await workflowRuntime.loadExecutionState(trx, task.execution_id, tenant);
        
        // Enqueue task completed event with dismiss resolution data
        await workflowRuntime.enqueueEvent(trx, {
          execution_id: task.execution_id,
          event_name: TaskEventNames.taskCompleted(taskId),
          payload: dismissResolutionData,
          user_id: userId,
          tenant,
          idempotency_key: taskCompletionEventId
        });
      } catch (error: any) {
        console.error('Error enqueueing workflow completion event:', error);
        console.log('Task marked as completed but workflow event not enqueued');
      }
      
      return { success: true };
    });
  } catch (error) {
    console.error(`Error dismissing task ${taskId}:`, error);
    throw error;
  } finally {
    // Revalidate cache to refresh UI
    revalidatePath('/msp/user-activities');
  }
}

/**
 * Hide a task from the user's view
 */
export async function hideTask(taskId: string): Promise<{ success: boolean }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get current user
    const currentUser = await getCurrentUser();
    const userId = currentUser?.user_id;
    
    if (!userId) {
      throw new Error('User not authenticated');
    }
    
    // Use transaction to update task and add history
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update task to mark as hidden
      await trx('workflow_tasks')
        .where('task_id', taskId)
        .where('tenant', tenant)
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
}

/**
 * Unhide a task to make it visible again
 */
export async function unhideTask(taskId: string): Promise<{ success: boolean }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    // Get current user
    const currentUser = await getCurrentUser();
    const userId = currentUser?.user_id;
    
    if (!userId) {
      throw new Error('User not authenticated');
    }
    
    // Use transaction to update task and add history
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Update task to mark as not hidden
      await trx('workflow_tasks')
        .where('task_id', taskId)
        .where('tenant', tenant)
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
}
