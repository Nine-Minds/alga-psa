'use server';

import { createTenantKnex } from '@server/lib/db';
import { WorkflowTriggerModel } from '@server/models/workflowTrigger';
import { WorkflowEventMappingModel } from '@server/models/workflowEventMapping';
import { EventCatalogModel } from '@server/models/eventCatalog';
import { 
  IWorkflowTrigger, 
  ICreateWorkflowTrigger, 
  IUpdateWorkflowTrigger,
  IWorkflowEventMapping,
  ICreateWorkflowEventMapping
} from '@alga-psa/shared/workflow/types/eventCatalog';

/**
 * Get all workflow triggers for a tenant
 * 
 * @param params Parameters for the action
 * @returns Array of workflow triggers
 */
export async function getWorkflowTriggers(params: {
  tenant: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}): Promise<IWorkflowTrigger[]> {
  const { tenant, eventType, limit, offset } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get all workflow triggers
  const triggers = await WorkflowTriggerModel.getAll(knex, tenant, {
    eventType,
    limit,
    offset
  });
  
  return triggers;
}

/**
 * Get a workflow trigger by ID
 * 
 * @param params Parameters for the action
 * @returns The workflow trigger or null if not found
 */
export async function getWorkflowTriggerById(params: {
  triggerId: string;
  tenant: string;
}): Promise<IWorkflowTrigger | null> {
  const { triggerId, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the workflow trigger
  const trigger = await WorkflowTriggerModel.getById(knex, triggerId, tenant);
  
  return trigger;
}

/**
 * Create a new workflow trigger
 * 
 * @param params Parameters for the action
 * @returns The created workflow trigger
 */
export async function createWorkflowTrigger(params: ICreateWorkflowTrigger): Promise<IWorkflowTrigger> {
  const { knex } = await createTenantKnex();
  
  // Verify that the event type exists in the event catalog
  const eventCatalogEntry = await EventCatalogModel.getByEventType(knex, params.event_type, params.tenant);
  
  if (!eventCatalogEntry) {
    throw new Error(`Event type "${params.event_type}" not found in the event catalog`);
  }
  
  // Create the workflow trigger
  const trigger = await WorkflowTriggerModel.create(knex, params);
  
  return trigger;
}

/**
 * Update a workflow trigger
 * 
 * @param params Parameters for the action
 * @returns The updated workflow trigger
 */
export async function updateWorkflowTrigger(params: {
  triggerId: string;
  tenant: string;
  data: IUpdateWorkflowTrigger;
}): Promise<IWorkflowTrigger | null> {
  const { triggerId, tenant, data } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the workflow trigger
  const trigger = await WorkflowTriggerModel.getById(knex, triggerId, tenant);
  
  if (!trigger) {
    throw new Error(`Workflow trigger with ID "${triggerId}" not found`);
  }
  
  // If the event type is being updated, verify that it exists in the event catalog
  if (data.event_type && data.event_type !== trigger.event_type) {
    const eventCatalogEntry = await EventCatalogModel.getByEventType(knex, data.event_type, tenant);
    
    if (!eventCatalogEntry) {
      throw new Error(`Event type "${data.event_type}" not found in the event catalog`);
    }
  }
  
  // Update the workflow trigger
  const updatedTrigger = await WorkflowTriggerModel.update(knex, triggerId, tenant, data);
  
  return updatedTrigger;
}

/**
 * Delete a workflow trigger
 * 
 * @param params Parameters for the action
 * @returns True if the trigger was deleted, false otherwise
 */
export async function deleteWorkflowTrigger(params: {
  triggerId: string;
  tenant: string;
}): Promise<boolean> {
  const { triggerId, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the workflow trigger
  const trigger = await WorkflowTriggerModel.getById(knex, triggerId, tenant);
  
  if (!trigger) {
    throw new Error(`Workflow trigger with ID "${triggerId}" not found`);
  }
  
  // Delete all event mappings for the trigger
  await WorkflowEventMappingModel.deleteAllForTrigger(knex, triggerId);
  
  // Delete the workflow trigger
  const result = await WorkflowTriggerModel.delete(knex, triggerId, tenant);
  
  return result;
}

/**
 * Get all event mappings for a trigger
 * 
 * @param params Parameters for the action
 * @returns Array of workflow event mappings
 */
export async function getWorkflowEventMappings(params: {
  triggerId: string;
}): Promise<IWorkflowEventMapping[]> {
  const { triggerId } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get all event mappings for the trigger
  const mappings = await WorkflowEventMappingModel.getAllForTrigger(knex, triggerId);
  
  return mappings;
}

/**
 * Create a new event mapping for a trigger
 * 
 * @param params Parameters for the action
 * @returns The created workflow event mapping
 */
export async function createWorkflowEventMapping(params: ICreateWorkflowEventMapping): Promise<IWorkflowEventMapping> {
  const { knex } = await createTenantKnex();
  
  // Create the workflow event mapping
  const mapping = await WorkflowEventMappingModel.create(knex, params);
  
  return mapping;
}

/**
 * Create multiple event mappings for a trigger
 * 
 * @param params Parameters for the action
 * @returns Array of created workflow event mappings
 */
export async function createWorkflowEventMappings(params: {
  mappings: ICreateWorkflowEventMapping[];
}): Promise<IWorkflowEventMapping[]> {
  const { mappings } = params;
  
  if (mappings.length === 0) {
    return [];
  }
  
  const { knex } = await createTenantKnex();
  
  // Create the workflow event mappings
  const createdMappings = await WorkflowEventMappingModel.createMany(knex, mappings);
  
  return createdMappings;
}

/**
 * Delete an event mapping
 * 
 * @param params Parameters for the action
 * @returns True if the mapping was deleted, false otherwise
 */
export async function deleteWorkflowEventMapping(params: {
  mappingId: string;
}): Promise<boolean> {
  const { mappingId } = params;
  
  const { knex } = await createTenantKnex();
  
  // Delete the workflow event mapping
  const result = await WorkflowEventMappingModel.delete(knex, mappingId);
  
  return result;
}

/**
 * Delete all event mappings for a trigger
 * 
 * @param params Parameters for the action
 * @returns Number of mappings deleted
 */
export async function deleteAllWorkflowEventMappings(params: {
  triggerId: string;
}): Promise<number> {
  const { triggerId } = params;
  
  const { knex } = await createTenantKnex();
  
  // Delete all event mappings for the trigger
  const result = await WorkflowEventMappingModel.deleteAllForTrigger(knex, triggerId);
  
  return result;
}
