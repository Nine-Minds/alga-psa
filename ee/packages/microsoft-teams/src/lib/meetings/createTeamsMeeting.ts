import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { resolveTeamsMeetingExecutionConfig } from './meetingConfig';

export interface CreateTeamsMeetingInput {
  tenantId: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  appointmentRequestId?: string | null;
}

export interface CreateTeamsMeetingResult {
  joinWebUrl: string;
  meetingId: string;
}

interface GraphMeetingResponse {
  id?: unknown;
  joinWebUrl?: unknown;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }

  return String(error || 'Unknown error');
}

export async function createTeamsMeeting(
  input: CreateTeamsMeetingInput
): Promise<CreateTeamsMeetingResult | null> {
  try {
    const config = await resolveTeamsMeetingExecutionConfig(input.tenantId);
    if (!config) {
      logger.warn('[TeamsMeetings] Unable to create Teams meeting because the tenant is not ready', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
      });
      return null;
    }

    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: config.microsoftTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.organizerUpn)}/onlineMeetings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          subject: input.subject,
          startDateTime: input.startDateTime,
          endDateTime: input.endDateTime,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      logger.warn('[TeamsMeetings] Failed to create Teams meeting', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
        status: response.status,
        graph_error: errorBody || response.statusText,
      });
      return null;
    }

    const payload = (await response.json()) as GraphMeetingResponse;
    const joinWebUrl = normalizeString(payload.joinWebUrl);
    const meetingId = normalizeString(payload.id);

    if (!joinWebUrl || !meetingId) {
      logger.warn('[TeamsMeetings] Graph create response was missing meeting fields', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
        status: response.status,
        graph_response: payload,
      });
      return null;
    }

    logger.info('[TeamsMeetings] Created Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'create',
      status: response.status,
      meeting_id: meetingId,
    });

    return {
      joinWebUrl,
      meetingId,
    };
  } catch (error) {
    logger.warn('[TeamsMeetings] Failed to create Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'create',
      error: normalizeErrorMessage(error),
    });
    return null;
  }
}
