'use server';

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { createInteractionWithSideEffects } from '@alga-psa/clients/actions/interactionCreateHelper';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import type { IScheduleEntry } from '@alga-psa/types';
import { resolveTeamsMeetingService, type TeamsMeetingAttendee } from '../lib/teamsMeetingService';

export interface ScheduleTeamsMeetingInput {
  subject: string;
  startDateTime?: string | Date;
  endDateTime?: string | Date;
  start_time?: string | Date;
  end_time?: string | Date;
  client_id?: string | null;
  clientId?: string | null;
  contact_name_id?: string | null;
  contactNameId?: string | null;
  contact_id?: string | null;
  ticket_id?: string | null;
  ticketId?: string | null;
  notes?: string | null;
  attendees?: TeamsMeetingAttendee[];
  createScheduleEntry?: boolean;
  assignedUserIds?: string[];
  scheduleEntry?: {
    title?: string;
    notes?: string | null;
    assignedUserIds?: string[];
    isPrivate?: boolean;
  };
}

export type ScheduleTeamsMeetingResult =
  | {
      success: true;
      data: {
        meeting_id: string;
        interaction_id: string;
        schedule_entry_id: string | null;
        join_url: string;
        provider_meeting_id: string;
      };
    }
  | { success: false; error: string };

function asDate(value: string | Date | undefined, fieldName: string): Date {
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date/time`);
  }

  return date;
}

function capabilityError(reason?: string): string {
  switch (reason) {
    case 'no_organizer':
      return 'Microsoft Teams meeting was not created because no default organizer is configured.';
    case 'ee_disabled':
      return 'Microsoft Teams meetings are only available in Enterprise Edition.';
    case 'not_configured':
    default:
      return 'Microsoft Teams meeting was not created because Teams is not configured for this tenant.';
  }
}

export const scheduleTeamsMeeting = withAuth(async (
  user,
  { tenant },
  input: ScheduleTeamsMeetingInput,
): Promise<ScheduleTeamsMeetingResult> => {
  const { knex: db } = await createTenantKnex();

  try {
    const canSchedule = await hasPermission(user, 'user_schedule', 'update', db);
    if (!canSchedule) {
      return { success: false, error: 'Permission denied to schedule Teams meetings.' };
    }

    const subject = input.subject?.trim();
    if (!subject) {
      return { success: false, error: 'Subject is required.' };
    }

    const start = asDate(input.startDateTime ?? input.start_time, 'startDateTime');
    const end = asDate(input.endDateTime ?? input.end_time, 'endDateTime');
    if (end.getTime() <= start.getTime()) {
      return { success: false, error: 'End time must be after start time.' };
    }

    const clientId = input.client_id ?? input.clientId ?? null;
    const contactNameId = input.contact_name_id ?? input.contactNameId ?? input.contact_id ?? null;
    if (!clientId && !contactNameId) {
      return { success: false, error: 'A client or contact is required.' };
    }

    const teamsMeetingService = await resolveTeamsMeetingService();
    const capability = await teamsMeetingService.getTeamsMeetingCapability(tenant);
    if (!capability.available) {
      return { success: false, error: capabilityError(capability.reason) };
    }

    const createdMeeting = await teamsMeetingService.createTeamsMeeting({
      tenantId: tenant,
      subject,
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      attendees: input.attendees ?? [],
      appointmentRequestId: null,
    });

    if (!createdMeeting) {
      return { success: false, error: 'Microsoft Teams meeting could not be created. Please try again or create it manually in Teams.' };
    }

    const sideEffects: Array<() => Promise<void>> = [];
    const scheduleEvents: Array<{
      entry: IScheduleEntry;
      assignedUserIds: string[];
    }> = [];

    try {
      const result = await withTransaction(db, async (trx: Knex.Transaction) => {
        const onlineMeetingType = await trx('system_interaction_types')
          .where({ type_name: 'Online Meeting' })
          .first('type_id');

        if (!onlineMeetingType?.type_id) {
          throw new Error('Online Meeting interaction type is not configured');
        }

        const interactionResult = await createInteractionWithSideEffects({
          tenant,
          trx,
          user,
          interactionData: {
            type_id: onlineMeetingType.type_id,
            client_id: clientId,
            contact_name_id: contactNameId,
            user_id: user.user_id,
            ticket_id: input.ticket_id ?? input.ticketId ?? null,
            title: `Online Meeting: ${subject}`,
            notes: input.notes ?? `Join Teams Meeting: ${createdMeeting.joinWebUrl}`,
            start_time: start,
            end_time: end,
            duration: Math.ceil((end.getTime() - start.getTime()) / 60000),
          },
        });

        sideEffects.push(interactionResult.publishSideEffects);

        let scheduleEntryId: string | null = null;
        if (input.createScheduleEntry) {
          const assignedUserIds =
            input.scheduleEntry?.assignedUserIds?.length
              ? input.scheduleEntry.assignedUserIds
              : input.assignedUserIds?.length
                ? input.assignedUserIds
                : [user.user_id];
          const scheduleNotes = input.scheduleEntry?.notes ?? input.notes ?? `Join Teams Meeting: ${createdMeeting.joinWebUrl}`;
          const entry = await ScheduleEntry.create(
            trx,
            tenant,
            {
              title: input.scheduleEntry?.title ?? subject,
              scheduled_start: start,
              scheduled_end: end,
              work_item_type: 'interaction',
              work_item_id: interactionResult.interaction.interaction_id,
              status: 'scheduled',
              notes: scheduleNotes,
              assigned_user_ids: assignedUserIds,
              is_recurring: false,
              is_private: !!input.scheduleEntry?.isPrivate,
            },
            {
              assignedUserIds,
              assignedByUserId: user.user_id,
            },
          );
          scheduleEntryId = entry.entry_id;
          scheduleEvents.push({ entry, assignedUserIds });
        }

        const now = new Date();
        const meetingId = uuidv4();
        await trx('online_meetings').insert({
          meeting_id: meetingId,
          tenant,
          provider: 'teams',
          provider_meeting_id: createdMeeting.meetingId,
          provider_event_id: createdMeeting.eventId ?? null,
          organizer_upn: createdMeeting.organizerUpn ?? null,
          organizer_user_id: createdMeeting.organizerUserId ?? null,
          subject,
          join_url: createdMeeting.joinWebUrl,
          start_time: start,
          end_time: end,
          status: 'scheduled',
          recording_fetch_attempts: 0,
          last_fetch_at: null,
          appointment_request_id: null,
          interaction_id: interactionResult.interaction.interaction_id,
          schedule_entry_id: scheduleEntryId,
          created_by: user.user_id,
          created_at: now,
          updated_at: now,
        });

        return {
          meeting_id: meetingId,
          interaction_id: interactionResult.interaction.interaction_id,
          schedule_entry_id: scheduleEntryId,
          join_url: createdMeeting.joinWebUrl,
          provider_meeting_id: createdMeeting.meetingId,
        };
      });

      for (const publishSideEffects of sideEffects) {
        try {
          await publishSideEffects();
        } catch (eventError) {
          console.error('[scheduleTeamsMeeting] Failed to publish Online Meeting interaction side effects', eventError);
        }
      }

      for (const scheduleEvent of scheduleEvents) {
        try {
          await publishEvent({
            eventType: 'SCHEDULE_ENTRY_CREATED',
            payload: {
              tenantId: tenant,
              userId: user.user_id,
              entryId: scheduleEvent.entry.entry_id,
              changes: {
                after: scheduleEvent.entry,
                assignedUserIds: scheduleEvent.assignedUserIds,
              },
            },
          });
        } catch (eventError) {
          console.error('[scheduleTeamsMeeting] Failed to publish SCHEDULE_ENTRY_CREATED event', eventError);
        }
      }

      return { success: true, data: result };
    } catch (dbError) {
      await teamsMeetingService.deleteTeamsMeeting({
        tenantId: tenant,
        meetingId: createdMeeting.meetingId,
        eventId: createdMeeting.eventId ?? null,
        appointmentRequestId: null,
      });
      throw dbError;
    }
  } catch (error) {
    console.error('[scheduleTeamsMeeting] Error scheduling Teams meeting:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to schedule Teams meeting.',
    };
  }
});
