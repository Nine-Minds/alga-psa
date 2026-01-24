'use server'
import ScheduleEntry from '../models/scheduleEntry';
import { IScheduleEntry, IEditScope } from '@alga-psa/types';
import { WorkItemType } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildAppointmentAssignedPayload,
  buildAppointmentCanceledPayload,
  buildAppointmentCompletedPayload,
  buildAppointmentCreatedPayload,
  buildAppointmentNoShowPayload,
  buildAppointmentRescheduledPayload,
  getSingleUserAssigneeId,
  getTicketIdFromScheduleEntry,
  isAppointmentCanceledStatus,
  isAppointmentCompletedStatus,
  isAppointmentNoShowStatus,
  isAppointmentRescheduled,
  shouldEmitAppointmentEvents,
} from '@shared/workflow/streams/domainEventBuilders/appointmentEventBuilders';
import {
  buildScheduleBlockCreatedPayload,
  buildScheduleBlockDeletedPayload,
  isScheduleBlockEntry,
} from '@shared/workflow/streams/domainEventBuilders/scheduleBlockEventBuilders';
import {
  buildTechnicianArrivedPayload,
  buildTechnicianCheckedOutPayload,
  buildTechnicianDispatchedPayload,
  buildTechnicianEnRoutePayload,
  getTechnicianUserIds,
  isTechnicianArrivedStatus,
  isTechnicianCheckedOutStatus,
  isTechnicianEnRouteStatus,
  shouldEmitTechnicianDispatchEvents,
} from '@shared/workflow/streams/domainEventBuilders/technicianDispatchEventBuilders';
import { maybePublishCapacityThresholdReached } from '../lib/capacityThresholdWorkflowEvents';

export type ScheduleActionResult<T> =
  | { success: true; entries: T; error?: never }
  | { success: false; error: string; entries?: never }

async function getTicketIdForAppointmentRequest(
  db: Knex,
  tenant: string,
  appointmentRequestId: string
): Promise<string | undefined> {
  const row = await withTransaction(db, async (trx: Knex.Transaction) => {
    return await trx('appointment_requests')
      .where({ tenant, appointment_request_id: appointmentRequestId })
      .select('ticket_id')
      .first();
  });
  return row?.ticket_id || undefined;
}

/**
 * Fetches schedule entries based on date range and user permissions.
 * - Users with 'user_schedule:update' can view all entries, optionally filtered by technicianIds.
 * - Users with only 'user_schedule:read' can view only their own entries.
 * - Users without 'user_schedule:read' cannot view any entries.
 */
