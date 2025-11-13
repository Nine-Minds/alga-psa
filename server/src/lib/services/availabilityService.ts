'use server';

import { createTenantKnex, runWithTenant } from '../db';
import {
  ITimeSlot,
  IAvailableDate,
  IAvailabilitySetting
} from '../../interfaces/scheduling.interfaces';
import { Knex } from 'knex';

/**
 * AvailabilityService
 * Handles all time slot calculation and availability checking logic for appointment scheduling
 */

/**
 * Get available time slots for a specific date
 * @param tenantId - Tenant identifier
 * @param date - Target date in YYYY-MM-DD format
 * @param serviceId - Service being scheduled
 * @param duration - Appointment duration in minutes
 * @param userId - Optional specific user to check availability for
 * @param userTimezone - Optional IANA timezone (e.g., 'America/New_York') for calculating minimum notice
 * @returns Array of available time slots
 */
export async function getAvailableTimeSlots(
  tenantId: string,
  date: string,
  serviceId: string,
  duration: number,
  userId?: string,
  userTimezone?: string
): Promise<ITimeSlot[]> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    // Validate date is not in the past and within booking window
    // Parse date in UTC to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const targetDate = new Date(Date.UTC(year, month - 1, day));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (targetDate < today) {
      return [];
    }

    // Get service rules to check advance booking limits
    const serviceSettings = await getServiceSettings(knex, tenantId, serviceId);

    // Store minimum notice hours for filtering individual slots later
    let minNoticeHours = 24; // default

    if (serviceSettings) {
      const maxAdvanceDays = serviceSettings.advance_booking_days ?? 30;
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + maxAdvanceDays);

      if (targetDate > maxDate) {
        return [];
      }

      minNoticeHours = serviceSettings.minimum_notice_hours ?? 24;
    }

    // Get day of week (0 = Sunday, 6 = Saturday) in UTC
    const dayOfWeek = targetDate.getUTCDay();

    // Check for company-wide exceptions first (user_id is NULL)
    const companyWideException = await knex('availability_exceptions')
      .where({
        tenant: tenantId,
        date: date
      })
      .whereNull('user_id')
      .first();

    // If there's a company-wide "not available" exception, return empty
    if (companyWideException && !companyWideException.is_available) {
      return [];
    }

    // Determine which users to check
    let userIds: string[] = [];
    if (userId) {
      // Check if the specific user has availability for this day of week
      const userHasAvailability = await knex('availability_settings')
        .where({
          tenant: tenantId,
          setting_type: 'user_hours',
          user_id: userId,
          day_of_week: dayOfWeek,
          is_available: true
        })
        .first();

      // Or check if user has an availability exception for this specific date
      const userHasException = await knex('availability_exceptions')
        .where({
          tenant: tenantId,
          user_id: userId,
          date: date,
          is_available: true
        })
        .first();

      // Only include the user if they have availability for this day or an exception
      if (userHasAvailability || userHasException) {
        userIds = [userId];
      }
    } else {
      // Get all users with availability settings for this day
      const usersWithSettings = await knex('availability_settings')
        .where({
          tenant: tenantId,
          setting_type: 'user_hours',
          day_of_week: dayOfWeek,
          is_available: true
        })
        .whereNotNull('user_id')
        .select('user_id')
        .distinct();

      userIds = usersWithSettings.map((row: any) => row.user_id);

      // Also check for user-specific exceptions that make them available on this date
      // (even if they don't normally work this day of week)
      const availableExceptions = await knex('availability_exceptions')
        .where({
          tenant: tenantId,
          date: date,
          is_available: true
        })
        .whereNotNull('user_id')
        .select('user_id')
        .distinct();

      // Add users from exceptions who might not be in the regular working hours
      availableExceptions.forEach((ex: any) => {
        if (!userIds.includes(ex.user_id)) {
          userIds.push(ex.user_id);
        }
      });
    }

    if (userIds.length === 0) {
      return [];
    }

    // Check for user-specific availability exceptions
    const userExceptions = await knex('availability_exceptions')
      .where({
        tenant: tenantId,
        date: date
      })
      .whereIn('user_id', userIds)
      .whereNotNull('user_id')
      .select('user_id', 'is_available');

    const unavailableUsers = userExceptions
      .filter((ex: any) => !ex.is_available)
      .map((ex: any) => ex.user_id);

    // Users who have availability exceptions making them available
    const exceptionAvailableUsers = userExceptions
      .filter((ex: any) => ex.is_available)
      .map((ex: any) => ex.user_id);

    // Remove unavailable users
    userIds = userIds.filter(id => !unavailableUsers.includes(id));

    if (userIds.length === 0) {
      return [];
    }

    let workingHours = await knex('availability_settings')
      .where({
        tenant: tenantId,
        setting_type: 'user_hours',
        day_of_week: dayOfWeek,
        is_available: true
      })
      .whereIn('user_id', userIds)
      .select('user_id', 'start_time', 'end_time', 'buffer_before_minutes', 'buffer_after_minutes');

    // For users with exceptions making them available but no regular hours for this day,
    // try to find their hours from any other day as a template
    const usersWithoutHours = userIds.filter(
      uid => !workingHours.find((wh: any) => wh.user_id === uid) && exceptionAvailableUsers.includes(uid)
    );

    if (usersWithoutHours.length > 0) {
      const alternateHours = await knex('availability_settings')
        .where({
          tenant: tenantId,
          setting_type: 'user_hours',
          is_available: true
        })
        .whereIn('user_id', usersWithoutHours)
        .whereNotNull('start_time')
        .whereNotNull('end_time')
        .select('user_id', 'start_time', 'end_time', 'buffer_before_minutes', 'buffer_after_minutes')
        .groupBy('user_id', 'start_time', 'end_time', 'buffer_before_minutes', 'buffer_after_minutes')
        .limit(usersWithoutHours.length);

      // Add these alternate hours to the working hours array
      workingHours = [...workingHours, ...alternateHours];
    }

    // Keep working hours aligned with the currently active user list
    const activeUserSet = new Set(userIds);
    workingHours = workingHours.filter(wh => activeUserSet.has(wh.user_id));

    // Get existing schedule entries for the date
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const scheduleEntries = await knex('schedule_entries')
      .where({ tenant: tenantId })
      .whereBetween('scheduled_start', [startOfDay.toISOString(), endOfDay.toISOString()])
      .select('entry_id', 'scheduled_start', 'scheduled_end');

    // Get assignees for schedule entries
    const entryIds = scheduleEntries.map((e: any) => e.entry_id);
    const assignees = entryIds.length > 0
      ? await knex('schedule_entry_assignees')
          .where({ tenant: tenantId })
          .whereIn('entry_id', entryIds)
          .whereIn('user_id', userIds)
          .select('entry_id', 'user_id')
      : [];

    // Build a map of entry_id to user_ids
    const entryAssigneeMap = new Map<string, string[]>();
    assignees.forEach((a: any) => {
      if (!entryAssigneeMap.has(a.entry_id)) {
        entryAssigneeMap.set(a.entry_id, []);
      }
      entryAssigneeMap.get(a.entry_id)!.push(a.user_id);
    });

    // Check max appointments per day
    const appointmentCounts = await knex('schedule_entries as se')
      .join('schedule_entry_assignees as sea', function() {
        this.on('se.entry_id', 'sea.entry_id')
            .andOn('se.tenant', 'sea.tenant');
      })
      .where({ 'se.tenant': tenantId })
      .whereBetween('se.scheduled_start', [startOfDay.toISOString(), endOfDay.toISOString()])
      .whereIn('sea.user_id', userIds)
      .groupBy('sea.user_id')
      .select('sea.user_id')
      .count('se.entry_id as count');

    const appointmentCountMap = new Map<string, number>();
    appointmentCounts.forEach((row: any) => {
      appointmentCountMap.set(row.user_id, parseInt(row.count));
    });

    // Get max appointments settings
    const maxAppointmentSettings = await knex('availability_settings')
      .where({
        tenant: tenantId,
        setting_type: 'user_hours',
        day_of_week: dayOfWeek
      })
      .whereIn('user_id', userIds)
      .whereNotNull('max_appointments_per_day')
      .select('user_id', 'max_appointments_per_day');

    const maxAppointmentsMap = new Map<string, number>();
    maxAppointmentSettings.forEach((s: any) => {
      maxAppointmentsMap.set(s.user_id, s.max_appointments_per_day);
    });

    // Filter out users who have reached their daily limit
    userIds = userIds.filter(uid => {
      const maxAppts = maxAppointmentsMap.get(uid);
      if (!maxAppts) return true;
      const currentCount = appointmentCountMap.get(uid) || 0;
      return currentCount < maxAppts;
    });

    if (userIds.length === 0) {
      return [];
    }

    // Sync working hours with the filtered users
    const filteredUserSet = new Set(userIds);
    workingHours = workingHours.filter(wh => filteredUserSet.has(wh.user_id));

    // Generate time slots
    const slots: ITimeSlot[] = [];
    const slotInterval = duration <= 30 ? duration : 30;

    for (const userHours of workingHours) {
      if (!userHours.start_time || !userHours.end_time) continue;

      const [startHour, startMinute] = userHours.start_time.split(':').map(Number);
      const [endHour, endMinute] = userHours.end_time.split(':').map(Number);

      let currentSlotTime = new Date(date);
      currentSlotTime.setHours(startHour, startMinute, 0, 0);

      const endTime = new Date(date);
      endTime.setHours(endHour, endMinute, 0, 0);

      while (currentSlotTime < endTime) {
        const slotEnd = new Date(currentSlotTime);
        slotEnd.setMinutes(slotEnd.getMinutes() + duration);

        // Check if slot end time is within working hours
        if (slotEnd <= endTime) {
          // Check for conflicts with existing schedule entries
          const hasConflict = scheduleEntries.some((entry: any) => {
            const entryStart = new Date(entry.scheduled_start);
            const entryEnd = new Date(entry.scheduled_end);

            // Check if this user is assigned to the entry
            const assignedUsers = entryAssigneeMap.get(entry.entry_id) || [];
            if (!assignedUsers.includes(userHours.user_id)) {
              return false;
            }

            // Apply buffer times
            const bufferBefore = userHours.buffer_before_minutes || 0;
            const bufferAfter = userHours.buffer_after_minutes || 0;

            const bufferedStart = new Date(entryStart);
            bufferedStart.setMinutes(bufferedStart.getMinutes() - bufferBefore);

            const bufferedEnd = new Date(entryEnd);
            bufferedEnd.setMinutes(bufferedEnd.getMinutes() + bufferAfter);

            // Check for overlap
            return (currentSlotTime < bufferedEnd && slotEnd > bufferedStart);
          });

          if (!hasConflict) {
            // Check if this slot already exists
            const existingSlot = slots.find(s =>
              s.start_time === currentSlotTime.toISOString() &&
              s.end_time === slotEnd.toISOString()
            );

            if (existingSlot) {
              // Add user to existing slot
              if (!existingSlot.available_users.includes(userHours.user_id)) {
                existingSlot.available_users.push(userHours.user_id);
              }
            } else {
              // Create new slot
              slots.push({
                start_time: currentSlotTime.toISOString(),
                end_time: slotEnd.toISOString(),
                available_users: [userHours.user_id],
                is_available: true
              });
            }
          }
        }

        // Move to next slot
        currentSlotTime.setMinutes(currentSlotTime.getMinutes() + slotInterval);
      }
    }

    // Filter out slots that don't meet minimum notice hours
    // Calculate minimum booking time in the user's timezone (or UTC if not provided)
    let minBookingTime: Date;

    if (userTimezone) {
      // Get current time in user's timezone
      const nowInUserTZ = new Date().toLocaleString('en-US', { timeZone: userTimezone });
      minBookingTime = new Date(nowInUserTZ);
      minBookingTime.setHours(minBookingTime.getHours() + minNoticeHours);
    } else {
      // Fallback to UTC if no timezone provided
      minBookingTime = new Date();
      minBookingTime.setHours(minBookingTime.getHours() + minNoticeHours);
    }

    const availableSlots = slots.filter(slot => {
      const slotStart = new Date(slot.start_time);
      return slotStart >= minBookingTime;
    });

    // Sort slots by start time
    availableSlots.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    return availableSlots;
  });
}

