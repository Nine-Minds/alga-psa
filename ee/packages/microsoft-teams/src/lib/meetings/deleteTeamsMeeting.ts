import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import {
  resolveTeamsMeetingConfigState,
  type TeamsMeetingConfigSkipReason,
} from './meetingConfig';
import { mapGraphStatusToMeetingErrorCode } from './createTeamsMeeting';

export interface DeleteTeamsMeetingInput {
  tenantId: string;
  meetingId: string;
  eventId?: string | null;
  appointmentRequestId?: string | null;
}

export type DeleteTeamsMeetingOutcome =
  | { status: 'deleted'; alreadyDeleted: boolean }
  | { status: 'skipped'; reason: TeamsMeetingConfigSkipReason }
  | { status: 'failed'; errorCode: string; errorMessage: string };

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  return String(error || 'Unknown error');
}

export async function deleteTeamsMeetingWithResult(
  input: DeleteTeamsMeetingInput
): Promise<DeleteTeamsMeetingOutcome> {
  try {
    const configState = await resolveTeamsMeetingConfigState(input.tenantId);
    if (configState.status !== 'ready') {
      logger.warn('[TeamsMeetings] Unable to delete Teams meeting because the tenant is not ready', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'delete',
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

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.organizerUpn)}/events/${encodeURIComponent(input.eventId ?? input.meetingId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // The event being gone already is success for cleanup purposes — the
    // cleanup job must be idempotent across retries.
    if (response.status === 404) {
      logger.info('[TeamsMeetings] Teams meeting already deleted', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'delete',
        meeting_id: input.meetingId,
        event_id: input.eventId ?? null,
      });
      return { status: 'deleted', alreadyDeleted: true };
    }

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMessage = `Failed to delete Teams meeting (${response.status}): ${errorBody || response.statusText}`;
      logger.warn('[TeamsMeetings] Failed to delete Teams meeting', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'delete',
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

    logger.info('[TeamsMeetings] Deleted Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'delete',
      meeting_id: input.meetingId,
      event_id: input.eventId ?? null,
      status: response.status,
    });

    return { status: 'deleted', alreadyDeleted: false };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    logger.warn('[TeamsMeetings] Failed to delete Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'delete',
      meeting_id: input.meetingId,
      event_id: input.eventId ?? null,
      status: null,
      error: errorMessage,
    });
    return { status: 'failed', errorCode: 'exception', errorMessage };
  }
}

export async function deleteTeamsMeeting(
  input: DeleteTeamsMeetingInput
): Promise<boolean> {
  const outcome = await deleteTeamsMeetingWithResult(input);
  return outcome.status === 'deleted';
}
