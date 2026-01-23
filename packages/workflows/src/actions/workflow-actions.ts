'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { WorkflowExecutionModel, WorkflowEventModel, WorkflowActionResultModel } from '@alga-psa/shared/workflow/persistence';
import type { IWorkflowExecution, IWorkflowEvent, IWorkflowActionResult } from '@alga-psa/shared/workflow/persistence';
import { getWorkflowRuntime, getActionRegistry } from '@alga-psa/shared/workflow/core';
import type { WorkflowDefinition, WorkflowMetadata } from '@alga-psa/shared/workflow/core';
import { initializeServerWorkflows } from '@alga-psa/shared/workflow/init/serverInit';

/**
 * Workflow metrics interface
 */
export interface WorkflowMetrics {
  total: number;
  active: number;
  completed: number;
  failed: number;
  byWorkflowName: Record<string, number>;
}

/**
 * Filter options for workflow executions
 */
export interface WorkflowExecutionFilter {
  workflowName?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Get workflow execution metrics
 */
export const getWorkflowMetricsAction = withAuth(async (_user, { tenant }): Promise<WorkflowMetrics> => {
  const { knex } = await createTenantKnex();

  // Get counts for each workflow status
  const [total, active, completed, failed] = await Promise.all([
    knex('workflow_executions').where({ tenant }).count('*').first(),
    knex('workflow_executions').where({ tenant, status: 'active' }).count('*').first(),
    knex('workflow_executions').where({ tenant, status: 'completed' }).count('*').first(),
    knex('workflow_executions').where({ tenant, status: 'failed' }).count('*').first(),
  ]);

  // Get counts by workflow name
  const workflowNameCounts = await knex('workflow_executions')
    .where({ tenant })
    .select('workflow_name')
    .count('* as count')
    .groupBy('workflow_name');

  const byWorkflowName: Record<string, number> = {};
  workflowNameCounts.forEach(row => {
    byWorkflowName[row.workflow_name] = parseInt(String(row.count), 10);
  });

  return {
    total: parseInt(String(total?.count || '0'), 10),
    active: parseInt(String(active?.count || '0'), 10),
    completed: parseInt(String(completed?.count || '0'), 10),
    failed: parseInt(String(failed?.count || '0'), 10),
    byWorkflowName
  };
});

/**
 * Get workflow executions with details
 */
export const getWorkflowExecutionsWithDetails = withAuth(async (
  _user,
  { tenant },
  filter: WorkflowExecutionFilter = {}
): Promise<IWorkflowExecution[]> => {
  console.log('getWorkflowExecutionsWithDetails called with filter:', JSON.stringify(filter, null, 2));

  const { knex } = await createTenantKnex();

  console.log(`Using tenant: ${tenant}`);

  let query = knex('workflow_executions')
    .where({ tenant })
    .orderBy('created_at', 'desc');

  console.log('Building query with filters');

  // Apply filters
  if (filter.workflowName) {
    console.log(`Filtering by workflow name: ${filter.workflowName}`);
    query = query.where('workflow_name', filter.workflowName);
  }

  if (filter.status) {
    console.log(`Filtering by status: ${filter.status}`);
    query = query.where('status', filter.status);
  }

  if (filter.startDate) {
    console.log(`Filtering by start date: ${filter.startDate}`);
    query = query.where('created_at', '>=', filter.startDate);
  }

  if (filter.endDate) {
    console.log(`Filtering by end date: ${filter.endDate}`);
    query = query.where('created_at', '<=', filter.endDate);
  }

  if (filter.limit) {
    console.log(`Applying limit: ${filter.limit}`);
    query = query.limit(filter.limit);
  }

  if (filter.offset) {
    console.log(`Applying offset: ${filter.offset}`);
    query = query.offset(filter.offset);
  }

  console.log('Executing query to fetch workflow executions');
  const executions = await query;

  console.log(`Retrieved ${executions.length} workflow executions`);

  return executions;
});

/**
 * Get workflow execution details by ID
 */
export const getWorkflowExecutionDetails = withAuth(async (
  _user,
  { tenant },
  executionId: string
): Promise<{
  execution: IWorkflowExecution;
  events: IWorkflowEvent[];
  actionResults: IWorkflowActionResult[]
} | null> => {
  try {
    const { knex } = await createTenantKnex();

    // Get execution details
    const execution = await WorkflowExecutionModel.getById(knex, tenant, executionId);

    if (!execution) {
      return null;
    }

    // Get events for this execution
    const events = await WorkflowEventModel.getByExecutionId(knex, tenant, executionId);

    // Get action results for this execution
    const actionResults = await WorkflowActionResultModel.getByExecutionId(knex, tenant, executionId);

    return {
      execution,
      events,
      actionResults
    };
  } catch (error) {
    console.error(`Error getting workflow execution details for ${executionId}:`, error);
    throw error;
  }
});

/**
 * Pause a workflow execution
 */
export const pauseWorkflowExecutionAction = withAuth(async (_user, { tenant }, executionId: string): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

    // Check if the execution exists and belongs to this tenant
    const execution = await WorkflowExecutionModel.getById(knex, tenant, executionId);

    if (!execution || execution.tenant !== tenant) {
      return false;
    }

    // Update the status to paused
    await WorkflowExecutionModel.update(knex, tenant, executionId, {
      status: 'paused'
    });

    return true;
  } catch (error) {
    console.error(`Error pausing workflow execution ${executionId}:`, error);
    return false;
  }
});

