/**
 * @alga-psa/scheduling - Schedule Entry Model
 *
 * Data access layer for schedule entry entities.
 * Migrated from server/src/lib/models/scheduleEntry.ts
 *
 * Key changes from original:
 * - Tenant is an explicit parameter (not from getCurrentTenantId)
 * - This decouples the model from Next.js runtime
 * - Class converted to object with methods for consistency
 * - Event publishing removed (should be handled by calling code)
 */

import type { Knex } from 'knex';
import type {
  IScheduleEntry,
  IRecurrencePattern,
  IEditScope,
  CreateScheduleEntryOptions,
} from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Schedule Entry model with tenant-explicit methods.
 * All methods require an explicit tenant parameter for multi-tenant safety.
 */
const ScheduleEntry = {
  /**
   * Helper method to fetch assigned user IDs for schedule entries.
   */
  getAssignedUserIds: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entryIds: (string | undefined)[]
  ): Promise<Record<string, string[]>> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting schedule entry assignees');
    }

    const validEntryIds = entryIds.filter((id): id is string => id !== undefined);

    if (validEntryIds.length === 0) {
      return {};
    }

    // Verify entries exist in the correct tenant
    const validEntries = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .whereIn('entry_id', validEntryIds)
      .select('entry_id');

    const validEntrySet = new Set(validEntries.map(e => e.entry_id));
    const invalidEntryIds = validEntryIds.filter(id => !validEntrySet.has(id));

    if (invalidEntryIds.length > 0) {
      throw new Error(`Schedule entries ${invalidEntryIds.join(', ')} not found in tenant ${tenant}`);
    }

    const assignments = await knexOrTrx('schedule_entry_assignees')
      .where('schedule_entry_assignees.tenant', tenant)
      .whereIn('entry_id', validEntryIds)
      .join('users', function () {
        this.on('schedule_entry_assignees.user_id', '=', 'users.user_id')
          .andOn('schedule_entry_assignees.tenant', '=', 'users.tenant');
      })
      .select('entry_id', 'schedule_entry_assignees.user_id');

    // Group by entry_id
    return assignments.reduce(
      (acc: Record<string, string[]>, curr: { entry_id: string; user_id: string }) => {
        if (!acc[curr.entry_id]) {
          acc[curr.entry_id] = [];
        }
        acc[curr.entry_id].push(curr.user_id);
        return acc;
      },
      {}
    );
  },

  /**
   * Helper method to update assignee records for a schedule entry.
   */
  updateAssignees: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entry_id: string,
    userIds: string[]
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating schedule entry assignees');
    }

    // Verify entry exists in the correct tenant
    const entryExists = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .andWhere('entry_id', entry_id)
      .first();

    if (!entryExists) {
      throw new Error(`Schedule entry ${entry_id} not found in tenant ${tenant}`);
    }

    // Delete existing assignments
    await knexOrTrx('schedule_entry_assignees')
      .where('schedule_entry_assignees.tenant', tenant)
      .andWhere('entry_id', entry_id)
      .del();

    // Insert new assignments
    if (userIds.length > 0) {
      // Verify all users exist in the correct tenant
      const validUsers = await knexOrTrx('users')
        .where('users.tenant', tenant)
        .whereIn('user_id', userIds)
        .select('user_id');

      const validUserIds = validUsers.map(u => u.user_id);
      const invalidUserIds = userIds.filter(id => !validUserIds.includes(id));

      if (invalidUserIds.length > 0) {
        throw new Error(`Users ${invalidUserIds.join(', ')} not found in tenant ${tenant}`);
      }

      const assignments = userIds.map(
        (user_id): { tenant: string; entry_id: string; user_id: string } => ({
          tenant,
          entry_id,
          user_id,
        })
      );
      await knexOrTrx('schedule_entry_assignees').insert(assignments);
    }
  },

  /**
   * Get all schedule entries within a date range.
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    start: Date,
    end: Date
  ): Promise<IScheduleEntry[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting schedule entries');
    }

    // Get all non-virtual entries (both regular and master recurring entries)
    const regularEntries = (await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .whereNull('original_entry_id')
      .andWhere(function () {
        this.whereBetween('scheduled_start', [start, end]).orWhereBetween('scheduled_end', [
          start,
          end,
        ]);
      })
      .select('*')
      .orderBy('scheduled_start', 'asc')) as unknown as IScheduleEntry[];

    if (regularEntries.length === 0) return regularEntries;

    // Get assigned user IDs for all entries
    const entryIds = regularEntries.map((e): string => e.entry_id);
    const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, entryIds);

    // Merge assigned user IDs into entries
    return regularEntries.map(
      (entry): IScheduleEntry => ({
        ...entry,
        assigned_user_ids: entry.assigned_user_ids || assignedUserIds[entry.entry_id] || [],
      })
    );
  },

  /**
   * Get the earliest schedule entry.
   */
  getEarliest: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<IScheduleEntry | undefined> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting earliest schedule entry');
    }

    const entry = (await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .orderBy('scheduled_start', 'asc')
      .first()) as (IScheduleEntry & { entry_id: string }) | undefined;

    if (!entry) return undefined;

    if (entry.entry_id) {
      const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, [
        entry.entry_id,
      ]);
      return {
        ...entry,
        assigned_user_ids: assignedUserIds[entry.entry_id] || [],
      };
    }

    return {
      ...entry,
      assigned_user_ids: [],
    };
  },

  /**
   * Get a single schedule entry by ID.
   */
  get: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entry_id: string
  ): Promise<IScheduleEntry | undefined> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting schedule entry');
    }

    const entry = (await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .andWhere('entry_id', entry_id)
      .first()) as (IScheduleEntry & { entry_id: string }) | undefined;

    if (!entry) return undefined;

    if (entry && entry_id) {
      const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, [entry_id]);
      return {
        ...entry,
        assigned_user_ids: assignedUserIds[entry_id] || [],
      };
    }

    return entry;
  },

  /**
   * Create a new schedule entry.
   */
  create: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entry: Omit<IScheduleEntry, 'entry_id' | 'created_at' | 'updated_at' | 'tenant'>,
    options: CreateScheduleEntryOptions
  ): Promise<IScheduleEntry> => {
    if (!tenant) {
      throw new Error('Tenant context is required for creating schedule entry');
    }

    const entry_id = uuidv4();

    // Prepare entry data
    const entryData = {
      entry_id,
      title: entry.title,
      scheduled_start: entry.scheduled_start,
      scheduled_end: entry.scheduled_end,
      notes: entry.notes,
      status: entry.status || 'scheduled',
      work_item_id: entry.work_item_type === 'ad_hoc' ? null : entry.work_item_id,
      work_item_type: entry.work_item_type,
      tenant,
      recurrence_pattern:
        entry.recurrence_pattern &&
        typeof entry.recurrence_pattern === 'object' &&
        Object.keys(entry.recurrence_pattern).length > 0
          ? JSON.stringify(entry.recurrence_pattern)
          : null,
      is_recurring: !!(
        entry.recurrence_pattern &&
        typeof entry.recurrence_pattern === 'object' &&
        Object.keys(entry.recurrence_pattern).length > 0
      ),
      is_private: entry.is_private || false,
    };

    // Create main entry
    const [createdEntry] = await knexOrTrx('schedule_entries')
      .insert(entryData)
      .returning('*');

    // Create assignee records
    await ScheduleEntry.updateAssignees(knexOrTrx, tenant, createdEntry.entry_id, options.assignedUserIds);

    return {
      ...createdEntry,
      assigned_user_ids: options.assignedUserIds,
    };
  },

  /**
   * Update an existing schedule entry.
   * Note: Recurrence handling for SINGLE/FUTURE/ALL modes should be implemented
   * by the calling code if needed.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entry_id: string,
    entry: Partial<IScheduleEntry> & { assigned_user_ids?: string[] }
  ): Promise<IScheduleEntry | undefined> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating schedule entry');
    }

    // Get the original entry
    const originalEntry = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .andWhere('entry_id', entry_id)
      .first();

    if (!originalEntry) {
      return undefined;
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (entry.title !== undefined) updateData.title = entry.title;
    if (entry.scheduled_start !== undefined) updateData.scheduled_start = entry.scheduled_start;
    if (entry.scheduled_end !== undefined) updateData.scheduled_end = entry.scheduled_end;
    if (entry.notes !== undefined) updateData.notes = entry.notes;
    if (entry.status !== undefined) updateData.status = entry.status;
    if (entry.work_item_id !== undefined) updateData.work_item_id = entry.work_item_id;
    if (entry.work_item_type !== undefined) updateData.work_item_type = entry.work_item_type;
    if (entry.is_private !== undefined) updateData.is_private = entry.is_private;

    if (entry.recurrence_pattern !== undefined) {
      updateData.recurrence_pattern =
        entry.recurrence_pattern &&
        typeof entry.recurrence_pattern === 'object' &&
        Object.keys(entry.recurrence_pattern).length > 0
          ? JSON.stringify(entry.recurrence_pattern)
          : null;
      updateData.is_recurring = !!(
        entry.recurrence_pattern &&
        typeof entry.recurrence_pattern === 'object' &&
        Object.keys(entry.recurrence_pattern).length > 0
      );
    }

    // Update the entry
    const [updatedEntry] = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .andWhere('entry_id', entry_id)
      .update(updateData)
      .returning('*');

    // Update assignees if provided
    if (entry.assigned_user_ids) {
      await ScheduleEntry.updateAssignees(knexOrTrx, tenant, entry_id, entry.assigned_user_ids);
      updatedEntry.assigned_user_ids = entry.assigned_user_ids;
    } else {
      // Get existing assigned user IDs
      const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, [entry_id]);
      updatedEntry.assigned_user_ids = assignedUserIds[entry_id] || [];
    }

    return updatedEntry;
  },

  /**
   * Delete a schedule entry.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entry_id: string
  ): Promise<boolean> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting schedule entry');
    }

    // Delete assignees first (if foreign key constraints require it)
    await knexOrTrx('schedule_entry_assignees')
      .where('schedule_entry_assignees.tenant', tenant)
      .andWhere('entry_id', entry_id)
      .del();

    const deletedCount = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .andWhere('entry_id', entry_id)
      .del();

    return deletedCount > 0;
  },

  /**
   * Get schedule entries by work item.
   */
  getByWorkItem: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    workItemId: string,
    workItemType: string
  ): Promise<IScheduleEntry[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting schedule entries by work item');
    }

    const entries = (await knexOrTrx('schedule_entries')
      .where({
        'schedule_entries.tenant': tenant,
        work_item_id: workItemId,
        work_item_type: workItemType,
      })
      .select('*')
      .orderBy('scheduled_start', 'asc')) as unknown as IScheduleEntry[];

    if (entries.length === 0) return entries;

    // Get assigned user IDs
    const entryIds = entries.map((e): string => e.entry_id);
    const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, entryIds);

    return entries.map(
      (entry): IScheduleEntry => ({
        ...entry,
        assigned_user_ids: assignedUserIds[entry.entry_id] || [],
      })
    );
  },

  /**
   * Get schedule entries by user.
   */
  getByUser: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    userId: string,
    start?: Date,
    end?: Date
  ): Promise<IScheduleEntry[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting schedule entries by user');
    }

    // Get entry IDs assigned to this user
    let assignmentQuery = knexOrTrx('schedule_entry_assignees')
      .where('schedule_entry_assignees.tenant', tenant)
      .andWhere('user_id', userId)
      .select('entry_id');

    const assignmentResult = await assignmentQuery;
    const entryIds = assignmentResult.map(a => a.entry_id);

    if (entryIds.length === 0) return [];

    // Get the actual entries
    let entriesQuery = knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .whereIn('entry_id', entryIds);

    if (start && end) {
      entriesQuery = entriesQuery.andWhere(function () {
        this.whereBetween('scheduled_start', [start, end]).orWhereBetween('scheduled_end', [
          start,
          end,
        ]);
      });
    }

    const entries = (await entriesQuery
      .select('*')
      .orderBy('scheduled_start', 'asc')) as unknown as IScheduleEntry[];

    if (entries.length === 0) return entries;

    // Get all assigned user IDs
    const allEntryIds = entries.map((e): string => e.entry_id);
    const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, allEntryIds);

    return entries.map(
      (entry): IScheduleEntry => ({
        ...entry,
        assigned_user_ids: assignedUserIds[entry.entry_id] || [],
      })
    );
  },

  /**
   * Parse recurrence pattern from string or object.
   */
  parseRecurrencePattern: (
    pattern: string | IRecurrencePattern | null
  ): IRecurrencePattern | null => {
    if (!pattern) return null;
    if (typeof pattern === 'object') return pattern as IRecurrencePattern;
    try {
      return JSON.parse(pattern) as IRecurrencePattern;
    } catch (error) {
      console.error('Error parsing recurrence pattern:', error);
      return null;
    }
  },
};

export default ScheduleEntry;
