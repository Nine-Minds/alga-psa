'use server'
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { IScheduleEntry, IEditScope, DeletionValidationResult } from '@alga-psa/types';
import { WorkItemType } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
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
} from '@alga-psa/workflow-streams';
import {
  buildScheduleBlockCreatedPayload,
  buildScheduleBlockDeletedPayload,
  isScheduleBlockEntry,
} from '@alga-psa/workflow-streams';
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
} from '@alga-psa/workflow-streams';
import { maybePublishCapacityThresholdReached } from '../lib/capacityThresholdWorkflowEvents';
import { resolveTeamsMeetingService } from '../lib/teamsMeetingService';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { resolveAppointmentTeamsMeetingContext } from '../lib/teamsMeetingContent';
import {
  applyEntryAccess,
  buildVisibilityFilter,
  canAssignUser,
  evaluateEntryAccess,
  levelAtLeast,
  maskEntry,
  resolveCalendarAccess,
  type CalendarAccess,
} from '../lib/calendarAccess';

export type ScheduleActionResult<T> =
  | { success: true; entries: T; error?: never }
  | { success: false; error: string; entries?: never }

type ScheduleActionError = ActionMessageError | ActionPermissionError;

function scheduleActionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message.startsWith('Permission denied')) {
    return message;
  }

  if (message === 'Schedule entry not found' || /^Schedule entry .+ not found/.test(message)) {
    return 'Schedule entry not found.';
  }

  if (/^Users .+ not found/.test(message)) {
    return 'One or more assigned users could not be found.';
  }

  if (message === 'Virtual timestamp is required for future updates') {
    return 'Select a recurrence occurrence before updating future schedule entries.';
  }

  return fallback;
}

function scheduleActionErrorFrom(error: unknown): ScheduleActionError | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (message.startsWith('Permission denied')) {
    return permissionError(message);
  }

  if (message === 'Schedule entry not found' || /^Schedule entry .+ not found/.test(message)) {
    return actionError('Schedule entry not found.', 'msp/schedule:errors.entry.notFound');
  }

  if (/^Users .+ not found/.test(message)) {
    return actionError('One or more assigned users could not be found.', 'msp/schedule:errors.entry.assigneesMissing');
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected schedule entry is invalid. Please refresh and try again.', 'msp/schedule:errors.entry.invalid');
  }

  return null;
}

async function getTicketIdForAppointmentRequest(
  db: Knex,
  tenant: string,
  appointmentRequestId: string
): Promise<string | undefined> {
  const row = await withTransaction(db, async (trx: Knex.Transaction) => {
    return await (tenantDb(trx, tenant) as any).table('appointment_requests')
      .where({ appointment_request_id: appointmentRequestId })
      .select('ticket_id')
      .first();
  });
  return row?.ticket_id || undefined;
}

/**
 * Fetches schedule entries visible to the viewer for a date range.
 *
 * Visibility comes from the shared-calendar resolver (lib/calendarAccess):
 * the viewer's own entries, entries on personal calendars shared with them,
 * entries on group calendars they belong to, and — for `user_schedule:update`
 * holders — everyone's entries. Busy-level entries are masked server-side and
 * every returned entry carries `access` and `can_edit`.
 *
 * `technicianIds` / `calendarIds` optionally narrow the result to specific
 * people and group calendars (the schedule page's overlay selection).
 */