/**
 * Check if a specific time slot is available
 * @param tenantId - Tenant identifier
 * @param startTime - Start time as ISO string
 * @param duration - Duration in minutes
 * @param userId - Optional specific user to check
 * @returns True if slot is available
 */
export async function isSlotAvailable(
  tenantId: string,
  startTime: string,
  duration: number,
  userId?: string
): Promise<boolean> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    const start = new Date(startTime);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + duration);

    const date = start.toISOString().split('T')[0];
    const dayOfWeek = start.getDay();

    // Check for company-wide exceptions first
    const companyWideException = await knex('availability_exceptions')
      .where({
        tenant: tenantId,
        date: date
      })
      .whereNull('user_id')
      .first();

    // If there's a company-wide "not available" exception, return false
    if (companyWideException && !companyWideException.is_available) {
      return false;
    }

    // Build user query
    let userQuery = knex('availability_settings')
      .where({
        tenant: tenantId,
        setting_type: 'user_hours',
        day_of_week: dayOfWeek,
        is_available: true
      })
      .whereNotNull('user_id')
      .select('user_id', 'start_time', 'end_time', 'buffer_before_minutes', 'buffer_after_minutes');

    if (userId) {
      userQuery = userQuery.where({ user_id: userId });
    }

    const workingHours = await userQuery;

    // Check for user-specific availability exceptions
    const userIds = workingHours.map((wh: any) => wh.user_id);
    const exceptions = await knex('availability_exceptions')
      .where({
        tenant: tenantId,
        date: date
      })
      .whereIn('user_id', userIds)
      .whereNotNull('user_id')
      .select('user_id', 'is_available');

    const unavailableUsers = exceptions
      .filter((ex: any) => !ex.is_available)
      .map((ex: any) => ex.user_id);

    // Check if there are exception-available users for this date
    const exceptionAvailableUsers = await knex('availability_exceptions')
      .where({
        tenant: tenantId,
        date: date,
        is_available: true
      })
      .whereNotNull('user_id')
      .select('user_id');

    // If checking a specific user with an available exception, that takes priority
    if (userId && exceptionAvailableUsers.some((ex: any) => ex.user_id === userId)) {
      // User has an exception making them available - allow the check to proceed
      if (workingHours.length === 0) {
        // Get hours from another day as template
        const alternateHours = await knex('availability_settings')
          .where({
            tenant: tenantId,
            setting_type: 'user_hours',
            user_id: userId,
            is_available: true
          })
          .whereNotNull('start_time')
          .whereNotNull('end_time')
          .first();

        if (alternateHours) {
          workingHours.push(alternateHours);
        }
      }
    }

    if (workingHours.length === 0) {
      return false;
    }

    // Check if at least one user is available during this time
    for (const userHours of workingHours) {
      if (unavailableUsers.includes(userHours.user_id)) {
        continue;
      }

      if (!userHours.start_time || !userHours.end_time) {
        continue;
      }

      // Check if slot is within working hours
      const [whStartHour, whStartMinute] = userHours.start_time.split(':').map(Number);
      const [whEndHour, whEndMinute] = userHours.end_time.split(':').map(Number);

      const whStart = new Date(start);
      whStart.setHours(whStartHour, whStartMinute, 0, 0);

      const whEnd = new Date(start);
      whEnd.setHours(whEndHour, whEndMinute, 0, 0);

      if (start < whStart || end > whEnd) {
        continue;
      }

      // Check for schedule conflicts
      const conflicts = await knex('schedule_entries as se')
        .join('schedule_entry_assignees as sea', function() {
          this.on('se.entry_id', 'sea.entry_id')
              .andOn('se.tenant', 'sea.tenant');
        })
        .where({
          'se.tenant': tenantId,
          'sea.user_id': userHours.user_id
        })
        .where(function() {
          this.where('se.scheduled_start', '<', end.toISOString())
              .andWhere('se.scheduled_end', '>', start.toISOString());
        })
        .select('se.entry_id');

      if (conflicts.length === 0) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Get available dates within a date range
 * @param tenantId - Tenant identifier
 * @param serviceId - Service being scheduled
 * @param startDate - Start of range (YYYY-MM-DD)
 * @param endDate - End of range (YYYY-MM-DD)
 * @param userId - Optional specific user
 * @param userTimezone - Optional IANA timezone (e.g., 'America/New_York') for calculating minimum notice
 * @returns Array of dates with availability info
 */
export async function getAvailableDates(
  tenantId: string,
  serviceId: string,
  startDate: string,
  endDate: string,
  userId?: string,
  userTimezone?: string
): Promise<IAvailableDate[]> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    // Parse dates in UTC to avoid timezone issues
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));

    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

    const results: IAvailableDate[] = [];

    // Get service settings for default duration
    const serviceSettings = await getServiceSettings(knex, tenantId, serviceId);
    const defaultDuration = 60; // Default 1 hour if not specified

    // Iterate through each date in the range
    let currentDate = new Date(start);
    while (currentDate <= end) {
      // Format date in UTC to ensure consistency
      const dateStr = currentDate.toISOString().split('T')[0];

      // Get available slots for this date
      const slots = await getAvailableTimeSlots(
        tenantId,
        dateStr,
        serviceId,
        defaultDuration,
        userId,
        userTimezone
      );

      const hasAvailability = slots.length > 0;

      results.push({
        date: dateStr,
        has_availability: hasAvailability,
        slot_count: slots.length
      });

      // Move to next day (increment UTC date)
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    return results;
  });
}

