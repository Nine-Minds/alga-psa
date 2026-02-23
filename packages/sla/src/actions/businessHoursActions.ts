'use server';

import { createTenantKnex, withTransaction, normalizeIanaTimeZone } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  IBusinessHoursSchedule,
  IBusinessHoursEntry,
  IHoliday,
  IBusinessHoursScheduleInput,
  IBusinessHoursEntryInput,
  IHolidayInput,
  IBusinessHoursScheduleWithEntries
} from '../types';
import {
  isWithinBusinessHours as calculatorIsWithinBusinessHours,
  getNextBusinessHoursStart as calculatorGetNextBusinessHoursStart
} from '../services/businessHoursCalculator';

// ============================================================================
// Business Hours Schedules
// ============================================================================

/**
 * Get all business hours schedules for the current tenant
 */
export const getBusinessHoursSchedules = withAuth(async (_user, { tenant }): Promise<IBusinessHoursSchedule[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const schedules = await trx('business_hours_schedules')
      .where({ tenant })
      .select('*')
      .orderBy('schedule_name', 'asc');

    return schedules;
  });
});

/**
 * Get a business hours schedule by ID with its entries and holidays
 */
export const getBusinessHoursScheduleById = withAuth(async (_user, { tenant }, scheduleId: string): Promise<IBusinessHoursScheduleWithEntries | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .first();

    if (!schedule) {
      return null;
    }

    const entries = await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId })
      .orderBy('day_of_week', 'asc');

    const holidays = await trx('holidays')
      .where({ tenant, schedule_id: scheduleId })
      .orderBy('holiday_date', 'asc');

    return {
      ...schedule,
      entries,
      holidays
    };
  });
});

/**
 * Get the default business hours schedule for the current tenant
 */
export const getDefaultBusinessHoursSchedule = withAuth(async (_user, { tenant }): Promise<IBusinessHoursSchedule | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, is_default: true })
      .first();

    return schedule || null;
  });
});

/**
 * Create a new business hours schedule with optional entries
 */
export const createBusinessHoursSchedule = withAuth(async (
  _user,
  { tenant },
  input: IBusinessHoursScheduleInput,
  entries?: IBusinessHoursEntryInput[]
): Promise<IBusinessHoursScheduleWithEntries> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const scheduleId = uuidv4();

    // If this schedule should be default, unset any existing default first
    if (input.is_default) {
      await trx('business_hours_schedules')
        .where({ tenant, is_default: true })
        .update({ is_default: false, updated_at: trx.fn.now() });
    }

    // Create the schedule
    const [schedule] = await trx('business_hours_schedules')
      .insert({
        tenant,
        schedule_id: scheduleId,
        schedule_name: input.schedule_name,
        timezone: input.timezone,
        is_default: input.is_default || false,
        is_24x7: input.is_24x7 || false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      .returning('*');

    // Create entries if provided
    let createdEntries: IBusinessHoursEntry[] = [];
    if (entries && entries.length > 0) {
      const entryRecords = entries.map((entry) => ({
        tenant,
        entry_id: uuidv4(),
        schedule_id: scheduleId,
        day_of_week: entry.day_of_week,
        start_time: entry.start_time,
        end_time: entry.end_time,
        is_enabled: entry.is_enabled
      }));

      createdEntries = await trx('business_hours_entries')
        .insert(entryRecords)
        .returning('*');
    }

    return {
      ...schedule,
      entries: createdEntries,
      holidays: []
    };
  });
});

/**
 * Update a business hours schedule
 */
export const updateBusinessHoursSchedule = withAuth(async (
  _user,
  { tenant },
  scheduleId: string,
  input: Partial<IBusinessHoursScheduleInput>
): Promise<IBusinessHoursSchedule> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // If this schedule should be default, unset any existing default first
    if (input.is_default) {
      await trx('business_hours_schedules')
        .where({ tenant, is_default: true })
        .whereNot({ schedule_id: scheduleId })
        .update({ is_default: false, updated_at: trx.fn.now() });
    }

    const updateData: Record<string, unknown> = {
      updated_at: trx.fn.now()
    };

    if (input.schedule_name !== undefined) updateData.schedule_name = input.schedule_name;
    if (input.timezone !== undefined) updateData.timezone = input.timezone;
    if (input.is_default !== undefined) updateData.is_default = input.is_default;
    if (input.is_24x7 !== undefined) updateData.is_24x7 = input.is_24x7;

    const [schedule] = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .update(updateData)
      .returning('*');

    if (!schedule) {
      throw new Error('Business hours schedule not found');
    }

    return schedule;
  });
});

