'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import { WorkflowTriggerModel } from '@alga-psa/workflows/models/workflowTrigger';
import { WorkflowEventMappingModel } from '@alga-psa/workflows/models/workflowEventMapping';
import { EventCatalogModel } from '@alga-psa/workflows/models/eventCatalog';
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

  const { knex } = await createTenantKnex(tenant);

  // Get all workflow triggers
  const triggers = await withTransaction(knex, async (trx) => {
    return await WorkflowTriggerModel.getAll(trx, tenant, {
      eventType,
      limit,
      offset
    });
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

  const { knex } = await createTenantKnex(tenant);

  // Get the workflow trigger
  const trigger = await withTransaction(knex, async (trx) => {
    return await WorkflowTriggerModel.getById(trx, triggerId, tenant);
  });

  return trigger;
}

/**
 * Create a new workflow trigger
 * 
 * @param params Parameters for the action
 * @returns The created workflow trigger
 */
export async function createWorkflowTrigger(params: ICreateWorkflowTrigger): Promise<IWorkflowTrigger> {
  const { knex } = await createTenantKnex(params.tenant);

  // Verify that the event type exists in the event catalog
  const trigger = await withTransaction(knex, async (trx) => {
    const eventCatalogEntry = await EventCatalogModel.getByEventType(trx, params.event_type, params.tenant);

    if (!eventCatalogEntry) {
      throw new Error(`Event type "${params.event_type}" not found in the event catalog`);
    }

    // Create the workflow trigger
    return await WorkflowTriggerModel.create(trx, params);
  });

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

  const { knex } = await createTenantKnex(tenant);

  // Get the workflow trigger
  const updatedTrigger = await withTransaction(knex, async (trx) => {
    const trigger = await WorkflowTriggerModel.getById(trx, triggerId, tenant);

    if (!trigger) {
      throw new Error(`Workflow trigger with ID "${triggerId}" not found`);
    }

    // If the event type is being updated, verify that it exists in the event catalog
    if (data.event_type && data.event_type !== trigger.event_type) {
      const eventCatalogEntry = await EventCatalogModel.getByEventType(trx, data.event_type, tenant);

      if (!eventCatalogEntry) {
        throw new Error(`Event type "${data.event_type}" not found in the event catalog`);
      }
    }

    // Update the workflow trigger
    return await WorkflowTriggerModel.update(trx, triggerId, tenant, data);
  });

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

  const { knex } = await createTenantKnex(tenant);

  // Get the workflow trigger
  const result = await withTransaction(knex, async (trx) => {
    const trigger = await WorkflowTriggerModel.getById(trx, triggerId, tenant);

    if (!trigger) {
      throw new Error(`Workflow trigger with ID "${triggerId}" not found`);
    }

    // Delete all event mappings for the trigger
    await WorkflowEventMappingModel.deleteAllForTrigger(trx, triggerId);

    // Delete the workflow trigger
    return await WorkflowTriggerModel.delete(trx, triggerId, tenant);
  });

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

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex } = await createTenantKnex(currentUser.tenant);

  // Get all event mappings for the trigger
  const mappings = await withTransaction(knex, async (trx) => {
    return await WorkflowEventMappingModel.getAllForTrigger(trx, triggerId);
  });

  return mappings;
}

/**
 * Create a new event mapping for a trigger
 * 
 * @param params Parameters for the action
 * @returns The created workflow event mapping
 */
export async function createWorkflowEventMapping(params: ICreateWorkflowEventMapping): Promise<IWorkflowEventMapping> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex } = await createTenantKnex(currentUser.tenant);

  // Create the workflow event mapping
  const mapping = await withTransaction(knex, async (trx) => {
    return await WorkflowEventMappingModel.create(trx, params);
  });

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

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex } = await createTenantKnex(currentUser.tenant);

  // Create the workflow event mappings
  const createdMappings = await withTransaction(knex, async (trx) => {
    return await WorkflowEventMappingModel.createMany(trx, mappings);
  });

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

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex } = await createTenantKnex(currentUser.tenant);

  // Delete the workflow event mapping
  const result = await withTransaction(knex, async (trx) => {
    return await WorkflowEventMappingModel.delete(trx, mappingId);
  });

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

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex } = await createTenantKnex(currentUser.tenant);

  // Delete all event mappings for the trigger
  const result = await withTransaction(knex, async (trx) => {
    return await WorkflowEventMappingModel.deleteAllForTrigger(trx, triggerId);
  });

  return result;
}