export const getScheduleEntries = withAuth(async (
  user,
  { tenant },
  start: Date,
  end: Date,
  technicianIds?: string[],
  calendarIds?: string[]
): Promise<ScheduleActionResult<IScheduleEntry[]>> => {
  try {
    const { knex: db } = await createTenantKnex();

    const canRead = await hasPermission(user, 'user_schedule', 'read', db);
    if (!canRead) {
        console.warn(`User ${user.user_id} lacks user_schedule:read permission.`);
        return { success: true, entries: [] };
    }

    // `user_schedule:update` keeps implicit view/edit of every calendar.
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);

    const entries = await withTransaction(db, async (trx: Knex.Transaction) => {
      const access = await resolveCalendarAccess(trx, tenant, user, canUpdate);
      const candidates = await ScheduleEntry.getAll(trx, tenant, start, end, buildVisibilityFilter(access));
      const visible = applyEntryAccess(candidates, access);

      const narrowByPeople = technicianIds && technicianIds.length > 0;
      const narrowByCalendars = calendarIds && calendarIds.length > 0;
      if (!narrowByPeople && !narrowByCalendars) {
        return visible;
      }

      return visible.filter(entry =>
        (narrowByPeople && entry.assigned_user_ids.some(assignedId => technicianIds!.includes(assignedId))) ||
        (narrowByCalendars && !!entry.calendar_id && calendarIds!.includes(entry.calendar_id)) ||
        (canUpdate && entry.assigned_user_ids.length === 0 && entry.work_item_type === 'appointment_request')
      );
    });

    return { success: true, entries };
  } catch (error) {
    console.error('Error fetching schedule entries:', error);
    const message = scheduleActionErrorMessage(error, 'Failed to fetch schedule entries');
    return { success: false, error: message };
  }
});

/**
 * Validate a target group calendar for an entry: it must exist, be a
 * non-archived group calendar, and the viewer must have edit or higher on it.
 */
async function assertEditableGroupCalendar(
  trx: Knex.Transaction,
  tenant: string,
  calendarId: string,
  access: CalendarAccess
): Promise<string | null> {
  const calendar = await tenantDb(trx, tenant).table('calendars')
    .where({ calendar_id: calendarId })
    .first('calendar_type', 'is_archived');
  if (!calendar || calendar.calendar_type !== 'group' || calendar.is_archived) {
    return 'The selected calendar is not available.';
  }
  if (!levelAtLeast(access.groupLevels.get(calendarId)?.level, 'edit')) {
    return 'Permission denied to add entries to this calendar.';
  }
  return null;
}

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

    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);
    const access = await withTransaction(db, async (trx: Knex.Transaction) =>
      resolveCalendarAccess(trx, tenant, user, canUpdate)
    );

    // Group calendar placement: must be an editable, non-archived group
    // calendar; group entries are never private.
    const calendarId = entry.calendar_id || null;
    if (calendarId) {
      const calendarError = await withTransaction(db, async (trx: Knex.Transaction) =>
        assertEditableGroupCalendar(trx, tenant, calendarId, access)
      );
      if (calendarError) {
        return { success: false, error: calendarError };
      }
      entry.calendar_id = calendarId;
      entry.is_private = false;
    } else {
      entry.calendar_id = null;
    }

    // Determine final assignedUserIds, preferring entry.assigned_user_ids, then options.
    // Personal entries default to the current user; group calendar entries may be unassigned.
    let assignedUserIds: string[];
    if (entry.assigned_user_ids && entry.assigned_user_ids.length > 0) {
      assignedUserIds = entry.assigned_user_ids;
    } else if (options?.assignedUserIds && options.assignedUserIds.length > 0) {
      assignedUserIds = options.assignedUserIds;
    } else if (calendarId) {
      assignedUserIds = [];
    } else {
      assignedUserIds = [user.user_id];
    }

    // --- Permission Check ---
    // Without user_schedule:update a viewer may only assign themselves and
    // users whose calendars they have edit access to.
    if (assignedUserIds.some(id => !canAssignUser(id, access))) {
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
        tenantId: tenant,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
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
        tenantId: tenant,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
      };

      try {
        await publishWorkflowEvent({
          eventType: 'APPOINTMENT_CREATED',
          ctx,
          payload: buildAppointmentCreatedPayload({
            entry: createdEntry,
            ticketId,
            timezone,
            createdByUserId: user.user_id,
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
                dispatchedByUserId: user.user_id,
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
        tenantId: tenant,
        actorUserId: user.user_id,
        after: createdEntry,
      });
    } catch (eventError) {
      console.error('[ScheduleActions] Failed to publish CAPACITY_THRESHOLD_REACHED workflow event', eventError);
    }

    return { success: true, entry: createdEntry };
  } catch (error) {
    console.error('Error creating schedule entry:', error);
    const message = scheduleActionErrorMessage(error, 'Failed to create schedule entry');
    return { success: false, error: message };
  }
});

