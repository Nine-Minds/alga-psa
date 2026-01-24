'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
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
export const createDefaultBusinessHoursSchedule = withAuth(async (_user, { tenant }): Promise<IBusinessHoursScheduleWithEntries> => {
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
        timezone: 'America/New_York',
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
    // Get the schedule
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .first();

    if (!schedule) {
      throw new Error('Business hours schedule not found');
    }

    // If 24x7, always return true
    if (schedule.is_24x7) {
      return true;
    }

    // Convert datetime to the schedule's timezone
    const scheduleTimezone = schedule.timezone;
    const localDate = new Date(datetime.toLocaleString('en-US', { timeZone: scheduleTimezone }));
    const dateString = datetime.toLocaleDateString('en-CA', { timeZone: scheduleTimezone }); // YYYY-MM-DD format

    // Check if the date is a holiday
    // Check for exact date match
    const exactHoliday = await trx('holidays')
      .where({ tenant })
      .where(function() {
        this.where({ schedule_id: scheduleId }).orWhereNull('schedule_id');
      })
      .where({ holiday_date: dateString, is_recurring: false })
      .first();

    if (exactHoliday) {
      return false;
    }

    // Check for recurring holiday (same month and day)
    const month = localDate.getMonth() + 1;
    const day = localDate.getDate();
    const recurringHoliday = await trx('holidays')
      .where({ tenant, is_recurring: true })
      .where(function() {
        this.where({ schedule_id: scheduleId }).orWhereNull('schedule_id');
      })
      .whereRaw('EXTRACT(MONTH FROM holiday_date) = ?', [month])
      .whereRaw('EXTRACT(DAY FROM holiday_date) = ?', [day])
      .first();

    if (recurringHoliday) {
      return false;
    }

    // Get the day of week (0=Sunday, 6=Saturday)
    const dayOfWeek = localDate.getDay();

    // Get the entry for this day
    const entry = await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId, day_of_week: dayOfWeek })
      .first();

    // If no entry for this day, not within business hours
    if (!entry || !entry.is_enabled) {
      return false;
    }

    // Check if the time is within the entry's hours
    const timeString = localDate.toTimeString().slice(0, 5); // HH:MM format

    return timeString >= entry.start_time && timeString < entry.end_time;
  });
});

/**
 * Get the next business hour start from a given datetime
 */
export const getNextBusinessHourStart = withAuth(async (_user, { tenant }, scheduleId: string, datetime: Date): Promise<Date> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get the schedule
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: scheduleId })
      .first();

    if (!schedule) {
      throw new Error('Business hours schedule not found');
    }

    // If 24x7, return the input datetime
    if (schedule.is_24x7) {
      return datetime;
    }

    // Get all entries for the schedule
    const entries = await trx('business_hours_entries')
      .where({ tenant, schedule_id: scheduleId, is_enabled: true })
      .orderBy('day_of_week', 'asc');

    if (entries.length === 0) {
      throw new Error('No business hours entries defined for this schedule');
    }

    // Get all holidays for the schedule
    const holidays = await trx('holidays')
      .where({ tenant })
      .where(function() {
        this.where({ schedule_id: scheduleId }).orWhereNull('schedule_id');
      });

    const scheduleTimezone = schedule.timezone;

    // Helper to check if a date is a holiday
    const isHoliday = (date: Date): boolean => {
      const dateString = date.toLocaleDateString('en-CA', { timeZone: scheduleTimezone });
      const month = parseInt(dateString.slice(5, 7), 10);
      const day = parseInt(dateString.slice(8, 10), 10);

      return holidays.some(h => {
        if (h.is_recurring) {
          const hMonth = parseInt(h.holiday_date.slice(5, 7), 10);
          const hDay = parseInt(h.holiday_date.slice(8, 10), 10);
          return month === hMonth && day === hDay;
        }
        return h.holiday_date === dateString;
      });
    };

    // Search up to 14 days ahead
    const maxDays = 14;
    let currentDate = new Date(datetime);

    for (let i = 0; i < maxDays; i++) {
      // Convert to schedule timezone
      const localDateStr = currentDate.toLocaleString('en-US', { timeZone: scheduleTimezone });
      const localDate = new Date(localDateStr);
      const dayOfWeek = localDate.getDay();

      // Find entry for this day
      const entry = entries.find(e => e.day_of_week === dayOfWeek);

      if (entry && !isHoliday(currentDate)) {
        // Get the start time for this day
        const [startHour, startMinute] = entry.start_time.split(':').map(Number);
        const [endHour, endMinute] = entry.end_time.split(':').map(Number);

        // Create datetime for start of business hours on this day
        const startOfBusiness = new Date(localDate);
        startOfBusiness.setHours(startHour, startMinute, 0, 0);

        const endOfBusiness = new Date(localDate);
        endOfBusiness.setHours(endHour, endMinute, 0, 0);

        // If we're on the first day and current time is before end of business
        if (i === 0) {
          const currentTimeStr = localDate.toTimeString().slice(0, 5);

          // If current time is before start, return start time
          if (currentTimeStr < entry.start_time) {
            // Convert back to original timezone/UTC
            const resultDate = new Date(datetime);
            resultDate.setHours(startHour, startMinute, 0, 0);
            return resultDate;
          }

          // If current time is within business hours, return current time
          if (currentTimeStr >= entry.start_time && currentTimeStr < entry.end_time) {
            return datetime;
          }
        } else {
          // For subsequent days, return the start of business hours
          const resultDate = new Date(currentDate);
          resultDate.setHours(startHour, startMinute, 0, 0);
          return resultDate;
        }
      }

      // Move to the next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }

    throw new Error('Could not find next business hour within 14 days');
  });
});
