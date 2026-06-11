import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { resolveTeamsMeetingExecutionConfig } from './meetingConfig';

export interface CreateTeamsMeetingInput {
  tenantId: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  attendees?: TeamsMeetingAttendee[];
  appointmentRequestId?: string | null;
}

export interface CreateTeamsMeetingResult {
  joinWebUrl: string;
  meetingId: string;
  organizerUpn: string;
  organizerUserId: string;
  eventId: string;
}

export interface TeamsMeetingAttendee {
  emailAddress: {
    address: string;
    name?: string;
  };
  type?: 'required' | 'optional' | 'resource';
}

interface GraphEventResponse {
  id?: unknown;
  onlineMeeting?: {
    joinUrl?: unknown;
  } | null;
}

interface GraphOnlineMeetingListResponse {
  value?: Array<{
    id?: unknown;
    joinWebUrl?: unknown;
  }>;
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

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

async function resolveOnlineMeetingIdFromJoinUrl(params: {
  accessToken: string;
  organizerUpn: string;
  joinWebUrl: string;
}): Promise<string> {
  const filter = encodeURIComponent(`JoinWebUrl eq '${escapeODataString(params.joinWebUrl)}'`);
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(params.organizerUpn)}/onlineMeetings?$filter=${filter}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to resolve online meeting (${response.status}): ${errorBody || response.statusText}`);
  }

  const payload = (await response.json()) as GraphOnlineMeetingListResponse;
  const meetingId = normalizeString(payload.value?.[0]?.id);
  if (!meetingId) {
    throw new Error('Microsoft Graph did not return an onlineMeeting id for the event join URL.');
  }

  return meetingId;
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
        status: null,
      });
      return null;
    }

    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: config.microsoftTenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.organizerUpn)}/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          subject: input.subject,
          start: {
            dateTime: input.startDateTime,
            timeZone: 'UTC',
          },
          end: {
            dateTime: input.endDateTime,
            timeZone: 'UTC',
          },
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
          ...(input.attendees?.length ? { attendees: input.attendees } : {}),
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

    const payload = (await response.json()) as GraphEventResponse;
    const eventId = normalizeString(payload.id);
    const joinWebUrl = normalizeString(payload.onlineMeeting?.joinUrl);

    if (!joinWebUrl || !eventId) {
      logger.warn('[TeamsMeetings] Graph create response was missing meeting fields', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
        status: response.status,
        graph_response: payload,
      });
      return null;
    }

    const meetingId = await resolveOnlineMeetingIdFromJoinUrl({
      accessToken,
      organizerUpn: config.organizerUpn,
      joinWebUrl,
    });

    logger.info('[TeamsMeetings] Created Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'create',
      status: response.status,
      meeting_id: meetingId,
      event_id: eventId,
    });

    return {
      joinWebUrl,
      meetingId,
      organizerUpn: config.organizerUpn,
      organizerUserId: config.organizerUserId,
      eventId,
    };
  } catch (error) {
    logger.warn('[TeamsMeetings] Failed to create Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'create',
      status: null,
      error: normalizeErrorMessage(error),
    });
    return null;
  }
}
