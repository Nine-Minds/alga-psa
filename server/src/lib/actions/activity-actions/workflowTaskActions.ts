'use server';

import { 
  WorkflowTaskActivity,
  ActivityFilters
} from "../../../interfaces/activity.interfaces";
import { createTenantKnex } from "../../db";
import { getCurrentUser } from "../user-actions/userActions";
import { revalidatePath } from "next/cache";
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { fetchWorkflowTaskActivities } from "./activityAggregationActions";
import { IWorkflowExecution } from "@alga-psa/shared/workflow/persistence/workflowInterfaces";

/**
 * Server action to fetch a workflow task by ID
 * 
 * @param taskId The ID of the workflow task to fetch
 * @returns Promise resolving to the WorkflowTaskActivity or null if not found
 */
export async function fetchWorkflowTask(
  taskId: string
): Promise<WorkflowTaskActivity | null> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Fetch all workflow tasks for the user
    const tasks = await fetchWorkflowTaskActivities(user.user_id, {}) as WorkflowTaskActivity[];
    
    // Find the task with the specified ID
    const task = tasks.find(t => t.id === taskId);
    return task || null;
  } catch (error) {
    console.error(`Error fetching workflow task (${taskId}):`, error);
    throw new Error("Failed to fetch workflow task. Please try again later.");
  }
}

/**
 * Interface for task form schema
 */
interface TaskFormSchema {
  jsonSchema: Record<string, any>;
  uiSchema: Record<string, any>;
  actions: Array<{
    id: string;
    label: string;
    primary?: boolean;
    disabled?: boolean;
  }>;
}

/**
 * Server action to fetch the form schema for a workflow task
 * 
 * @param formId The ID of the form to fetch
 * @returns Promise resolving to the form schema
 */
export async function fetchTaskFormSchema(
  formId: string
): Promise<TaskFormSchema> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Fetch the form schema from the database
    const form = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx("workflow_forms")
        .where("form_id", formId)
        .where("tenant", tenant)
        .first();
    });
      
    if (!form) {
      throw new Error(`Form not found: ${formId}`);
    }
    
    // Parse the JSON schema and UI schema
    const jsonSchema = form.json_schema ? JSON.parse(form.json_schema) : {};
    const uiSchema = form.ui_schema ? JSON.parse(form.ui_schema) : {};
    
    // Generate actions based on the form configuration
    const actions = [
      { id: 'submit', label: 'Submit', primary: true },
      { id: 'cancel', label: 'Cancel' }
    ];
    
    return {
      jsonSchema,
      uiSchema,
      actions
    };
  } catch (error) {
    console.error(`Error fetching task form schema (${formId}):`, error);
    throw new Error("Failed to fetch task form schema. Please try again later.");
  }
}

/**
 * Server action to fetch existing form data for a workflow task
 * 
 * @param taskId The ID of the workflow task
 * @returns Promise resolving to the form data or null if not found
 */
export async function fetchTaskFormData(
  taskId: string
): Promise<Record<string, any> | null> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Fetch the task and execution data
    const { task, execution } = await withTransaction(db, async (trx: Knex.Transaction) => {
      const task = await trx("workflow_tasks")
        .where("task_id", taskId)
        .where("tenant", tenant)
        .first();
        
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      
      // Fetch the execution to get the context data
      const execution = await trx("workflow_executions")
        .where("execution_id", task.execution_id)
        .where("tenant", tenant)
        .first();
        
      return { task, execution };
    });
      
    if (!execution) {
      throw new Error(`Execution not found: ${task.execution_id}`);
    }
    
    // Return the context data as the form data
    return execution.context_data || null;
  } catch (error) {
    console.error(`Error fetching task form data (${taskId}):`, error);
    throw new Error("Failed to fetch task form data. Please try again later.");
  }
}

/**
 * Server action to submit a workflow task form
 * 
 * @param taskId The ID of the workflow task
 * @param formData The form data to submit
 * @returns Promise resolving to a boolean indicating success
 */
