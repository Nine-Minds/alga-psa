'use server';

import { createTenantKnex } from '../db';
import { WorkflowEventAttachmentModel } from '../../models/workflowEventAttachment';
import { EventCatalogModel } from '../../models/eventCatalog';
import { 
  IWorkflowEventAttachment, 
  ICreateWorkflowEventAttachment, 
  IUpdateWorkflowEventAttachment 
} from '@shared/workflow/types/eventCatalog';
import { getWorkflowRegistration } from './workflow-runtime-actions';
import { getEventBus } from '../eventBus';
import { WorkflowTriggerModel } from 'server/src/models/workflowTrigger';

/**
 * Get all workflow event attachments for a workflow
 * 
 * @param params Parameters for the action
 * @returns Array of workflow event attachments
 */
export async function getWorkflowEventAttachmentsForWorkflow(params: {
  workflowId: string;
  tenant: string;
  isActive?: boolean;
}): Promise<IWorkflowEventAttachment[]> {
  const { workflowId, tenant, isActive } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get all workflow event attachments for the workflow
  const attachments = await WorkflowEventAttachmentModel.getAllForWorkflow(knex, workflowId, tenant, {
    isActive
  });
  
  return attachments;
}

/**
 * Get all workflow event attachments for an event
 * 
 * @param params Parameters for the action
 * @returns Array of workflow event attachments
 */
export async function getWorkflowEventAttachmentsForEvent(params: {
  eventId: string;
  tenant: string;
  isActive?: boolean;
}): Promise<IWorkflowEventAttachment[]> {
  const { eventId, tenant, isActive } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get all workflow event attachments for the event
  const attachments = await WorkflowEventAttachmentModel.getAllForEvent(knex, eventId, tenant, {
    isActive
  });
  
  return attachments;
}

/**
 * Get a workflow event attachment by ID
 * 
 * @param params Parameters for the action
 * @returns The workflow event attachment or null if not found
 */