export const getScheduleEntries = withAuth(async (
  user,
  { tenant },
  start: Date,
  end: Date,
  technicianIds?: string[]
): Promise<ScheduleActionResult<IScheduleEntry[]>> => {
  try {
    const { knex: db } = await createTenantKnex();

    // Check for basic read permission
    const canRead = await hasPermission(user, 'user_schedule', 'read', db);
    if (!canRead) {
        // Return empty list if no read permission, as per contract line implication
        console.warn(`User ${user.user_id} lacks user_schedule:read permission.`);
        return { success: true, entries: [] };
        // Alternative: return { success: false, error: 'Permission denied to view schedule entries.' };
    }

    // Check if user has broader view/update permission
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);

    // Optimize: Filter at database level instead of loading all and filtering in memory
    let filteredEntries = await withTransaction(db, async (trx: Knex.Transaction) => {
      const allEntries = await ScheduleEntry.getAll(trx, tenant, start, end);

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
          entry.assigned_user_ids.includes(user.user_id)
        );
      }
    });

    // Then filter private entries - these are only visible to assigned users regardless of permissions
    filteredEntries = filteredEntries.map(entry => {
      if (entry.is_private && !entry.assigned_user_ids.includes(user.user_id)) {
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
});

// Removed getScheduleEntriesByUser and getCurrentUserScheduleEntries as getScheduleEntries now handles permissions.

export const addScheduleEntry = withAuth(async (
  user,
  { tenant },
  entry: Omit<IScheduleEntry, 'entry_id' | 'created_at' | 'updated_at' | 'tenant'>,
  options?: {
    assignedUserIds?: string[];
  }
) => {
  try {
    const { knex: db } = await createTenantKnex();

    // Basic check: Must have at least read permission to add own entry
    const canRead = await hasPermission(user, 'user_schedule', 'read', db);
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
      assignedUserIds = [user.user_id];
    }

    // --- Permission Check ---
    const isAssigningToOthers = assignedUserIds.some(id => id !== user.user_id);
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);

    if (isAssigningToOthers && !canUpdate) {
      return {
        success: false,
        error: 'Permission denied to assign schedule entries to other users.'
      };
    }
    // --- End Permission Check ---

    const createdEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.create(trx, tenant, entry, {
        assignedUserIds,
        assignedByUserId: user.user_id
      });
    });

    try {
      await publishEvent({
        eventType: 'SCHEDULE_ENTRY_CREATED',
        payload: {
          tenantId: tenant,
          userId: user.user_id,
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

    if (isScheduleBlockEntry(createdEntry)) {
      const ctx = {
        tenantId: currentUser.tenant,
        actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
      };

      try {
        await publishWorkflowEvent({
          eventType: 'SCHEDULE_BLOCK_CREATED',
          ctx,
          payload: buildScheduleBlockCreatedPayload({ entry: createdEntry, timezone: 'UTC' }),
        });
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish SCHEDULE_BLOCK_CREATED workflow event', eventError);
      }
    }

    if (shouldEmitAppointmentEvents(createdEntry)) {
      const timezone = 'UTC';
      const ticketId =
        getTicketIdFromScheduleEntry(createdEntry) ||
        (createdEntry.work_item_type === 'appointment_request' && createdEntry.work_item_id
          ? await getTicketIdForAppointmentRequest(db, tenant, createdEntry.work_item_id)
          : undefined);

      const ctx = {
        tenantId: currentUser.tenant,
        actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
      };

      try {
        await publishWorkflowEvent({
          eventType: 'APPOINTMENT_CREATED',
          ctx,
          payload: buildAppointmentCreatedPayload({
            entry: createdEntry,
            ticketId,
            timezone,
            createdByUserId: currentUser.user_id,
          }),
        });

        const assigneeId = getSingleUserAssigneeId(createdEntry);
        if (assigneeId) {
          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_ASSIGNED',
            ctx,
            payload: buildAppointmentAssignedPayload({
              appointmentId: createdEntry.entry_id,
              ticketId,
              newAssigneeId: assigneeId,
            }),
          });
        }
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish APPOINTMENT_* workflow events', eventError);
      }

      if (shouldEmitTechnicianDispatchEvents(createdEntry)) {
        try {
          const technicianUserIds = getTechnicianUserIds({ ...createdEntry, assigned_user_ids: assignedUserIds });
          for (const technicianUserId of technicianUserIds) {
            await publishWorkflowEvent({
              eventType: 'TECHNICIAN_DISPATCHED',
              ctx,
              payload: buildTechnicianDispatchedPayload({
                appointmentId: createdEntry.entry_id,
                ticketId,
                technicianUserId,
                dispatchedByUserId: currentUser.user_id,
              }),
            });
          }
        } catch (eventError) {
          console.error('[ScheduleActions] Failed to publish TECHNICIAN_DISPATCHED workflow event', eventError);
        }
      }
    }

    try {
      await maybePublishCapacityThresholdReached({
        db,
        tenantId: currentUser.tenant,
        actorUserId: currentUser.user_id,
        after: createdEntry,
      });
    } catch (eventError) {
      console.error('[ScheduleActions] Failed to publish CAPACITY_THRESHOLD_REACHED workflow event', eventError);
    }

    return { success: true, entry: createdEntry };
  } catch (error) {
    console.error('Error creating schedule entry:', error);
    const message = error instanceof Error ? error.message : 'Failed to create schedule entry';
    return { success: false, error: message };
  }
});

