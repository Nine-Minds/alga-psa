'use server';

import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { IEditScope } from '@alga-psa/types';
import type { IRecurrencePattern, IScheduleEntry, IUserWithRoles } from '@alga-psa/types';
import { resolveTeamsMeetingService, type TeamsMeetingAttendee } from '../lib/teamsMeetingService';
import { ensureCreatorAttendee } from '../lib/teamsMeetingContent';

export interface ScheduleTeamsMeetingInput {
  /** Required in create mode; ignored in existing-entry mode, where the entry's title is the subject. */
  subject?: string;
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
  /**
   * Existing-entry mode: attach the Teams meeting to this schedule entry
   * instead of creating a new entry/interaction. The entry is preserved (only
   * its notes gain the join link), the online_meetings row is linked via
   * schedule_entry_id in the same transaction, and a second non-cancelled
   * meeting for the same entry is rejected. A virtual occurrence id of a
   * recurring series (`${masterId}_${timestamp}`) is accepted: that occurrence
   * is materialized into a standalone entry (SINGLE-scope extraction) and the
   * meeting attaches to it; recurring masters themselves are rejected.
   * Mutually exclusive with createScheduleEntry/scheduleEntry; subject/times/
   * client are read from the entry itself.
   */
  scheduleEntryId?: string;
}

export type ScheduleTeamsMeetingResult =
  | {
      success: true;
      data: {
        meeting_id: string;
        /** Null in existing-entry mode, which creates no interaction. */
        interaction_id: string | null;
        /**
         * The entry the meeting is linked to. When a virtual occurrence id was
         * passed, this is the materialized standalone entry — not the input id.
         */
        schedule_entry_id: string | null;
        join_url: string;
        provider_meeting_id: string;
        /** Existing-entry mode only: the entry's notes after the join link was appended. */
        schedule_entry_notes?: string;
      };
    }
  | { success: false; error: string };

export interface ScheduleEntryTeamsMeetingSummary {
  meeting_id: string;
  join_url: string;
  subject: string;
  status: string;
}

export type GetScheduleEntryTeamsMeetingResult =
  | { success: true; data: ScheduleEntryTeamsMeetingSummary | null }
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

function appendJoinUrlToNotes(notes: string | null | undefined, joinUrl: string): string {
  const baseNotes = notes?.trim() ?? '';
  if (!baseNotes) {
    return `Join Teams Meeting: ${joinUrl}`;
  }
  if (baseNotes.includes(joinUrl)) {
    return baseNotes;
  }
  return `${baseNotes}\n\nJoin Teams Meeting: ${joinUrl}`;
}

function teamsSchedulingActionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (
    message === 'startDateTime is required' ||
    message === 'startDateTime must be a valid date/time' ||
    message === 'endDateTime is required' ||
    message === 'endDateTime must be a valid date/time' ||
    message === 'Online Meeting interaction type is not configured' ||
    message === 'Schedule entry not found.' ||
    message === ENTRY_ALREADY_HAS_MEETING_ERROR ||
    message === OCCURRENCE_NOT_AVAILABLE_ERROR
  ) {
    return message;
  }

  if (/^Users .+ not found/.test(message)) {
    return 'One or more assigned users could not be found.';
  }

  return 'Failed to schedule Teams meeting.';
}

const ENTRY_ALREADY_HAS_MEETING_ERROR = 'This schedule entry already has a Teams meeting.';
const OCCURRENCE_NOT_AVAILABLE_ERROR =
  'This occurrence is no longer part of the recurring series. Refresh the calendar and try again.';

/** Occurrences of a recurring series carry composite ids (`${masterId}_${timestamp}`). */
function isVirtualScheduleEntryId(entryId: string): boolean {
  return entryId.includes('_');
}

/**
 * The partial unique index behind duplicate prevention (one non-cancelled
 * meeting per schedule entry). Citus reports violations under shard-local
 * names (`online_meetings_schedule_entry_active_unique_102008`), so matching
 * is by prefix.
 */
const ENTRY_MEETING_UNIQUE_INDEX = 'online_meetings_schedule_entry_active_unique';

function isDuplicateEntryMeetingViolation(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string; message?: string } | null;
  if (pgError?.code !== '23505') {
    return false;
  }
  return (
    (pgError.constraint ?? '').startsWith(ENTRY_MEETING_UNIQUE_INDEX) ||
    (pgError.message ?? '').includes(ENTRY_MEETING_UNIQUE_INDEX)
  );
}

