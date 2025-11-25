/**
 * Time entry repository - data access layer for time entries
 *
 * This repository provides database operations for time entries.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  TimeEntry,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  TimeEntryFilters,
  TimeEntryListResponse,
  TimeSheet,
  TimeSheetApproval,
} from '../types/index.js';

const TIME_ENTRIES_TABLE = 'time_entries';
const TIME_SHEETS_TABLE = 'time_sheets';

/**
 * Create the time entry repository with database connection
 */
export function createTimeEntryRepository(knex: Knex) {
  return {
    /**
     * Find a time entry by ID
     */
    async findById(
      tenantId: string,
      entryId: string
    ): Promise<TimeEntry | null> {
      const result = await knex(TIME_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id: entryId })
        .first();
      return result || null;
    },

    /**
     * Find time entries matching filters
     */
    async findMany(
      tenantId: string,
      filters: TimeEntryFilters = {}
    ): Promise<TimeEntryListResponse> {
      const {
        user_id,
        work_item_id,
        work_item_type,
        time_sheet_id,
        approval_status,
        start_date,
        end_date,
        service_id,
        is_billable,
        limit = 50,
        offset = 0,
        orderBy = 'start_time',
        orderDirection = 'desc',
      } = filters;

      let query = knex(TIME_ENTRIES_TABLE).where({ tenant: tenantId });

      // Apply filters
      if (user_id) {
        query = query.where({ user_id });
      }

      if (work_item_id) {
        query = query.where({ work_item_id });
      }

      if (work_item_type) {
        query = query.where({ work_item_type });
      }

      if (time_sheet_id) {
        query = query.where({ time_sheet_id });
      }

      if (approval_status) {
        query = query.where({ approval_status });
      }

      if (start_date) {
        query = query.where('start_time', '>=', start_date);
      }

      if (end_date) {
        query = query.where('end_time', '<=', end_date);
      }

      if (service_id) {
        query = query.where({ service_id });
      }

      if (is_billable !== undefined) {
        if (is_billable) {
          query = query.where('billable_duration', '>', 0);
        } else {
          query = query.where('billable_duration', '=', 0);
        }
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const entries = await query
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      return { entries, total, limit, offset };
    },

    /**
     * Create a new time entry
     */
    async create(
      tenantId: string,
      userId: string,
      input: CreateTimeEntryInput
    ): Promise<TimeEntry> {
      const now = new Date().toISOString();

      const [entry] = await knex(TIME_ENTRIES_TABLE)
        .insert({
          ...input,
          user_id: userId,
          tenant: tenantId,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      return entry;
    },

    /**
     * Update an existing time entry
     */
    async update(
      tenantId: string,
      input: UpdateTimeEntryInput
    ): Promise<TimeEntry | null> {
      const { entry_id, ...updateData } = input;

      const [entry] = await knex(TIME_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id })
        .update({
          ...updateData,
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      return entry || null;
    },

    /**
     * Delete a time entry
     */
    async delete(tenantId: string, entryId: string): Promise<boolean> {
      const result = await knex(TIME_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id: entryId })
        .delete();

      return result > 0;
    },

    /**
     * Start time tracking for a work item
     * Creates a time entry with start_time but no end_time
     */
    async startTracking(
      tenantId: string,
      userId: string,
      workItemId: string,
      workItemType: string,
      options?: { notes?: string; service_id?: string }
    ): Promise<TimeEntry> {
      const now = new Date().toISOString();

      const [entry] = await knex(TIME_ENTRIES_TABLE)
        .insert({
          work_item_id: workItemId,
          work_item_type: workItemType,
          start_time: now,
          end_time: now, // Will be updated when stopped
          billable_duration: 0, // Will be calculated when stopped
          notes: options?.notes || '',
          user_id: userId,
          tenant: tenantId,
          approval_status: 'DRAFT',
          service_id: options?.service_id,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      return entry;
    },

    /**
     * Stop time tracking for an entry
     * Updates end_time and calculates billable_duration
     */
    async stopTracking(
      tenantId: string,
      entryId: string,
      options?: { billable_duration?: number; notes?: string }
    ): Promise<TimeEntry | null> {
      const now = new Date().toISOString();

      // Get the entry to calculate duration if not provided
      const entry = await this.findById(tenantId, entryId);
      if (!entry) {
        return null;
      }

      const startTime = new Date(entry.start_time);
      const endTime = new Date(now);
      const calculatedDuration = Math.round((endTime.getTime() - startTime.getTime()) / 60000); // minutes

      const [updated] = await knex(TIME_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id: entryId })
        .update({
          end_time: now,
          billable_duration: options?.billable_duration ?? calculatedDuration,
          notes: options?.notes !== undefined ? options.notes : entry.notes,
          updated_at: now,
        })
        .returning('*');

      return updated || null;
    },

    /**
     * Approve a time entry
     */
    async approve(
      tenantId: string,
      entryId: string,
      approverId: string
    ): Promise<TimeEntry | null> {
      const [entry] = await knex(TIME_ENTRIES_TABLE)
        .where({ tenant: tenantId, entry_id: entryId })
        .update({
          approval_status: 'APPROVED',
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      return entry || null;
    },

    /**
     * Get time entries for a time sheet
     */
    async findByTimeSheet(
      tenantId: string,
      timeSheetId: string
    ): Promise<TimeEntry[]> {
      return knex(TIME_ENTRIES_TABLE)
        .where({ tenant: tenantId, time_sheet_id: timeSheetId })
        .orderBy('start_time', 'desc');
    },

    /**
     * Get active tracking entry for a user (entry with same start and end time)
     */
    async findActiveTracking(
      tenantId: string,
      userId: string
    ): Promise<TimeEntry | null> {
      // An active tracking entry has billable_duration of 0 and DRAFT status
      const result = await knex(TIME_ENTRIES_TABLE)
        .where({
          tenant: tenantId,
          user_id: userId,
          billable_duration: 0,
          approval_status: 'DRAFT'
        })
        .whereRaw('start_time = end_time')
        .orderBy('created_at', 'desc')
        .first();

      return result || null;
    },
  };
}

/**
 * Create the time sheet repository
 */
export function createTimeSheetRepository(knex: Knex) {
  return {
    /**
     * Find a time sheet by ID
     */
    async findById(
      tenantId: string,
      timeSheetId: string
    ): Promise<TimeSheet | null> {
      const result = await knex(TIME_SHEETS_TABLE)
        .where({ tenant: tenantId, id: timeSheetId })
        .first();
      return result || null;
    },

    /**
     * Find or create a time sheet for a user and period
     */
    async findOrCreate(
      tenantId: string,
      userId: string,
      periodId: string
    ): Promise<TimeSheet> {
      // Try to find existing
      let timeSheet = await knex(TIME_SHEETS_TABLE)
        .where({ tenant: tenantId, user_id: userId, period_id: periodId })
        .first();

      if (timeSheet) {
        return timeSheet;
      }

      // Create new
      const [created] = await knex(TIME_SHEETS_TABLE)
        .insert({
          user_id: userId,
          period_id: periodId,
          tenant: tenantId,
          approval_status: 'DRAFT',
        })
        .returning('*');

      return created;
    },

    /**
     * Submit a time sheet for approval
     */
    async submit(
      tenantId: string,
      timeSheetId: string
    ): Promise<TimeSheet | null> {
      const [timeSheet] = await knex(TIME_SHEETS_TABLE)
        .where({ tenant: tenantId, id: timeSheetId })
        .update({
          approval_status: 'SUBMITTED',
          submitted_at: new Date().toISOString(),
        })
        .returning('*');

      return timeSheet || null;
    },

    /**
     * Approve a time sheet
     */
    async approve(
      tenantId: string,
      timeSheetId: string,
      approverId: string
    ): Promise<TimeSheet | null> {
      const [timeSheet] = await knex(TIME_SHEETS_TABLE)
        .where({ tenant: tenantId, id: timeSheetId })
        .update({
          approval_status: 'APPROVED',
          approved_at: new Date().toISOString(),
          approved_by: approverId,
        })
        .returning('*');

      return timeSheet || null;
    },
  };
}

// Default exports for convenience
export const timeEntryRepository = {
  create: createTimeEntryRepository,
};

export const timeSheetRepository = {
  create: createTimeSheetRepository,
};
