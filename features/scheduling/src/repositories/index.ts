/**
 * Scheduling repository - data access layer for schedules and appointments
 *
 * This repository provides database operations for scheduling.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  ScheduleEntry,
  CreateScheduleEntryInput,
  UpdateScheduleEntryInput,
  ScheduleEntryFilters,
  ScheduleEntryListResponse,
  Appointment,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  AppointmentFilters,
  AppointmentListResponse,
  AvailabilityQuery,
  AvailabilityResult,
  TimeSlot,
} from '../types/index.js';

const SCHEDULE_ENTRIES_TABLE = 'schedule_entries';
const SCHEDULE_ASSIGNEES_TABLE = 'schedule_entry_assignees';
const APPOINTMENTS_TABLE = 'appointments';

/**
 * Create the schedule repository with database connection
 */
export function createScheduleRepository(knex: Knex) {
  return {
    /**
     * Find a schedule entry by ID
     */
    async findEntryById(
      tenantId: string,
      entryId: string
    ): Promise<ScheduleEntry | null> {
      const entry = await knex(SCHEDULE_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id: entryId })
        .first();

      if (!entry) return null;

      // Fetch assigned user IDs
      const assignees = await knex(SCHEDULE_ASSIGNEES_TABLE)
        .where({ entry_id: entryId, tenant: tenantId })
        .select('user_id');

      return {
        ...entry,
        assigned_user_ids: assignees.map((a) => a.user_id),
      };
    },

    /**
     * Find schedule entries matching filters
     */
    async findEntries(
      tenantId: string,
      filters: ScheduleEntryFilters = {}
    ): Promise<ScheduleEntryListResponse> {
      const {
        user_ids,
        work_item_id,
        work_item_type,
        status,
        start_date,
        end_date,
        is_recurring,
        is_private,
        search,
        limit = 50,
        offset = 0,
        orderBy = 'scheduled_start',
        orderDirection = 'asc',
      } = filters;

      let query = knex(SCHEDULE_ENTRIES_TABLE).where({ tenant: tenantId });

      // Apply user filter
      if (user_ids && user_ids.length > 0) {
        query = query
          .join(
            SCHEDULE_ASSIGNEES_TABLE,
            `${SCHEDULE_ENTRIES_TABLE}.entry_id`,
            `${SCHEDULE_ASSIGNEES_TABLE}.entry_id`
          )
          .whereIn(`${SCHEDULE_ASSIGNEES_TABLE}.user_id`, user_ids);
      }

      // Apply work item filter
      if (work_item_id) {
        query = query.where({ work_item_id });
      }

      // Apply work item type filter
      if (work_item_type) {
        query = query.where({ work_item_type });
      }

      // Apply status filter
      if (status) {
        query = query.where({ status });
      }

      // Apply date range filters
      if (start_date) {
        query = query.where('scheduled_end', '>=', start_date);
      }
      if (end_date) {
        query = query.where('scheduled_start', '<=', end_date);
      }

      // Apply recurring filter
      if (is_recurring !== undefined) {
        query = query.where({ is_recurring });
      }

      // Apply private filter
      if (is_private !== undefined) {
        query = query.where({ is_private });
      }

      // Apply search filter
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('title', `%${search}%`)
            .orWhereILike('notes', `%${search}%`);
        });
      }

      // Get total count
      const countResult = await query
        .clone()
        .countDistinct(`${SCHEDULE_ENTRIES_TABLE}.entry_id as count`)
        .first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const entryRows = await query
        .select(`${SCHEDULE_ENTRIES_TABLE}.*`)
        .distinct()
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      // Fetch assignees for each entry
      const entryIds = entryRows.map((e) => e.entry_id);
      const assignees = entryIds.length > 0
        ? await knex(SCHEDULE_ASSIGNEES_TABLE)
            .whereIn('entry_id', entryIds)
            .where({ tenant: tenantId })
            .select('entry_id', 'user_id')
        : [];

      const assigneeMap = assignees.reduce((acc, a) => {
        if (!acc[a.entry_id]) acc[a.entry_id] = [];
        acc[a.entry_id].push(a.user_id);
        return acc;
      }, {} as Record<string, string[]>);

      const entries = entryRows.map((entry) => ({
        ...entry,
        assigned_user_ids: assigneeMap[entry.entry_id] || [],
      }));

      return { entries, total, limit, offset };
    },

    /**
     * Create a new schedule entry
     */
    async createEntry(
      tenantId: string,
      input: CreateScheduleEntryInput
    ): Promise<ScheduleEntry> {
      const { assigned_user_ids, ...entryData } = input;

      const [entry] = await knex(SCHEDULE_ENTRIES_TABLE)
        .insert({
          ...entryData,
          tenant: tenantId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      // Insert assignees
      if (assigned_user_ids.length > 0) {
        await knex(SCHEDULE_ASSIGNEES_TABLE).insert(
          assigned_user_ids.map((user_id) => ({
            entry_id: entry.entry_id,
            user_id,
            tenant: tenantId,
          }))
        );
      }

      return {
        ...entry,
        assigned_user_ids,
      };
    },

    /**
     * Update an existing schedule entry
     */
    async updateEntry(
      tenantId: string,
      input: UpdateScheduleEntryInput
    ): Promise<ScheduleEntry | null> {
      const { entry_id, assigned_user_ids, update_type, ...updateData } = input;

      const [entry] = await knex(SCHEDULE_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      if (!entry) return null;

      // Update assignees if provided
      if (assigned_user_ids !== undefined) {
        await knex(SCHEDULE_ASSIGNEES_TABLE)
          .where({ entry_id, tenant: tenantId })
          .delete();

        if (assigned_user_ids.length > 0) {
          await knex(SCHEDULE_ASSIGNEES_TABLE).insert(
            assigned_user_ids.map((user_id) => ({
              entry_id,
              user_id,
              tenant: tenantId,
            }))
          );
        }
      }

      // Fetch current assignees
      const assignees = await knex(SCHEDULE_ASSIGNEES_TABLE)
        .where({ entry_id, tenant: tenantId })
        .select('user_id');

      return {
        ...entry,
        assigned_user_ids: assignees.map((a) => a.user_id),
      };
    },

    /**
     * Delete a schedule entry
     */
    async deleteEntry(tenantId: string, entryId: string): Promise<boolean> {
      // Delete assignees first
      await knex(SCHEDULE_ASSIGNEES_TABLE)
        .where({ entry_id: entryId, tenant: tenantId })
        .delete();

      const result = await knex(SCHEDULE_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id: entryId })
        .delete();

      return result > 0;
    },

    /**
     * Get availability for users in a date range
     */
    async getAvailability(
      tenantId: string,
      query: AvailabilityQuery
    ): Promise<AvailabilityResult[]> {
      const { user_ids, start_date, end_date } = query;

      // Get all schedule entries for the users in the date range
      const entries = await knex(SCHEDULE_ENTRIES_TABLE)
        .join(
          SCHEDULE_ASSIGNEES_TABLE,
          `${SCHEDULE_ENTRIES_TABLE}.entry_id`,
          `${SCHEDULE_ASSIGNEES_TABLE}.entry_id`
        )
        .where({ [`${SCHEDULE_ENTRIES_TABLE}.tenant`]: tenantId })
        .whereIn(`${SCHEDULE_ASSIGNEES_TABLE}.user_id`, user_ids)
        .where('scheduled_end', '>=', start_date)
        .where('scheduled_start', '<=', end_date)
        .select(
          `${SCHEDULE_ASSIGNEES_TABLE}.user_id`,
          `${SCHEDULE_ENTRIES_TABLE}.scheduled_start`,
          `${SCHEDULE_ENTRIES_TABLE}.scheduled_end`
        );

      // Group entries by user
      const userEntries = entries.reduce((acc, entry) => {
        if (!acc[entry.user_id]) acc[entry.user_id] = [];
        acc[entry.user_id].push({
          start: entry.scheduled_start,
          end: entry.scheduled_end,
        });
        return acc;
      }, {} as Record<string, Array<{ start: Date; end: Date }>>);

      // Calculate availability for each user
      return user_ids.map((user_id) => {
        const busySlots = userEntries[user_id] || [];
        const slots: TimeSlot[] = [];

        // Simple implementation: mark busy times as unavailable
        busySlots.forEach(({ start, end }: { start: Date; end: Date }) => {
          slots.push({
            start,
            end,
            available: false,
            user_id,
          });
        });

        // Calculate total available hours (simplified)
        const totalHours = (end_date.getTime() - start_date.getTime()) / (1000 * 60 * 60);
        const busyHours = busySlots.reduce((sum: number, slot: { start: Date; end: Date }) => {
          return sum + (slot.end.getTime() - slot.start.getTime()) / (1000 * 60 * 60);
        }, 0);

        return {
          user_id,
          slots,
          total_available_hours: totalHours - busyHours,
        };
      });
    },

    /**
     * Find an appointment by ID
     */
    async findAppointmentById(
      tenantId: string,
      appointmentId: string
    ): Promise<Appointment | null> {
      const result = await knex(APPOINTMENTS_TABLE)
        .where({ tenant: tenantId, appointment_id: appointmentId })
        .first();
      return result || null;
    },

    /**
     * Find appointments matching filters
     */
    async findAppointments(
      tenantId: string,
      filters: AppointmentFilters = {}
    ): Promise<AppointmentListResponse> {
      const {
        attendee_user_ids,
        organizer_user_id,
        status,
        start_date,
        end_date,
        is_all_day,
        search,
        limit = 50,
        offset = 0,
        orderBy = 'start_time',
        orderDirection = 'asc',
      } = filters;

      let query = knex(APPOINTMENTS_TABLE).where({ tenant: tenantId });

      // Apply attendee filter (assuming attendees is stored as JSON array)
      if (attendee_user_ids && attendee_user_ids.length > 0) {
        query = query.where((builder) => {
          attendee_user_ids.forEach((userId) => {
            builder.orWhereRaw('attendees @> ?', [JSON.stringify([userId])]);
          });
        });
      }

      // Apply organizer filter
      if (organizer_user_id) {
        query = query.where({ organizer_user_id });
      }

      // Apply status filter
      if (status) {
        query = query.where({ status });
      }

      // Apply date range filters
      if (start_date) {
        query = query.where('end_time', '>=', start_date);
      }
      if (end_date) {
        query = query.where('start_time', '<=', end_date);
      }

      // Apply all-day filter
      if (is_all_day !== undefined) {
        query = query.where({ is_all_day });
      }

      // Apply search filter
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('title', `%${search}%`)
            .orWhereILike('description', `%${search}%`);
        });
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const appointments = await query
        .select('*')
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      return { appointments, total, limit, offset };
    },

    /**
     * Create a new appointment
     */
    async createAppointment(
      tenantId: string,
      input: CreateAppointmentInput
    ): Promise<Appointment> {
      const [appointment] = await knex(APPOINTMENTS_TABLE)
        .insert({
          ...input,
          tenant: tenantId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      return appointment;
    },

    /**
     * Update an existing appointment
     */
    async updateAppointment(
      tenantId: string,
      input: UpdateAppointmentInput
    ): Promise<Appointment | null> {
      const { appointment_id, ...updateData } = input;

      const [appointment] = await knex(APPOINTMENTS_TABLE)
        .where({ tenant: tenantId, appointment_id })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      return appointment || null;
    },

    /**
     * Delete an appointment
     */
    async deleteAppointment(tenantId: string, appointmentId: string): Promise<boolean> {
      const result = await knex(APPOINTMENTS_TABLE)
        .where({ tenant: tenantId, appointment_id: appointmentId })
        .delete();

      return result > 0;
    },
  };
}

// Default export for convenience when used with dependency injection
export const scheduleRepository = {
  create: createScheduleRepository,
};
