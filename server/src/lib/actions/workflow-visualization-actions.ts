'use server';

import fs from 'fs/promises';
import path from 'path';
import { getWorkflowRuntime } from '@/lib/workflow/core/workflowRuntime';
import { getActionRegistry } from '@/lib/workflow/core/actionRegistry';
import { WorkflowDefinition } from '@/lib/workflow/core/workflowDefinition';
import { initializeServerWorkflows } from '@/lib/workflow/init/serverInit';
import { IWorkflowExecution, IWorkflowEvent, IWorkflowActionResult } from '@/lib/workflow/persistence/workflowInterfaces';
import WorkflowExecutionModel from '@/lib/workflow/persistence/workflowExecutionModel';
import WorkflowEventModel from '@/lib/workflow/persistence/workflowEventModel';
import WorkflowActionResultModel from '@/lib/workflow/persistence/workflowActionResultModel';

/**
 * Get workflow definition by ID
 * This function retrieves a workflow definition from the runtime registry
 */
export async function getWorkflowDefinition(definitionId: string): Promise<any> {
  try {
    // Initialize the workflow system on the server side
    await initializeServerWorkflows();
    
    // Get the action registry
    const actionRegistry = getActionRegistry();
    
    // Get the workflow runtime
    const runtime = getWorkflowRuntime(actionRegistry);
    
    // Get all registered workflows
    const workflowDefinitions = runtime.getRegisteredWorkflows();
    
    // Find the requested workflow
    const workflowDefinition = workflowDefinitions.get(definitionId);
    
    if (!workflowDefinition) {
      throw new Error(`Workflow definition not found: ${definitionId}`);
    }
    
    // Convert the workflow definition to a format suitable for visualization
    return {
      name: workflowDefinition.metadata.name,
      description: workflowDefinition.metadata.description || '',
      version: workflowDefinition.metadata.version || '1.0.0',
      states: extractStatesFromWorkflow(workflowDefinition),
      events: [],
      actions: [],
      transitions: extractTransitionsFromWorkflow(workflowDefinition)
    };
  } catch (error) {
    console.error(`Error loading workflow definition ${definitionId}:`, error);
    throw error instanceof Error
      ? error
      : new Error(`Unknown error loading workflow definition: ${String(error)}`);
  }
}

/**
 * Extract states from a TypeScript workflow definition
 * This is a placeholder implementation that would need to be expanded
 * based on how states are defined in your TypeScript workflows
 */
function extractStatesFromWorkflow(workflowDefinition: WorkflowDefinition): any[] {
  // For now, return a basic set of states based on the invoice approval workflow
  return [
    { name: 'draft', description: 'Initial draft state' },
    { name: 'submitted', description: 'Invoice submitted for approval' },
    { name: 'approved', description: 'Invoice approved' },
    { name: 'rejected', description: 'Invoice rejected' },
    { name: 'paid', description: 'Invoice paid' }
  ];
}

/**
 * Extract transitions from a TypeScript workflow definition
 * This is a placeholder implementation that would need to be expanded
 * based on how transitions are defined in your TypeScript workflows
 */
function extractTransitionsFromWorkflow(workflowDefinition: WorkflowDefinition): any[] {
  // For now, return a basic set of transitions based on the invoice approval workflow
  return [
    { from: 'draft', to: 'submitted', event: 'Submit' },
    { from: 'submitted', to: 'approved', event: 'Approve' },
    { from: 'submitted', to: 'rejected', event: 'Reject' },
    { from: 'approved', to: 'paid', event: 'Pay' }
  ];
}

/**
 * Get raw TypeScript content for a workflow definition
 */
export async function getWorkflowDSLContent(definitionId: string): Promise<string> {
  try {
    // For the TypeScript-based workflow system, we'll look for the workflow in the examples directory
    const examplesDir = path.join(process.cwd(), 'src', 'lib', 'workflow', 'examples');
    const tsFilePath = path.join(examplesDir, `${definitionId}Workflow.ts`);
    
    try {
      // Read the TypeScript file
      const tsContent = await fs.readFile(tsFilePath, 'utf-8');
      console.log(`Read workflow TypeScript file: ${definitionId}, size: ${tsContent.length} bytes`);
      return tsContent;
    } catch (fileError) {
      if ((fileError as NodeJS.ErrnoException).code === 'ENOENT') {
        // File not found
        throw new Error(`Workflow definition not found: ${definitionId}`);
      }
      // Rethrow other errors
      throw fileError;
    }
  } catch (error) {
    console.error(`Error loading workflow TypeScript content for ${definitionId}:`, error);
    throw error instanceof Error
      ? error
      : new Error(`Unknown error loading workflow TypeScript content: ${String(error)}`);
  }
}

