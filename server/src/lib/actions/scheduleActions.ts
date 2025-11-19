'use server'
import ScheduleEntry from '../models/scheduleEntry';
import { IScheduleEntry, IEditScope } from 'server/src/interfaces/schedule.interfaces';
import { WorkItemType } from 'server/src/interfaces/workItem.interfaces';
import { getCurrentUser, getCurrentUserPermissions } from './user-actions/userActions';
import { withTransaction } from '@alga-psa/shared/db';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';
import { publishEvent } from 'server/src/lib/eventBus/publishers';

export type ScheduleActionResult<T> =
  | { success: true; entries: T; error?: never }
  | { success: false; error: string; entries?: never }

/**
 * Fetches schedule entries based on date range and user permissions.
 * - Users with 'user_schedule:update' can view all entries, optionally filtered by technicianIds.
 * - Users with only 'user_schedule:read' can view only their own entries.
 * - Users without 'user_schedule:read' cannot view any entries.
 */
export async function getScheduleEntries(
  start: Date,
  end: Date,
  technicianIds?: string[]
): Promise<ScheduleActionResult<IScheduleEntry[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated.' };
    }
    const userPermissions = await getCurrentUserPermissions();

    // Check for basic read permission
    const canRead = userPermissions.includes('user_schedule:read');
    if (!canRead) {
        // Return empty list if no read permission, as per contract line implication
        console.warn(`User ${currentUser.user_id} lacks user_schedule:read permission.`);
        return { success: true, entries: [] };
        // Alternative: return { success: false, error: 'Permission denied to view schedule entries.' };
    }

    const { knex: db } = await createTenantKnex();

    // Check if user has broader view/update permission
    const canUpdate = userPermissions.includes('user_schedule:update');

    // Optimize: Filter at database level instead of loading all and filtering in memory
    let filteredEntries = await withTransaction(db, async (trx: Knex.Transaction) => {
      const allEntries = await ScheduleEntry.getAll(trx, start, end);

      // Early return if no filtering needed (user can see all)
      if (canUpdate && (!technicianIds || technicianIds.length === 0)) {
        return allEntries;
      }

      // Filter based on permissions
      if (canUpdate && technicianIds && technicianIds.length > 0) {
        // User has update permission: Can view assigned entries OR unassigned appointment requests
        return allEntries.filter(entry =>
          entry.assigned_user_ids.some(assignedId => technicianIds.includes(assignedId)) ||
          (entry.assigned_user_ids.length === 0 && entry.work_item_type === 'appointment_request')
        );
      } else {
        // User only has read permission: View only own entries
        return allEntries.filter(entry =>
          entry.assigned_user_ids.includes(currentUser.user_id)
        );
      }
    });

    // Then filter private entries - these are only visible to assigned users regardless of permissions
    filteredEntries = filteredEntries.map(entry => {
      if (entry.is_private && !entry.assigned_user_ids.includes(currentUser.user_id)) {
        return {
          ...entry,
          title: "Busy",
          notes: "",
          work_item_id: null,
          work_item_type: "ad_hoc"
        };
      }
      return entry;
    });

    return { success: true, entries: filteredEntries };
  } catch (error) {
    console.error('Error fetching schedule entries:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch schedule entries';
    return { success: false, error: message };
  }
}

// Removed getScheduleEntriesByUser and getCurrentUserScheduleEntries as getScheduleEntries now handles permissions.

