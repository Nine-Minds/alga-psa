import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import { publishEvent } from '@alga-psa/event-bus/publishers';

/**
 * Interface for workflow task definition
 */
export interface IWorkflowTaskDefinition {
  task_definition_id: string;
  tenant: string;
  task_type: string;
  name: string;
  description?: string;
  form_id: string;
  default_priority?: string;
  default_sla_days?: number;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for workflow task instance
 */
export interface IWorkflowTask {
  task_id: string;
  tenant: string;
  execution_id: string;
  event_id?: string;
  // task_definition_id: string; // OLD: Stores UUID for tenant task_definitions, or task_type (string) for system_task_definitions
  tenant_task_definition_id?: string | null; // FK to workflow_task_definitions.task_definition_id (UUID)
  system_task_definition_task_type?: string | null; // FK to system_workflow_task_definitions.task_type (TEXT)
  task_definition_type: 'tenant' | 'system'; // Indicates which FK is active
  title: string;
  description?: string;
  status: WorkflowTaskStatus;
  priority: string;
  due_date?: string;
  context_data?: Record<string, any>;
  assigned_roles?: string[];
  assigned_users?: string[];
  created_at: string;
  updated_at: string;
  created_by?: string;
  claimed_at?: string;
  claimed_by?: string;
  completed_at?: string;
  completed_by?: string;
  response_data?: Record<string, any>;
}

/**
 * Enum for workflow task status
 */
export enum WorkflowTaskStatus {
  PENDING = 'pending',
  CLAIMED = 'claimed',
  COMPLETED = 'completed',
  CANCELED = 'canceled',
  EXPIRED = 'expired'
}

type WorkflowTaskSearchEventType =
  | 'WORKFLOW_TASK_CREATED'
  | 'WORKFLOW_TASK_UPDATED'
  | 'WORKFLOW_TASK_DELETED'
  | 'WORKFLOW_TASK_ASSIGNMENT_CHANGED';

export async function publishWorkflowTaskSearchEvent(
  eventType: WorkflowTaskSearchEventType,
  tenant: string,
  taskId: string,
  options: {
    userId?: string;
    status?: string;
    assignedUserIds?: string[];
    changedFields?: string[];
  } = {},
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        taskId,
        userId: options.userId,
        status: options.status,
        assignedUserIds: options.assignedUserIds,
        changedFields: options.changedFields,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (eventError) {
    console.error(`[WorkflowTaskModel] Failed to publish ${eventType} search event:`, eventError);
  }
}

/**
 * Interface for task history entry
 */
export interface IWorkflowTaskHistory {
  history_id: string;
  task_id: string;
  tenant: string;
  action: string;
  from_status?: string;
  to_status?: string;
  user_id?: string;
  timestamp: string;
  details?: Record<string, any>;
}

function workflowTasks(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table('workflow_tasks') as Knex.QueryBuilder<any, any>;
}

function workflowTaskHistory(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table('workflow_task_history') as Knex.QueryBuilder<any, any>;
}

/**
 * Model for workflow_tasks table
 */
const WorkflowTaskModel = {
  /**
   * Create a new task
   */
  createTask: async (
    knex: Knex,
    tenant: string,
    task: Omit<IWorkflowTask, 'task_id' | 'created_at' | 'updated_at'> // event_id is optional in IWorkflowTask, allow it to be passed
  ): Promise<string> => {
    try {
      const taskId = uuidv4(); // Removed "task-" prefix
      
      const taskToInsert: IWorkflowTask = {
        ...task, // Spread the incoming task payload which should match the new structure
        task_id: taskId,
        tenant, // Ensure tenant is part of the final object if not already in `task`
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Ensure event_id is handled if it's part of the input `task` or set to undefined
        event_id: task.event_id || undefined,
      };
      
      // Ensure JSON fields are correctly formatted for PostgreSQL
      const finalTaskRecord = {
        ...taskToInsert,
        assigned_roles: taskToInsert.assigned_roles ? JSON.stringify(taskToInsert.assigned_roles) : null,
        assigned_users: taskToInsert.assigned_users ? JSON.stringify(taskToInsert.assigned_users) : null,
        context_data: taskToInsert.context_data ? JSON.stringify(taskToInsert.context_data) : null,
        response_data: taskToInsert.response_data ? JSON.stringify(taskToInsert.response_data) : null,
      };
      
      const [result] = await workflowTasks(knex, tenant)
        .insert(finalTaskRecord)
        .returning('task_id');
      
      if (!result || !result.task_id) {
        throw new Error('Task creation failed, no task_id returned.');
      }

      await publishWorkflowTaskSearchEvent('WORKFLOW_TASK_CREATED', tenant, result.task_id, {
        userId: task.created_by,
        status: task.status,
        assignedUserIds: task.assigned_users,
        changedFields: ['title', 'description', 'assigned_users', 'status'],
      });
      
      return result.task_id;
    } catch (error) {
      console.error('Error creating workflow task:', error);
      throw error;
    }
  },
  
  /**
   * Get a task by ID
   */
  getTaskById: async (
    knex: Knex,
    tenant: string,
    taskId: string
  ): Promise<IWorkflowTask | null> => {
    try {
      const task = await workflowTasks(knex, tenant)
        .where({
          task_id: taskId,
        })
        .first();
      
      return task || null;
    } catch (error) {
      console.error(`Error getting task ${taskId}:`, error);
      throw error;
    }
  },
  
  /**
   * Get tasks by execution ID
   */
  getTasksByExecutionId: async (
    knex: Knex,
    tenant: string,
    executionId: string
  ): Promise<IWorkflowTask[]> => {
    try {
      const tasks = await workflowTasks(knex, tenant)
        .where({
          execution_id: executionId,
        })
        .orderBy('created_at', 'desc');
      
      return tasks;
    } catch (error) {
      console.error(`Error getting tasks for execution ${executionId}:`, error);
      throw error;
    }
  },
  
  /**
   * Get tasks assigned to a user
   */
  getTasksAssignedToUser: async (
    knex: Knex,
    tenant: string,
    userId: string,
    status?: WorkflowTaskStatus | WorkflowTaskStatus[]
  ): Promise<IWorkflowTask[]> => {
    try {
      let query = workflowTasks(knex, tenant)
        .whereRaw("assigned_users @> ?", [[userId]]);
      
      if (status) {
        if (Array.isArray(status)) {
          query = query.whereIn('status', status);
        } else {
          query = query.where('status', status);
        }
      }
      
      const tasks = await query.orderBy('due_date', 'asc');
      
      return tasks;
    } catch (error) {
      console.error(`Error getting tasks assigned to user ${userId}:`, error);
      throw error;
    }
  },
  
  /**
   * Get tasks assigned to roles
   */
  getTasksAssignedToRoles: async (
    knex: Knex,
    tenant: string,
    roles: string[],
    status?: WorkflowTaskStatus | WorkflowTaskStatus[]
  ): Promise<IWorkflowTask[]> => {
    try {
      let query = workflowTasks(knex, tenant)
        .where(function() {
          for (const role of roles) {
            this.orWhereRaw("assigned_roles @> ?", [[role]]);
          }
        });
      
      if (status) {
        if (Array.isArray(status)) {
          query = query.whereIn('status', status);
        } else {
          query = query.where('status', status);
        }
      }
      
      const tasks = await query.orderBy('due_date', 'asc');
      
      return tasks;
    } catch (error) {
      console.error(`Error getting tasks assigned to roles:`, error);
      throw error;
    }
  },
  
  /**
   * Update task status
   */
  updateTaskStatus: async (
    knex: Knex,
    tenant: string,
    taskId: string,
    status: WorkflowTaskStatus,
    userId?: string
  ): Promise<boolean> => {
    try {
      const now = new Date().toISOString();
      const updates: Partial<IWorkflowTask> = {
        status,
        updated_at: now
      };
      
      // Add additional fields based on the new status
      if (status === WorkflowTaskStatus.CLAIMED) {
        updates.claimed_at = now;
        updates.claimed_by = userId;
      } else if (status === WorkflowTaskStatus.COMPLETED) {
        updates.completed_at = now;
        // updates.completed_by = userId;
      }
      
      const result = await workflowTasks(knex, tenant)
        .where({
          task_id: taskId,
        })
        .update(updates);

      if (result > 0) {
        await publishWorkflowTaskSearchEvent('WORKFLOW_TASK_UPDATED', tenant, taskId, {
          userId,
          status,
          changedFields: Object.keys(updates),
        });
      }
      
      return result > 0;
    } catch (error) {
      console.error(`Error updating task ${taskId} status:`, error);
      throw error;
    }
  },
  
  /**
   * Update task response data
   */
  updateTaskResponseData: async (
    knex: Knex,
    tenant: string,
    taskId: string,
    responseData: Record<string, any>
  ): Promise<boolean> => {
    try {
      const result = await workflowTasks(knex, tenant)
        .where({
          task_id: taskId,
        })
        .update({
          response_data: responseData,
          updated_at: new Date().toISOString()
        });

      if (result > 0) {
        await publishWorkflowTaskSearchEvent('WORKFLOW_TASK_UPDATED', tenant, taskId, {
          changedFields: ['response_data'],
        });
      }
      
      return result > 0;
    } catch (error) {
      console.error(`Error updating task ${taskId} response data:`, error);
      throw error;
    }
  },

  /**
   * Replace task assignees.
   */
  updateTaskAssignment: async (
    knex: Knex,
    tenant: string,
    taskId: string,
    assignedUserIds: string[],
    userId?: string
  ): Promise<boolean> => {
    try {
      const result = await workflowTasks(knex, tenant)
        .where({
          task_id: taskId,
        })
        .update({
          assigned_users: JSON.stringify(assignedUserIds),
          updated_at: new Date().toISOString()
        });

      if (result > 0) {
        await publishWorkflowTaskSearchEvent('WORKFLOW_TASK_ASSIGNMENT_CHANGED', tenant, taskId, {
          userId,
          assignedUserIds,
          changedFields: ['assigned_users'],
        });
      }

      return result > 0;
    } catch (error) {
      console.error(`Error updating workflow task ${taskId} assignment:`, error);
      throw error;
    }
  },

  /**
   * Delete a task.
   */
  deleteTask: async (
    knex: Knex,
    tenant: string,
    taskId: string,
    userId?: string
  ): Promise<boolean> => {
    try {
      const task = await workflowTasks(knex, tenant)
        .where({
          task_id: taskId,
        })
        .first();

      if (!task) {
        return false;
      }

      let deleted = 0;
      await knex.transaction(async (trx) => {
        await workflowTaskHistory(trx, tenant)
          .where({
            task_id: taskId,
          })
          .delete();

        const deletedRows = await workflowTasks(trx, tenant)
          .where({
            task_id: taskId,
          })
          .delete();

        deleted = Number(deletedRows ?? 0);
      });

      if (deleted > 0) {
        await publishWorkflowTaskSearchEvent('WORKFLOW_TASK_DELETED', tenant, taskId, {
          userId,
          status: task.status,
          assignedUserIds: task.assigned_users,
        });
      }

      return deleted > 0;
    } catch (error) {
      console.error(`Error deleting workflow task ${taskId}:`, error);
      throw error;
    }
  },
  
  /**
   * Complete a task with response data
   */
  completeTask: async (
    knex: Knex,
    tenant: string,
    taskId: string,
    responseData: Record<string, any>,
    userId?: string
  ): Promise<boolean> => {
    try {
      const now = new Date().toISOString();
      
      const result = await workflowTasks(knex, tenant)
        .where({
          task_id: taskId,
        })
        .update({
          status: WorkflowTaskStatus.COMPLETED,
          response_data: responseData,
          completed_at: now,
          // completed_by: userId,
          updated_at: now
        });

      if (result > 0) {
        await publishWorkflowTaskSearchEvent('WORKFLOW_TASK_UPDATED', tenant, taskId, {
          userId,
          status: WorkflowTaskStatus.COMPLETED,
          changedFields: ['status', 'response_data', 'completed_at'],
        });
      }
      
      return result > 0;
    } catch (error) {
      console.error(`Error completing task ${taskId}:`, error);
      throw error;
    }
  },
  
  /**
   * Add task history entry
   */
  addTaskHistory: async (
    knex: Knex,
    tenant: string,
    history: Omit<IWorkflowTaskHistory, 'history_id' | 'timestamp'>
  ): Promise<string> => {
    try {
      const historyId = uuidv4(); // Removed "hist-" prefix
      
      const [result] = await workflowTaskHistory(knex, tenant)
        .insert({
          ...history,
          history_id: historyId,
          tenant,
          timestamp: new Date().toISOString()
        })
        .returning('history_id');
      
      return result.history_id;
    } catch (error) {
      console.error(`Error adding task history for task ${history.task_id}:`, error);
      throw error;
    }
  },
  
  /**
   * Get task history
   */
  getTaskHistory: async (
    knex: Knex,
    tenant: string,
    taskId: string
  ): Promise<IWorkflowTaskHistory[]> => {
    try {
      const history = await workflowTaskHistory(knex, tenant)
        .where({
          task_id: taskId,
        })
        .orderBy('timestamp', 'asc');
      
      return history;
    } catch (error) {
      console.error(`Error getting history for task ${taskId}:`, error);
      throw error;
    }
  }
};

export default WorkflowTaskModel;