/**
 * Get workflow execution by ID
 */
export async function getWorkflowExecution(executionId: string): Promise<IWorkflowExecution | null> {
  try {
    // For testing purposes, return mock data if executionId is 'mock'
    if (executionId === 'mock') {
      return {
        execution_id: 'mock-execution',
        workflow_name: 'InvoiceApproval',
        workflow_version: '1.0.0',
        current_state: 'draft',
        status: 'active',
        context_data: {
          id: 'mock-execution',
          data: {
            invoice: {
              id: 'INV-MOCK',
              amount: 1000,
              submitter: 'Alice',
              status: 'draft'
            }
          }
        },
        tenant: 'mock-tenant',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
    
    const execution = await WorkflowExecutionModel.getById(executionId);
    
    // If no execution found, return null
    if (!execution) {
      return null;
    }
    
    // Return a clean copy without any non-serializable data
    return {
      execution_id: execution.execution_id,
      workflow_name: execution.workflow_name,
      workflow_version: execution.workflow_version,
      current_state: execution.current_state,
      status: execution.status,
      context_data: execution.context_data,
      tenant: execution.tenant,
      created_at: execution.created_at,
      updated_at: execution.updated_at
    };
  } catch (error) {
    console.error(`Error getting workflow execution ${executionId}:`, error);
    throw error;
  }
}

/**
 * Get workflow events by execution ID
 */
export async function getWorkflowEvents(executionId: string): Promise<IWorkflowEvent[]> {
  try {
    // For testing purposes, return mock data if executionId is 'mock'
    if (executionId === 'mock') {
      return [
        {
          event_id: 'mock-event-1',
          execution_id: 'mock-execution',
          event_name: 'workflow.started',
          event_type: 'system',
          from_state: 'none',
          to_state: 'draft',
          payload: {
            workflow_name: 'InvoiceApproval',
            initial_data: {
              invoice: {
                id: 'INV-MOCK',
                amount: 1000,
                submitter: 'Alice',
                status: 'draft'
              }
            }
          },
          tenant: 'mock-tenant',
          created_at: new Date().toISOString()
        }
      ];
    }
    
    const events = await WorkflowEventModel.getByExecutionId(executionId);
    
    // Return clean copies without any non-serializable data
    return events.map(event => ({
      event_id: event.event_id,
      execution_id: event.execution_id,
      event_name: event.event_name,
      event_type: event.event_type,
      from_state: event.from_state,
      to_state: event.to_state,
      payload: event.payload,
      tenant: event.tenant,
      created_at: event.created_at
    }));
  } catch (error) {
    console.error(`Error getting workflow events for execution ${executionId}:`, error);
    throw error;
  }
}

/**
 * Get workflow action results by execution ID
 */
export async function getWorkflowActionResults(executionId: string): Promise<IWorkflowActionResult[]> {
  try {
    // For testing purposes, return mock data if executionId is 'mock'
    if (executionId === 'mock') {
      return [
        {
          result_id: 'mock-result-1',
          execution_id: 'mock-execution',
          event_id: 'mock-event-1',
          action_name: 'send_notification',
          success: true,
          result: { success: true, notificationId: 'notif-123' },
          error_message: '',
          idempotency_key: 'mock-execution:send_notification:123',
          ready_to_execute: false,
          tenant: 'mock-tenant',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }
      ];
    }
    
    const results = await WorkflowActionResultModel.getByExecutionId(executionId);
    
    // Return clean copies without any non-serializable data
    return results.map(result => ({
      result_id: result.result_id,
      execution_id: result.execution_id,
      event_id: result.event_id,
      action_name: result.action_name,
      action_path: result.action_path,
      action_group: result.action_group,
      parameters: result.parameters,
      success: result.success,
      result: result.result,
      error_message: result.error_message || '',
      idempotency_key: result.idempotency_key,
      ready_to_execute: result.ready_to_execute,
      tenant: result.tenant,
      started_at: result.started_at,
      completed_at: result.completed_at,
      created_at: result.created_at
    }));
  } catch (error) {
    console.error(`Error getting workflow action results for execution ${executionId}:`, error);
    throw error;
  }
}

/**
 * Helper function to ensure an object is serializable
 * Removes any functions, circular references, etc.
 */
function makeSerializable(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => makeSerializable(item));
  }
  
  // Handle plain objects
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    
    for (const key in obj) {
      // Skip functions and properties that start with underscore (often internal properties)
      if (typeof obj[key] !== 'function' && !key.startsWith('_')) {
        try {
          // Test if the value can be serialized
          JSON.stringify(obj[key]);
          result[key] = makeSerializable(obj[key]);
        } catch (e) {
          // If it can't be serialized, skip it
          console.warn(`Skipping non-serializable property: ${key}`);
        }
      }
    }
    
    return result;
  }
  
  // Return primitive values as is
  return obj;
}

