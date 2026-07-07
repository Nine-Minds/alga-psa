import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import {
  resolveTeamsMeetingConfigState,
  type TeamsMeetingConfigSkipReason,
} from './meetingConfig';
import { mapGraphStatusToMeetingErrorCode, type TeamsMeetingAttendee } from './createTeamsMeeting';

export interface UpdateTeamsMeetingInput {
  tenantId: string;
  meetingId: string;
  eventId?: string | null;
  startDateTime: string;
  endDateTime: string;
  /** When provided, the Graph event subject is updated too. */
  subject?: string | null;
  /**
   * When provided, replaces the event attendee set (refreshed when the
   * assignee changed) so Graph sends updated invites. Ignored when the
   * tenant has calendar invites turned off.
   */
  attendees?: TeamsMeetingAttendee[] | null;
  /** Optional HTML body refresh. */
  bodyHtml?: string | null;
  appointmentRequestId?: string | null;
}

export type UpdateTeamsMeetingOutcome =
  | { status: 'updated' }
  | { status: 'skipped'; reason: TeamsMeetingConfigSkipReason }
  | { status: 'failed'; errorCode: string; errorMessage: string };

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  return String(error || 'Unknown error');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function updateTeamsMeetingWithResult(
  input: UpdateTeamsMeetingInput
): Promise<UpdateTeamsMeetingOutcome> {
  try {
    const configState = await resolveTeamsMeetingConfigState(input.tenantId);
    if (configState.status !== 'ready') {
      logger.warn('[TeamsMeetings] Unable to update Teams meeting because the tenant is not ready', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'update',
        meeting_id: input.meetingId,
        event_id: input.eventId ?? null,
        reason: configState.reason,
      });
      return { status: 'skipped', reason: configState.reason };
    }
    const config = configState.config;

    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: config.microsoftTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    const subject = normalizeString(input.subject);
    const bodyHtml = normalizeString(input.bodyHtml);
    const attendees = config.sendMeetingInvites && input.attendees ? input.attendees : null;

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.organizerUpn)}/events/${encodeURIComponent(input.eventId ?? input.meetingId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          start: {
            dateTime: input.startDateTime,
            timeZone: 'UTC',
          },
          end: {
            dateTime: input.endDateTime,
            timeZone: 'UTC',
          },
          ...(subject ? { subject } : {}),
          ...(bodyHtml ? { body: { contentType: 'html', content: bodyHtml } } : {}),
          ...(attendees ? { attendees } : {}),
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMessage = `Failed to update Teams meeting (${response.status}): ${errorBody || response.statusText}`;
      logger.warn('[TeamsMeetings] Failed to update Teams meeting', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'update',
        meeting_id: input.meetingId,
        event_id: input.eventId ?? null,
        status: response.status,
        graph_error: errorBody || response.statusText,
      });
      return {
        status: 'failed',
        errorCode: mapGraphStatusToMeetingErrorCode(response.status),
        errorMessage,
      };
    }

    logger.info('[TeamsMeetings] Updated Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'update',
      meeting_id: input.meetingId,
      event_id: input.eventId ?? null,
      status: response.status,
      subject_updated: Boolean(subject),
      attendees_updated: Boolean(attendees),
    });

    return { status: 'updated' };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    logger.warn('[TeamsMeetings] Failed to update Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'update',
      meeting_id: input.meetingId,
      event_id: input.eventId ?? null,
      status: null,
      error: errorMessage,
    });
    return { status: 'failed', errorCode: 'exception', errorMessage };
  }
}

export async function updateTeamsMeeting(
  input: UpdateTeamsMeetingInput
): Promise<boolean> {
  const outcome = await updateTeamsMeetingWithResult(input);
  return outcome.status === 'updated';
}
