'use server';

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import { WorkflowEventAttachmentModel } from '@alga-psa/workflows/models/workflowEventAttachment';
import { EventCatalogModel } from '@alga-psa/workflows/models/eventCatalog';
import {
  IWorkflowEventAttachment,
  ICreateWorkflowEventAttachment, // Will need update in shared types
  IUpdateWorkflowEventAttachment
} from '@alga-psa/shared/workflow/types/eventCatalog';
import { getWorkflowRegistration, startWorkflowFromEvent } from './workflow-runtime-actions';
import { getEventBus } from '@alga-psa/event-bus';
// import { WorkflowTriggerModel } from '@alga-psa/workflows/models/workflowTrigger'; // Trigger logic might need review later
import { getWorkflowRuntime } from '@alga-psa/shared/workflow/core';

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
}): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean })[]> { // Updated return type
  const { workflowId, tenant, isActive } = params;

  const { knex } = await createTenantKnex(tenant);
  
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
export async function getWorkflowEventAttachmentsForEventType(params: {
  eventType: string;
  tenant: string;
  isActive?: boolean;
}): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean })[]> { // Updated return type
  const { eventType, tenant, isActive } = params;

  const { knex } = await createTenantKnex(tenant);

  // Get all workflow event attachments for the event type
  // NOTE: Assumes WorkflowEventAttachmentModel.getAllForEventType exists/will be created
  const attachments = await WorkflowEventAttachmentModel.getAllForEventType(knex, eventType, tenant, {
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
}): Promise<(IWorkflowEventAttachment & { isSystemManaged: boolean }) | null> { // Updated return type
  const { attachmentId, tenant } = params;

  const { knex } = await createTenantKnex(tenant);
  
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
// NOTE: ICreateWorkflowEventAttachment interface in shared types needs event_id changed to event_type
export async function createWorkflowEventAttachment(params: ICreateWorkflowEventAttachment): Promise<IWorkflowEventAttachment> {
  const { workflow_id, event_type, tenant } = params; // Destructure event_type
  const { knex } = await createTenantKnex(tenant);

  // Verify that the workflow exists
  const workflow = await getWorkflowRegistration(workflow_id);

  if (!workflow) {
    throw new Error(`Workflow with ID "${workflow_id}" not found`);
  }

  // Verify that the event_type exists in either the tenant or system event catalog
  let eventName = '';
  const tenantEvent = await EventCatalogModel.getByEventType(knex, event_type, tenant);

  if (tenantEvent) {
    eventName = tenantEvent.name;
  } else {
    // Check system catalog
    const systemEvent = await knex('system_event_catalog')
      .where({ event_type: event_type })
      .first();

    if (!systemEvent) {
      throw new Error(`Event type "${event_type}" not found in tenant or system event catalog`);
    }
    eventName = systemEvent.name;
  }


  // Check if an attachment already exists for this workflow and event type
  // NOTE: Assumes WorkflowEventAttachmentModel.getByWorkflowAndEventType exists/will be created
  const existingAttachment = await WorkflowEventAttachmentModel.getByWorkflowAndEventType(
    knex,
    workflow_id,
    event_type,
    tenant
  );

  if (existingAttachment) {
    // If the attachment exists but is inactive, update it to active
    if (!existingAttachment.is_active) {
      const updatedAttachment = await WorkflowEventAttachmentModel.update(
        knex,
        existingAttachment.attachment_id,
        tenant,
        { is_active: true }
      );
      // NOTE: Assumes WorkflowEventAttachmentModel.update returns the updated record correctly
      return updatedAttachment!;
    }

    throw new Error(`Workflow "${workflow.name}" is already attached to event type "${event_type}" (${eventName})`);
  }

  // Create the workflow event attachment
  // NOTE: Assumes WorkflowEventAttachmentModel.create accepts event_type
  const attachment = await WorkflowEventAttachmentModel.create(knex, {
    ...params, // Pass original params which now include event_type
    event_type: event_type // Explicitly pass event_type if needed by the updated model method
  });

  // Subscribe to the event in the event bus
  // This already uses event_type, so it should be fine
  await subscribeWorkflowToEvent(event_type, workflow_id, tenant);

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

  const { knex } = await createTenantKnex(tenant);
  
  // Get the workflow event attachment
  const attachment = await WorkflowEventAttachmentModel.getById(knex, attachmentId, tenant);
  
  if (!attachment) {
    throw new Error(`Workflow event attachment with ID "${attachmentId}" not found`);
  }
  
  // Update the workflow event attachment
  const updatedAttachment = await WorkflowEventAttachmentModel.update(knex, attachmentId, tenant, data);
  
  // If the attachment is being deactivated, unsubscribe from the event
  // NOTE: The attachment object now contains event_type instead of event_id
  // Need to adjust logic if event_type isn't directly on the attachment object after model update
  const eventType = attachment.event_type; // Assuming event_type is now on the attachment

  if (!eventType) {
      console.warn(`Attachment ${attachmentId} does not have an event_type. Cannot handle subscriptions.`);
      return updatedAttachment; // Return early if event_type is missing
  }


  if (data.is_active === false && attachment.is_active) {
      await unsubscribeWorkflowFromEvent(eventType, attachment.workflow_id, tenant);
  }

  // If the attachment is being activated, subscribe to the event
  if (data.is_active === true && !attachment.is_active) {
      await subscribeWorkflowToEvent(eventType, attachment.workflow_id, tenant);
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

  const { knex } = await createTenantKnex(tenant);
  
  // Get the workflow event attachment
  const attachment = await WorkflowEventAttachmentModel.getById(knex, attachmentId, tenant);
  
  if (!attachment) {
    throw new Error(`Workflow event attachment with ID "${attachmentId}" not found`);
  }
  
  // If the attachment is active, unsubscribe from the event
  // NOTE: The attachment object now contains event_type instead of event_id
  const eventType = attachment.event_type; // Assuming event_type is now on the attachment

  if (attachment.is_active && eventType) {
      await unsubscribeWorkflowFromEvent(eventType, attachment.workflow_id, tenant);
  } else if (attachment.is_active && !eventType) {
      console.warn(`Attachment ${attachmentId} is active but missing event_type. Cannot unsubscribe.`);
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
}): Promise<{ workflow_id: string; isSystemManaged: boolean }[]> { // Updated return type
  const { eventType, tenant } = params;

  const { knex } = await createTenantKnex(tenant);
  
  // Get all workflows attached to the event type (now returns objects with isSystemManaged flag)
  const workflowAttachments = await WorkflowEventAttachmentModel.getWorkflowsForEventType(knex, eventType, tenant);
  
  return workflowAttachments; // Return the full objects
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
  const { knex } = await createTenantKnex(tenant);
  
  // Create a unique subscription ID for this workflow and event
  const subscriptionId = `workflow:${workflowId}:event:${eventType}`;
  
  try {
    // Get the workflow registration to verify it exists
    const workflow = await getWorkflowRegistration(workflowId);
    
    if (!workflow) {
      throw new Error(`Workflow with ID "${workflowId}" not found`);
    }
    
    // Get the trigger for this workflow and event
    // Trigger logic might need review depending on how triggers relate to system vs tenant events.
    // For now, assume the existing trigger logic is sufficient or will be handled separately.
    // const trigger = await knex('workflow_triggers')
    //   .where('event_type', eventType)
    //   .where('tenant', tenant)
    //   .first();
    //
    // if (!trigger) {
    //   // Create a default trigger if one doesn't exist
    //   const [newTrigger] = await knex('workflow_triggers')
    //     .insert({
    //       event_type: eventType,
    //       tenant: tenant,
    //       name: `${eventType} Trigger`,
    //       description: `Auto-generated trigger for ${eventType} events`,
    //       created_at: new Date().toISOString(),
    //       updated_at: new Date().toISOString()
    //     })
    //     .returning('*');
    //
    //   console.log(`Created new trigger for event type "${eventType}"`);
    // }

    // Subscribe to the event
    await eventBus.subscribe(eventType as any, async (event) => {
      // Verify tenant
      if (event.payload.tenantId !== tenant) {
        return;
      }
      
      // Start the workflow
      try {
        // Extract event name from payload if available, or use a default
        const eventName = event.payload.eventName || 'event.received';
        
        // Start the workflow from the event
        const result = await startWorkflowFromEvent({
          workflowName: workflow.name,
          eventType,
          eventPayload: event.payload,
          tenant,
          userId: event.payload.userId
        });
        
        const executionId = result.executionId;
        
        // Log the workflow execution
        console.log(`Started workflow ${workflowId} (${workflow.name}) for event ${eventType} with execution ID ${executionId}`);
      } catch (error) {
        console.error(`Error starting workflow ${workflowId} for event ${eventType}:`, error);
      }
    });
    
    console.log(`Successfully subscribed workflow ${workflowId} to event type ${eventType}`);
  } catch (error) {
    console.error(`Error subscribing workflow ${workflowId} to event ${eventType}:`, error);
    throw error;
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
    // Check if there are any other active attachments for this workflow and event type
    const { knex } = await createTenantKnex();
    // NOTE: This query needs to be updated to use event_type directly from workflow_event_attachments
    // Assuming the model/table now stores event_type directly
    const otherAttachments = await knex('workflow_event_attachments')
      .where({
        event_type: eventType, // Use the event_type column directly
        tenant: tenant,
        is_active: true
      })
      .whereNot('workflow_id', workflowId)
      .count('* as count')
      .first();

    // If there are other active attachments, don't unsubscribe from the event
    if (otherAttachments && Number(otherAttachments.count) > 0) {
      console.log(`Not unsubscribing from event ${eventType} as there are other active attachments`);
      return;
    }
    
    // Unsubscribe from the event
    // Note: The EventBus doesn't currently support unsubscribing by handler
    // This is a limitation that should be addressed in a future update
    console.log(`Unsubscribing workflow ${workflowId} from event ${eventType}`);
    
    // For now, we'll log the unsubscription but not actually unsubscribe
    // This is a known limitation of the current implementation
  } catch (error) {
    console.error(`Error unsubscribing workflow ${workflowId} from event ${eventType}:`, error);
    throw error;
  }
}