/** Exceptions mark extracted/deleted occurrences by their UTC day, mirroring the generator's filter. */
function occurrenceIsExcepted(pattern: IRecurrencePattern | null, occurrenceStart: Date): boolean {
  if (!pattern?.exceptions?.length) {
    return false;
  }
  const target = new Date(occurrenceStart);
  target.setUTCHours(0, 0, 0, 0);
  return pattern.exceptions.some((exception) => {
    const day = new Date(exception);
    day.setUTCHours(0, 0, 0, 0);
    return day.getTime() === target.getTime();
  });
}

/** How far around the occurrence instant the recurrence engine generates when resolving a virtual id. */
const OCCURRENCE_RESOLUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

type ExistingEntryTarget =
  | { kind: 'concrete'; entry: IScheduleEntry }
  | {
      kind: 'occurrence';
      masterEntryId: string;
      /** The generated occurrence: master fields with occurrence times and assignments. */
      occurrence: IScheduleEntry;
    };

async function findActiveMeetingForEntry(
  conn: Knex | Knex.Transaction,
  tenant: string,
  scheduleEntryId: string,
): Promise<{ meeting_id: string; join_url: string; subject: string; status: string } | undefined> {
  return tenantDb(conn, tenant).table('online_meetings')
    .where({ schedule_entry_id: scheduleEntryId })
    .whereNot('status', 'cancelled')
    .orderBy('created_at', 'desc')
    .first('meeting_id', 'join_url', 'subject', 'status');
}

/**
 * Attendees for an entry-attached meeting: the entry's assigned users (the
 * creator is guaranteed separately via ensureCreatorAttendee). Missing emails
 * are tolerated — the meeting is still created without that invite.
 */
async function buildEntryAssigneeAttendees(
  db: Knex,
  tenant: string,
  assignedUserIds: string[],
): Promise<TeamsMeetingAttendee[]> {
  if (assignedUserIds.length === 0) {
    return [];
  }

  const rows: Array<{ email: string | null; first_name: string | null; last_name: string | null }> =
    await tenantDb(db, tenant).table('users')
      .whereIn('user_id', assignedUserIds)
      .select('email', 'first_name', 'last_name');

  const attendees: TeamsMeetingAttendee[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const email = row.email?.trim();
    if (!email || seen.has(email.toLowerCase())) {
      continue;
    }
    seen.add(email.toLowerCase());
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    attendees.push({
      emailAddress: { address: email, ...(name ? { name } : {}) },
      type: 'required',
    });
  }
  return attendees;
}

/**
 * Existing-entry mode of scheduleTeamsMeeting: the entry is the source of
 * truth for subject/times/attendees and is preserved — only its notes gain the
 * join link. The online_meetings row is linked via schedule_entry_id in the
 * same transaction as that notes update. Duplicates cannot land twice: the
 * re-check runs under a row lock on the entry, and the partial unique index
 * on (tenant, schedule_entry_id) backstops anything the lock doesn't cover.
 *
 * A virtual occurrence id of a recurring series is scoped to that concrete
 * occurrence: the engine's SINGLE-scope extraction materializes it into a
 * standalone entry (adding the exception to the master) inside the same
 * transaction, and the meeting attaches to the materialized entry. Recurring
 * masters themselves are rejected — a meeting belongs to one occurrence, not
 * a series. No interaction is created and no SCHEDULE_ENTRY_CREATED event is
 * published.
 */
