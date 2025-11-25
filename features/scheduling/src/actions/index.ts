/**
 * Scheduling server actions
 *
 * These are Next.js server actions for scheduling operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createScheduleRepository } from '../repositories/index.js';
import {
  createScheduleEntrySchema,
  updateScheduleEntrySchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  type ScheduleEntry,
  type ScheduleEntryFilters,
  type ScheduleEntryListResponse,
  type CreateScheduleEntryInput,
  type UpdateScheduleEntryInput,
  type Appointment,
  type AppointmentFilters,
  type AppointmentListResponse,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type AvailabilityQuery,
  type AvailabilityResult,
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
 * Get a list of schedule entries for the current tenant
 */
export async function getScheduleEntries(
  context: ActionContext,
  filters: ScheduleEntryFilters = {}
): Promise<ScheduleEntryListResponse> {
  const repo = createScheduleRepository(context.knex);
  return repo.findEntries(context.tenantId, filters);
}

/**
 * Get a single schedule entry by ID
 */
export async function getScheduleEntry(
  context: ActionContext,
  entryId: string
): Promise<ScheduleEntry | null> {
  const repo = createScheduleRepository(context.knex);
  return repo.findEntryById(context.tenantId, entryId);
}

/**
 * Create a new schedule entry
 */
export async function createScheduleEntry(
  context: ActionContext,
  input: CreateScheduleEntryInput
): Promise<{ success: true; entry: ScheduleEntry } | { success: false; error: string }> {
  // Validate input
  const validation = createScheduleEntrySchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createScheduleRepository(context.knex);
    const entry = await repo.createEntry(context.tenantId, validation.data);
    return { success: true, entry };
  } catch (error) {
    console.error('[scheduling/actions] Failed to create schedule entry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create schedule entry',
    };
  }
}

/**
 * Update an existing schedule entry
 */
export async function updateScheduleEntry(
  context: ActionContext,
  input: UpdateScheduleEntryInput
): Promise<{ success: true; entry: ScheduleEntry } | { success: false; error: string }> {
  // Validate input
  const validation = updateScheduleEntrySchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createScheduleRepository(context.knex);
    const entry = await repo.updateEntry(context.tenantId, validation.data);

    if (!entry) {
      return { success: false, error: 'Schedule entry not found' };
    }

    return { success: true, entry };
  } catch (error) {
    console.error('[scheduling/actions] Failed to update schedule entry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update schedule entry',
    };
  }
}

/**
 * Delete a schedule entry
 */
export async function deleteScheduleEntry(
  context: ActionContext,
  entryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createScheduleRepository(context.knex);
    const deleted = await repo.deleteEntry(context.tenantId, entryId);

    if (!deleted) {
      return { success: false, error: 'Schedule entry not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[scheduling/actions] Failed to delete schedule entry:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete schedule entry',
    };
  }
}

/**
 * Get availability for users in a date range
 */
export async function getAvailability(
  context: ActionContext,
  query: AvailabilityQuery
): Promise<{ success: true; results: AvailabilityResult[] } | { success: false; error: string }> {
  try {
    const repo = createScheduleRepository(context.knex);
    const results = await repo.getAvailability(context.tenantId, query);
    return { success: true, results };
  } catch (error) {
    console.error('[scheduling/actions] Failed to get availability:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get availability',
    };
  }
}

/**
 * Get a list of appointments for the current tenant
 */
export async function getAppointments(
  context: ActionContext,
  filters: AppointmentFilters = {}
): Promise<AppointmentListResponse> {
  const repo = createScheduleRepository(context.knex);
  return repo.findAppointments(context.tenantId, filters);
}

/**
 * Get a single appointment by ID
 */
export async function getAppointment(
  context: ActionContext,
  appointmentId: string
): Promise<Appointment | null> {
  const repo = createScheduleRepository(context.knex);
  return repo.findAppointmentById(context.tenantId, appointmentId);
}

/**
 * Create a new appointment
 */
export async function createAppointment(
  context: ActionContext,
  input: CreateAppointmentInput
): Promise<{ success: true; appointment: Appointment } | { success: false; error: string }> {
  // Validate input
  const validation = createAppointmentSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createScheduleRepository(context.knex);
    const appointment = await repo.createAppointment(context.tenantId, validation.data);
    return { success: true, appointment };
  } catch (error) {
    console.error('[scheduling/actions] Failed to create appointment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create appointment',
    };
  }
}

/**
 * Update an existing appointment
 */
export async function updateAppointment(
  context: ActionContext,
  input: UpdateAppointmentInput
): Promise<{ success: true; appointment: Appointment } | { success: false; error: string }> {
  // Validate input
  const validation = updateAppointmentSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createScheduleRepository(context.knex);
    const appointment = await repo.updateAppointment(context.tenantId, validation.data);

    if (!appointment) {
      return { success: false, error: 'Appointment not found' };
    }

    return { success: true, appointment };
  } catch (error) {
    console.error('[scheduling/actions] Failed to update appointment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update appointment',
    };
  }
}

/**
 * Delete an appointment
 */
export async function deleteAppointment(
  context: ActionContext,
  appointmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createScheduleRepository(context.knex);
    const deleted = await repo.deleteAppointment(context.tenantId, appointmentId);

    if (!deleted) {
      return { success: false, error: 'Appointment not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[scheduling/actions] Failed to delete appointment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete appointment',
    };
  }
}