/**
 * Get workflow execution status
 * This function returns a serializable version of the execution data
 */
export async function getWorkflowExecutionStatus(executionId: string) {
  try {
    // Mock data for testing
    if (executionId === 'mock') {
      return {
        execution: {
          execution_id: 'mock-execution',
          workflow_name: 'InvoiceApproval',
          workflow_version: '1.0.0',
          current_state: 'draft',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        events: [
          {
            event_id: 'mock-event-1',
            execution_id: 'mock-execution',
            event_name: 'workflow.started',
            event_type: 'system',
            from_state: 'none',
            to_state: 'draft',
            created_at: new Date().toISOString()
          }
        ],
        actionResults: [
          {
            result_id: 'mock-result-1',
            execution_id: 'mock-execution',
            action_name: 'send_notification',
            success: true,
            result: { success: true, notificationId: 'notif-123' },
            error_message: '',
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          }
        ]
      };
    }
    
    const [execution, events, actionResults] = await Promise.all([
      getWorkflowExecution(executionId),
      getWorkflowEvents(executionId),
      getWorkflowActionResults(executionId)
    ]);
    
    if (!execution) {
      return null;
    }
    
    // Create a serializable version of the data
    const serializedData = {
      execution: {
        execution_id: execution.execution_id,
        workflow_name: execution.workflow_name,
        workflow_version: execution.workflow_version,
        current_state: execution.current_state,
        status: execution.status,
        created_at: execution.created_at,
        updated_at: execution.updated_at
      },
      events: events.map(event => ({
        event_id: event.event_id,
        execution_id: event.execution_id,
        event_name: event.event_name,
        event_type: event.event_type,
        from_state: event.from_state,
        to_state: event.to_state,
        created_at: event.created_at
      })),
      actionResults: actionResults.map(result => ({
        result_id: result.result_id,
        execution_id: result.execution_id,
        action_name: result.action_name,
        success: result.success,
        result: makeSerializable(result.result),
        error_message: result.error_message || '',
        started_at: result.started_at,
        completed_at: result.completed_at,
        created_at: result.created_at
      }))
    };
    
    // Ensure the data is fully serializable
    return makeSerializable(serializedData);
  } catch (error) {
    console.error(`Error getting workflow execution status for ${executionId}:`, error);
    throw error;
  }
}

/**
 * Get workflow visualization data
 * This combines definition, execution status, and TypeScript content
 */
export async function getWorkflowVisualizationData(definitionId: string, executionId?: string) {
  try {
    // Fetch definition, TypeScript content, and execution status in parallel
    const [definition, tsContent, executionStatus] = await Promise.all([
      getWorkflowDefinition(definitionId),
      getWorkflowDSLContent(definitionId).catch(() => null),
      executionId ? getWorkflowExecutionStatus(executionId) : Promise.resolve(null)
    ]);
    
    return {
      definition,
      tsContent,
      executionStatus
    };
  } catch (error) {
    console.error(`Error getting workflow visualization data:`, error);
    throw error;
  }
}