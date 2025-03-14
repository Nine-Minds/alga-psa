'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { v4 as uuidv4 } from 'uuid';
import { getFormRegistry } from '@shared/workflow/core/formRegistry';
import { getActionRegistry } from '@shared/workflow/core/actionRegistry';
import WorkflowTaskModel, { WorkflowTaskStatus } from '@shared/workflow/persistence/workflowTaskModel';
import WorkflowEventModel from '@shared/workflow/persistence/workflowEventModel';
import { TaskSubmissionParams, TaskDetails, TaskQueryParams, TaskQueryResult, TaskEventNames } from '@shared/workflow/persistence/taskInboxInterfaces';
import { withTransaction } from 'server/src/lib/db/db';
import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';

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
    return await withTransaction(tenant, async (trx) => {
      // Get task details
      const task = await WorkflowTaskModel.getTaskById(trx, tenant, taskId);
      
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      // Get task definition to find the form schema
      const taskDefinition = await trx('workflow_task_definitions')
        .where({
          task_definition_id: task.task_definition_id,
          tenant
        })
        .first();
      
      if (!taskDefinition) {
        throw new Error(`Task definition ${task.task_definition_id} not found`);
      }
      
      // Get form registry
      const formRegistry = getFormRegistry();
      
      // Validate form data against schema
      const validationResult = await formRegistry.validateFormData(
        trx,
        tenant,
        taskDefinition.form_id,
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
      
      // 3. Create workflow event
      const eventId = uuidv4(); // Use plain UUID without prefix
      const event = {
        event_id: eventId,
        execution_id: task.execution_id,
        event_name: TaskEventNames.taskCompleted(taskId),
        event_type: 'task_completed',
        tenant,
        from_state: task.status,
        to_state: WorkflowTaskStatus.COMPLETED,
        user_id: userId,
        payload: finalFormData,
        created_at: new Date().toISOString()
      };
      
      await trx('workflow_events').insert(event);
      
      // 4. Publish event to workflow engine
      // Get action registry and workflow runtime
      const actionRegistry = getActionRegistry();
      const workflowRuntime = getWorkflowRuntime(actionRegistry);
      
      try {
        // First, try to load the execution state to ensure it's in memory
        await workflowRuntime.loadExecutionState(trx, task.execution_id, tenant);
        
        // Then enqueue event for asynchronous processing
        await workflowRuntime.enqueueEvent(trx, {
          execution_id: task.execution_id,
          event_name: TaskEventNames.taskCompleted(taskId),
          payload: finalFormData,
          user_id: userId,
          tenant
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
    const tasks = await WorkflowTaskModel.getTasksAssignedToUser(
      knex,
      tenant,
      userId,
      status
    );
    
    // Get tasks assigned to user's roles
    const userRoles = currentUser.roles || [];
    const roleIds = userRoles.map(role => role.role_id);
    const roleTasks = await WorkflowTaskModel.getTasksAssignedToRoles(
      knex,
      tenant,
      roleIds,
      status
    );
    
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
    const task = await WorkflowTaskModel.getTaskById(knex, tenant, taskId);
    
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    
    // Get task definition
    const taskDefinition = await knex('workflow_task_definitions')
      .where({
        task_definition_id: task.task_definition_id,
        tenant
      })
      .first();
    
    if (!taskDefinition) {
      throw new Error(`Task definition ${task.task_definition_id} not found`);
    }
    
    // Get form schema
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
    const task = await WorkflowTaskModel.getTaskById(knex, tenant, taskId);
    
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
    return await withTransaction(tenant, async (trx) => {
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
    const task = await WorkflowTaskModel.getTaskById(knex, tenant, taskId);
    
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
    return await withTransaction(tenant, async (trx) => {
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