/**
 * Keeps an appointment's linked Teams meeting in sync when the schedule entry
 * is rescheduled directly on the calendar (drag/edit) — not just through the
 * appointment-request reschedule action. PATCHes the Graph event with the new
 * times plus refreshed subject/attendees so attendees receive an updated
 * calendar invite, then moves the online_meetings row. Best-effort and
 * post-commit (never rolls back the schedule change); returns a warning string
 * when the Graph update could not be applied.
 */
async function syncTeamsMeetingForRescheduledEntry(
  db: Knex,
  tenant: string,
  updatedEntry: IScheduleEntry,
): Promise<string | undefined> {
  if (updatedEntry.work_item_type !== 'appointment_request' || !updatedEntry.work_item_id) {
    return syncTeamsMeetingForRescheduledEntryLink(db, tenant, updatedEntry);
  }

  const scopedDb = tenantDb(db, tenant) as any;
  const request = await scopedDb.table('appointment_requests')
    .where({ appointment_request_id: updatedEntry.work_item_id, tenant })
    .first();
  if (!request) {
    return undefined;
  }

  const onlineMeeting = await scopedDb.table('online_meetings')
    .where({ appointment_request_id: request.appointment_request_id })
    .first();

  const provider = onlineMeeting?.provider ?? request.online_meeting_provider;
  const providerMeetingId = onlineMeeting?.provider_meeting_id ?? request.online_meeting_id;
  const liveStatuses = ['scheduled', 'recording_pending', 'recording_ready', 'ended', 'no_recording'];
  const meetingIsLive = onlineMeeting ? liveStatuses.includes(onlineMeeting.status) : true;
  if (provider !== 'teams' || !providerMeetingId || !meetingIsLive) {
    return undefined;
  }

  const startDate = new Date(updatedEntry.scheduled_start as unknown as string);
  const endDate = new Date(updatedEntry.scheduled_end as unknown as string);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return undefined;
  }

  const context = await resolveAppointmentTeamsMeetingContext({
    trx: db,
    tenant,
    request: {
      appointment_request_id: request.appointment_request_id,
      service_id: request.service_id,
      is_authenticated: request.is_authenticated,
      contact_id: request.contact_id,
      requester_email: request.requester_email,
      requester_name: request.requester_name,
      description: request.description,
      schedule_entry_id: updatedEntry.entry_id,
    },
  });

  const teamsMeetingService = await resolveTeamsMeetingService();
  const outcome = await teamsMeetingService.updateTeamsMeetingWithResult({
    tenantId: tenant,
    meetingId: providerMeetingId,
    eventId: onlineMeeting?.provider_event_id ?? null,
    startDateTime: startDate.toISOString(),
    endDateTime: endDate.toISOString(),
    subject: context.subject,
    attendees: context.attendees,
    bodyHtml: context.bodyHtml,
    appointmentRequestId: request.appointment_request_id,
  });

  if (outcome.status === 'skipped') {
    // Tenant not configured for Teams meetings — the local move stands; no invite change.
    return undefined;
  }

  if (outcome.status === 'failed') {
    return 'Appointment moved, but the Microsoft Teams meeting could not be rescheduled. Please update it manually in Teams.';
  }

  if (onlineMeeting) {
    await scopedDb.table('online_meetings')
      .where({ meeting_id: onlineMeeting.meeting_id })
      .update({ start_time: startDate, end_time: endDate, updated_at: new Date() });
  }

  return undefined;
}

/**
 * Same contract as syncTeamsMeetingForRescheduledEntry, for meetings attached
 * directly to a schedule entry (online_meetings.schedule_entry_id, created
 * from the calendar entry editor) rather than through an appointment request.
 * Subject follows the entry title; attendees are left untouched.
 */
