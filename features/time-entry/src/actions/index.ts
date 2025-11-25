/**
 * Time entry server actions
 *
 * These are Next.js server actions for time entry operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createTimeEntryRepository, createTimeSheetRepository } from '../repositories/index.js';
import {
  createTimeEntrySchema,
  updateTimeEntrySchema,
  startTrackingSchema,
  stopTrackingSchema,
  type TimeEntry,
  type TimeEntryFilters,
  type TimeEntryListResponse,
  type CreateTimeEntryInput,
  type UpdateTimeEntryInput,
  type StartTrackingInput,
  type StopTrackingInput,
  type TimeSheet,
  type TimeEntryWithWorkItem,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a list of time entries for the current tenant
 */
export async function getTimeEntries(
  context: ActionContext,
  filters: TimeEntryFilters = {}
): Promise<TimeEntryListResponse> {
  const repo = createTimeEntryRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get a single time entry by ID
 */
export async function getTimeEntry(
  context: ActionContext,
  entryId: string
): Promise<TimeEntry | null> {
  const repo = createTimeEntryRepository(context.knex);
  return repo.findById(context.tenantId, entryId);
}

/**
 * Create a new time entry
 */
export async function createTimeEntry(
  context: ActionContext,
  input: CreateTimeEntryInput
): Promise<{ success: true; entry: TimeEntry } | { success: false; error: string }> {
  // Validate input
  const validation = createTimeEntrySchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createTimeEntryRepository(context.knex);
    const entry = await repo.create(
      context.tenantId,
      context.userId,
      validation.data
    );
    return { success: true, entry };
  } catch (error) {
    console.error('[time-entry/actions] Failed to create time entry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create time entry',
    };
  }
}

/**
 * Update an existing time entry
 */
export async function updateTimeEntry(
  context: ActionContext,
  input: UpdateTimeEntryInput
): Promise<{ success: true; entry: TimeEntry } | { success: false; error: string }> {
  // Validate input
  const validation = updateTimeEntrySchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createTimeEntryRepository(context.knex);
    const entry = await repo.update(context.tenantId, validation.data);

    if (!entry) {
      return { success: false, error: 'Time entry not found' };
    }

    return { success: true, entry };
  } catch (error) {
    console.error('[time-entry/actions] Failed to update time entry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update time entry',
    };
  }
}

/**
 * Delete a time entry
 */
export async function deleteTimeEntry(
  context: ActionContext,
  entryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createTimeEntryRepository(context.knex);
    const deleted = await repo.delete(context.tenantId, entryId);

    if (!deleted) {
      return { success: false, error: 'Time entry not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[time-entry/actions] Failed to delete time entry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete time entry',
    };
  }
}

/**
 * Start tracking time for a work item
 */
export async function startTracking(
  context: ActionContext,
  input: StartTrackingInput
): Promise<{ success: true; entry: TimeEntry } | { success: false; error: string }> {
  // Validate input
  const validation = startTrackingSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createTimeEntryRepository(context.knex);

    // Check if there's already an active tracking entry
    const activeEntry = await repo.findActiveTracking(context.tenantId, context.userId);
    if (activeEntry) {
      return {
        success: false,
        error: 'You already have an active time tracking entry. Please stop it before starting a new one.',
      };
    }

    const entry = await repo.startTracking(
      context.tenantId,
      context.userId,
      validation.data.work_item_id,
      validation.data.work_item_type,
      {
        notes: validation.data.notes,
        service_id: validation.data.service_id,
      }
    );
    return { success: true, entry };
  } catch (error) {
    console.error('[time-entry/actions] Failed to start tracking:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start tracking',
    };
  }
}

/**
 * Stop tracking time for an entry
 */
export async function stopTracking(
  context: ActionContext,
  input: StopTrackingInput
): Promise<{ success: true; entry: TimeEntry } | { success: false; error: string }> {
  // Validate input
  const validation = stopTrackingSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createTimeEntryRepository(context.knex);
    const entry = await repo.stopTracking(
      context.tenantId,
      validation.data.entry_id,
      {
        billable_duration: validation.data.billable_duration,
        notes: validation.data.notes,
      }
    );

    if (!entry) {
      return { success: false, error: 'Time entry not found' };
    }

    return { success: true, entry };
  } catch (error) {
    console.error('[time-entry/actions] Failed to stop tracking:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop tracking',
    };
  }
}

/**
 * Approve a time entry
 */
export async function approveTimeEntry(
  context: ActionContext,
  entryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createTimeEntryRepository(context.knex);
    const entry = await repo.approve(context.tenantId, entryId, context.userId);

    if (!entry) {
      return { success: false, error: 'Time entry not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[time-entry/actions] Failed to approve time entry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve time entry',
    };
  }
}

/**
 * Get time entries for a specific time sheet
 */
export async function getTimeEntriesForTimeSheet(
  context: ActionContext,
  timeSheetId: string
): Promise<TimeEntry[]> {
  const repo = createTimeEntryRepository(context.knex);
  return repo.findByTimeSheet(context.tenantId, timeSheetId);
}

/**
 * Get or create a time sheet for a user and period
 */
export async function getOrCreateTimeSheet(
  context: ActionContext,
  periodId: string,
  userId?: string
): Promise<TimeSheet> {
  const repo = createTimeSheetRepository(context.knex);
  return repo.findOrCreate(
    context.tenantId,
    userId || context.userId,
    periodId
  );
}

/**
 * Submit a time sheet for approval
 */
export async function submitTimeSheet(
  context: ActionContext,
  timeSheetId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createTimeSheetRepository(context.knex);
    const timeSheet = await repo.submit(context.tenantId, timeSheetId);

    if (!timeSheet) {
      return { success: false, error: 'Time sheet not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[time-entry/actions] Failed to submit time sheet:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to submit time sheet',
    };
  }
}

/**
 * Approve a time sheet
 */
export async function approveTimeSheet(
  context: ActionContext,
  timeSheetId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createTimeSheetRepository(context.knex);
    const timeSheet = await repo.approve(
      context.tenantId,
      timeSheetId,
      context.userId
    );

    if (!timeSheet) {
      return { success: false, error: 'Time sheet not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[time-entry/actions] Failed to approve time sheet:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve time sheet',
    };
  }
}

/**
 * Get the currently active tracking entry for the current user
 */
export async function getActiveTracking(
  context: ActionContext
): Promise<TimeEntry | null> {
  const repo = createTimeEntryRepository(context.knex);
  return repo.findActiveTracking(context.tenantId, context.userId);
}