/**
 * Delete a business hours schedule
 */
export const deleteBusinessHoursSchedule = withAuth(async (_user, { tenant }, scheduleId: string): Promise<void> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check if schedule is in use by SLA policies
    const slaPoliciesCount = await trx('sla_policies')
      .where({ tenant, business_hours_schedule_id: scheduleId })
      .count('* as count')
      .first();

    if (slaPoliciesCount && Number(slaPoliciesCount.count) > 0) {
      throw new Error('Cannot delete schedule: it is used by one or more SLA policies');
    }

    // Delete associated holidays
    await trx('holidays')
      .where({ tenant, schedule_id: scheduleId })
      .delete();

    // Delete associated entries
    await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId })
      .delete();

    // Delete the schedule
    const deletedCount = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .delete();

    if (deletedCount === 0) {
      throw new Error('Business hours schedule not found');
    }
  });
});

/**
 * Set a schedule as the default for the tenant
 */
export const setDefaultBusinessHoursSchedule = withAuth(async (_user, { tenant }, scheduleId: string): Promise<void> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Verify schedule exists
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .first();

    if (!schedule) {
      throw new Error('Business hours schedule not found');
    }

    // Unset any existing default
    await trx('business_hours_schedules')
      .where({ tenant, is_default: true })
      .update({ is_default: false, updated_at: trx.fn.now() });

    // Set new default
    await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .update({ is_default: true, updated_at: trx.fn.now() });
  });
});

// ============================================================================
// Business Hours Entries (daily schedule)
// ============================================================================

/**
 * Get all business hours entries for a schedule
 */
export const getBusinessHoursEntries = withAuth(async (_user, { tenant }, scheduleId: string): Promise<IBusinessHoursEntry[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const entries = await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId })
      .orderBy('day_of_week', 'asc');

    return entries;
  });
});

/**
 * Upsert business hours entries for a schedule
 * This will replace existing entries for the specified days
 */
export const upsertBusinessHoursEntries = withAuth(async (
  _user,
  { tenant },
  scheduleId: string,
  entries: IBusinessHoursEntryInput[]
): Promise<IBusinessHoursEntry[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Verify schedule exists
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .first();

    if (!schedule) {
      throw new Error('Business hours schedule not found');
    }

    // Delete existing entries for the days we're updating
    const daysToUpdate = entries.map(e => e.day_of_week);
    await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId })
      .whereIn('day_of_week', daysToUpdate)
      .delete();

    // Insert new entries
    const entryRecords = entries.map((entry) => ({
      tenant,
      entry_id: uuidv4(),
      schedule_id: scheduleId,
      day_of_week: entry.day_of_week,
      start_time: entry.start_time,
      end_time: entry.end_time,
      is_enabled: entry.is_enabled
    }));

    const createdEntries = await trx('business_hours_entries')
      .insert(entryRecords)
      .returning('*');

    // Update schedule's updated_at
    await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .update({ updated_at: trx.fn.now() });

    return createdEntries;
  });
});

/**
 * Delete a specific business hours entry
 */
export const deleteBusinessHoursEntry = withAuth(async (_user, { tenant }, entryId: string): Promise<void> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const entry = await trx('business_hours_entries')
      .where({ tenant, entry_id: entryId })
      .first();

    if (!entry) {
      throw new Error('Business hours entry not found');
    }

    await trx('business_hours_entries')
      .where({ tenant, entry_id: entryId })
      .delete();

    // Update schedule's updated_at
    await trx('business_hours_schedules')
      .where({ tenant, schedule_id: entry.schedule_id })
      .update({ updated_at: trx.fn.now() });
  });
});

