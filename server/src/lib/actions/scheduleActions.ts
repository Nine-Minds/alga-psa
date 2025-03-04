'use server'
import ScheduleEntry from '../models/scheduleEntry';
import { IScheduleEntry, IEditScope } from 'server/src/interfaces/schedule.interfaces';
import { WorkItemType } from 'server/src/interfaces/workItem.interfaces';
import { getCurrentUser } from './user-actions/userActions';

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