export const updateScheduleEntry = withAuth(async (
  user,
  { tenant },
  entry_id: string,
  entry: Partial<IScheduleEntry>
) => {
  try {
    const { knex: db } = await createTenantKnex();
    const canUpdateGlobally = await hasPermission(user, 'user_schedule', 'update', db);

    const masterEntryId =
      (typeof entry.original_entry_id === 'string' && entry.original_entry_id.length > 0
        ? entry.original_entry_id
        : (entry_id.includes('_') ? entry_id.split('_')[0] : entry_id));

    // Fetch the existing entry first to check permissions
    const existingEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.get(trx, tenant, masterEntryId);
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
      existingEntry.assigned_user_ids[0] === user.user_id;

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
        ? (entry.assigned_user_ids.length === 1 && entry.assigned_user_ids[0] === user.user_id)
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

    const updatedEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.update(trx, tenant, masterEntryId, updateData);
    });

    if (updatedEntry) {
      try {
        await publishEvent({
          eventType: 'SCHEDULE_ENTRY_UPDATED',
          payload: {
            tenantId: tenant,
            userId: user.user_id,
            entryId: entry_id,
            changes: {
              before: sanitizeScheduleEntryForEvent(existingEntry),
              after: sanitizeScheduleEntryForEvent(updatedEntry),
              updateType: entry.updateType || IEditScope.SINGLE,
            },
          },
        });
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish SCHEDULE_ENTRY_UPDATED event', eventError);
      }

      const wasScheduleBlock = isScheduleBlockEntry(existingEntry);
      const isScheduleBlock = isScheduleBlockEntry(updatedEntry);
      if (!wasScheduleBlock && isScheduleBlock) {
        const ctx = {
          tenantId: currentUser.tenant,
          actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
        };

        try {
          await publishWorkflowEvent({
            eventType: 'SCHEDULE_BLOCK_CREATED',
            ctx,
            payload: buildScheduleBlockCreatedPayload({ entry: updatedEntry, timezone: 'UTC' }),
          });
        } catch (eventError) {
          console.error('[ScheduleActions] Failed to publish SCHEDULE_BLOCK_CREATED workflow event', eventError);
        }
      } else if (wasScheduleBlock && !isScheduleBlock) {
        const ctx = {
          tenantId: currentUser.tenant,
          actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
        };

        try {
          await publishWorkflowEvent({
            eventType: 'SCHEDULE_BLOCK_DELETED',
            ctx,
            payload: buildScheduleBlockDeletedPayload({
              scheduleBlockId: existingEntry.entry_id,
              reason: 'No longer private ad-hoc block',
            }),
          });
        } catch (eventError) {
          console.error('[ScheduleActions] Failed to publish SCHEDULE_BLOCK_DELETED workflow event', eventError);
        }
      }

      if (shouldEmitAppointmentEvents(existingEntry) || shouldEmitAppointmentEvents(updatedEntry)) {
        const timezone = 'UTC';
        const ticketId =
          getTicketIdFromScheduleEntry(updatedEntry) ||
          (updatedEntry.work_item_type === 'appointment_request' && updatedEntry.work_item_id
            ? await getTicketIdForAppointmentRequest(db, tenant, updatedEntry.work_item_id)
            : undefined);

        const ctx = {
          tenantId: currentUser.tenant,
          actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
        };

        try {
          if (isAppointmentRescheduled(existingEntry, updatedEntry)) {
            await publishWorkflowEvent({
              eventType: 'APPOINTMENT_RESCHEDULED',
              ctx,
              payload: buildAppointmentRescheduledPayload({
                before: existingEntry,
                after: updatedEntry,
                ticketId,
                timezone,
              }),
            });
          }

          const previousAssigneeId = getSingleUserAssigneeId(existingEntry);
          const newAssigneeId = getSingleUserAssigneeId(updatedEntry);
          if (newAssigneeId && newAssigneeId !== previousAssigneeId) {
            await publishWorkflowEvent({
              eventType: 'APPOINTMENT_ASSIGNED',
              ctx,
              payload: buildAppointmentAssignedPayload({
                appointmentId: updatedEntry.entry_id,
                ticketId,
                previousAssigneeId,
                newAssigneeId,
              }),
            });
          }

          if (!isAppointmentCanceledStatus(existingEntry.status) && isAppointmentCanceledStatus(updatedEntry.status)) {
            await publishWorkflowEvent({
              eventType: 'APPOINTMENT_CANCELED',
              ctx,
              payload: buildAppointmentCanceledPayload({ appointmentId: updatedEntry.entry_id, ticketId }),
            });
          }

          if (!isAppointmentCompletedStatus(existingEntry.status) && isAppointmentCompletedStatus(updatedEntry.status)) {
            await publishWorkflowEvent({
              eventType: 'APPOINTMENT_COMPLETED',
              ctx,
              payload: buildAppointmentCompletedPayload({ appointmentId: updatedEntry.entry_id, ticketId }),
            });
          }

          if (!isAppointmentNoShowStatus(existingEntry.status) && isAppointmentNoShowStatus(updatedEntry.status)) {
            await publishWorkflowEvent({
              eventType: 'APPOINTMENT_NO_SHOW',
              ctx,
              payload: buildAppointmentNoShowPayload({ appointmentId: updatedEntry.entry_id, ticketId, party: 'customer' }),
            });
          }
        } catch (eventError) {
          console.error('[ScheduleActions] Failed to publish appointment workflow events', eventError);
        }

        if (shouldEmitTechnicianDispatchEvents(updatedEntry)) {
          try {
            const beforeTechs = new Set(getTechnicianUserIds(existingEntry));
            const afterTechs = getTechnicianUserIds(updatedEntry);
            const addedTechs = afterTechs.filter((id) => !beforeTechs.has(id));

            for (const technicianUserId of addedTechs) {
              await publishWorkflowEvent({
                eventType: 'TECHNICIAN_DISPATCHED',
                ctx,
                payload: buildTechnicianDispatchedPayload({
                  appointmentId: updatedEntry.entry_id,
                  ticketId,
                  technicianUserId,
                  dispatchedByUserId: currentUser.user_id,
                }),
              });
            }

            const statusChanged = String(existingEntry.status ?? '') !== String(updatedEntry.status ?? '');
            if (statusChanged) {
              if (
                !isTechnicianEnRouteStatus(existingEntry.status) &&
                isTechnicianEnRouteStatus(updatedEntry.status)
              ) {
                for (const technicianUserId of afterTechs) {
                  await publishWorkflowEvent({
                    eventType: 'TECHNICIAN_EN_ROUTE',
                    ctx,
                    payload: buildTechnicianEnRoutePayload({
                      appointmentId: updatedEntry.entry_id,
                      ticketId,
                      technicianUserId,
                    }),
                  });
                }
              }

              if (
                !isTechnicianArrivedStatus(existingEntry.status) &&
                isTechnicianArrivedStatus(updatedEntry.status)
              ) {
                for (const technicianUserId of afterTechs) {
                  await publishWorkflowEvent({
                    eventType: 'TECHNICIAN_ARRIVED',
                    ctx,
                    payload: buildTechnicianArrivedPayload({
                      appointmentId: updatedEntry.entry_id,
                      ticketId,
                      technicianUserId,
                    }),
                  });
                }
              }

              const checkedOutByStatus =
                !isTechnicianCheckedOutStatus(existingEntry.status) &&
                isTechnicianCheckedOutStatus(updatedEntry.status);
              const checkedOutByCompletion =
                !isAppointmentCompletedStatus(existingEntry.status) &&
                isAppointmentCompletedStatus(updatedEntry.status);

              if (checkedOutByStatus || checkedOutByCompletion) {
                for (const technicianUserId of afterTechs) {
                  await publishWorkflowEvent({
                    eventType: 'TECHNICIAN_CHECKED_OUT',
                    ctx,
                    payload: buildTechnicianCheckedOutPayload({
                      appointmentId: updatedEntry.entry_id,
                      ticketId,
                      technicianUserId,
                    }),
                  });
                }
              }
            }
          } catch (eventError) {
            console.error(
              '[ScheduleActions] Failed to publish technician dispatch lifecycle workflow events',
              eventError
            );
          }
        }
      }
    }

    if (updatedEntry) {
      try {
        await maybePublishCapacityThresholdReached({
          db,
          tenantId: currentUser.tenant,
          actorUserId: currentUser.user_id,
          before: existingEntry,
          after: updatedEntry,
        });
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish CAPACITY_THRESHOLD_REACHED workflow event', eventError);
      }
    }

    return { success: true, entry: updatedEntry };
  } catch (error) {
    console.error('Error updating schedule entry:', error);
    const message = error instanceof Error ? error.message : 'Failed to update schedule entry';
    return { success: false, error: message };
  }
});