export async function addScheduleEntry(
  entry: Omit<IScheduleEntry, 'entry_id' | 'created_at' | 'updated_at' | 'tenant'>, 
  options?: { 
    assignedUserIds?: string[];
  }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated.' };
    }
    const userPermissions = await getCurrentUserPermissions();

    // Basic check: Must have at least read permission to add own entry
    const canRead = userPermissions.includes('user_schedule:read');
    if (!canRead) {
        return { success: false, error: 'Permission denied to add schedule entries.' };
    }

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

    // Determine final assignedUserIds, preferring entry.assigned_user_ids, then options, then defaulting to current user
    let assignedUserIds: string[];
    if (entry.assigned_user_ids && entry.assigned_user_ids.length > 0) {
      assignedUserIds = entry.assigned_user_ids;
    } else if (options?.assignedUserIds && options.assignedUserIds.length > 0) {
      assignedUserIds = options.assignedUserIds;
    } else {
      assignedUserIds = [currentUser.user_id];
    }

    // --- Permission Check ---
    const isAssigningToOthers = assignedUserIds.some(id => id !== currentUser.user_id);
    const canUpdate = userPermissions.includes('user_schedule:update');

    if (isAssigningToOthers && !canUpdate) {
      return {
        success: false,
        error: 'Permission denied to assign schedule entries to other users.'
      };
    }
    // --- End Permission Check ---

    const { knex: db } = await createTenantKnex();
    const createdEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.create(trx, entry, {
        assignedUserIds,
        assignedByUserId: currentUser.user_id
      });
    });

    try {
      await publishEvent({
        eventType: 'SCHEDULE_ENTRY_CREATED',
        payload: {
          tenantId: currentUser.tenant,
          userId: currentUser.user_id,
          entryId: createdEntry.entry_id,
          changes: {
            after: sanitizeScheduleEntryForEvent(createdEntry),
            assignedUserIds,
          },
        },
      });
    } catch (eventError) {
      console.error('[ScheduleActions] Failed to publish SCHEDULE_ENTRY_CREATED event', eventError);
    }

    return { success: true, entry: createdEntry };
  } catch (error) {
    console.error('Error creating schedule entry:', error);
    const message = error instanceof Error ? error.message : 'Failed to create schedule entry';
    return { success: false, error: message };
  }
}

export async function updateScheduleEntry(
  entry_id: string,
  entry: Partial<IScheduleEntry>
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated.' };
    }
    const userPermissions = await getCurrentUserPermissions();
    const canUpdateGlobally = userPermissions.includes('user_schedule:update');

    // Fetch the existing entry first to check permissions
    const { knex: db } = await createTenantKnex();
    const existingEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.get(trx, entry_id);
    });
    if (!existingEntry) {
      return { success: false, error: 'Schedule entry not found.' };
    }

    // --- Permission Check ---
    let canEditThisEntry = false;
    
    // Check if the entry is private
    const isPrivateEntry = existingEntry.is_private;
    const isOwnEntry =
      existingEntry.assigned_user_ids.length === 1 &&
      existingEntry.assigned_user_ids[0] === currentUser.user_id;
    
    // If the entry is private, only the creator can edit it
    if (isPrivateEntry && !isOwnEntry) {
      return { success: false, error: 'Permission denied to edit a private schedule entry.' };
    }
    
    if (canUpdateGlobally) {
      // Global update permission allows editing any non-private entry
      canEditThisEntry = true;
    } else {
      // User might only have 'user_schedule:read' (implicitly checked by reaching here)
      
      // Check if the update attempts to change assignment *away* from solely the current user
      // If assigned_user_ids is not part of the update, assignment doesn't change.
      // If it is part of the update, it must contain *only* the current user's ID.
      const assignmentRemainsOwn = entry.assigned_user_ids
        ? (entry.assigned_user_ids.length === 1 && entry.assigned_user_ids[0] === currentUser.user_id)
        : true; // If assigned_user_ids is not being updated, the assignment aspect is permitted

      if (isOwnEntry && assignmentRemainsOwn) {
        canEditThisEntry = true; // Allowed to edit own entry if assignment isn't changed to others
      }
    }

    if (!canEditThisEntry) {
      return { success: false, error: 'Permission denied to update this schedule entry.' };
    }
    // --- End Permission Check ---

    // Ensure work_item_type is preserved if not explicitly updated
    if (entry.work_item_id && !entry.work_item_type && existingEntry.work_item_type) {
        entry.work_item_type = existingEntry.work_item_type;
    }

    // Prepare update data - use existing assignees if not provided in the update
    const updateData = {
        ...entry,
        assigned_user_ids: entry.assigned_user_ids // Let ScheduleEntry.update handle merging if needed based on updateType
    };

    const editScope = entry.updateType || IEditScope.SINGLE;
    const updatedEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.update(
          trx,
          entry_id,
          updateData,
          editScope
      );
    });

    if (updatedEntry) {
      try {
        await publishEvent({
          eventType: 'SCHEDULE_ENTRY_UPDATED',
          payload: {
            tenantId: currentUser.tenant,
            userId: currentUser.user_id,
            entryId: entry_id,
            changes: {
              before: sanitizeScheduleEntryForEvent(existingEntry),
              after: sanitizeScheduleEntryForEvent(updatedEntry),
              updateType: editScope,
            },
          },
        });
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish SCHEDULE_ENTRY_UPDATED event', eventError);
      }
    }

    return { success: true, entry: updatedEntry };
  } catch (error) {
    console.error('Error updating schedule entry:', error);
    const message = error instanceof Error ? error.message : 'Failed to update schedule entry';
    return { success: false, error: message };
  }
}

