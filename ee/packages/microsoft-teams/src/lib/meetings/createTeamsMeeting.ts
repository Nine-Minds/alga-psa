import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import {
  resolveTeamsMeetingConfigState,
  type TeamsMeetingConfigSkipReason,
} from './meetingConfig';
import { renewTeamsMeetingArtifactSubscriptions } from './artifactSubscriptions';

export interface CreateTeamsMeetingInput {
  tenantId: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  attendees?: TeamsMeetingAttendee[];
  /** Optional HTML body carried onto the Graph event (appointment context + PSA link). */
  bodyHtml?: string | null;
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

export type CreateTeamsMeetingOutcome =
  | { status: 'created'; meeting: CreateTeamsMeetingResult }
  | { status: 'skipped'; reason: TeamsMeetingConfigSkipReason }
  | { status: 'failed'; errorCode: string; errorMessage: string };

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

export function mapGraphStatusToMeetingErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'graph_unauthorized';
  if (status === 404) return 'graph_not_found';
  if (status === 429) return 'graph_throttled';
  if (status >= 500 && status <= 599) return 'graph_server_error';
  return 'graph_error';
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

/**
 * Best-effort artifact subscription ensure at meeting-creation time so a
 * tenant whose 30-minute renewal schedule has not run yet (or is broken)
 * still captures recordings for meetings created right now. Skips quickly
 * when subscriptions are already active (renewal helper checks expiry).
 */
function ensureArtifactSubscriptionsInBackground(tenantId: string): void {
  void renewTeamsMeetingArtifactSubscriptions({ tenantId }).catch((error) => {
    logger.warn('[TeamsMeetings] Failed to ensure artifact subscriptions after meeting creation', {
      tenant: tenantId,
      error: normalizeErrorMessage(error),
    });
  });
}

export async function createTeamsMeetingWithResult(
  input: CreateTeamsMeetingInput
): Promise<CreateTeamsMeetingOutcome> {
  try {
    const configState = await resolveTeamsMeetingConfigState(input.tenantId);
    if (configState.status !== 'ready') {
      logger.warn('[TeamsMeetings] Unable to create Teams meeting because the tenant is not ready', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
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

    // Attendees drive native calendar invites; when the tenant has turned
    // invites off, create the event without attendees (legacy behavior).
    const attendees = config.sendMeetingInvites ? input.attendees ?? [] : [];
    const bodyHtml = normalizeString(input.bodyHtml);

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
          ...(bodyHtml ? { body: { contentType: 'html', content: bodyHtml } } : {}),
          ...(attendees.length ? { attendees } : {}),
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMessage = `Failed to create Teams meeting (${response.status}): ${errorBody || response.statusText}`;
      logger.warn('[TeamsMeetings] Failed to create Teams meeting', {
        tenant: input.tenantId,
        appointment_request_id: input.appointmentRequestId ?? null,
        operation: 'create',
        status: response.status,
        graph_error: errorBody || response.statusText,
      });
      return {
        status: 'failed',
        errorCode: mapGraphStatusToMeetingErrorCode(response.status),
        errorMessage,
      };
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
      return {
        status: 'failed',
        errorCode: 'graph_missing_meeting_fields',
        errorMessage: 'Microsoft Graph created the event but did not return an online meeting join URL.',
      };
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
      attendee_count: attendees.length,
    });

    ensureArtifactSubscriptionsInBackground(input.tenantId);

    return {
      status: 'created',
      meeting: {
        joinWebUrl,
        meetingId,
        organizerUpn: config.organizerUpn,
        organizerUserId: config.organizerUserId,
        eventId,
      },
    };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    logger.warn('[TeamsMeetings] Failed to create Teams meeting', {
      tenant: input.tenantId,
      appointment_request_id: input.appointmentRequestId ?? null,
      operation: 'create',
      status: null,
      error: errorMessage,
    });
    return { status: 'failed', errorCode: 'exception', errorMessage };
  }
}

export async function createTeamsMeeting(
  input: CreateTeamsMeetingInput
): Promise<CreateTeamsMeetingResult | null> {
  const outcome = await createTeamsMeetingWithResult(input);
  return outcome.status === 'created' ? outcome.meeting : null;
}
