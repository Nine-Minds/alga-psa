import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

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
  task_definition_id: string;
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
    task: Omit<IWorkflowTask, 'task_id' | 'created_at' | 'updated_at'>
  ): Promise<string> => {
    try {
      const taskId = `task-${uuidv4()}`;
      
      // Create the record with appropriate values for insertion
      const taskRecord = {
        ...task,
        task_id: taskId,
        tenant,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      console.log('DEBUG WorkflowTaskModel.createTask - About to insert task:', JSON.stringify(taskRecord, null, 2));
      console.log('DEBUG WorkflowTaskModel.createTask - assigned_roles type:', typeof taskRecord.assigned_roles);
      
      // Explicitly stringify and re-parse the JSON fields to ensure proper format
      if (taskRecord.assigned_roles !== undefined) {
        try {
          // Force proper JSON format by stringifying and re-parsing
          const jsonString = JSON.stringify(taskRecord.assigned_roles);
          console.log('DEBUG WorkflowTaskModel.createTask - assigned_roles stringified:', jsonString);
          
          // Store the raw JSON string directly to avoid any driver conversion issues
          // This ensures PostgreSQL gets exactly what we expect
          taskRecord.assigned_roles = JSON.parse(jsonString);
          console.log('DEBUG WorkflowTaskModel.createTask - assigned_roles re-parsed:', taskRecord.assigned_roles);
        } catch (e: any) {
          console.error('DEBUG WorkflowTaskModel.createTask - ERROR: assigned_roles JSON processing failed:', e.message);
          taskRecord.assigned_roles = undefined;
        }
      }
      
      if (taskRecord.assigned_users !== undefined) {
        try {
          // Force proper JSON format by stringifying and re-parsing
          const jsonString = JSON.stringify(taskRecord.assigned_users);
          console.log('DEBUG WorkflowTaskModel.createTask - assigned_users stringified:', jsonString);
          
          // Store the raw JSON string directly to avoid any driver conversion issues
          taskRecord.assigned_users = JSON.parse(jsonString);
          console.log('DEBUG WorkflowTaskModel.createTask - assigned_users re-parsed:', taskRecord.assigned_users);
        } catch (e: any) {
          console.error('DEBUG WorkflowTaskModel.createTask - ERROR: assigned_users JSON processing failed:', e.message);
          taskRecord.assigned_users = undefined;
        }
      }
      
      // To be extra safe, manually build the SQL to ensure proper JSON serialization
      // This is a more direct approach when dealing with JSONB fields that may be causing issues
      const pgTaskRecord = {
        ...taskRecord,
        // Force PostgreSQL to see these as proper JSON strings
        assigned_roles: taskRecord.assigned_roles ? JSON.stringify(taskRecord.assigned_roles) : null,
        assigned_users: taskRecord.assigned_users ? JSON.stringify(taskRecord.assigned_users) : null,
        context_data: taskRecord.context_data ? JSON.stringify(taskRecord.context_data) : null
      };
      
      console.log('DEBUG WorkflowTaskModel.createTask - Final pgTaskRecord:',
        'assigned_roles:', pgTaskRecord.assigned_roles,
        'type:', typeof pgTaskRecord.assigned_roles);
      
      const [result] = await knex('workflow_tasks')
        .insert(pgTaskRecord)
        .returning('task_id');
      
      console.log('DEBUG WorkflowTaskModel.createTask - Successfully inserted task with ID:', result.task_id);
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
      const task = await knex<IWorkflowTask>('workflow_tasks')
        .where({
          task_id: taskId,
          tenant
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
      const tasks = await knex<IWorkflowTask>('workflow_tasks')
        .where({
          execution_id: executionId,
          tenant
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
      let query = knex<IWorkflowTask>('workflow_tasks')
        .where('tenant', tenant)
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
      let query = knex<IWorkflowTask>('workflow_tasks')
        .where('tenant', tenant)
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
        updates.completed_by = userId;
      }
      
      const result = await knex('workflow_tasks')
        .where({
          task_id: taskId,
          tenant
        })
        .update(updates);
      
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
      const result = await knex('workflow_tasks')
        .where({
          task_id: taskId,
          tenant
        })
        .update({
          response_data: responseData,
          updated_at: new Date().toISOString()
        });
      
      return result > 0;
    } catch (error) {
      console.error(`Error updating task ${taskId} response data:`, error);
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
      
      const result = await knex('workflow_tasks')
        .where({
          task_id: taskId,
          tenant
        })
        .update({
          status: WorkflowTaskStatus.COMPLETED,
          response_data: responseData,
          completed_at: now,
          completed_by: userId,
          updated_at: now
        });
      
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
      const historyId = `hist-${uuidv4()}`;
      
      const [result] = await knex('workflow_task_history')
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
      const history = await knex<IWorkflowTaskHistory>('workflow_task_history')
        .where({
          task_id: taskId,
          tenant
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