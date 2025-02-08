import { createTenantKnex } from '../db';
import { IScheduleEntry, IRecurrencePattern } from '@/interfaces/schedule.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { generateOccurrences } from '../utils/recurrenceUtils';
import { Knex } from 'knex';

interface CreateScheduleEntryOptions {
  assignedUserIds: string[];  // Make required since it's the only way to assign users now
}

class ScheduleEntry {
  /**
   * Helper method to fetch assigned user IDs for schedule entries
   */
  private static async getAssignedUserIds(db: Knex, tenant: string, entryIds: (string | undefined)[]): Promise<Record<string, string[]>> {
    // Filter out undefined entry IDs
    const validEntryIds = entryIds.filter((id): id is string => id !== undefined);
    
    if (validEntryIds.length === 0) {
      return {};
    }

    const assignments = await db('schedule_entry_assignees')
      .where({ tenant })
      .whereIn('entry_id', validEntryIds)
      .select('entry_id', 'user_id');
    
    // Group by entry_id
    return assignments.reduce((acc: Record<string, string[]>, curr: { entry_id: string; user_id: string }) => {
      if (!acc[curr.entry_id]) {
        acc[curr.entry_id] = [];
      }
      acc[curr.entry_id].push(curr.user_id);
      return acc;
    }, {});
  }

  /**
   * Helper method to update assignee records for a schedule entry
   */
  private static async updateAssignees(db: Knex, tenant: string, entry_id: string, userIds: string[]): Promise<void> {
    // Delete existing assignments
    await db('schedule_entry_assignees')
      .where({ tenant, entry_id })
      .del();

    // Insert new assignments
    if (userIds.length > 0) {
      const assignments = userIds.map((user_id): { tenant: string; entry_id: string; user_id: string; } => ({
        tenant,
        entry_id,
        user_id,
      }));
      await db('schedule_entry_assignees').insert(assignments);
    }
  }

  static async getAll(start: Date, end: Date): Promise<IScheduleEntry[]> {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant is required');
    }
    
    // Get all non-virtual entries (both regular and master recurring entries)
    const regularEntries = await db('schedule_entries')
      .where({ tenant })
      .whereNull('original_entry_id') // This ensures we get master entries but not virtual instances
      .andWhere(function() {
        // And fall within our date range
        this.whereBetween('scheduled_start', [start, end])
          .orWhereBetween('scheduled_end', [start, end]);
      })
      .select('*')
      .orderBy('scheduled_start', 'asc') as unknown as IScheduleEntry[];

    console.log('[ScheduleEntry.getAll] Query parameters:', {
      start: start.toISOString(),
      end: end.toISOString()
    });

    console.log('[ScheduleEntry.getAll] Regular entries:', {
      count: regularEntries.length,
      entries: regularEntries.map((e): { id: string; title: string; start: Date; isRecurring: boolean; hasPattern: boolean; } => ({
        id: e.entry_id,
        title: e.title,
        start: e.scheduled_start,
        isRecurring: !!e.is_recurring,
        hasPattern: !!e.recurrence_pattern
      }))
    });

    // Get recurring entries (virtual instances only)
    const virtualEntries = await this.getRecurringEntriesInRange(start, end);
    
    console.log('[ScheduleEntry.getAll] Virtual entries:', {
      count: virtualEntries.length,
      entries: virtualEntries.map((e): { id: string; title: string; start: Date; originalId: string | undefined; } => ({
        id: e.entry_id,
        title: e.title,
        start: e.scheduled_start,
        originalId: e.original_entry_id
      }))
    });

    const allEntries = [...regularEntries, ...virtualEntries];
    if (allEntries.length === 0) return allEntries;

    // Get assigned user IDs for all non-virtual entries
    const entryIds = regularEntries.map((e): string => e.entry_id);
    const assignedUserIds = await this.getAssignedUserIds(db, tenant, entryIds);

    // Merge assigned user IDs into entries
    const finalEntries = allEntries.map((entry): IScheduleEntry => ({
      ...entry,
      // For recurring entries, assigned_user_ids is already populated
      assigned_user_ids: entry.assigned_user_ids || assignedUserIds[entry.entry_id] || []
    }));

