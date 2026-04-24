import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { resolveTeamsMeetingExecutionConfig } from './meetingConfig';

export interface DeleteTeamsMeetingInput {
  tenantId: string;
  meetingId: string;
  appointmentRequestId?: string | null;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  return String(error || 'Unknown error');
}

export async function deleteTeamsMeeting(
  input: DeleteTeamsMeetingInput
): Promise<boolean> {
  try {
    const config = await resolveTeamsMeetingExecutionConfig(input.tenantId);
    if (!config) {
      logger.warn('[TeamsMeetings] Unable to delete Teams meeting because the tenant is not ready', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'delete',
        meeting_id: input.meetingId,
        status: null,
      });
      return false;
    }

    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: config.microsoftTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.organizerUpn)}/onlineMeetings/${encodeURIComponent(input.meetingId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.warn('[TeamsMeetings] Failed to delete Teams meeting', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'delete',
        meeting_id: input.meetingId,
        status: response.status,
        graph_error: errorBody || response.statusText,
      });
      return false;
    }

    logger.info('[TeamsMeetings] Deleted Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'delete',
      meeting_id: input.meetingId,
      status: response.status,
    });

    return true;
  } catch (error) {
    logger.warn('[TeamsMeetings] Failed to delete Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'delete',
      meeting_id: input.meetingId,
      status: null,
      error: normalizeErrorMessage(error),
    });
    return false;
  }
}