export async function deleteScheduleEntry(entry_id: string, deleteType: IEditScope = IEditScope.SINGLE) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated.' };
    }
    const userPermissions = await getCurrentUserPermissions();
    const canUpdateGlobally = userPermissions.includes('user_schedule:update');

    // Parse entry ID to get master entry ID (for virtual entries)
    const isVirtualId = entry_id.includes('_');
    const masterEntryId = isVirtualId ? entry_id.split('_')[0] : entry_id;

    // Fetch the existing entry first to check permissions
    const { knex: db } = await createTenantKnex();
    const existingEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.get(trx, masterEntryId);
    });
    if (!existingEntry) {
      // If entry doesn't exist, deletion is technically successful (idempotent)
      // or we could return an error. Returning success for now.
      return { success: true };
      // Alternative: return { success: false, error: 'Schedule entry not found.' };
    }

    // --- Permission Check ---
    let canDeleteThisEntry = false;
    
    // Check if the entry is private
    const isPrivateEntry = existingEntry.is_private;
    const isOwnEntry =
      existingEntry.assigned_user_ids.length === 1 &&
      existingEntry.assigned_user_ids[0] === currentUser.user_id;
    
    // If the entry is private, only the creator can delete it
    if (isPrivateEntry && !isOwnEntry) {
      return {
        success: false,
        error: 'This is a private entry. Only the creator can delete it.',
        isPrivateError: true
      };
    }
    
    if (canUpdateGlobally) {
      // Global update permission allows deleting any non-private entry
      canDeleteThisEntry = true;
    } else {
      // User might only have 'user_schedule:read'
      if (isOwnEntry) {
        canDeleteThisEntry = true; // Allowed to delete own entry
      }
    }

    if (!canDeleteThisEntry) {
      return { success: false, error: 'Permission denied to delete this schedule entry.' };
    }
    // --- End Permission Check ---

    const success = await ScheduleEntry.delete(entry_id, deleteType);

    if (success) {
      try {
        await publishEvent({
          eventType: 'SCHEDULE_ENTRY_DELETED',
          payload: {
            tenantId: currentUser.tenant,
            userId: currentUser.user_id,
            entryId: entry_id,
            changes: {
              before: sanitizeScheduleEntryForEvent(existingEntry),
              deleteType,
            },
          },
        });
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish SCHEDULE_ENTRY_DELETED event', eventError);
      }
    }

    return { success };
  } catch (error) {
    console.error('Error deleting schedule entry:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete schedule entry';
    return { success: false, error: message };
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

    const { knex: db, tenant } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {

    // Get the schedule entry
    const entry = await trx('schedule_entries')
      .where({
        entry_id: entryId,
        tenant
      })
      .first();

    if (!entry) {
      return null;
    }

    // Get assigned users
    const assignees = await trx('schedule_entry_assignees')
      .where({
        entry_id: entryId,
        tenant
      })
      .select('user_id');

    const assignedUserIds = assignees.map(a => a.user_id);

    // Combine entry with assigned users
    const scheduleEntry: IScheduleEntry = {
      ...entry,
      assigned_user_ids: assignedUserIds || []
    };

    // Check if entry is private and user is not assigned to it
    if (scheduleEntry.is_private && !assignedUserIds.includes(user.id)) {
      // Return limited information for private entries
      return {
        ...scheduleEntry,
        title: "Busy",
        notes: "",
        work_item_id: null,
        work_item_type: "ad_hoc"
      };
    }

      return scheduleEntry;
    });
  } catch (error) {
    console.error('Error fetching schedule entry by ID:', error);
    throw new Error('Failed to fetch schedule entry');
  }
}

function sanitizeScheduleEntryForEvent(entry: IScheduleEntry | null | undefined) {
  if (!entry) {
    return undefined;
  }

  const toIsoString = (value: unknown): string | null => {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  return {
    id: entry.entry_id,
    title: entry.title,
    scheduledStart: toIsoString(entry.scheduled_start),
    scheduledEnd: toIsoString(entry.scheduled_end),
    status: entry.status,
    workItemId: entry.work_item_id,
    workItemType: entry.work_item_type,
    isRecurring: entry.is_recurring,
    recurrencePattern: entry.recurrence_pattern,
    assignedUserIds: entry.assigned_user_ids ?? [],
    isPrivate: entry.is_private,
  };
}
