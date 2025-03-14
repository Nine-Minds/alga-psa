import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import WorkflowTaskModel, { IWorkflowTask, WorkflowTaskStatus } from '../persistence/workflowTaskModel.js';
import { TaskCreationParams, TaskEventNames } from '../persistence/taskInboxInterfaces.js';
import { getWorkflowRuntime } from './workflowRuntime.js';
import { getFormRegistry } from './formRegistry.js';
import { ActionRegistry, ActionExecutionContext, ActionParameterDefinition } from './actionRegistry.js';

/**
 * Extended context for workflow actions with additional properties needed for task creation
 */
interface TaskActionContext extends ActionExecutionContext {
  knex: Knex;
  userId?: string;
  tenant: string;
  executionId: string;
}

/**
 * Service for managing workflow tasks in the Task Inbox system
 */
export class TaskInboxService {
  /**
   * Create a new task in the Task Inbox
   * 
   * @param knex Knex instance
   * @param tenant Tenant ID
   * @param executionId Workflow execution ID
   * @param params Task creation parameters
   * @param userId User ID of the creator
   * @returns The created task ID
   */
  async createTask(
    knex: Knex,
    tenant: string,
    executionId: string,
    params: TaskCreationParams,
    userId?: string
  ): Promise<string> {
    try {
      // Generate a unique task ID
      const taskId = `task-${uuidv4()}`;
      
      // Get task definition
      let taskDefinitionId: string;
      
      // Check if task definition exists
      const existingTaskDef = await knex('workflow_task_definitions')
        .where({
          task_type: params.taskType,
          tenant
        })
        .first();
      
      if (existingTaskDef) {
        taskDefinitionId = existingTaskDef.task_definition_id;
      } else {
        // Create a new task definition if it doesn't exist
        const newTaskDefId = `taskdef-${uuidv4()}`;
        
        // Ensure we have a form ID
        if (!params.formId) {
          throw new Error('Form ID is required for creating a new task definition');
        }
        
        // Verify the form exists
        const formRegistry = getFormRegistry();
        const form = await formRegistry.getForm(knex, tenant, params.formId);
        
        if (!form) {
          throw new Error(`Form with ID ${params.formId} not found`);
        }
        
        // Create the task definition
        await knex('workflow_task_definitions').insert({
          task_definition_id: newTaskDefId,
          tenant,
          task_type: params.taskType,
          name: params.title, // Use the task title as the definition name
          description: params.description,
          form_id: params.formId,
          default_priority: params.priority || 'medium',
          default_sla_days: params.dueDate ? 
            Math.ceil((new Date(params.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 
            3, // Default to 3 days if no due date provided
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        
        taskDefinitionId = newTaskDefId;
      }
      
      // Create the task - ensure assigned_roles and assigned_users are properly formatted JSON arrays
      // For PostgreSQL JSONB fields, we need to make sure these are valid JSON arrays
      console.log('DEBUG createTask - Raw params assignTo:', JSON.stringify(params.assignTo, null, 2));
      
      let assignedRoles = undefined;
      if (params.assignTo?.roles) {
        console.log('DEBUG createTask - Raw roles:', params.assignTo.roles, 'Type:', typeof params.assignTo.roles);
        
        if (typeof params.assignTo.roles === 'string') {
          assignedRoles = [params.assignTo.roles]; // Convert string to array
          console.log('DEBUG createTask - Converted string role to array:', assignedRoles);
        } else if (Array.isArray(params.assignTo.roles)) {
          assignedRoles = params.assignTo.roles;
          console.log('DEBUG createTask - Using array roles:', assignedRoles);
        } else {
          console.log('DEBUG createTask - Invalid roles format, set to undefined');
        }
      }
      
      let assignedUsers = undefined;
      if (params.assignTo?.users) {
        console.log('DEBUG createTask - Raw users:', params.assignTo.users, 'Type:', typeof params.assignTo.users);
        
        if (typeof params.assignTo.users === 'string') {
          assignedUsers = [params.assignTo.users]; // Convert string to array
          console.log('DEBUG createTask - Converted string user to array:', assignedUsers);
        } else if (Array.isArray(params.assignTo.users)) {
          assignedUsers = params.assignTo.users;
          console.log('DEBUG createTask - Using array users:', assignedUsers);
        } else {
          console.log('DEBUG createTask - Invalid users format, set to undefined');
        }
      }
      
      // Final check to ensure we have arrays at this point
      if (assignedRoles !== undefined && !Array.isArray(assignedRoles)) {
        console.log('DEBUG createTask - Final check: roles is not an array, forcing to undefined');
        assignedRoles = undefined;
      }
      
      if (assignedUsers !== undefined && !Array.isArray(assignedUsers)) {
        console.log('DEBUG createTask - Final check: users is not an array, forcing to undefined');
        assignedUsers = undefined;
      }
      
      const task: Omit<IWorkflowTask, 'task_id' | 'created_at' | 'updated_at'> = {
        tenant,
        execution_id: executionId,
        task_definition_id: taskDefinitionId,
        title: params.title,
        description: params.description,
        status: WorkflowTaskStatus.PENDING,
        priority: params.priority || 'medium',
        due_date: params.dueDate ? new Date(params.dueDate).toISOString() : undefined,
        context_data: params.contextData,
        assigned_roles: assignedRoles,
        assigned_users: assignedUsers,
        created_by: userId
      };
      
      console.log('DEBUG createTask - Final task object assigned_roles:', 
                  task.assigned_roles ? JSON.stringify(task.assigned_roles) : 'undefined', 
                  'Type:', typeof task.assigned_roles);
      
      // Insert the task - capturing the returned task ID
      const generatedTaskId = await WorkflowTaskModel.createTask(knex, tenant, task);
      console.log('DEBUG createTask - Task created with ID:', generatedTaskId);
      
      // Add task history entry - using the generated task ID from the database
      try {
        await WorkflowTaskModel.addTaskHistory(knex, tenant, {
          task_id: generatedTaskId, // Use the task ID returned from createTask
          tenant,
          action: 'create',
          from_status: undefined,
          to_status: WorkflowTaskStatus.PENDING,
          user_id: userId
        });
        console.log('DEBUG createTask - Task history added successfully for:', generatedTaskId);
      } catch (error) {
        console.error('Error adding task history:', error);
        // Continue even if history fails - the task is already created
      }
      
      // Create a task created event - using the generated task ID
      const eventId = `${uuidv4()}`;
      const event = {
        event_id: eventId,
        execution_id: executionId,
        event_name: TaskEventNames.taskCreated(generatedTaskId),
        event_type: 'task_created',
        tenant,
        from_state: '',
        to_state: WorkflowTaskStatus.PENDING,
        user_id: userId,
        payload: {
          taskId: generatedTaskId, // Use the generated task ID
          taskType: params.taskType,
          title: params.title,
          description: params.description,
          priority: params.priority || 'medium',
          dueDate: params.dueDate,
          // Use the same validated arrays we used for the task
          assignedRoles: assignedRoles,
          assignedUsers: assignedUsers,
          contextData: params.contextData
        },
        created_at: new Date().toISOString()
      };
      
      // Insert the event
      try {
        await knex('workflow_events').insert(event);
        console.log('DEBUG createTask - Event created successfully for task:', generatedTaskId);
      } catch (error) {
        console.error('Error creating task event:', error);
        // Continue even if event creation fails - the task is already created
      }
      
      return generatedTaskId; // Return the generated task ID from the database
    } catch (error) {
      console.error('Error creating task:', error);
      throw error;
    }
  }
  
  /**
   * Register a task creation action with the workflow engine
   * This allows workflows to create human tasks
   * 
   * @param actionRegistry The action registry to register with
   */
  registerTaskActions(actionRegistry: ActionRegistry): void {
    // Register create_human_task action using registerSimpleAction
    actionRegistry.registerSimpleAction(
      'create_human_task',
      'Create a human task in the Task Inbox',
      [
        { name: 'taskType', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
        { name: 'description', type: 'string', required: false },
        { name: 'priority', type: 'string', required: false },
        { name: 'dueDate', type: 'string', required: false },
        { name: 'assignTo', type: 'object', required: false },
        { name: 'contextData', type: 'object', required: false },
        { name: 'formId', type: 'string', required: false }
      ],
      async (params: Record<string, any>, context: ActionExecutionContext) => {
        try {
          const taskInboxService = new TaskInboxService();
          
          // Get database connection
          const { getAdminConnection } = await import('@shared/db/admin.js');
          const knex = await getAdminConnection();
          
          // Validate and normalize inputs
          let assignTo = undefined;
          
          console.log('DEBUG create_human_task - Context:', {
            tenant: context.tenant,
            executionId: context.executionId,
            userId: context.userId || 'undefined', // Log userId to verify it's being passed
            idempotencyKey: context.idempotencyKey
          });
          
          console.log('DEBUG create_human_task - Input params:', JSON.stringify(params, null, 2));
          
          // Ensure assignTo is properly structured with valid array values
          if (params.assignTo) {
            console.log('DEBUG create_human_task - Original assignTo:', JSON.stringify(params.assignTo, null, 2));
            
            // Check if roles is a string and convert to array if needed
            let roles = params.assignTo.roles;
            console.log('DEBUG create_human_task - Original roles:', roles, 'Type:', typeof roles);
            
            if (typeof roles === 'string') {
              roles = [roles]; // Convert single string to array
              console.log('DEBUG create_human_task - Converted string role to array:', roles);
            } else if (!Array.isArray(roles)) {
              roles = undefined; // If not string or array, set to undefined
              console.log('DEBUG create_human_task - Invalid roles format, set to undefined');
            }
            
            // Check if users is a string and convert to array if needed
            let users = params.assignTo.users;
            console.log('DEBUG create_human_task - Original users:', users, 'Type:', typeof users);
            
            if (typeof users === 'string') {
              users = [users]; // Convert single string to array
              console.log('DEBUG create_human_task - Converted string user to array:', users);
            } else if (!Array.isArray(users)) {
              users = undefined; // If not string or array, set to undefined
              console.log('DEBUG create_human_task - Invalid users format, set to undefined');
            }
            
            assignTo = {
              roles: roles,
              users: users
            };
            
            console.log('DEBUG create_human_task - Normalized assignTo:', JSON.stringify(assignTo, null, 2));
          } else {
            console.log('DEBUG create_human_task - No assignTo provided');
          }
          
          // Create the task with validated inputs
          const taskId = await taskInboxService.createTask(
            knex,
            context.tenant,
            context.executionId,
            {
              taskType: params.taskType,
              title: params.title,
              description: params.description,
              priority: params.priority,
              dueDate: params.dueDate,
              assignTo: assignTo,
              contextData: params.contextData,
              formId: params.formId
            },
            context.userId
          );
          
          return {
            success: true,
            taskId
          };
        } catch (error) {
          console.error('Error executing create_human_task action:', error);
          throw error;
        }
      }
    );
  }
}

// Singleton instance
let taskInboxServiceInstance: TaskInboxService | null = null;

/**
 * Get the task inbox service instance
 */
export function getTaskInboxService(): TaskInboxService {
  if (!taskInboxServiceInstance) {
    taskInboxServiceInstance = new TaskInboxService();
  }
  return taskInboxServiceInstance;
}