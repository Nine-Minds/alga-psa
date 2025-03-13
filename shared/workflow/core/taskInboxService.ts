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
      
      // Create the task
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
        assigned_roles: params.assignTo?.roles,
        assigned_users: params.assignTo?.users,
        created_by: userId
      };
      
      // Insert the task
      await WorkflowTaskModel.createTask(knex, tenant, task);
      
      // Add task history entry
      await WorkflowTaskModel.addTaskHistory(knex, tenant, {
        task_id: taskId,
        tenant,
        action: 'create',
        from_status: undefined,
        to_status: WorkflowTaskStatus.PENDING,
        user_id: userId
      });
      
      // Create a task created event
      const eventId = `evt-${uuidv4()}`;
      const event = {
        event_id: eventId,
        execution_id: executionId,
        event_name: TaskEventNames.taskCreated(taskId),
        event_type: 'task_created',
        tenant,
        from_state: '',
        to_state: WorkflowTaskStatus.PENDING,
        user_id: userId,
        payload: {
          taskId,
          taskType: params.taskType,
          title: params.title,
          description: params.description,
          priority: params.priority || 'medium',
          dueDate: params.dueDate,
          assignedRoles: params.assignTo?.roles,
          assignedUsers: params.assignTo?.users,
          contextData: params.contextData
        },
        created_at: new Date().toISOString()
      };
      
      // Insert the event
      await knex('workflow_events').insert(event);
      
      return taskId;
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
    // Register createHumanTask action using registerSimpleAction
    actionRegistry.registerSimpleAction(
      'createHumanTask',
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
          
          // Create the task
          const taskId = await taskInboxService.createTask(
            (context as TaskActionContext).knex,
            context.tenant,
            context.executionId,
            {
              taskType: params.taskType,
              title: params.title,
              description: params.description,
              priority: params.priority,
              dueDate: params.dueDate,
              assignTo: params.assignTo,
              contextData: params.contextData,
              formId: params.formId
            },
            (context as TaskActionContext).userId
          );
          
          return {
            success: true,
            taskId
          };
        } catch (error) {
          console.error('Error executing createHumanTask action:', error);
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