export async function getWorkflowEventAttachmentById(params: {
  attachmentId: string;
  tenant: string;
}): Promise<IWorkflowEventAttachment | null> {
  const { attachmentId, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the workflow event attachment
  const attachment = await WorkflowEventAttachmentModel.getById(knex, attachmentId, tenant);
  
  return attachment;
}

/**
 * Create a new workflow event attachment
 * 
 * @param params Parameters for the action
 * @returns The created workflow event attachment
 */
export async function createWorkflowEventAttachment(params: ICreateWorkflowEventAttachment): Promise<IWorkflowEventAttachment> {
  const { knex } = await createTenantKnex();
  
  // Verify that the workflow exists
  const workflow = await getWorkflowRegistration(params.workflow_id);
  
  if (!workflow) {
    throw new Error(`Workflow with ID "${params.workflow_id}" not found`);
  }
  
  // Verify that the event exists in the event catalog
  const event = await EventCatalogModel.getById(knex, params.event_id, params.tenant_id);
  
  if (!event) {
    throw new Error(`Event with ID "${params.event_id}" not found in the event catalog`);
  }
  
  // Check if an attachment already exists for this workflow and event
  const existingAttachment = await WorkflowEventAttachmentModel.getByWorkflowAndEvent(
    knex,
    params.workflow_id,
    params.event_id,
    params.tenant_id
  );
  
  if (existingAttachment) {
    // If the attachment exists but is inactive, update it to active
    if (!existingAttachment.is_active) {
      const updatedAttachment = await WorkflowEventAttachmentModel.update(
        knex,
        existingAttachment.attachment_id,
        params.tenant_id,
        { is_active: true }
      );
      
      return updatedAttachment!;
    }
    
    throw new Error(`Workflow "${workflow.name}" is already attached to event "${event.name}"`);
  }
  
  // Create the workflow event attachment
  const attachment = await WorkflowEventAttachmentModel.create(knex, params);
  
  // Subscribe to the event in the event bus
  const eventBus = getEventBus();
  await subscribeWorkflowToEvent(event.event_type, params.workflow_id, params.tenant_id);
  
  return attachment;
}

/**
 * Update a workflow event attachment
 * 
 * @param params Parameters for the action
 * @returns The updated workflow event attachment
 */
export async function updateWorkflowEventAttachment(params: {
  attachmentId: string;
  tenant: string;
  data: IUpdateWorkflowEventAttachment;
}): Promise<IWorkflowEventAttachment | null> {
  const { attachmentId, tenant, data } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the workflow event attachment
  const attachment = await WorkflowEventAttachmentModel.getById(knex, attachmentId, tenant);
  
  if (!attachment) {
    throw new Error(`Workflow event attachment with ID "${attachmentId}" not found`);
  }
  
  // Update the workflow event attachment
  const updatedAttachment = await WorkflowEventAttachmentModel.update(knex, attachmentId, tenant, data);
  
  // If the attachment is being deactivated, unsubscribe from the event
  if (data.is_active === false && attachment.is_active) {
    const event = await EventCatalogModel.getById(knex, attachment.event_id, tenant);
    
    if (event) {
      await unsubscribeWorkflowFromEvent(event.event_type, attachment.workflow_id, tenant);
    }
  }
  
  // If the attachment is being activated, subscribe to the event
  if (data.is_active === true && !attachment.is_active) {
    const event = await EventCatalogModel.getById(knex, attachment.event_id, tenant);
    
    if (event) {
      await subscribeWorkflowToEvent(event.event_type, attachment.workflow_id, tenant);
    }
  }
  
  return updatedAttachment;
}

/**
 * Delete a workflow event attachment
 * 
 * @param params Parameters for the action
 * @returns True if the attachment was deleted, false otherwise
 */
export async function deleteWorkflowEventAttachment(params: {
  attachmentId: string;
  tenant: string;
}): Promise<boolean> {
  const { attachmentId, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the workflow event attachment
  const attachment = await WorkflowEventAttachmentModel.getById(knex, attachmentId, tenant);
  
  if (!attachment) {
    throw new Error(`Workflow event attachment with ID "${attachmentId}" not found`);
  }
  
  // If the attachment is active, unsubscribe from the event
  if (attachment.is_active) {
    const event = await EventCatalogModel.getById(knex, attachment.event_id, tenant);
    
    if (event) {
      await unsubscribeWorkflowFromEvent(event.event_type, attachment.workflow_id, tenant);
    }
  }
  
  // Delete the workflow event attachment
  const result = await WorkflowEventAttachmentModel.delete(knex, attachmentId, tenant);
  
  return result;
}

/**
 * Get all workflows attached to an event type
 * 
 * @param params Parameters for the action
 * @returns Array of workflow IDs
 */
export async function getWorkflowsForEventType(params: {
  eventType: string;
  tenant: string;
}): Promise<string[]> {
  const { eventType, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get all workflows attached to the event type
  const workflowIds = await WorkflowEventAttachmentModel.getWorkflowsForEventType(knex, eventType, tenant);
  
  return workflowIds;
}

/**
 * Subscribe a workflow to an event
 * 
 * @param eventType Event type
 * @param workflowId Workflow ID
 * @param tenant Tenant ID
 */
async function subscribeWorkflowToEvent(
  eventType: string,
  workflowId: string,
  tenant: string
): Promise<void> {
  const eventBus = getEventBus();
  const { knex } = await createTenantKnex();
  
  // Create a unique subscription ID for this workflow and event
  const subscriptionId = `workflow:${workflowId}:event:${eventType}`;
  
  try {
    // Get the workflow registration to verify it exists
    const workflow = await getWorkflowRegistration(workflowId);
    
    if (!workflow) {
      throw new Error(`Workflow with ID "${workflowId}" not found`);
    }
    
    // Get the trigger for this workflow and event
    const trigger = await knex('workflow_triggers')
      .where('event_type', eventType)
      .where('tenant_id', tenant)
      .first();
    
    if (!trigger) {
      throw new Error(`Trigger for event type "${eventType}" not found`);
    }
    
    // Get parameter mappings for the trigger
    const mappings = await knex('workflow_event_mappings')
      .where('trigger_id', trigger.trigger_id)
      .select('*');
    
    // Subscribe to the event
    await eventBus.subscribe(eventType as any, async (event) => {
      // Verify tenant
      if (event.payload.tenantId !== tenant) {
        return;
      }
      
      // Start the workflow
      try {
        // Create a workflow runtime instance
        // Note: This is a placeholder - actual implementation will depend on the workflow runtime API
        const workflowRuntime = {
          createExecution: async (params: any) => {
            console.log('Creating workflow execution with params:', params);
            return `execution-${Date.now()}`;
          },
          enqueueEvent: async (params: any) => {
            console.log('Enqueueing event with params:', params);
            return true;
          }
        };
        
        // Map event payload to workflow parameters based on mappings
        const workflowParams: Record<string, any> = {};
        
        for (const mapping of mappings) {
          // Extract value from event payload using the field path
          const fieldPath = mapping.event_field_path.split('.');
          let value = event.payload;
          
          for (const field of fieldPath) {
            if (value && typeof value === 'object' && field in value) {
              value = value[field];
            } else {
              value = undefined;
              break;
            }
          }
          
          // Apply transform function if provided
          if (mapping.transform_function && value !== undefined) {
            try {
              // Use Function constructor to create a function from the string
              // This is safe because the transform function is validated before saving
              const transformFn = new Function('val', `return ${mapping.transform_function}`);
              value = transformFn(value);
            } catch (error) {
              console.error(`Error applying transform function for parameter ${mapping.workflow_parameter}:`, error);
            }
          }
          
          // Set the parameter value
          if (value !== undefined) {
            workflowParams[mapping.workflow_parameter] = value;
          }
        }
        
        // Create a new workflow execution
        const executionId = await workflowRuntime.createExecution({
          workflowName: workflow.name,
          workflowVersion: 'latest',
          tenant: tenant
        });
        
        // Log the workflow execution
        console.log(`Started workflow ${workflowId} (${workflow.name}) for event ${eventType} with execution ID ${executionId}`);
        
        // Enqueue an event to start the workflow with the mapped parameters
        await workflowRuntime.enqueueEvent({
          executionId,
          eventName: 'StartWorkflow',
          tenant: tenant,
          userRole: 'system',
          payload: {
            ...workflowParams,
            eventType,
            eventTimestamp: new Date().toISOString(),
            sourceEventId: event.id || `event-${Date.now()}`
          }
        });
        
        // Record the workflow execution in the database
        await knex('workflow_executions').insert({
          execution_id: executionId,
          tenant_id: tenant,
          workflow_name: workflow.name,
          current_state: 'started',
          status: 'running',
          context_data: {
            eventType,
            parameters: workflowParams,
            sourceEventId: event.id || `event-${Date.now()}`
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error starting workflow ${workflowId} for event ${eventType}:`, error);
      }
    });
  } finally {
    // Connection will be released automatically
  }
}

/**
 * Unsubscribe a workflow from an event
 * 
 * @param eventType Event type
 * @param workflowId Workflow ID
 * @param tenant Tenant ID
 */
async function unsubscribeWorkflowFromEvent(
  eventType: string,
  workflowId: string,
  tenant: string
): Promise<void> {
  const eventBus = getEventBus();
  
  // Create a unique subscription ID for this workflow and event
  const subscriptionId = `workflow:${workflowId}:event:${eventType}`;
  
  try {
    // Unsubscribe from the event
    // Note: This is a placeholder - actual implementation will depend on the event bus API
    console.log(`Unsubscribing workflow ${workflowId} from event ${eventType}`);
    // The actual unsubscribe method would be called here
  } catch (error) {
    console.error(`Error unsubscribing workflow ${workflowId} from event ${eventType}:`, error);
  }
}
