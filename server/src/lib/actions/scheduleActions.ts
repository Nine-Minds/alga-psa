'use server'
import ScheduleEntry from '../models/scheduleEntry';
import { IScheduleEntry, IEditScope } from 'server/src/interfaces/schedule.interfaces';
import { WorkItemType } from 'server/src/interfaces/workItem.interfaces';
import { getCurrentUser } from './user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';

export type ScheduleActionResult<T> = 
  | { success: true; entries: T; error?: never }
  | { success: false; error: string; entries?: never }

export async function getScheduleEntries(start: Date, end: Date): Promise<ScheduleActionResult<IScheduleEntry[]>> {
  try {
    const entries = await ScheduleEntry.getAll(start, end);
    return { success: true, entries };
  } catch (error) {
    console.error('Error fetching schedule entries:', error);
    return { success: false, error: 'Failed to fetch schedule entries' };
  }
}

export async function getScheduleEntriesByUser(start: Date, end: Date, userId: string): Promise<ScheduleActionResult<IScheduleEntry[]>> {
  try {
    const entries = await ScheduleEntry.getAll(start, end);
    // Filter entries where user is assigned
    const userEntries = entries.filter(entry => entry.assigned_user_ids.includes(userId));
    return { success: true, entries: userEntries };
  } catch (error) {
    console.error('Error fetching user schedule entries:', error);
    return { success: false, error: 'Failed to fetch user schedule entries' };
  }
}

export async function getCurrentUserScheduleEntries(start: Date, end: Date): Promise<ScheduleActionResult<IScheduleEntry[]>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'No authenticated user found' };
    }
    return getScheduleEntriesByUser(start, end, user.user_id);
  } catch (error) {
    console.error('Error fetching current user schedule entries:', error);
    return { success: false, error: 'Failed to fetch current user schedule entries' };
  }
}

export async function addScheduleEntry(
  entry: Omit<IScheduleEntry, 'entry_id' | 'created_at' | 'updated_at' | 'tenant'>, 
  options?: { 
    assignedUserIds?: string[];
  }
) {
  try {
    // Validate work item ID based on type
    if (entry.work_item_type === 'ad_hoc') {
      // For ad-hoc entries, ensure work_item_id is null
      entry.work_item_id = null;
      entry.status = entry.status || 'scheduled'; // Ensure status is set for ad-hoc entries
    } else if (!entry.work_item_id) {
      return {
        success: false,
        error: 'Non-ad-hoc entries must have a valid work item ID'
      };
    }
    
    // Ensure work_item_type is preserved for ticket and project_task entries
    if (entry.work_item_id && !entry.work_item_type) {
      return {
        success: false,
        error: 'Work item type must be specified for entries with a work item ID'
      };
    }

    // Ensure at least one user is assigned
    if (!options?.assignedUserIds || options.assignedUserIds.length === 0) {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('No authenticated user found');
      }
      options = {
        ...options,
        assignedUserIds: [user.user_id]
      };
    }

    let assignedUserIds: string[];
    
    if (!options?.assignedUserIds || options.assignedUserIds.length === 0) {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('No authenticated user found');
      }
      assignedUserIds = [user.user_id];
    } else {
      assignedUserIds = options.assignedUserIds;
    }
    
    const createdEntry = await ScheduleEntry.create(entry, {
      assignedUserIds
    });
    return { success: true, entry: createdEntry };
  } catch (error) {
    console.error('Error creating schedule entry:', error);
    return { success: false, error: 'Failed to create schedule entry' };
  }
}

export async function updateScheduleEntry(
  entry_id: string,
  entry: Partial<IScheduleEntry>
) {
  try {
    // Ensure work_item_type is preserved for ticket and project_task entries
    if (entry.work_item_id && !entry.work_item_type) {
      // Fetch the existing entry to get its work_item_type
      const existingEntry = await ScheduleEntry.get(entry_id);
      if (existingEntry && existingEntry.work_item_type) {
        entry.work_item_type = existingEntry.work_item_type;
      }
    }
    
    // If no assigned_user_ids provided, keep existing assignments
    const updatedEntry = await ScheduleEntry.update(entry_id, {
      ...entry,
      assigned_user_ids: entry.assigned_user_ids
    }, entry.updateType || IEditScope.SINGLE);
    return { success: true, entry: updatedEntry };
  } catch (error) {
    console.error('Error updating schedule entry:', error);
    return { success: false, error: 'Failed to update schedule entry' };
  }
}

export async function deleteScheduleEntry(entry_id: string, deleteType: IEditScope = IEditScope.SINGLE) {
  try {
    const success = await ScheduleEntry.delete(entry_id, deleteType);
    return { success };
  } catch (error) {
    console.error('Error deleting schedule entry:', error);
    return { success: false, error: 'Failed to delete schedule entry' };
  }
}

/**
 * Get a schedule entry by ID
 * @param entryId The ID of the schedule entry to retrieve
 * @param user The authenticated user
 * @returns The schedule entry or null if not found
 */
export async function getScheduleEntryById(entryId: string, user: any): Promise<IScheduleEntry | null> {
  try {
    // Validate user has permission to view schedule entries
    if (!user) {
      throw new Error('User not authenticated');
    }

    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get the schedule entry
    const entry = await db('schedule_entries')
      .where({
        entry_id: entryId,
        tenant
      })
      .first();

    if (!entry) {
      return null;
    }

    // Get assigned users
    const assignees = await db('schedule_entry_assignees')
      .where({
        entry_id: entryId,
        tenant
      })
      .first();

    // Combine entry with assigned users
    const scheduleEntry: IScheduleEntry = {
      ...entry,
      assigned_user_ids: assignees?.assigned_user_ids || []
    };

    return scheduleEntry;
  } catch (error) {
    console.error('Error fetching schedule entry by ID:', error);
    throw new Error('Failed to fetch schedule entry');
  }
}