async function scheduleTeamsMeetingForExistingEntry(
  user: IUserWithRoles,
  tenant: string,
  db: Knex,
  input: ScheduleTeamsMeetingInput,
): Promise<ScheduleTeamsMeetingResult> {
  const scheduleEntryId = input.scheduleEntryId!;

  if (input.createScheduleEntry || input.scheduleEntry) {
    return { success: false, error: 'scheduleEntryId cannot be combined with createScheduleEntry.' };
  }

  let target: ExistingEntryTarget;
  if (isVirtualScheduleEntryId(scheduleEntryId)) {
    const [masterEntryId, timestampPart] = scheduleEntryId.split('_');
    const occurrenceTime = Number(timestampPart);
    if (!masterEntryId || !Number.isFinite(occurrenceTime)) {
      return { success: false, error: OCCURRENCE_NOT_AVAILABLE_ERROR };
    }

    // Resolve through the recurrence engine so exactly the occurrences the
    // calendar shows (pattern, exceptions, holidays) are accepted — an
    // already-extracted or deleted occurrence no longer generates.
    const occurrence = (await ScheduleEntry.getRecurringEntriesInRange(
      db,
      tenant,
      new Date(occurrenceTime - OCCURRENCE_RESOLUTION_WINDOW_MS),
      new Date(occurrenceTime + OCCURRENCE_RESOLUTION_WINDOW_MS),
    )).find((candidate) => candidate.entry_id === scheduleEntryId);

    if (!occurrence) {
      return { success: false, error: OCCURRENCE_NOT_AVAILABLE_ERROR };
    }

    target = { kind: 'occurrence', masterEntryId, occurrence };
  } else {
    const entry = await ScheduleEntry.get(db, tenant, scheduleEntryId);
    if (!entry) {
      return { success: false, error: 'Schedule entry not found.' };
    }
    if (entry.is_recurring) {
      return {
        success: false,
        error: 'Teams meetings can only be attached to a single occurrence, not a recurring series.',
      };
    }
    target = { kind: 'concrete', entry };
  }

  const sourceEntry = target.kind === 'concrete' ? target.entry : target.occurrence;

  const subject = sourceEntry.title?.trim();
  if (!subject) {
    return { success: false, error: 'Subject is required.' };
  }

  const start = asDate(sourceEntry.scheduled_start as unknown as string | Date, 'startDateTime');
  const end = asDate(sourceEntry.scheduled_end as unknown as string | Date, 'endDateTime');
  if (end.getTime() <= start.getTime()) {
    return { success: false, error: 'End time must be after start time.' };
  }

  // Pre-check before the Graph call so the common duplicate path never creates
  // an orphan meeting; the locked re-check inside the transaction closes the
  // race. Occurrences have no concrete entry yet, so nothing can be linked.
  if (target.kind === 'concrete' && (await findActiveMeetingForEntry(db, tenant, scheduleEntryId))) {
    return { success: false, error: ENTRY_ALREADY_HAS_MEETING_ERROR };
  }

  const teamsMeetingService = await resolveTeamsMeetingService();
  const capability = await teamsMeetingService.getTeamsMeetingCapability(tenant);
  if (!capability.available) {
    return { success: false, error: capabilityError(capability.reason) };
  }

  const attendees = ensureCreatorAttendee(
    input.attendees ?? await buildEntryAssigneeAttendees(db, tenant, sourceEntry.assigned_user_ids ?? []),
    user,
  );

  const createdMeeting = await teamsMeetingService.createTeamsMeeting({
    tenantId: tenant,
    subject,
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    attendees,
    appointmentRequestId: null,
  });

  if (!createdMeeting) {
    return { success: false, error: 'Microsoft Teams meeting could not be created. Please try again or create it manually in Teams.' };
  }

  try {
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);

      let linkedEntryId: string;
      let notes: string;

      if (target.kind === 'occurrence') {
        // Lock the master row so concurrent materializations of the same
        // occurrence serialize; the loser then sees the exception this
        // extraction adds and is rejected instead of extracting twice.
        const lockedMaster = await scopedDb.table('schedule_entries')
          .where({ entry_id: target.masterEntryId })
          .forUpdate()
          .first('entry_id', 'recurrence_pattern');
        if (!lockedMaster) {
          throw new Error(OCCURRENCE_NOT_AVAILABLE_ERROR);
        }
        const lockedPattern = ScheduleEntry.parseRecurrencePattern(lockedMaster.recurrence_pattern);
        if (!lockedPattern || occurrenceIsExcepted(lockedPattern, start)) {
          throw new Error(OCCURRENCE_NOT_AVAILABLE_ERROR);
        }

        notes = appendJoinUrlToNotes(sourceEntry.notes, createdMeeting.joinWebUrl);
        // The engine's SINGLE scope is the occurrence-materialization path:
        // it extracts the occurrence into a standalone entry, copies the
        // master's assignments, and adds the exception to the master.
        const materialized = await ScheduleEntry.update(
          trx,
          tenant,
          scheduleEntryId,
          { scheduled_start: start, scheduled_end: end, notes },
          IEditScope.SINGLE,
        );
        if (!materialized) {
          throw new Error(OCCURRENCE_NOT_AVAILABLE_ERROR);
        }
        linkedEntryId = materialized.entry_id;
      } else {
        // Lock the entry row so concurrent creates for the same entry
        // serialize on the duplicate re-check instead of both passing it.
        const lockedEntry = await scopedDb.table('schedule_entries')
          .where({ entry_id: scheduleEntryId })
          .forUpdate()
          .first('entry_id');
        if (!lockedEntry) {
          throw new Error('Schedule entry not found.');
        }
        if (await findActiveMeetingForEntry(trx, tenant, scheduleEntryId)) {
          throw new Error(ENTRY_ALREADY_HAS_MEETING_ERROR);
        }

        notes = appendJoinUrlToNotes(target.entry.notes, createdMeeting.joinWebUrl);
        await scopedDb.table('schedule_entries')
          .where({ entry_id: scheduleEntryId })
          .update({ notes, updated_at: new Date() });
        linkedEntryId = scheduleEntryId;
      }

      const now = new Date();
      const meetingId = uuidv4();
      try {
        await scopedDb.table('online_meetings').insert({
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
          interaction_id: null,
          schedule_entry_id: linkedEntryId,
          created_by: user.user_id,
          created_at: now,
          updated_at: now,
        });
      } catch (insertError) {
        // The partial unique index is the backstop for anything the row lock
        // doesn't serialize (e.g. entry-linked rows inserted elsewhere).
        if (isDuplicateEntryMeetingViolation(insertError)) {
          throw new Error(ENTRY_ALREADY_HAS_MEETING_ERROR);
        }
        throw insertError;
      }

      return {
        meeting_id: meetingId,
        interaction_id: null,
        schedule_entry_id: linkedEntryId,
        join_url: createdMeeting.joinWebUrl,
        provider_meeting_id: createdMeeting.meetingId,
        schedule_entry_notes: notes,
      };
    });

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

    if (input.scheduleEntryId) {
      return await scheduleTeamsMeetingForExistingEntry(user, tenant, db, input);
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
      attendees: ensureCreatorAttendee(input.attendees ?? [], user),
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
        const scopedDb = tenantDb(trx, tenant);
        const onlineMeetingType = await scopedDb.table('system_interaction_types')
          .where({ type_name: 'Online Meeting' })
          .first('type_id');

        if (!onlineMeetingType?.type_id) {
          throw new Error('Online Meeting interaction type is not configured');
        }

        // Dynamic import: the cross-vertical (scheduling -> clients) idiom that keeps the
        // static dependency graph clean. See custom-rules/no-feature-to-feature-imports.
        const { createInteractionWithSideEffects } = await import('@alga-psa/clients/actions/interactionCreateHelper');
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
            notes: appendJoinUrlToNotes(input.notes, createdMeeting.joinWebUrl),
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
          const scheduleNotes = appendJoinUrlToNotes(input.scheduleEntry?.notes ?? input.notes, createdMeeting.joinWebUrl);
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
        await scopedDb.table('online_meetings').insert({
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
      error: teamsSchedulingActionErrorMessage(error),
    };
  }
});

/**
 * The non-cancelled Teams meeting attached to a schedule entry, if any — the
 * calendar entry editor uses this to decide between "Join" and "Create".
 * Occurrence ids of recurring series resolve to null: meetings only attach to
 * concrete entries.
 */
export const getScheduleEntryTeamsMeeting = withAuth(async (
  user,
  { tenant },
  scheduleEntryId: string,
): Promise<GetScheduleEntryTeamsMeetingResult> => {
  const { knex: db } = await createTenantKnex();

  try {
    const canRead = await hasPermission(user, 'user_schedule', 'read', db);
    if (!canRead) {
      return { success: false, error: 'Permission denied to view schedule entries.' };
    }

    if (!scheduleEntryId || isVirtualScheduleEntryId(scheduleEntryId)) {
      return { success: true, data: null };
    }

    const meeting = await findActiveMeetingForEntry(db, tenant, scheduleEntryId);
    return { success: true, data: meeting ?? null };
  } catch (error) {
    console.error('[getScheduleEntryTeamsMeeting] Error loading Teams meeting for entry:', error);
    return { success: false, error: 'Failed to load the Teams meeting for this schedule entry.' };
  }
});