// ============================================================================
// Holidays
// ============================================================================

/**
 * Get all holidays, optionally filtered by schedule
 */
export const getHolidays = withAuth(async (_user, { tenant }, scheduleId?: string): Promise<IHoliday[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    let query = trx('holidays').where({ tenant });

    if (scheduleId) {
      query = query.where({ schedule_id: scheduleId });
    }

    const holidays = await query.orderBy('holiday_date', 'asc');

    return holidays;
  });
});

/**
 * Create a new holiday
 */
export const createHoliday = withAuth(async (_user, { tenant }, input: IHolidayInput): Promise<IHoliday> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // If schedule_id provided, verify it exists
    if (input.schedule_id) {
      const schedule = await trx('business_hours_schedules')
        .where({ tenant, schedule_id: input.schedule_id })
        .first();

      if (!schedule) {
        throw new Error('Business hours schedule not found');
      }
    }

    const [holiday] = await trx('holidays')
      .insert({
        tenant,
        holiday_id: uuidv4(),
        schedule_id: input.schedule_id || null,
        holiday_name: input.holiday_name,
        holiday_date: input.holiday_date,
        is_recurring: input.is_recurring || false,
        created_at: trx.fn.now()
      })
      .returning('*');

    return holiday;
  });
});

/**
 * Update an existing holiday
 */
export const updateHoliday = withAuth(async (
  _user,
  { tenant },
  holidayId: string,
  input: Partial<IHolidayInput>
): Promise<IHoliday> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // If schedule_id is being updated, verify it exists
    if (input.schedule_id) {
      const schedule = await trx('business_hours_schedules')
        .where({ tenant, schedule_id: input.schedule_id })
        .first();

      if (!schedule) {
        throw new Error('Business hours schedule not found');
      }
    }

    const updateData: Record<string, unknown> = {};

    if (input.holiday_name !== undefined) updateData.holiday_name = input.holiday_name;
    if (input.holiday_date !== undefined) updateData.holiday_date = input.holiday_date;
    if (input.is_recurring !== undefined) updateData.is_recurring = input.is_recurring;
    if (input.schedule_id !== undefined) updateData.schedule_id = input.schedule_id;

    const [holiday] = await trx('holidays')
      .where({ tenant, holiday_id: holidayId })
      .update(updateData)
      .returning('*');

    if (!holiday) {
      throw new Error('Holiday not found');
    }

    return holiday;
  });
});

/**
 * Delete a holiday
 */
export const deleteHoliday = withAuth(async (_user, { tenant }, holidayId: string): Promise<void> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const deletedCount = await trx('holidays')
      .where({ tenant, holiday_id: holidayId })
      .delete();

    if (deletedCount === 0) {
      throw new Error('Holiday not found');
    }
  });
});

/**
 * Bulk create holidays
 */
