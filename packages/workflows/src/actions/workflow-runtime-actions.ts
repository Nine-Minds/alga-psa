'use server';

/**
 * Server actions for workflow runtime integration with database-driven workflow registration
 */
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import WorkflowRegistrationModel, { WorkflowRegistration, WorkflowRegistrationWithSystemFlag } from '@alga-psa/shared/workflow/persistence/workflowRegistrationModel'; // Import the new type
import { getWorkflowRuntime } from '@alga-psa/shared/workflow/core/workflowRuntime';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get a workflow registration by ID and optional version
 * If version is not provided, returns the current version
 *
 * @param id The workflow registration ID
 * @param version Optional version string
 * @returns The workflow registration or null if not found
 */
export async function getWorkflowRegistration(id: string, version?: string): Promise<WorkflowRegistrationWithSystemFlag | null> { // Updated return type
  const { knex, tenant } = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant is required');
  }
  
  try {
    // Use the model to get the workflow registration by ID
    return await WorkflowRegistrationModel.getById(knex, tenant, id, version);
  } catch (error) {
    logger.error(`Error getting workflow registration for ID ${id}:`, error);
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
export async function getAllWorkflowRegistrations(): Promise<WorkflowRegistrationWithSystemFlag[]> { // Updated return type
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
  executionId?: string;
  status: 'accepted' | 'error';
  message: string;
}> {
  const { workflowName, eventType, eventPayload, tenant, userId } = params;
  
  try {
    // Import here to avoid circular dependencies
    const { submitWorkflowEventAction } = await import('./workflow-event-actions');
    
    // Instead of directly starting the workflow, submit an event to the event bus
    // This will be picked up by the workflow worker through the event subscription system
    const result = await submitWorkflowEventAction({
      event_name: eventType,
      event_type: eventType,
      tenant,
      payload: {
        ...eventPayload,
        workflowName, // Include the workflow name in the payload
        sourceEventId: eventPayload.id || uuidv4(),
        timestamp: new Date().toISOString(),
        userId
      }
    });
    
    // Log the event submission
    logger.info(`Submitted event ${eventType} to trigger workflow ${workflowName}`, {
      tenant,
      workflowName,
      eventType,
      status: result.status
    });
    
    return {
      executionId: result.eventId, // Use the event ID as a reference
      status: result.status === 'error' ? 'error' : 'accepted',
      message: result.message
    };
  } catch (error) {
    logger.error(`Error starting workflow ${workflowName} from event ${eventType}:`, error);
    throw error;
  }
}