async function syncTeamsMeetingForRescheduledEntryLink(
  db: Knex,
  tenant: string,
  updatedEntry: IScheduleEntry,
): Promise<string | undefined> {
  const scopedDb = tenantDb(db, tenant) as any;
  const onlineMeeting = await scopedDb.table('online_meetings')
    .where({ schedule_entry_id: updatedEntry.entry_id })
    .whereNull('appointment_request_id')
    .whereNot('status', 'cancelled')
    .first();

  if (!onlineMeeting || onlineMeeting.provider !== 'teams' || !onlineMeeting.provider_meeting_id) {
    return undefined;
  }

  const startDate = new Date(updatedEntry.scheduled_start as unknown as string);
  const endDate = new Date(updatedEntry.scheduled_end as unknown as string);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return undefined;
  }

  const teamsMeetingService = await resolveTeamsMeetingService();
  const outcome = await teamsMeetingService.updateTeamsMeetingWithResult({
    tenantId: tenant,
    meetingId: onlineMeeting.provider_meeting_id,
    eventId: onlineMeeting.provider_event_id ?? null,
    startDateTime: startDate.toISOString(),
    endDateTime: endDate.toISOString(),
    subject: updatedEntry.title ?? null,
    attendees: null,
    bodyHtml: null,
    appointmentRequestId: null,
  });

  if (outcome.status === 'skipped') {
    return undefined;
  }

  if (outcome.status === 'failed') {
    return 'Entry moved, but the Microsoft Teams meeting could not be rescheduled. Please update it manually in Teams.';
  }

  await scopedDb.table('online_meetings')
    .where({ meeting_id: onlineMeeting.meeting_id })
    .update({
      start_time: startDate,
      end_time: endDate,
      subject: updatedEntry.title ?? onlineMeeting.subject,
      updated_at: new Date(),
    });

  return undefined;
}

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
    const isPrivateEntry = existingEntry.is_private && !existingEntry.calendar_id;
    const isOwnEntry =
      existingEntry.assigned_user_ids.length === 1 &&
      existingEntry.assigned_user_ids[0] === user.user_id;

    // If the entry is private, only its sole assignee can edit it
    if (isPrivateEntry && !isOwnEntry) {
      return { success: false, error: 'Permission denied to edit a private schedule entry.' };
    }

    const access = await withTransaction(db, async (trx: Knex.Transaction) =>
      resolveCalendarAccess(trx, tenant, user, canUpdateGlobally)
    );
    const decision = evaluateEntryAccess(existingEntry, access);
    if (decision.access === 'none' || !decision.canEdit) {
      return { success: false, error: 'Permission denied to update this schedule entry.' };
    }

    // Newly added assignees must be users the viewer may assign.
    if (entry.assigned_user_ids) {
      const addedAssignees = entry.assigned_user_ids.filter(
        id => !existingEntry.assigned_user_ids.includes(id)
      );
      if (addedAssignees.some(id => !canAssignUser(id, access))) {
        return { success: false, error: 'Permission denied to assign schedule entries to other users.' };
      }
    }

    // Moving the entry onto a (different) group calendar requires edit there.
    if (entry.calendar_id !== undefined) {
      const targetCalendarId = entry.calendar_id || null;
      entry.calendar_id = targetCalendarId;
      if (targetCalendarId && targetCalendarId !== existingEntry.calendar_id) {
        const calendarError = await withTransaction(db, async (trx: Knex.Transaction) =>
          assertEditableGroupCalendar(trx, tenant, targetCalendarId, access)
        );
        if (calendarError) {
          return { success: false, error: calendarError };
        }
      }
    }
    // Group calendar entries are never private.
    const resultingCalendarId =
      entry.calendar_id !== undefined ? entry.calendar_id : existingEntry.calendar_id;
    if (resultingCalendarId) {
      entry.is_private = false;
    }
    // --- End Permission Check ---

    let teamsMeetingWarning: string | undefined;

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
      return await ScheduleEntry.update(trx, tenant, entry_id, updateData, entry.updateType);
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
          tenantId: tenant,
          actor: { actorType: 'USER' as const, actorUserId: user.user_id },
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
          tenantId: tenant,
          actor: { actorType: 'USER' as const, actorUserId: user.user_id },
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

      // Meetings attached directly to this entry (online_meetings.schedule_entry_id,
      // created from the calendar entry editor) must follow a reschedule too.
      // Appointment/ticket entries reach the same sync helper through the
      // appointment-events block below.
      if (
        !shouldEmitAppointmentEvents(existingEntry) &&
        !shouldEmitAppointmentEvents(updatedEntry) &&
        isAppointmentRescheduled(existingEntry, updatedEntry)
      ) {
        try {
          teamsMeetingWarning = await syncTeamsMeetingForRescheduledEntry(db, tenant, updatedEntry);
        } catch (teamsError) {
          console.error('[ScheduleActions] Failed to sync Teams meeting on reschedule', teamsError);
          teamsMeetingWarning = 'Entry moved, but the Microsoft Teams meeting could not be rescheduled. Please update it manually in Teams.';
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
          tenantId: tenant,
          actor: { actorType: 'USER' as const, actorUserId: user.user_id },
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

            // Keep the linked Teams meeting in sync with the calendar move so
            // attendees get an updated invite (best-effort, post-commit).
            try {
              teamsMeetingWarning = await syncTeamsMeetingForRescheduledEntry(db, tenant, updatedEntry);
            } catch (teamsError) {
              console.error('[ScheduleActions] Failed to sync Teams meeting on reschedule', teamsError);
              teamsMeetingWarning = 'Appointment moved, but the Microsoft Teams meeting could not be rescheduled. Please update it manually in Teams.';
            }
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
                  dispatchedByUserId: user.user_id,
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
          tenantId: tenant,
          actorUserId: user.user_id,
          before: existingEntry,
          after: updatedEntry,
        });
      } catch (eventError) {
        console.error('[ScheduleActions] Failed to publish CAPACITY_THRESHOLD_REACHED workflow event', eventError);
      }
    }

    return { success: true, entry: updatedEntry, teamsMeetingWarning };
  } catch (error) {
    console.error('Error updating schedule entry:', error);
    const message = scheduleActionErrorMessage(error, 'Failed to update schedule entry');
    return { success: false, error: message };
  }
});

