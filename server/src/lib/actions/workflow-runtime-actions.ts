'use server';

/**
 * Server actions for workflow runtime integration with database-driven workflow registration
 */
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import logger from '@shared/core/logger.js';
import WorkflowRegistrationModel, { WorkflowRegistration } from '@shared/workflow/persistence/workflowRegistrationModel.js';
import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get a workflow registration by name and optional version
 * If version is not provided, returns the current version
 *
 * @param name The workflow name
 * @param version Optional version string
 * @returns The workflow registration or null if not found
 */
export async function getWorkflowRegistration(name: string, version?: string): Promise<WorkflowRegistration | null> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant is required');
  }
  
  try {
    // Use the model to get the workflow registration
    return await WorkflowRegistrationModel.getByName(knex, tenant, name, version);
  } catch (error) {
    logger.error(`Error getting workflow registration for ${name}:`, error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
}

/**
 * Get all workflow registrations
 * 
 * @returns Array of workflow registrations
 */
export async function getAllWorkflowRegistrations(): Promise<WorkflowRegistration[]> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant is required');
  }
  
  try {
    // Use the model to get all workflow registrations
    return await WorkflowRegistrationModel.getAll(knex, tenant);
  } catch (error) {
    logger.error('Error getting all workflow registrations:', error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
}

/**
 * Create a workflow registration from a template
 * 
 * @param params Parameters for creating a registration from a template
 * @returns The created workflow registration
 */
export async function createRegistrationFromTemplate(params: {
  templateId: string;
  name: string;
  description?: string;
  parameters?: any;
}): Promise<{ registrationId: string }> {
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant is required');
  }
  
  try {
    // Use the model to create a registration from a template
    return await WorkflowRegistrationModel.createFromTemplate(knex, tenant, {
      templateId: params.templateId,
      name: params.name,
      description: params.description,
      parameters: params.parameters
    });
  } catch (error) {
    logger.error(`Error creating workflow registration from template ${params.templateId}:`, error);
    throw error;
  } finally {
    // Connection will be released automatically
  }
}

/**
 * Start a workflow execution from an event
 * This is used by the event-driven workflow system to start workflows in response to events
 *
 * @param params Parameters for starting a workflow from an event
 * @returns The workflow execution ID and initial state
 */
export async function startWorkflowFromEvent(params: {
  workflowName: string;
  eventType: string;
  eventPayload: any;
  tenant: string;
  userId?: string;
}): Promise<{
  executionId: string;
  currentState: string;
}> {
  const { workflowName, eventType, eventPayload, tenant, userId } = params;
  const { knex } = await createTenantKnex();
  
  try {
    // Get the workflow runtime
    const runtime = getWorkflowRuntime();
    
    // Start the workflow
    const result = await runtime.startWorkflow(knex, workflowName, {
      tenant,
      initialData: {
        eventType,
        eventPayload,
        sourceEventId: eventPayload.id || uuidv4(),
        timestamp: new Date().toISOString()
      },
      userId
    });
    
    // Log the workflow execution
    logger.info(`Started workflow ${workflowName} from event ${eventType}`, {
      executionId: result.executionId,
      tenant,
      workflowName,
      eventType
    });
    
    return {
      executionId: result.executionId,
      currentState: result.currentState
    };
  } catch (error) {
    logger.error(`Error starting workflow ${workflowName} from event ${eventType}:`, error);
    throw error;
  }
}