export const deleteScheduleEntry = withAuth(async (
  user,
  { tenant },
  entry_id: string,
  deleteType: IEditScope = IEditScope.SINGLE
) => {
  try {
    const { knex: db } = await createTenantKnex();
    const canUpdateGlobally = await hasPermission(user, 'user_schedule', 'update', db);

    // Parse entry ID to get master entry ID (for virtual entries)
    const isVirtualId = entry_id.includes('_');
    const masterEntryId = isVirtualId ? entry_id.split('_')[0] : entry_id;

    // Fetch the existing entry first to check permissions
    const existingEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.get(trx, tenant, masterEntryId);
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
      existingEntry.assigned_user_ids[0] === user.user_id;

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

    if (isVirtualId && deleteType === IEditScope.SINGLE) {
      return {
        success: false,
        error: 'Deleting a single occurrence of a recurring entry is not supported yet.',
      };
    }

    const entryIdToDelete = deleteType === IEditScope.SINGLE ? masterEntryId : masterEntryId;
    const success = await withTransaction(db, async (trx: Knex.Transaction) => {
      return ScheduleEntry.delete(trx, tenant, entryIdToDelete);
    });

    if (success) {
      try {
        await publishEvent({
          eventType: 'SCHEDULE_ENTRY_DELETED',
          payload: {
            tenantId: tenant,
            userId: user.user_id,
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

      if (isScheduleBlockEntry(existingEntry)) {
        const ctx = {
          tenantId: currentUser.tenant,
          actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
        };

        try {
          await publishWorkflowEvent({
            eventType: 'SCHEDULE_BLOCK_DELETED',
            ctx,
            payload: buildScheduleBlockDeletedPayload({
              scheduleBlockId: existingEntry.entry_id,
              reason: deleteType === IEditScope.ALL ? 'Deleted (all occurrences)' : 'Deleted',
            }),
          });
        } catch (eventError) {
          console.error('[ScheduleActions] Failed to publish SCHEDULE_BLOCK_DELETED workflow event', eventError);
        }
      }

      if (shouldEmitAppointmentEvents(existingEntry)) {
        const ticketId =
          getTicketIdFromScheduleEntry(existingEntry) ||
          (existingEntry.work_item_type === 'appointment_request' && existingEntry.work_item_id
            ? await getTicketIdForAppointmentRequest(db, tenant, existingEntry.work_item_id)
            : undefined);

        const ctx = {
          tenantId: currentUser.tenant,
          actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id },
        };

        try {
          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_CANCELED',
            ctx,
            payload: buildAppointmentCanceledPayload({
              appointmentId: existingEntry.entry_id,
              ticketId,
              reason: deleteType === IEditScope.ALL ? 'Deleted (all occurrences)' : 'Deleted',
            }),
          });
        } catch (eventError) {
          console.error('[ScheduleActions] Failed to publish APPOINTMENT_CANCELED workflow event', eventError);
        }
      }

      try {
        await maybePublishCapacityThresholdReached({
          db,
          tenantId: currentUser.tenant,
          actorUserId: currentUser.user_id,
          before: existingEntry,
        });
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish CAPACITY_THRESHOLD_REACHED workflow event', eventError);
      }
    }

    return { success };
  } catch (error) {
    console.error('Error deleting schedule entry:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete schedule entry';
    return { success: false, error: message };
  }
});

/**
 * Get a schedule entry by ID
 * @param entryId The ID of the schedule entry to retrieve
 * @param user The authenticated user
 * @returns The schedule entry or null if not found
 */
export const getScheduleEntryById = withAuth(async (
  user,
  { tenant },
  entryId: string
): Promise<IScheduleEntry | null> => {
  try {
    const { knex: db } = await createTenantKnex();
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
    if (scheduleEntry.is_private && !assignedUserIds.includes(user.user_id)) {
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
});

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
