// @ts-nocheck
// TODO: CreateScheduleEntryOptions not exported from @alga-psa/types
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
import { generateOccurrences } from '../utils/recurrenceUtils';

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
   * Gets recurring entries within a date range by calculating virtual instances
   * from master recurring entries and their recurrence patterns.
   */
  getRecurringEntriesInRange: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    start: Date,
    end: Date
  ): Promise<IScheduleEntry[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting recurring entries');
    }

    // Get master recurring entries that might have occurrences in the range
    const masterEntries = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .where('is_recurring', true)
      .whereNotNull('recurrence_pattern')
      .whereNull('original_entry_id')
      .where('scheduled_start', '<=', end)
      .andWhere(function () {
        this.where('scheduled_end', '>=', start)
          .orWhereRaw("(recurrence_pattern->>'endDate')::date >= ?", [start])
          .orWhereRaw("(recurrence_pattern->>'endDate') IS NULL");
      })
      .select('*') as unknown as IScheduleEntry[];

    if (masterEntries.length === 0) return [];

    // Only return virtual instances — master entries are already included in getAll()
    return ScheduleEntry.getRecurringEntriesWithAssignments(knexOrTrx, tenant, masterEntries, start, end);
  },

  /**
   * Private helper: generates virtual recurring entries with user assignments.
   */
  getRecurringEntriesWithAssignments: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entries: IScheduleEntry[],
    start: Date,
    end: Date
  ): Promise<IScheduleEntry[]> => {
    const result: IScheduleEntry[] = [];

    // Get assigned user IDs for all master entries
    const entryIds = entries.map((e): string => e.entry_id);
    const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, entryIds);

    for (const entry of entries) {
      if (!entry.recurrence_pattern) continue;

      try {
        // If recurrence_pattern is a string (from DB), parse it
        if (typeof entry.recurrence_pattern === 'string') {
          const pattern = JSON.parse(entry.recurrence_pattern) as IRecurrencePattern;
          if (!pattern || Object.keys(pattern).length === 0) continue;

          pattern.startDate = new Date(pattern.startDate);
          pattern.startDate.setHours(0, 0, 0, 0);

          if (pattern.endDate) {
            pattern.endDate = new Date(pattern.endDate);
            if (pattern.endDate < start) continue;
          }
          if (pattern.exceptions) {
            pattern.exceptions = (pattern.exceptions || []).map((d): Date => new Date(d));
          }
          entry.recurrence_pattern = pattern;
        }

        // Calculate occurrences within the range, respecting endDate
        const effectiveEnd =
          entry.recurrence_pattern.endDate && entry.recurrence_pattern.endDate < end
            ? entry.recurrence_pattern.endDate
            : end;
        const occurrences = generateOccurrences(entry, start, effectiveEnd);

        // Create virtual entries for each occurrence
        const duration =
          new Date(entry.scheduled_end).getTime() - new Date(entry.scheduled_start).getTime();
        const virtualEntries = occurrences
          .filter((occurrence) => {
            const utcDate = new Date(occurrence);
            utcDate.setUTCHours(0, 0, 0, 0);
            return !entry.recurrence_pattern?.exceptions?.some((ex) => {
              const exDate = new Date(ex);
              exDate.setUTCHours(0, 0, 0, 0);
              return exDate.getTime() === utcDate.getTime();
            });
          })
          .map(
            (occurrence): IScheduleEntry => ({
              ...entry,
              entry_id: `${entry.entry_id}_${occurrence.getTime()}`,
              scheduled_start: occurrence,
              scheduled_end: new Date(occurrence.getTime() + duration),
              is_recurring: true,
              original_entry_id: entry.entry_id,
              assigned_user_ids: assignedUserIds[entry.entry_id] || [],
            })
          );

        result.push(...virtualEntries);
      } catch (error) {
        console.error('Error processing recurring entry:', error);
        continue;
      }
    }

    return result;
  },

  /**
   * Get all schedule entries within a date range, including virtual recurring instances.
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

    // Get all non-virtual, non-recurring-master entries.
    // Recurring masters are excluded here because they are represented
    // by the virtual instances generated below — including them would
    // cause a duplicate on the first occurrence day.
    const regularEntries = (await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .whereNull('original_entry_id')
      .andWhere(function () {
        this.where('is_recurring', false).orWhereNull('is_recurring');
      })
      .andWhere(function () {
        this.whereBetween('scheduled_start', [start, end]).orWhereBetween('scheduled_end', [
          start,
          end,
        ]);
      })
      .select('*')
      .orderBy('scheduled_start', 'asc')) as unknown as IScheduleEntry[];

    // Get recurring virtual instances
    const virtualEntries = await ScheduleEntry.getRecurringEntriesInRange(
      knexOrTrx,
      tenant,
      start,
      end
    );

    const allEntries = [...regularEntries, ...virtualEntries];
    if (allEntries.length === 0) return allEntries;

    // Get assigned user IDs for all non-virtual entries
    const entryIds = regularEntries.map((e): string => e.entry_id);
    const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, entryIds);

    // Merge assigned user IDs into entries
    return allEntries.map(
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
   * Update an existing schedule entry with recurrence scope support.
   *
   * updateType controls how recurring entries are modified:
   * - SINGLE: Extract virtual instance to standalone entry, add exception to master
   * - FUTURE: Split series at this point — truncate master, create new master for future
   * - ALL: Update the master entry directly, preserving exceptions
   *
   * For non-recurring entries, updateType is ignored and a simple update is performed.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entry_id: string,
    entry: Partial<IScheduleEntry> & { assigned_user_ids?: string[] },
    updateType?: IEditScope
  ): Promise<IScheduleEntry | undefined> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating schedule entry');
    }

    // Parse entry ID to determine if it's a virtual instance
    const isVirtualId = entry_id.includes('_');
    const [masterId, timestamp] = isVirtualId ? entry_id.split('_') : [entry_id, null];
    const masterEntryId = masterId;
    const virtualTimestamp = timestamp ? new Date(parseInt(timestamp, 10)) : undefined;

    // Get the master entry
    const originalEntry = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .andWhere('entry_id', masterEntryId)
      .first();

    if (!originalEntry) {
      return undefined;
    }

    // Handle recurring entries with scope
    if (originalEntry.recurrence_pattern && updateType) {
      const originalPattern = ScheduleEntry.parseRecurrencePattern(originalEntry.recurrence_pattern);

      if (originalPattern) {
        switch (updateType) {
          case 'single': {
            // SINGLE: Create a standalone concrete entry and add exception to master
            const assignedUserIds = await ScheduleEntry.getAssignedUserIds(
              knexOrTrx,
              tenant,
              [masterEntryId]
            );

            const standaloneId = uuidv4();
            await knexOrTrx('schedule_entries').insert({
              entry_id: standaloneId,
              title: entry.title || originalEntry.title,
              scheduled_start: entry.scheduled_start || originalEntry.scheduled_start,
              scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
              notes: entry.notes || originalEntry.notes,
              status: entry.status || originalEntry.status,
              work_item_id: entry.work_item_id || originalEntry.work_item_id,
              work_item_type: entry.work_item_type || originalEntry.work_item_type,
              tenant,
              is_recurring: false,
              original_entry_id: null,
              recurrence_pattern: null,
              is_private: entry.is_private !== undefined ? entry.is_private : originalEntry.is_private,
            });

            // Copy assignments from master to standalone entry
            await ScheduleEntry.updateAssignees(
              knexOrTrx,
              tenant,
              standaloneId,
              entry.assigned_user_ids || assignedUserIds[masterEntryId] || []
            );

            // Add exception date to master pattern
            const exceptionDate = new Date(entry.scheduled_start || originalEntry.scheduled_start);
            exceptionDate.setUTCHours(0, 0, 0, 0);
            const updatedPattern = {
              ...originalPattern,
              exceptions: [...(originalPattern.exceptions || []), exceptionDate],
            };

            await knexOrTrx('schedule_entries')
              .where('schedule_entries.tenant', tenant)
              .andWhere('entry_id', masterEntryId)
              .update({
                recurrence_pattern: JSON.stringify(updatedPattern),
              });

            return {
              ...originalEntry,
              entry_id: standaloneId,
              title: entry.title || originalEntry.title,
              scheduled_start: entry.scheduled_start || originalEntry.scheduled_start,
              scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
              notes: entry.notes || originalEntry.notes,
              status: entry.status || originalEntry.status,
              work_item_id: entry.work_item_id || originalEntry.work_item_id,
              work_item_type: entry.work_item_type || originalEntry.work_item_type,
              is_recurring: false,
              original_entry_id: null,
              is_private: entry.is_private !== undefined ? entry.is_private : originalEntry.is_private,
              assigned_user_ids: entry.assigned_user_ids || assignedUserIds[masterEntryId] || [],
            };
          }

          case 'future': {
            // FUTURE: Split the recurrence into two series
            if (!virtualTimestamp) {
              throw new Error('Virtual timestamp is required for future updates');
            }

            const newMasterId = uuidv4();

            // Truncate original master to end before the current instance
            const originalEndDate = new Date(virtualTimestamp);
            originalEndDate.setDate(originalEndDate.getDate() - 1);
            originalEndDate.setHours(23, 59, 59, 999);

            const futureOriginalPattern = {
              ...originalPattern,
              endDate: originalEndDate,
              exceptions: originalPattern.exceptions?.filter(
                (d) => new Date(d) < virtualTimestamp
              ),
            };

            await knexOrTrx('schedule_entries')
              .where('schedule_entries.tenant', tenant)
              .andWhere('entry_id', masterEntryId)
              .update({
                recurrence_pattern: JSON.stringify(futureOriginalPattern),
              });

            // Create new master starting at the current instance
            const newStartDate = entry.scheduled_start || virtualTimestamp;
            const newPattern = entry.recurrence_pattern
              ? {
                  ...entry.recurrence_pattern,
                  startDate: newStartDate,
                  exceptions: [],
                }
              : {
                  ...originalPattern,
                  startDate: newStartDate,
                  endDate: originalPattern.endDate,
                  exceptions: originalPattern.exceptions?.filter(
                    (d) => new Date(d) >= virtualTimestamp
                  ),
                };

            const newMasterEntry = {
              entry_id: newMasterId,
              title: entry.title || originalEntry.title,
              scheduled_start: newStartDate,
              scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
              notes: entry.notes || originalEntry.notes,
              status: entry.status || originalEntry.status,
              work_item_id: entry.work_item_id || originalEntry.work_item_id,
              work_item_type: entry.work_item_type || originalEntry.work_item_type,
              tenant,
              recurrence_pattern: JSON.stringify(newPattern),
              is_recurring: true,
              original_entry_id: null,
              is_private: entry.is_private !== undefined ? entry.is_private : originalEntry.is_private,
            };

            await knexOrTrx('schedule_entries').insert(newMasterEntry);

            const masterAssignees = await ScheduleEntry.getAssignedUserIds(
              knexOrTrx,
              tenant,
              [masterEntryId]
            );
            await ScheduleEntry.updateAssignees(
              knexOrTrx,
              tenant,
              newMasterId,
              entry.assigned_user_ids || masterAssignees[masterEntryId] || []
            );

            return {
              ...newMasterEntry,
              assigned_user_ids:
                entry.assigned_user_ids || masterAssignees[masterEntryId] || [],
            } as IScheduleEntry;
          }

          case 'all': {
            // ALL: Update the master entry directly, preserving exceptions
            const allUpdatePattern = entry.recurrence_pattern
              ? {
                  frequency: entry.recurrence_pattern.frequency,
                  interval: entry.recurrence_pattern.interval,
                  startDate: originalPattern.startDate,
                  endDate: entry.recurrence_pattern.endDate || originalPattern.endDate,
                  exceptions: originalPattern.exceptions || [],
                  daysOfWeek: entry.recurrence_pattern.daysOfWeek || originalPattern.daysOfWeek,
                  dayOfMonth: entry.recurrence_pattern.dayOfMonth || originalPattern.dayOfMonth,
                  monthOfYear:
                    entry.recurrence_pattern.monthOfYear || originalPattern.monthOfYear,
                  count: entry.recurrence_pattern.count || originalPattern.count,
                }
              : originalPattern;

            const [updatedMasterEntry] = await knexOrTrx('schedule_entries')
              .where('schedule_entries.tenant', tenant)
              .andWhere('entry_id', masterEntryId)
              .update({
                title: entry.title || originalEntry.title,
                scheduled_start: entry.scheduled_start || originalEntry.scheduled_start,
                scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
                notes: entry.notes || originalEntry.notes,
                status: entry.status || originalEntry.status,
                work_item_id: entry.work_item_id || originalEntry.work_item_id,
                work_item_type: entry.work_item_type || originalEntry.work_item_type,
                recurrence_pattern: JSON.stringify(allUpdatePattern),
                is_recurring: true,
              })
              .returning('*');

            if (entry.assigned_user_ids) {
              await ScheduleEntry.updateAssignees(
                knexOrTrx,
                tenant,
                masterEntryId,
                entry.assigned_user_ids
              );
            }

            const finalAssignees = entry.assigned_user_ids ||
              (await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, [masterEntryId]))[
                masterEntryId
              ] || [];

            return {
              ...updatedMasterEntry,
              assigned_user_ids: finalAssignees,
            };
          }
        }
      }
    }

    // Non-recurring path (or recurring without updateType): simple field update
    // Check if we're removing recurrence from a recurring entry
    const isRemovingRecurrence =
      originalEntry.is_recurring &&
      entry.recurrence_pattern !== undefined &&
      (!entry.recurrence_pattern || Object.keys(entry.recurrence_pattern).length === 0);

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (isRemovingRecurrence) {
      updateData.recurrence_pattern = null;
      updateData.is_recurring = false;
    }

    if (entry.title !== undefined) updateData.title = entry.title;
    if (entry.scheduled_start !== undefined) updateData.scheduled_start = entry.scheduled_start;
    if (entry.scheduled_end !== undefined) updateData.scheduled_end = entry.scheduled_end;
    if (entry.notes !== undefined) updateData.notes = entry.notes;
    if (entry.status !== undefined) updateData.status = entry.status;
    if (entry.work_item_id !== undefined) updateData.work_item_id = entry.work_item_id;
    if (entry.work_item_type !== undefined) updateData.work_item_type = entry.work_item_type;
    if (entry.is_private !== undefined) updateData.is_private = entry.is_private;

    if (entry.recurrence_pattern !== undefined && !isRemovingRecurrence) {
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
      .andWhere('entry_id', masterEntryId)
      .update(updateData)
      .returning('*');

    // Update assignees if provided
    if (entry.assigned_user_ids) {
      await ScheduleEntry.updateAssignees(knexOrTrx, tenant, masterEntryId, entry.assigned_user_ids);
      updatedEntry.assigned_user_ids = entry.assigned_user_ids;
    } else {
      const assignedUserIds = await ScheduleEntry.getAssignedUserIds(knexOrTrx, tenant, [
        masterEntryId,
      ]);
      updatedEntry.assigned_user_ids = assignedUserIds[masterEntryId] || [];
    }

    return updatedEntry;
  },

  /**
   * Delete a schedule entry with recurrence scope support.
   *
   * deleteType controls how recurring entries are removed:
   * - SINGLE (virtual): Add exception date to master pattern
   * - SINGLE (master): Create new master from next occurrence, delete original
   * - FUTURE (virtual): Truncate master series end date to before this instance
   * - FUTURE (master): Delete the entire series
   * - ALL: Delete the master entry entirely
   *
   * For non-recurring entries, deleteType is ignored.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    entry_id: string,
    deleteType?: IEditScope
  ): Promise<boolean> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting schedule entry');
    }

    // Parse entry ID to determine if it's a virtual instance
    const isVirtualId = entry_id.includes('_');
    const [masterId, timestamp] = isVirtualId ? entry_id.split('_') : [entry_id, null];
    const masterEntryId = masterId;
    const virtualTimestamp = timestamp ? new Date(parseInt(timestamp, 10)) : undefined;

    // Get the master entry
    const originalEntry = await knexOrTrx('schedule_entries')
      .where('schedule_entries.tenant', tenant)
      .andWhere('entry_id', masterEntryId)
      .first();

    if (!originalEntry) {
      return false;
    }

    // Handle recurring entries with scope
    if (originalEntry.recurrence_pattern && deleteType) {
      const originalPattern = ScheduleEntry.parseRecurrencePattern(
        originalEntry.recurrence_pattern
      );

      if (originalPattern) {
        switch (deleteType) {
          case 'single': {
            if (virtualTimestamp) {
              // Virtual instance: add exception date to master pattern
              const exceptionDate = new Date(virtualTimestamp);
              exceptionDate.setUTCHours(0, 0, 0, 0);
              const updatedPattern = {
                ...originalPattern,
                exceptions: [...(originalPattern.exceptions || []), exceptionDate],
              };

              await knexOrTrx('schedule_entries')
                .where('schedule_entries.tenant', tenant)
                .andWhere('entry_id', masterEntryId)
                .update({
                  recurrence_pattern: JSON.stringify(updatedPattern),
                });

              return true;
            } else {
              // Master entry: create new master from next occurrence, delete original
              const now = new Date();
              const futureDate = new Date(now);
              futureDate.setFullYear(futureDate.getFullYear() + 1);

              const occurrences = generateOccurrences(
                { ...originalEntry, recurrence_pattern: originalPattern } as IScheduleEntry,
                originalEntry.scheduled_start,
                futureDate
              );

              const masterStartTime = new Date(originalEntry.scheduled_start).getTime();
              const nextOccurrence = occurrences.find(
                (occ) => occ.getTime() > masterStartTime
              );

              if (nextOccurrence) {
                const newMasterId = uuidv4();
                const duration =
                  new Date(originalEntry.scheduled_end).getTime() -
                  new Date(originalEntry.scheduled_start).getTime();

                const exceptionDate = new Date(originalEntry.scheduled_start);
                exceptionDate.setUTCHours(0, 0, 0, 0);

                const newPattern = {
                  ...originalPattern,
                  startDate: nextOccurrence,
                  exceptions: [...(originalPattern.exceptions || []), exceptionDate],
                };

                await knexOrTrx('schedule_entries').insert({
                  entry_id: newMasterId,
                  title: originalEntry.title,
                  scheduled_start: nextOccurrence,
                  scheduled_end: new Date(nextOccurrence.getTime() + duration),
                  notes: originalEntry.notes,
                  status: originalEntry.status,
                  work_item_id: originalEntry.work_item_id,
                  work_item_type: originalEntry.work_item_type,
                  tenant,
                  recurrence_pattern: JSON.stringify(newPattern),
                  is_recurring: true,
                  is_private: originalEntry.is_private,
                });

                // Copy assignees to new master
                const assignedUserIds = await ScheduleEntry.getAssignedUserIds(
                  knexOrTrx,
                  tenant,
                  [masterEntryId]
                );
                await ScheduleEntry.updateAssignees(
                  knexOrTrx,
                  tenant,
                  newMasterId,
                  assignedUserIds[masterEntryId] || []
                );
              }

              // Delete assignees then original master
              await knexOrTrx('schedule_entry_assignees')
                .where('schedule_entry_assignees.tenant', tenant)
                .andWhere('entry_id', masterEntryId)
                .del();

              await knexOrTrx('schedule_entries')
                .where('schedule_entries.tenant', tenant)
                .andWhere('entry_id', masterEntryId)
                .del();

              return true;
            }
          }

          case 'future': {
            if (virtualTimestamp) {
              // Truncate series to end before this instance
              const endDate = new Date(virtualTimestamp);
              endDate.setDate(endDate.getDate() - 1);
              endDate.setHours(23, 59, 59, 999);

              const updatedPattern = {
                ...originalPattern,
                endDate,
                exceptions:
                  originalPattern.exceptions?.filter(
                    (d) => new Date(d) < virtualTimestamp
                  ) || [],
              };

              await knexOrTrx('schedule_entries')
                .where('schedule_entries.tenant', tenant)
                .andWhere('entry_id', masterEntryId)
                .update({
                  recurrence_pattern: JSON.stringify(updatedPattern),
                });

              return true;
            } else {
              // Master entry in FUTURE mode = delete entire series
              await knexOrTrx('schedule_entry_assignees')
                .where('schedule_entry_assignees.tenant', tenant)
                .andWhere('entry_id', masterEntryId)
                .del();

              await knexOrTrx('schedule_entries')
                .where('schedule_entries.tenant', tenant)
                .andWhere('entry_id', masterEntryId)
                .del();

              return true;
            }
          }

          case 'all': {
            // Delete assignees first, then the master entry
            await knexOrTrx('schedule_entry_assignees')
              .where('schedule_entry_assignees.tenant', tenant)
              .andWhere('entry_id', masterEntryId)
              .del();

            const deletedCount = await knexOrTrx('schedule_entries')
              .where('schedule_entries.tenant', tenant)
              .andWhere('entry_id', masterEntryId)
              .del();

            return deletedCount > 0;
          }
        }
      }
    }

    // Non-recurring path: simple delete
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
