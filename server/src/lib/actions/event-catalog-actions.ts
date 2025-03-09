'use server';

import { createTenantKnex } from '../db';
import { EventCatalogModel } from '../../models/eventCatalog';
import {
  IEventCatalogEntry,
  ICreateEventCatalogEntry, 
  IUpdateEventCatalogEntry 
} from '@shared/workflow/types/eventCatalog';
import { z } from 'zod';

/**
 * Get all event catalog entries for a tenant
 * 
 * @param params Parameters for the action
 * @returns Array of event catalog entries
 */
export async function getEventCatalogEntries(params: {
  tenant: string;
  category?: string;
  isSystemEvent?: boolean;
  limit?: number;
  offset?: number;
}): Promise<IEventCatalogEntry[]> {
  const { tenant, category, isSystemEvent, limit, offset } = params;
  
  const { knex } = await createTenantKnex();
  
  // Initialize system events if needed
  await EventCatalogModel.initializeSystemEvents(knex, tenant);
  
  // Get all event catalog entries
  const entries = await EventCatalogModel.getAll(knex, tenant, {
    category,
    isSystemEvent,
    limit,
    offset
  });
  
  return entries;
}

/**
 * Get an event catalog entry by ID
 * 
 * @param params Parameters for the action
 * @returns The event catalog entry or null if not found
 */
export async function getEventCatalogEntryById(params: {
  eventId: string;
  tenant: string;
}): Promise<IEventCatalogEntry | null> {
  const { eventId, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the event catalog entry
  const entry = await EventCatalogModel.getById(knex, eventId, tenant);
  
  return entry;
}

/**
 * Get an event catalog entry by event type
 * 
 * @param params Parameters for the action
 * @returns The event catalog entry or null if not found
 */
export async function getEventCatalogEntryByEventType(params: {
  eventType: string;
  tenant: string;
}): Promise<IEventCatalogEntry | null> {
  const { eventType, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the event catalog entry
  const entry = await EventCatalogModel.getByEventType(knex, eventType, tenant);
  
  return entry;
}

/**
 * Create a new event catalog entry
 * 
 * @param params Parameters for the action
 * @returns The created event catalog entry
 */
export async function createEventCatalogEntry(params: ICreateEventCatalogEntry): Promise<IEventCatalogEntry> {
  const { knex } = await createTenantKnex();
  
  // Check if an entry with the same event type already exists
  const existingEntry = await EventCatalogModel.getByEventType(knex, params.event_type, params.tenant_id);
  
  if (existingEntry) {
    throw new Error(`Event catalog entry with event type "${params.event_type}" already exists`);
  }
  
  // Create the event catalog entry
  const entry = await EventCatalogModel.create(knex, params);
  
  return entry;
}

/**
 * Update an event catalog entry
 * 
 * @param params Parameters for the action
 * @returns The updated event catalog entry
 */
export async function updateEventCatalogEntry(params: {
  eventId: string;
  tenant: string;
  data: IUpdateEventCatalogEntry;
}): Promise<IEventCatalogEntry | null> {
  const { eventId, tenant, data } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the event catalog entry
  const entry = await EventCatalogModel.getById(knex, eventId, tenant);
  
  if (!entry) {
    throw new Error(`Event catalog entry with ID "${eventId}" not found`);
  }
  
  // Check if the entry is a system event and prevent certain updates
  if (entry.is_system_event) {
    // Prevent changing the name or event type of system events
    if (data.name) {
      throw new Error('Cannot change the name of a system event');
    }
    
    // Prevent changing the payload schema of system events
    if (data.payload_schema) {
      throw new Error('Cannot change the payload schema of a system event');
    }
  }
  
  // Update the event catalog entry
  const updatedEntry = await EventCatalogModel.update(knex, eventId, tenant, data);
  
  return updatedEntry;
}

/**
 * Delete an event catalog entry
 * 
 * @param params Parameters for the action
 * @returns True if the entry was deleted, false otherwise
 */
export async function deleteEventCatalogEntry(params: {
  eventId: string;
  tenant: string;
}): Promise<boolean> {
  const { eventId, tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get the event catalog entry
  const entry = await EventCatalogModel.getById(knex, eventId, tenant);
  
  if (!entry) {
    throw new Error(`Event catalog entry with ID "${eventId}" not found`);
  }
  
  // Prevent deleting system events
  if (entry.is_system_event) {
    throw new Error('Cannot delete a system event');
  }
  
  // Delete the event catalog entry
  const result = await EventCatalogModel.delete(knex, eventId, tenant);
  
  return result;
}

/**
 * Initialize system events for a tenant
 * 
 * @param params Parameters for the action
 */
export async function initializeSystemEvents(params: {
  tenant: string;
}): Promise<void> {
  const { tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Initialize system events
  await EventCatalogModel.initializeSystemEvents(knex, tenant);
}

/**
 * Get event categories for a tenant
 * 
 * @param params Parameters for the action
 * @returns Array of event categories
 */
export async function getEventCategories(params: {
  tenant: string;
}): Promise<string[]> {
  const { tenant } = params;
  
  const { knex } = await createTenantKnex();
  
  // Get distinct categories
  const results = await knex('event_catalog')
    .where('tenant_id', tenant)
    .distinct('category')
    .whereNotNull('category')
    .orderBy('category', 'asc');
  
  return results.map((r: { category: string }) => r.category);
}