    console.log('[ScheduleEntry.getAll] Final entries:', {
      total: finalEntries.length,
      regularCount: regularEntries.length,
      virtualCount: virtualEntries.length,
      entries: finalEntries.map((e): { id: string; title: string; start: Date; isVirtual: boolean; originalId: string | undefined; } => ({
        id: e.entry_id,
        title: e.title,
        start: e.scheduled_start,
        isVirtual: e.entry_id.includes('_'),
        originalId: e.original_entry_id
      }))
    });

    return finalEntries;
  }

  static async getEarliest(): Promise<IScheduleEntry | undefined> {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant is required');
    }
    const entry = await db('schedule_entries')
      .where({ tenant })
      .orderBy('scheduled_start', 'asc')
      .first() as (IScheduleEntry & { entry_id: string }) | undefined;

    if (!entry) return undefined;

    // Get assigned user IDs if entry_id exists
    if (entry.entry_id) {
      const assignedUserIds = await this.getAssignedUserIds(db, tenant, [entry.entry_id]);
      return {
        ...entry,
        assigned_user_ids: assignedUserIds[entry.entry_id] || []
      };
    }
    
    return {
      ...entry,
      assigned_user_ids: []
    };
  }

  static async get(entry_id: string): Promise<IScheduleEntry | undefined> {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant is required');
    }
    const entry = await db('schedule_entries')
      .where({ tenant, entry_id })
      .first() as (IScheduleEntry & { entry_id: string }) | undefined;
    
    if (!entry) return undefined;

    // Get assigned user IDs if entry exists
    if (entry && entry_id) {
      const assignedUserIds = await this.getAssignedUserIds(db, tenant, [entry_id]);
      return {
        ...entry,
        assigned_user_ids: assignedUserIds[entry_id] || []
      };
    }
    
    return entry;
  }

  static async create(
    entry: Omit<IScheduleEntry, 'entry_id' | 'created_at' | 'updated_at' | 'tenant'>,
    options: CreateScheduleEntryOptions
  ): Promise<IScheduleEntry> {
    if (options.assignedUserIds.length === 0) {
      throw new Error('At least one assigned user is required');
    }

    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Start transaction
    const trx = await db.transaction();
    
    try {
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
        recurrence_pattern: (entry.recurrence_pattern && typeof entry.recurrence_pattern === 'object' && Object.keys(entry.recurrence_pattern).length > 0)
          ? JSON.stringify(entry.recurrence_pattern)
          : null,
        is_recurring: !!(entry.recurrence_pattern && typeof entry.recurrence_pattern === 'object' && Object.keys(entry.recurrence_pattern).length > 0)
      };

      console.log('Creating schedule entry:', entryData);

      // Create main entry with only valid columns
      const [createdEntry] = await trx('schedule_entries')
        .insert(entryData)
        .returning('*');

      console.log('Created schedule entry:', createdEntry);

      // Create assignee records
      await this.updateAssignees(trx, tenant, createdEntry.entry_id, options.assignedUserIds);

      await trx.commit();

      return {
        ...createdEntry,
        assigned_user_ids: options.assignedUserIds
      };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  static async update(
    entry_id: string, 
    entry: Partial<IScheduleEntry> & { assigned_user_ids?: string[] },
    updateType: 'single' | 'future' | 'all'
  ): Promise<IScheduleEntry | undefined> {
    console.log('[ScheduleEntry.update] Starting update:', {
      entry_id,
      updateType,
      providedFields: Object.keys(entry)
    });

    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Start transaction
    const trx = await db.transaction();
    console.log('[ScheduleEntry.update] Transaction started');
    
    try {
      // Parse entry ID and determine if it's a virtual instance
      const isVirtualId = entry_id.includes('_');
      const [masterId, timestamp] = isVirtualId ? entry_id.split('_') : [entry_id, null];
      const masterEntryId = masterId;
      const virtualTimestamp = timestamp ? new Date(parseInt(timestamp, 10)) : undefined;

      if (isVirtualId) {
        console.log('[ScheduleEntry.update] Parsed virtual instance:', {
          virtualId: entry_id,
          masterId,
          timestamp: virtualTimestamp
        });
      }

      // Get the master entry
      console.log('[ScheduleEntry.update] Fetching master entry:', { masterEntryId });
      const originalEntry = await trx('schedule_entries')
        .where({ tenant, entry_id: masterEntryId })
        .first();

      if (!originalEntry) {
        console.log('[ScheduleEntry.update] Master entry not found:', { masterEntryId });
        await trx.rollback();
        return undefined;
      }

      console.log('[ScheduleEntry.update] Found master entry:', {
        masterEntryId,
        hasRecurrencePattern: !!originalEntry.recurrence_pattern,
        isRecurring: originalEntry.is_recurring,
        scheduledStart: originalEntry.scheduled_start
      });

      // Helper function to safely parse recurrence pattern
      const parseRecurrencePattern = (pattern: string | IRecurrencePattern | null): IRecurrencePattern | null => {
        if (!pattern) return null;
        if (typeof pattern === 'object') return pattern as IRecurrencePattern;
        try {
          return JSON.parse(pattern) as IRecurrencePattern;
        } catch (error) {
          console.error('Error parsing recurrence pattern:', error);
          return null;
        }
      };

      // Handle different recurrence update types
      if (originalEntry.recurrence_pattern) {
        const originalPattern = parseRecurrencePattern(originalEntry.recurrence_pattern);
        
        if (originalPattern) {
          // Initialize update data with tenant first
          let updateData: Partial<IScheduleEntry & { tenant: string }> = {
            tenant
          };

          switch (updateType) {
            case 'single':
              // Get assigned user IDs for the master entry
              const assignedUserIds = await this.getAssignedUserIds(trx, tenant, [masterEntryId]);
              
              // 1. Create concrete standalone entry
              const standaloneId = uuidv4();
              await trx('schedule_entries').insert({
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
                recurrence_pattern: null
              });

              // Copy assignments from master to standalone entry
              await this.updateAssignees(
                trx,
                tenant,
                standaloneId,
                entry.assigned_user_ids || assignedUserIds[masterEntryId] || []
              );

              // 2. Add UTC exception to master pattern
              const exceptionDate = new Date(entry.scheduled_start || originalEntry.scheduled_start);
              exceptionDate.setUTCHours(0, 0, 0, 0);
              const singleUpdatedPattern = {
                ...originalPattern,
                exceptions: [...(originalPattern.exceptions || []), exceptionDate]
              };

              await trx('schedule_entries')
                .where({ tenant, entry_id: masterEntryId })
                .update({
                  recurrence_pattern: JSON.stringify(singleUpdatedPattern)
                });

              // 3. Return new standalone entry
              await trx.commit();
              return {
                ...originalEntry,
                entry_id: standaloneId,
                scheduled_start: entry.scheduled_start || originalEntry.scheduled_start,
                scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
                is_recurring: false,
                original_entry_id: null,
                assigned_user_ids: entry.assigned_user_ids || assignedUserIds[masterEntryId] || []
              };

            case 'future':
              if (!virtualTimestamp) {
                throw new Error('Virtual timestamp is required for future updates');
              }
              // Split the recurrence into two series
              const newMasterId = uuidv4();
              
              // 1. Update original master entry to end before the current instance
              const originalEndDate = new Date(virtualTimestamp);
              originalEndDate.setDate(originalEndDate.getDate() - 1); // Previous day
              originalEndDate.setHours(23, 59, 59, 999); // End of previous day in local time
              
              const futureOriginalPattern = {
                ...originalPattern,
                endDate: originalEndDate,
                exceptions: originalPattern.exceptions?.filter(d => new Date(d) < virtualTimestamp)
              };
              
              await trx('schedule_entries')
                .where({ tenant, entry_id: masterEntryId })
                .update({
                  recurrence_pattern: JSON.stringify(futureOriginalPattern)
                });

              // 2. Create new master starting at current instance with fresh ID
              const newStartDate = entry.scheduled_start || virtualTimestamp;
              // Create new pattern with all changes from the entry update
              const newPattern = entry.recurrence_pattern ? {
                ...entry.recurrence_pattern,
                startDate: newStartDate,
                exceptions: [] // Start fresh with no exceptions for the new series
              } : {
                ...originalPattern,
                startDate: newStartDate,
                endDate: originalPattern.endDate,
                exceptions: originalPattern.exceptions?.filter(d => new Date(d) >= virtualTimestamp)
              };

              const newMasterEntry = {
                ...originalEntry,
                entry_id: newMasterId,
                original_entry_id: null, // Reset original ID for new series
                title: entry.title || originalEntry.title,
                scheduled_start: newStartDate,
                scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
                notes: entry.notes || originalEntry.notes,
                status: entry.status || originalEntry.status,
                work_item_id: entry.work_item_id || originalEntry.work_item_id,
                work_item_type: entry.work_item_type || originalEntry.work_item_type,
                tenant,
                recurrence_pattern: JSON.stringify(newPattern),
                is_recurring: true
              };

              await trx('schedule_entries').insert(newMasterEntry);
              await this.updateAssignees(trx, tenant, newMasterId, 
                entry.assigned_user_ids || originalEntry.assigned_user_ids);
              
              await trx.commit();
              return {
                ...newMasterEntry,
                assigned_user_ids: entry.assigned_user_ids || originalEntry.assigned_user_ids
              };

            case 'all':
              // Update all fields including the recurrence pattern
              const allUpdatePattern = entry.recurrence_pattern ? {
                ...originalPattern,
                ...entry.recurrence_pattern,
                startDate: entry.scheduled_start || originalPattern.startDate,
                exceptions: originalPattern.exceptions || []
              } : originalPattern;

              // Update the entry with all changes
              const [updatedMasterEntry] = await trx('schedule_entries')
                .where({ tenant, entry_id: masterEntryId })
                .update({
                  title: entry.title || originalEntry.title,
                  scheduled_start: entry.scheduled_start || originalEntry.scheduled_start,
                  scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
                  notes: entry.notes || originalEntry.notes,
                  status: entry.status || originalEntry.status,
                  work_item_id: entry.work_item_id || originalEntry.work_item_id,
                  work_item_type: entry.work_item_type || originalEntry.work_item_type,
                  recurrence_pattern: entry.recurrence_pattern ? JSON.stringify({
                    frequency: entry.recurrence_pattern.frequency,
                    interval: entry.recurrence_pattern.interval,
                    startDate: originalPattern.startDate, // Keep original start date to preserve existing events
                    endDate: entry.recurrence_pattern.endDate || originalPattern.endDate,
                    exceptions: originalPattern.exceptions || [],
                    daysOfWeek: entry.recurrence_pattern.daysOfWeek || originalPattern.daysOfWeek,
                    dayOfMonth: entry.recurrence_pattern.dayOfMonth || originalPattern.dayOfMonth,
                    monthOfYear: entry.recurrence_pattern.monthOfYear || originalPattern.monthOfYear,
                    count: entry.recurrence_pattern.count || originalPattern.count
                  }) : JSON.stringify(originalPattern),
                  is_recurring: true
                })
                .returning('*');

              // Update assignees if provided
              if (entry.assigned_user_ids) {
                await this.updateAssignees(trx, tenant, masterEntryId, entry.assigned_user_ids);
              }

              await trx.commit();
              return {
                ...updatedMasterEntry,
                assigned_user_ids: entry.assigned_user_ids || originalEntry.assigned_user_ids
              };
          }
        }
      }

      // Check if we're removing recurrence from a recurring entry
      const isRemovingRecurrence = (originalEntry.is_recurring && 
        entry.recurrence_pattern !== undefined && 
        (!entry.recurrence_pattern || Object.keys(entry.recurrence_pattern).length === 0)) || isVirtualId;

      // Initialize update data
      const updateData: Partial<IScheduleEntry & { tenant: string }> = {
        tenant
      };

      // If removing recurrence, handle cleanup
      if (isRemovingRecurrence) {
        console.log('[ScheduleEntry] Recurrence removal requested:', {
          entryId: entry_id,
          isVirtualInstance: !!originalEntry.originalEntryId,
          originalEntryId: originalEntry.originalEntryId,
          scheduledStart: originalEntry.scheduled_start,
          currentPattern: originalEntry.recurrence_pattern
        });

        // For virtual instances, use the parsed master ID and timestamp
        if (isVirtualId && virtualTimestamp) {
          // For virtual instances in 'future' mode, we handle this in the 'future' case
          // No need to create additional entries here
          return undefined;
        } else {
          console.log('[ScheduleEntry] Removing recurrence from master entry:', {
            masterEntryId: entry_id,
            scheduledStart: originalEntry.scheduled_start,
            originalPattern: originalEntry.recurrence_pattern
          });

          // This is a master entry - simply clear the recurrence pattern
          console.log('[ScheduleEntry] Clearing recurrence for master entry:', {
            masterEntryId: entry_id
          });
          updateData.recurrence_pattern = null;
          updateData.is_recurring = false;

          console.log('[ScheduleEntry] Final update data for master:', {
            masterEntryId: entry_id,
            recurrencePattern: updateData.recurrence_pattern,
            isRecurring: updateData.is_recurring
          });
        }
      }

      // Only proceed with general updates if we haven't already handled a virtual instance
      if (entry.title !== undefined) updateData.title = entry.title;
      if (entry.scheduled_start !== undefined) updateData.scheduled_start = entry.scheduled_start;
      if (entry.scheduled_end !== undefined) updateData.scheduled_end = entry.scheduled_end;
      if (entry.notes !== undefined) updateData.notes = entry.notes;
      if (entry.status !== undefined) updateData.status = entry.status;
      if (entry.work_item_id !== undefined) updateData.work_item_id = entry.work_item_id;
      if (entry.work_item_type !== undefined) updateData.work_item_type = entry.work_item_type;
      if (entry.recurrence_pattern !== undefined) {
        // Only stringify if it's a valid recurrence pattern object
        if (entry.work_item_type !== undefined) updateData.work_item_type = entry.work_item_type;
        if (entry.recurrence_pattern !== undefined) {
          // Assign the object directly instead of stringifying it
          updateData.recurrence_pattern = entry.recurrence_pattern && typeof entry.recurrence_pattern === 'object' && Object.keys(entry.recurrence_pattern).length > 0
            ? entry.recurrence_pattern
            : null;
        }
        updateData.is_recurring = !!(entry.recurrence_pattern && typeof entry.recurrence_pattern === 'object' && Object.keys(entry.recurrence_pattern).length > 0);
      }

      // For virtual instances, handle the update differently
      if (isVirtualId) {
        console.log('[ScheduleEntry.update] Processing virtual instance update:', {
          virtualId: entry_id,
          masterEntryId,
          virtualTimestamp,
          isRemovingRecurrence
        });

        // Get assigned user IDs for the master entry
        console.log('[ScheduleEntry.update] Fetching assigned users for virtual instance');
        const assignedUserIds = await this.getAssignedUserIds(trx, tenant, [masterEntryId]);

        // If removing recurrence, update the master pattern
        if (isRemovingRecurrence && virtualTimestamp) {
          console.log('[ScheduleEntry.update] Updating master pattern for virtual instance');
          const masterPattern = parseRecurrencePattern(originalEntry.recurrence_pattern);
          if (masterPattern) {
            const oldEndDate = masterPattern.endDate;
            masterPattern.endDate = virtualTimestamp;
            
            console.log('[ScheduleEntry.update] Updating master pattern:', {
              masterEntryId,
              oldEndDate,
              newEndDate: masterPattern.endDate,
              frequency: masterPattern.frequency,
              interval: masterPattern.interval
            });

            await trx('schedule_entries')
              .where({ tenant, entry_id: masterEntryId })
              .update({
                recurrence_pattern: JSON.stringify(masterPattern)
              });
            
            console.log('[ScheduleEntry.update] Master pattern updated successfully');
          } else {
            console.log('[ScheduleEntry.update] No valid pattern found for virtual instance');
          }
        }

        // Create virtual entry with updated data
        const virtualEntry: IScheduleEntry = {
          ...originalEntry,
          entry_id, // Keep the virtual ID
          scheduled_start: entry.scheduled_start || originalEntry.scheduled_start,
          scheduled_end: entry.scheduled_end || originalEntry.scheduled_end,
          is_recurring: true,
          original_entry_id: masterEntryId,
          // Use provided assigned users or inherit from master
          assigned_user_ids: entry.assigned_user_ids || assignedUserIds[masterEntryId] || []
        };

        console.log('[ScheduleEntry.update] Virtual entry prepared:', {
          virtualId: virtualEntry.entry_id,
          masterId: virtualEntry.original_entry_id,
          scheduledStart: virtualEntry.scheduled_start,
          scheduledEnd: virtualEntry.scheduled_end,
          assignedUsers: virtualEntry.assigned_user_ids.length
        });

        await trx.commit();
        return virtualEntry;
      } else {
        // For real entries, update the database
        console.log('[ScheduleEntry.update] Updating real entry:', {
          entryId: entry_id,
          updateData
        });

        const [updatedEntry] = await trx('schedule_entries')
          .where({ tenant, entry_id })
          .update(updateData)
          .returning('*');

        console.log('[ScheduleEntry.update] Database update complete:', {
          entryId: updatedEntry.entry_id,
          isRecurring: updatedEntry.is_recurring,
          hasPattern: !!updatedEntry.recurrence_pattern
        });

        // Update assignees if provided
        if (entry.assigned_user_ids) {
          console.log('[ScheduleEntry.update] Updating assignees:', {
            entryId: entry_id,
            newAssignees: entry.assigned_user_ids
          });
          await this.updateAssignees(trx, tenant, entry_id, entry.assigned_user_ids);
          updatedEntry.assigned_user_ids = entry.assigned_user_ids;
        } else {
          // Get existing assigned user IDs
          console.log('[ScheduleEntry.update] Fetching existing assignees');
          const assignedUserIds = await this.getAssignedUserIds(trx, tenant, [entry_id]);
          updatedEntry.assigned_user_ids = assignedUserIds[entry_id] || [];
        }

        console.log('[ScheduleEntry.update] Committing real entry update');
        await trx.commit();

        console.log('[ScheduleEntry.update] Update complete:', {
          entryId: updatedEntry.entry_id,
          scheduledStart: updatedEntry.scheduled_start,
          scheduledEnd: updatedEntry.scheduled_end,
          isRecurring: updatedEntry.is_recurring,
          assignedUsers: updatedEntry.assigned_user_ids
        });

        return updatedEntry;
      }
    } catch (error) {
      console.error('[ScheduleEntry.update] Error during update:', {
        error,
        entry_id,
        isVirtual: entry_id.includes('_')
      });
      await trx.rollback();
      throw error;
    }
  }

  /**
   * Gets recurring entries within a date range by calculating occurrences from the recurrence pattern
   */
  private static async getRecurringEntriesWithAssignments(
    db: Knex,
    entries: IScheduleEntry[],
    start: Date,
    end: Date
  ): Promise<IScheduleEntry[]> {
    const result: IScheduleEntry[] = [];
    
    // Get assigned user IDs for all master entries
    const entryIds = entries.map((e): string => e.entry_id);
    if (!entries[0]?.tenant) {
      throw new Error('Tenant is required');
    }
    const assignedUserIds = await this.getAssignedUserIds(db, entries[0].tenant, entryIds);

    // Process each recurring entry
    for (const entry of entries) {
      // Skip if no recurrence pattern or if it's empty
      if (!entry.recurrence_pattern) continue;

      try {
        // If recurrence_pattern is a string (from DB), parse it
        if (typeof entry.recurrence_pattern === 'string') {
          const pattern = JSON.parse(entry.recurrence_pattern) as IRecurrencePattern;
          // Skip if pattern is empty
          if (!pattern || Object.keys(pattern).length === 0) continue;
          
          // Convert date strings to Date objects and normalize times
          pattern.startDate = new Date(pattern.startDate);
          pattern.startDate.setHours(0, 0, 0, 0);
          
          if (pattern.endDate) {
            pattern.endDate = new Date(pattern.endDate);
            // Skip if the pattern has ended before our range starts
            if (pattern.endDate < start) continue;
          }
          if (pattern.exceptions) {
            pattern.exceptions = (pattern.exceptions || []).map((d): Date => new Date(d));
          }
          entry.recurrence_pattern = pattern;
        }

        // Calculate occurrences within the range, but only up to endDate if it exists
        const effectiveEnd = entry.recurrence_pattern.endDate && entry.recurrence_pattern.endDate < end 
          ? entry.recurrence_pattern.endDate 
          : end;
        const occurrences = generateOccurrences(entry, start, effectiveEnd);

        // Create virtual entries for each occurrence
        const duration = new Date(entry.scheduled_end).getTime() - new Date(entry.scheduled_start).getTime();
        const virtualEntries = occurrences
          // Filter out exception dates
          .filter(occurrence => {
            const utcDate = new Date(occurrence);
            utcDate.setUTCHours(0, 0, 0, 0);
            return !entry.recurrence_pattern?.exceptions?.some(ex => {
              const exDate = new Date(ex);
              exDate.setUTCHours(0, 0, 0, 0);
              return exDate.getTime() === utcDate.getTime();
            });
          })
          // Create virtual entries for remaining dates
          .map((occurrence): IScheduleEntry => ({
            ...entry,
            entry_id: `${entry.entry_id}_${occurrence.getTime()}`,
            scheduled_start: occurrence,
            scheduled_end: new Date(occurrence.getTime() + duration),
            is_recurring: true,
            original_entry_id: entry.entry_id,
            assigned_user_ids: assignedUserIds[entry.entry_id] || []
          }));

        result.push(...virtualEntries);
      } catch (error) {
        console.error('Error processing recurring entry:', error);
        // Skip this entry if there's an error
        continue;
      }
    }

    return result;
  }

  static async getRecurringEntriesInRange(start: Date, end: Date): Promise<IScheduleEntry[]> {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant is required');
    }
    
    // Get master recurring entries that might have occurrences in the range
    const masterEntries = await db('schedule_entries')
      .where({ tenant, is_recurring: true })
      .whereNotNull('recurrence_pattern')
      .whereNull('original_entry_id') // Only get master entries
      .where('scheduled_start', '<=', end) // Entry must start before the end of our range
      .andWhere(function() {
        // Include entries where:
        // 1. The end date is after the start of our range
        this.where('scheduled_end', '>=', start)
          // 2. Or the recurrence end date is after the start of our range
          .orWhereRaw("(recurrence_pattern->>'endDate')::date >= ?", [start])
          // 3. Or there is no end date (either not specified or explicitly null)
          .orWhereRaw("(recurrence_pattern->>'endDate') IS NULL")
      })
      .select('*') as unknown as IScheduleEntry[];

    console.log('[ScheduleEntry.getRecurringEntriesInRange] Master entries found:', {
      count: masterEntries.length,
      entries: masterEntries.map(e => ({
        id: e.entry_id,
        title: e.title,
        start: e.scheduled_start,
        hasPattern: !!e.recurrence_pattern
      }))
    });

    if (masterEntries.length === 0) return [];

    // Only return virtual instances - master entries are already included in getAll()
    const virtualEntries = await this.getRecurringEntriesWithAssignments(db, masterEntries, start, end);

    console.log('[ScheduleEntry.getRecurringEntriesInRange] Generated virtual entries:', {
      count: virtualEntries.length,
      entries: virtualEntries.map((e): { id: string; title: string; start: Date; originalId: string | undefined; } => ({
        id: e.entry_id,
        title: e.title,
        start: e.scheduled_start,
        originalId: e.original_entry_id
      }))
    });

    return virtualEntries;
  }

  static async delete(entry_id: string): Promise<boolean> {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant is required');
    }
    
    // Note: No need to delete from schedule_entry_assignees explicitly
    // due to CASCADE delete in the foreign key constraint
    const deletedCount = await db('schedule_entries')
      .where({ tenant, entry_id })
      .del();
    return deletedCount > 0;
  }
}

export default ScheduleEntry;