/**
 * Resume a workflow execution
 */
export const resumeWorkflowExecutionAction = withAuth(async (_user, { tenant }, executionId: string): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

    // Check if the execution exists and belongs to this tenant
    const execution = await WorkflowExecutionModel.getById(knex, tenant, executionId);

    if (!execution || execution.tenant !== tenant) {
      return false;
    }

    // Update the status to active
    await WorkflowExecutionModel.update(knex, tenant, executionId, {
      status: 'active'
    });

    return true;
  } catch (error) {
    console.error(`Error resuming workflow execution ${executionId}:`, error);
    return false;
  }
});

/**
 * Cancel a workflow execution
 */
export const cancelWorkflowExecutionAction = withAuth(async (_user, { tenant }, executionId: string): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

    // Check if the execution exists and belongs to this tenant
    const execution = await WorkflowExecutionModel.getById(knex, tenant, executionId);

    if (!execution || execution.tenant !== tenant) {
      return false;
    }

    // Update the status to cancelled
    await WorkflowExecutionModel.update(knex, tenant, executionId, {
      status: 'cancelled'
    });

    return true;
  } catch (error) {
    console.error(`Error cancelling workflow execution ${executionId}:`, error);
    return false;
  }
});

/**
 * Retry a failed action in a workflow
 */
export const retryWorkflowActionAction = withAuth(async (
  _user,
  { tenant },
  executionId: string,
  actionResultId: string
): Promise<boolean> => {
  try {
    const { knex } = await createTenantKnex();

    // Check if the action result exists and belongs to this tenant
    const actionResult = await WorkflowActionResultModel.getById(knex, tenant, actionResultId);

    if (!actionResult || actionResult.tenant !== tenant || actionResult.execution_id !== executionId) {
      return false;
    }

    // Mark the action as ready to execute again
    await WorkflowActionResultModel.update(knex, tenant, actionResultId, {
      ready_to_execute: true,
      success: false,
      error_message: undefined,
      started_at: undefined,
      completed_at: undefined
    });

    // Update the workflow execution status to active
    await WorkflowExecutionModel.update(knex, tenant, executionId, {
      status: 'active'
    });

    return true;
  } catch (error) {
    console.error(`Error retrying workflow action ${actionResultId}:`, error);
    return false;
  }
});


/**
 * Get all registered workflow definitions
 * This function returns a list of all workflow definitions registered in the runtime
 */
export async function getRegisteredWorkflowsAction(): Promise<Array<{
  name: string;
  description?: string;
  version?: string;
  tags?: string[];
}>> {
  try {
    // Initialize the workflow system on the server side
    await initializeServerWorkflows();
    
    // Get the action registry
    const actionRegistry = getActionRegistry();
    
    // Get the workflow runtime
    const runtime = getWorkflowRuntime(actionRegistry);
    
    // Get all registered workflows
    const workflowDefinitions = runtime.getRegisteredWorkflows();
    
    // Convert to array of metadata
    const result = Array.from(workflowDefinitions.values()).map(workflow => ({
      name: workflow.metadata.name,
      description: workflow.metadata.description,
      version: workflow.metadata.version,
      tags: workflow.metadata.tags
    }));
    
    return result;
  } catch (error) {
    console.error('Error getting registered workflows:', error);
    throw error;
  }
}
