'use server';

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { EventCatalogModel } from '../models/eventCatalog';
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
export const getEventCatalogEntries = withAuth(async (
  _user,
  { tenant },
  params: {
    category?: string;
    isSystemEvent?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<IEventCatalogEntry[]> => {
  const { category, isSystemEvent, limit, offset } = params;

  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Initialize system events if needed
  await EventCatalogModel.initializeSystemEvents(knex, tenant);

  // Get all event catalog entries
  const entries = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await EventCatalogModel.getAll(trx, tenant, {
      category,
      isSystemEvent,
      limit,
      offset
    });
  });

  return entries;
});

/**
 * Get an event catalog entry by ID
 *
 * @param params Parameters for the action
 * @returns The event catalog entry or null if not found
 */
export const getEventCatalogEntryById = withAuth(async (
  _user,
  { tenant },
  eventId: string
): Promise<IEventCatalogEntry | null> => {
  const { knex } = await createTenantKnex();

  // Get the event catalog entry
  const entry = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await EventCatalogModel.getById(trx, eventId, tenant);
  });

  return entry;
});

/**
 * Get an event catalog entry by event type
 *
 * @param params Parameters for the action
 * @returns The event catalog entry or null if not found
 */
export const getEventCatalogEntryByEventType = withAuth(async (
  _user,
  { tenant },
  eventType: string
): Promise<IEventCatalogEntry | null> => {
  const { knex } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Get the event catalog entry
  const entry = await EventCatalogModel.getByEventType(knex, eventType, tenant);

  return entry;
});

/**
 * Create a new event catalog entry
 *
 * @param params Parameters for the action
 * @returns The created event catalog entry
 */
export const createEventCatalogEntry = withAuth(async (
  _user,
  { tenant },
  params: Omit<ICreateEventCatalogEntry, 'tenant'>
): Promise<IEventCatalogEntry> => {
  const { knex } = await createTenantKnex();

  // Check if an entry with the same event type already exists
  const existingEntry = await EventCatalogModel.getByEventType(knex, params.event_type, tenant);

  if (existingEntry) {
    throw new Error(`Event catalog entry with event type "${params.event_type}" already exists`);
  }

  // Create the event catalog entry
  const entry = await EventCatalogModel.create(knex, { ...params, tenant });

  return entry;
});

/**
 * Update an event catalog entry
 *
 * @param params Parameters for the action
 * @returns The updated event catalog entry
 */
export const updateEventCatalogEntry = withAuth(async (
  _user,
  { tenant },
  eventId: string,
  data: IUpdateEventCatalogEntry
): Promise<IEventCatalogEntry | null> => {
  const { knex } = await createTenantKnex();

  // Get the event catalog entry
  const entry = await EventCatalogModel.getById(knex, eventId, tenant);

  if (!entry) {
    throw new Error(`Event catalog entry with ID "${eventId}" not found`);
  }

  // Update the event catalog entry
  const updatedEntry = await EventCatalogModel.update(knex, eventId, tenant, data);

  return updatedEntry;
});

/**
 * Delete an event catalog entry
 *
 * @param params Parameters for the action
 * @returns True if the entry was deleted, false otherwise
 */
export const deleteEventCatalogEntry = withAuth(async (
  _user,
  { tenant },
  eventId: string
): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  // Get the event catalog entry
  const entry = await EventCatalogModel.getById(knex, eventId, tenant);

  if (!entry) {
    throw new Error(`Event catalog entry with ID "${eventId}" not found`);
  }

  // Delete the event catalog entry
  const result = await EventCatalogModel.delete(knex, eventId, tenant);

  return result;
});

/**
 * Initialize system events for a tenant
 *
 * @param params Parameters for the action
 */
export const initializeSystemEvents = withAuth(async (
  _user,
  { tenant }
): Promise<void> => {
  const { knex } = await createTenantKnex();

  // Initialize system events
  await EventCatalogModel.initializeSystemEvents(knex, tenant);
});

/**
 * Get event categories for a tenant
 *
 * @param params Parameters for the action
 * @returns Array of event categories
 */
export const getEventCategories = withAuth(async (
  _user,
  { tenant }
): Promise<string[]> => {
  const { knex } = await createTenantKnex();

  // Get distinct categories
  const results = await knex('event_catalog')
    .where('tenant', tenant)
    .distinct('category')
    .whereNotNull('category')
    .orderBy('category', 'asc');

  return results.map((r: { category: string }) => r.category);
});