export const bulkCreateHolidays = withAuth(async (_user, { tenant }, holidays: IHolidayInput[]): Promise<IHoliday[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Verify all schedule_ids exist
    const scheduleIds = [...new Set(holidays.filter(h => h.schedule_id).map(h => h.schedule_id))];
    if (scheduleIds.length > 0) {
      const existingSchedules = await trx('business_hours_schedules')
        .where({ tenant })
        .whereIn('schedule_id', scheduleIds as string[])
        .select('schedule_id');

      const existingIds = new Set(existingSchedules.map(s => s.schedule_id));
      const missingIds = scheduleIds.filter(id => !existingIds.has(id));

      if (missingIds.length > 0) {
        throw new Error(`Business hours schedules not found: ${missingIds.join(', ')}`);
      }
    }

    const holidayRecords = holidays.map((input) => ({
      tenant,
      holiday_id: uuidv4(),
      schedule_id: input.schedule_id || null,
      holiday_name: input.holiday_name,
      holiday_date: input.holiday_date,
      is_recurring: input.is_recurring || false,
      created_at: trx.fn.now()
    }));

    const createdHolidays = await trx('holidays')
      .insert(holidayRecords)
      .returning('*');

    return createdHolidays;
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a default business hours schedule with standard business hours (Mon-Fri 8am-6pm)
 */
export const createDefaultBusinessHoursSchedule = withAuth(async (_user, { tenant }, browserTimezone?: string): Promise<IBusinessHoursScheduleWithEntries> => {
  // Standard business hours entries for Mon-Fri (days 1-5)
  const standardEntries: IBusinessHoursEntryInput[] = [
    { day_of_week: 0, start_time: '08:00', end_time: '18:00', is_enabled: false }, // Sunday
    { day_of_week: 1, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Monday
    { day_of_week: 2, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Tuesday
    { day_of_week: 3, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Wednesday
    { day_of_week: 4, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Thursday
    { day_of_week: 5, start_time: '08:00', end_time: '18:00', is_enabled: true },  // Friday
    { day_of_week: 6, start_time: '08:00', end_time: '18:00', is_enabled: false }  // Saturday
  ];

  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const scheduleId = uuidv4();

    // Resolve tenant timezone (falls back to browser timezone, then UTC)
    const settingsRow = await trx('tenant_settings')
      .where({ tenant })
      .select('settings')
      .first();
    const rawTz = settingsRow?.settings?.timezone;
    const tenantTz = typeof rawTz === 'string' ? rawTz : null;
    const timezone = normalizeIanaTimeZone(tenantTz || browserTimezone || null);

    // Unset any existing default
    await trx('business_hours_schedules')
      .where({ tenant, is_default: true })
      .update({ is_default: false, updated_at: trx.fn.now() });

    // Create the schedule
    const [schedule] = await trx('business_hours_schedules')
      .insert({
        tenant,
        schedule_id: scheduleId,
        schedule_name: 'Standard Business Hours',
        timezone,
        is_default: true,
        is_24x7: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      .returning('*');

    // Create entries
    const entryRecords = standardEntries.map((entry) => ({
      tenant,
      entry_id: uuidv4(),
      schedule_id: scheduleId,
      day_of_week: entry.day_of_week,
      start_time: entry.start_time,
      end_time: entry.end_time,
      is_enabled: entry.is_enabled
    }));

    const createdEntries = await trx('business_hours_entries')
      .insert(entryRecords)
      .returning('*');

    return {
      ...schedule,
      entries: createdEntries,
      holidays: []
    };
  });
});

/**
 * Check if a given datetime falls within business hours
 */
export const isWithinBusinessHours = withAuth(async (_user, { tenant }, scheduleId: string, datetime: Date): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .first();

    if (!schedule) {
      throw new Error('Business hours schedule not found');
    }

    const entries = await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId })
      .orderBy('day_of_week', 'asc');

    const holidays = await trx('holidays')
      .where({ tenant })
      .where(function() {
        this.where({ schedule_id: scheduleId }).orWhereNull('schedule_id');
      });

    const scheduleWithEntries: IBusinessHoursScheduleWithEntries = {
      ...schedule,
      entries,
      holidays
    };

    return calculatorIsWithinBusinessHours(scheduleWithEntries, datetime);
  });
});

/**
 * Get the next business hour start from a given datetime
 */
export const getNextBusinessHourStart = withAuth(async (_user, { tenant }, scheduleId: string, datetime: Date): Promise<Date> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .first();

    if (!schedule) {
      throw new Error('Business hours schedule not found');
    }

    const entries = await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId })
      .orderBy('day_of_week', 'asc');

    const holidays = await trx('holidays')
      .where({ tenant })
      .where(function() {
        this.where({ schedule_id: scheduleId }).orWhereNull('schedule_id');
      });

    const scheduleWithEntries: IBusinessHoursScheduleWithEntries = {
      ...schedule,
      entries,
      holidays
    };

    return calculatorGetNextBusinessHoursStart(scheduleWithEntries, datetime);
  });
});

/**
 * Get the tenant's configured timezone for SLA defaults
 */
export const getTenantTimezoneForSla = withAuth(async (_user, { tenant }): Promise<string> => {
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const settingsRow = await trx('tenant_settings')
      .where({ tenant }).select('settings').first();
    const rawTz = settingsRow?.settings?.timezone;
    return normalizeIanaTimeZone(typeof rawTz === 'string' ? rawTz : null);
  });
});