export const deleteScheduleEntry = withAuth(async (
  user,
  { tenant },
  entry_id: string,
  deleteType: IEditScope = IEditScope.SINGLE
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean; isPrivateError?: boolean; error?: string }> => {
  try {
    const { knex: db } = await createTenantKnex();

    const isVirtualId = entry_id.includes('_');
    const masterEntryId = isVirtualId ? entry_id.split('_')[0] : entry_id;

    const existingEntry = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await ScheduleEntry.get(trx, tenant, masterEntryId);
    });

    if (!existingEntry) {
      return {
        success: true,
        deleted: true,
        canDelete: true,
        dependencies: [],
        alternatives: []
      };
    }

    const isPrivateEntry = existingEntry.is_private;
    const isOwnEntry =
      existingEntry.assigned_user_ids.length === 1 &&
      existingEntry.assigned_user_ids[0] === user.user_id;

    if (isPrivateEntry && !isOwnEntry) {
      const message = 'This is a private entry. Only the creator can delete it.';
      return {
        success: false,
        error: message,
        isPrivateError: true,
        canDelete: false,
        code: 'PERMISSION_DENIED',
        message,
        dependencies: [],
        alternatives: []
      };
    }

    const canUpdateGlobally = await hasPermission(user, 'user_schedule', 'update', db);
    const access = await withTransaction(db, async (trx: Knex.Transaction) =>
      resolveCalendarAccess(trx, tenant, user, canUpdateGlobally)
    );
    const decision = evaluateEntryAccess(existingEntry, access);
    if (decision.access === 'none' || !decision.canEdit) {
      const message = 'Permission denied to delete this schedule entry.';
      return {
        success: false,
        error: message,
        canDelete: false,
        code: 'PERMISSION_DENIED',
        message,
        dependencies: [],
        alternatives: []
      };
    }

    const appointmentRequestRow =
      existingEntry.work_item_type === 'appointment_request' && existingEntry.work_item_id
        ? await withTransaction(db, async (trx: Knex.Transaction) => {
            return await (tenantDb(trx, tenant) as any).table('appointment_requests')
              .where({
                appointment_request_id: existingEntry.work_item_id,
                tenant,
              })
              .first();
          })
        : null;
    const onlineMeetingRow = appointmentRequestRow
      ? await withTransaction(db, async (trx: Knex.Transaction) => {
          return await (tenantDb(trx, tenant) as any).table('online_meetings')
            .where({
              appointment_request_id: appointmentRequestRow.appointment_request_id,
            })
            .first();
        })
      : null;

    const result = await deleteEntityWithValidation('schedule_entry', masterEntryId, db, tenant, async (trx, tenantId) => {
      const scopedDb = tenantDb(trx, tenantId) as any;
      // Clean up schedule conflicts referencing this entry
      await scopedDb.table('schedule_conflicts')
        .where(function(this: any) {
          this.where('entry_id_1', masterEntryId).orWhere('entry_id_2', masterEntryId);
        })
        .del();

      const success = await ScheduleEntry.delete(trx, tenantId, entry_id, deleteType);
      if (!success) {
        throw new Error('Schedule entry not found');
      }

      // A deal step points at its calendar entry; deleting the entry here
      // must clear that pointer (and the step's timed flag) or the step's
      // next edit would resurrect the entry. Tenant-scoped knex keeps the
      // dependency direction clean — scheduling never imports opportunities.
      if (existingEntry.work_item_type === 'opportunity_step') {
        await (tenantDb(trx, tenantId) as any).table('opportunity_steps')
          .where({ schedule_entry_id: masterEntryId })
          .update({
            schedule_entry_id: null,
            has_time: false,
            updated_at: new Date().toISOString(),
          });
      }
    });

    if (!result.deleted) {
      return {
        ...result,
        success: false,
        error: result.message ?? 'Failed to delete schedule entry'
      };
    }

    if (appointmentRequestRow) {
      await withTransaction(db, async (trx: Knex.Transaction) => {
        const scopedDb = tenantDb(trx, tenant) as any;
        const nextUpdate: Record<string, unknown> = {
          schedule_entry_id: null,
          online_meeting_provider: null,
          online_meeting_url: null,
          online_meeting_id: null,
          updated_at: new Date(),
        };

        if (appointmentRequestRow.status === 'approved') {
          nextUpdate.status = 'cancelled';
          nextUpdate.declined_reason = 'Cancelled by MSP';
        }

        await scopedDb.table('appointment_requests')
          .where({
            appointment_request_id: appointmentRequestRow.appointment_request_id,
            tenant,
          })
          .update(nextUpdate);

        await scopedDb.table('online_meetings')
          .where({
            appointment_request_id: appointmentRequestRow.appointment_request_id,
            tenant,
          })
          .update({
            status: 'cancelled',
            updated_at: new Date(),
          });
      });

      const teamsMeetingId = onlineMeetingRow?.provider_meeting_id ?? appointmentRequestRow.online_meeting_id;
      if ((onlineMeetingRow?.provider === 'teams' || appointmentRequestRow.online_meeting_provider === 'teams') && teamsMeetingId) {
        const teamsMeetingService = await resolveTeamsMeetingService();
        await teamsMeetingService.deleteTeamsMeeting({
          tenantId: tenant,
          meetingId: teamsMeetingId,
          eventId: onlineMeetingRow?.provider_event_id ?? null,
          appointmentRequestId: appointmentRequestRow.appointment_request_id,
        });
      }
    }

    // Meetings attached directly to this entry (online_meetings.schedule_entry_id,
    // created from the calendar entry editor) die with the entry: cancel the
    // active rows, then best-effort delete the Graph meetings so invites are
    // retracted. The Graph retraction deliberately includes rows already marked
    // cancelled: a local cancellation does not prove the external meeting was
    // retracted (migration 20260903160000 collapses duplicate rows locally
    // without touching Graph, and an earlier best-effort delete may have
    // failed). deleteTeamsMeeting treats an already-deleted meeting (Graph 404)
    // as success, so retrying here is safe and idempotent.
    const entryLinkedMeetings: Array<{
      meeting_id: string;
      provider: string;
      provider_meeting_id: string | null;
      provider_event_id: string | null;
      status: string;
    }> = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await (tenantDb(trx, tenant) as any).table('online_meetings')
        .where({ schedule_entry_id: masterEntryId })
        .whereNull('appointment_request_id')
        .select('meeting_id', 'provider', 'provider_meeting_id', 'provider_event_id', 'status');
    });

    if (entryLinkedMeetings.length > 0) {
      const activeMeetings = entryLinkedMeetings.filter((meeting) => meeting.status !== 'cancelled');
      if (activeMeetings.length > 0) {
        await withTransaction(db, async (trx: Knex.Transaction) => {
          await (tenantDb(trx, tenant) as any).table('online_meetings')
            .whereIn('meeting_id', activeMeetings.map((meeting) => meeting.meeting_id))
            .update({ status: 'cancelled', updated_at: new Date() });
        });
      }

      const teamsMeetingService = await resolveTeamsMeetingService();
      for (const meeting of entryLinkedMeetings) {
        if (meeting.provider !== 'teams' || !meeting.provider_meeting_id) {
          continue;
        }
        await teamsMeetingService.deleteTeamsMeeting({
          tenantId: tenant,
          meetingId: meeting.provider_meeting_id,
          eventId: meeting.provider_event_id ?? null,
          appointmentRequestId: null,
        });
      }
    }

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
        tenantId: tenant,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
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
        tenantId: tenant,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
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
        tenantId: tenant,
        actorUserId: user.user_id,
        before: existingEntry,
      });
    } catch (eventError) {
      console.error('[ScheduleActions] Failed to publish CAPACITY_THRESHOLD_REACHED workflow event', eventError);
    }

    return {
      ...result,
      success: true,
      deleted: true
    };
  } catch (error) {
    console.error('Error deleting schedule entry:', error);
    const message = scheduleActionErrorMessage(error, 'Failed to delete schedule entry');
    return {
      success: false,
      error: message,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message,
      dependencies: [],
      alternatives: []
    };
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
): Promise<IScheduleEntry | null | ScheduleActionError> => {
  try {
    const { knex: db } = await createTenantKnex();
    const canRead = await hasPermission(user, 'user_schedule', 'read', db);
    if (!canRead) {
      return permissionError('Permission denied to view schedule entries.');
    }
    const canUpdate = await hasPermission(user, 'user_schedule', 'update', db);
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant) as any;

      // Get the schedule entry
      const entry = await scopedDb.table('schedule_entries')
        .where({
          entry_id: entryId,
          tenant
        })
        .first();

      if (!entry) {
        return null;
      }

      // Get assigned users
      const assignees = await scopedDb.table('schedule_entry_assignees')
        .where({
          entry_id: entryId,
          tenant
        })
        .select('user_id');

      const assignedUserIds = assignees.map((a: any) => a.user_id);

      // Combine entry with assigned users
      const scheduleEntry: IScheduleEntry = {
        ...entry,
        assigned_user_ids: assignedUserIds || []
      };

      const access = await resolveCalendarAccess(trx, tenant, user, canUpdate);
      const decision = evaluateEntryAccess(scheduleEntry, access);
      if (decision.access === 'none') {
        return null;
      }
      if (decision.access === 'busy') {
        return maskEntry(scheduleEntry, access);
      }

      return { ...scheduleEntry, access: 'full', can_edit: decision.canEdit };
    });
  } catch (error) {
    console.error('Error fetching schedule entry by ID:', error);
    const expected = scheduleActionErrorFrom(error);
    if (expected) return expected;
    throw error;
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