/**
 * Get services available to a client based on active contracts
 * @param tenantId - Tenant identifier
 * @param clientId - Client identifier
 * @returns Array of services with details
 */
export async function getAvailableServicesForClient(
  tenantId: string,
  clientId: string
): Promise<any[]> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    // Get active contracts for the client
    const today = new Date().toISOString().split('T')[0];

    // First get the contract_id from client_contracts
    const clientContracts = await knex('client_contracts')
      .where({
        tenant: tenantId,
        client_id: clientId,
        is_active: true
      })
      .where('start_date', '<=', today)
      .where(function() {
        this.whereNull('end_date')
            .orWhere('end_date', '>=', today);
      })
      .select('contract_id');

    if (clientContracts.length === 0) {
      return [];
    }

    const contractIds = clientContracts.map(c => c.contract_id);

    // Now get services from the contract lines (contract_lines contains contract_id directly)
    const services = await knex('contract_lines as cl')
      .join('contract_line_services as cls', function() {
        this.on('cl.contract_line_id', 'cls.contract_line_id')
            .andOn('cl.tenant', 'cls.tenant');
      })
      .join('service_catalog as sc', function() {
        this.on('cls.service_id', 'sc.service_id')
            .andOn('cls.tenant', 'sc.tenant');
      })
      .where('cl.tenant', tenantId)
      .whereIn('cl.contract_id', contractIds)
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.description as service_description',
        'sc.billing_method as service_type',
        'sc.default_rate'
      )
      .distinct();

    return services;
  });
}

/**
 * Get services that allow public booking without contracts
 * @param tenantId - Tenant identifier
 * @returns Array of public bookable services
 */
export async function getServicesForPublicBooking(
  tenantId: string
): Promise<any[]> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    const services = await knex('availability_settings as avs')
      .join('service_catalog as sc', function() {
        this.on('avs.service_id', 'sc.service_id')
            .andOn('avs.tenant', 'sc.tenant');
      })
      .where({
        'avs.tenant': tenantId,
        'avs.setting_type': 'service_rules',
        'avs.allow_without_contract': true
      })
      .select(
        'sc.service_id',
        'sc.service_name',
        'sc.description as service_description',
        'sc.billing_method as service_type',
        'sc.default_rate'
      )
      .distinct();

    return services;
  });
}

/**
 * Helper: Get service-specific availability settings
 */
async function getServiceSettings(
  knex: Knex,
  tenantId: string,
  serviceId: string
): Promise<IAvailabilitySetting | null> {
  const setting = await knex('availability_settings')
    .where({
      tenant: tenantId,
      setting_type: 'service_rules',
      service_id: serviceId
    })
    .first();

  return setting || null;
}