export async function submitTaskForm(
  taskId: string,
  formData: Record<string, any>
): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Update task and execution in a transaction
    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Fetch the task to get the execution ID
      const task = await trx("workflow_tasks")
        .where("task_id", taskId)
        .where("tenant", tenant)
        .first();
        
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      
      // Update the task status to completed
      await trx("workflow_tasks")
        .where("task_id", taskId)
        .where("tenant", tenant)
        .update({ 
          status: "completed",
          updated_at: new Date()
        });
        
      // Update the execution context data with the form data
      await trx("workflow_executions")
        .where("execution_id", task.execution_id)
        .where("tenant", tenant)
        .update({ 
          context_data: formData,
          updated_at: new Date()
        });
    });
    
    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error submitting task form (${taskId}):`, error);
    throw new Error("Failed to submit task form. Please try again later.");
  }
}

/**
 * Server action to cancel a workflow task
 * 
 * @param taskId The ID of the workflow task to cancel
 * @returns Promise resolving to a boolean indicating success
 */
export async function cancelWorkflowTask(
  taskId: string
): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Update the task status to cancelled
    await withTransaction(db, async (trx: Knex.Transaction) => {
      await trx("workflow_tasks")
        .where("task_id", taskId)
        .where("tenant", tenant)
        .update({ 
          status: "cancelled",
          updated_at: new Date()
        });
    });
    
    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error cancelling workflow task (${taskId}):`, error);
    throw new Error("Failed to cancel workflow task. Please try again later.");
  }
}

/**
 * Server action to reassign a workflow task to a different user
 * 
 * @param taskId The ID of the workflow task to reassign
 * @param newAssigneeId The ID of the user to assign the task to
 * @returns Promise resolving to a boolean indicating success
 */
export async function reassignWorkflowTask(
  taskId: string,
  newAssigneeId: string
): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Update task assignment in a transaction
    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Fetch the task to get the current assigned users
      const task = await trx("workflow_tasks")
        .where("task_id", taskId)
        .where("tenant", tenant)
        .first();
        
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      
      // Replace the assigned users with the new assignee
      await trx("workflow_tasks")
        .where("task_id", taskId)
        .where("tenant", tenant)
        .update({ 
          assigned_users: [newAssigneeId],
          updated_at: new Date()
        });
    });
    
    // Revalidate the activities path to refresh the data
    revalidatePath('/activities');
    
    return true;
  } catch (error) {
    console.error(`Error reassigning workflow task (${taskId}, ${newAssigneeId}):`, error);
    throw new Error("Failed to reassign workflow task. Please try again later.");
  }
}

/**
 * Server action to fetch workflow tasks for the dashboard
 * This is a specialized version of fetchWorkflowTaskActivities that returns a limited number of tasks
 * with additional filtering options specific to the dashboard
 * 
 * @param limit The maximum number of tasks to return
 * @param filters Optional filters to apply to the tasks
 * @returns Promise resolving to an array of WorkflowTaskActivity objects
 */
export async function fetchDashboardWorkflowTasks(
  limit: number = 5,
  filters: ActivityFilters = {}
): Promise<WorkflowTaskActivity[]> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Set default filters for the dashboard
    const dashboardFilters: ActivityFilters = {
      ...filters,
      isClosed: filters.isClosed !== undefined ? filters.isClosed : false
    };
    
    // Apply search filter if provided
    if (filters.search) {
      dashboardFilters.search = filters.search;
    }
    
    // Apply due date filters if provided
    if (filters.dueDateStart) {
      dashboardFilters.dueDateStart = filters.dueDateStart;
    }
    
    if (filters.dueDateEnd) {
      dashboardFilters.dueDateEnd = filters.dueDateEnd;
    }
    
    // Apply workflow execution filter if provided
    if (filters.executionId) {
      dashboardFilters.executionId = filters.executionId;
    }
    
    // Apply priority filter if provided
    if (filters.priority && filters.priority.length > 0) {
      dashboardFilters.priority = filters.priority;
    }
    
    // Fetch workflow tasks for the user
    const tasks = await fetchWorkflowTaskActivities(user.user_id, dashboardFilters) as WorkflowTaskActivity[];
    
    // Sort tasks by priority and due date
    const sortedTasks = tasks.sort((a, b) => {
      // First sort by priority (high to low)
      const priorityOrder = { 
        'high': 0, 
        'medium': 1, 
        'low': 2 
      };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then sort by due date (closest first)
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      } else if (a.dueDate) {
        return -1; // a has due date, b doesn't
      } else if (b.dueDate) {
        return 1; // b has due date, a doesn't
      }
      
      // Finally sort by creation date (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    
    // Return the limited number of tasks
    return sortedTasks.slice(0, limit);
  } catch (error) {
    console.error(`Error fetching dashboard workflow tasks:`, error);
    throw new Error("Failed to fetch dashboard workflow tasks. Please try again later.");
  }
}